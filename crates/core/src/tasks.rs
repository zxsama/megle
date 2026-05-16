use tokio::sync::mpsc;

use std::fs;
use std::path::Path;

use crate::db::{Database, TaskScanProgress, ThumbnailStateUpsert};
use crate::thumbnails::{
    cache_key_for, write_placeholder_thumbnail, ThumbnailDecision, ThumbnailPolicy,
    GRID_320_PROFILE,
};

const TASK_PROGRESS_FLUSH_INTERVAL_ITEMS: i64 = 100;
const THUMBNAIL_SOURCE_CHANGED_ERROR: &str = "thumbnail source changed while processing";

pub type TaskSender = mpsc::Sender<i64>;

pub fn start_worker(worker_database: Database) -> TaskSender {
    let mut worker_database = worker_database;
    worker_database
        .reset_running_root_scan_tasks_for_recovery()
        .expect("reset running root_scan tasks for startup recovery");
    worker_database
        .fail_pending_root_scan_tasks_for_disabled_roots()
        .expect("fail disabled root_scan tasks for startup recovery");
    worker_database
        .reset_running_thumbnail_tasks_for_recovery()
        .expect("reset running thumbnail tasks for startup recovery");
    let recovery_task_ids = worker_database
        .list_pending_root_scan_task_ids()
        .expect("list pending root_scan tasks for startup recovery");
    let recovery_thumbnail_task_ids = worker_database
        .list_pending_thumbnail_task_ids()
        .expect("list pending thumbnail tasks for startup recovery");

    let (sender, mut receiver) = mpsc::channel(128);
    tokio::spawn(async move {
        for task_id in recovery_task_ids {
            run_task(&mut worker_database, task_id);
        }
        for task_id in recovery_thumbnail_task_ids {
            run_task(&mut worker_database, task_id);
        }
        while let Some(task_id) = receiver.recv().await {
            run_task(&mut worker_database, task_id);
        }
    });
    sender
}

fn run_task(database: &mut Database, task_id: i64) {
    if let Err(error) = run_task_with_database(database, task_id) {
        handle_task_error(database, task_id, error);
    }
}

fn handle_task_error(database: &mut Database, task_id: i64, error: anyhow::Error) {
    let error_message = error.to_string();
    if let Ok(Some(task)) = database.get_task(task_id) {
        if task.kind == "thumbnail" {
            if let Some(file_id) = task.file_id {
                if error_message.contains(THUMBNAIL_SOURCE_CHANGED_ERROR) {
                    let _ = database.reset_thumbnail_after_stale_source(
                        file_id,
                        GRID_320_PROFILE,
                        &error_message,
                    );
                } else {
                    let _ = database.publish_thumbnail_failure_for_attempted_source(
                        file_id,
                        GRID_320_PROFILE,
                        task.thumbnail_source_fingerprint.as_deref(),
                        &error_message,
                    );
                }
            }
        }
    }
    let _ = database.mark_task_failed(task_id, &error_message);
}

fn run_task_with_database(database: &mut Database, task_id: i64) -> anyhow::Result<()> {
    let task = database
        .get_task(task_id)?
        .ok_or_else(|| anyhow::anyhow!("task not found: {task_id}"))?;
    if task.status != "pending" {
        return Err(anyhow::anyhow!(
            "task {task_id} is not pending; current status is {}",
            task.status
        ));
    }
    match task.kind.as_str() {
        "root_scan" => {
            database.mark_task_running(task_id)?;
            let root_id = task
                .root_id
                .ok_or_else(|| anyhow::anyhow!("root_scan task missing root id: {task_id}"))?;
            let root = database
                .get_root(root_id)?
                .ok_or_else(|| anyhow::anyhow!("root not found: {root_id}"))?;
            if !root.enabled {
                return Err(anyhow::anyhow!("root is disabled: {root_id}"));
            }
            let mut progress_database = database.reopen()?;
            let mut latest_progress = TaskScanProgress {
                items_seen: 0,
                items_total: None,
                folders_seen: 0,
                media_files_seen: 0,
                skipped_files: 0,
            };
            let mut last_flushed_items = -TASK_PROGRESS_FLUSH_INTERVAL_ITEMS;
            let mut progress_callback = |progress: TaskScanProgress| {
                latest_progress = progress;
                if progress.items_seen - last_flushed_items >= TASK_PROGRESS_FLUSH_INTERVAL_ITEMS {
                    if let Some(progress_database) = &mut progress_database {
                        if progress_database
                            .update_task_scan_progress(task_id, progress)
                            .is_ok()
                        {
                            last_flushed_items = progress.items_seen;
                        }
                    }
                }
            };
            let summary =
                crate::scan::scan_root_with_progress(database, &root, &mut progress_callback)?;
            drop(progress_callback);
            latest_progress = TaskScanProgress {
                items_seen: latest_progress.items_seen,
                items_total: None,
                folders_seen: summary.folders_seen as i64,
                media_files_seen: summary.media_files_seen as i64,
                skipped_files: summary.skipped_files as i64,
            };
            database.update_task_scan_progress(task_id, latest_progress)?;
            database.mark_task_succeeded(task_id)?;
            Ok(())
        }
        "thumbnail" => {
            let cache_root = database.default_thumbnail_cache_dir();
            run_thumbnail_task_with_cache(database, task_id, &cache_root)
        }
        other => Err(anyhow::anyhow!("unsupported task kind: {other}")),
    }
}

fn run_thumbnail_task_with_cache(
    database: &mut Database,
    task_id: i64,
    cache_root: &Path,
) -> anyhow::Result<()> {
    run_thumbnail_task_with_cache_and_before_publish(database, task_id, cache_root, |_| {})
}

fn run_thumbnail_task_with_cache_and_before_publish(
    database: &mut Database,
    task_id: i64,
    cache_root: &Path,
    before_publish: impl FnOnce(&mut Database),
) -> anyhow::Result<()> {
    let task = database
        .get_task(task_id)?
        .ok_or_else(|| anyhow::anyhow!("task not found: {task_id}"))?;
    if task.status != "pending" && task.status != "running" {
        return Err(anyhow::anyhow!(
            "task {task_id} is not pending or running; current status is {}",
            task.status
        ));
    }
    let file_id = task
        .file_id
        .ok_or_else(|| anyhow::anyhow!("thumbnail task missing file id: {task_id}"))?;
    let source = database
        .get_thumbnail_source(file_id)?
        .ok_or_else(|| anyhow::anyhow!("media item not found: {file_id}"))?;
    let policy = ThumbnailPolicy::grid_320();
    let source_fingerprint = source.source_fingerprint(GRID_320_PROFILE);
    if task.status == "pending" {
        database.mark_thumbnail_task_running(task_id, &source_fingerprint)?;
    }

    let dimensions = if source.metadata_status.as_deref() == Some("ready") {
        (source.width, source.height)
    } else {
        (None, None)
    };

    if policy.initial_state(source.media_kind.as_deref(), dimensions.0, dimensions.1)
        == ThumbnailDecision::SkippedSmall
    {
        before_publish(database);
        let published = database.upsert_thumbnail_state_if_source_fingerprint_current(
            ThumbnailStateUpsert {
                file_id,
                profile: GRID_320_PROFILE.to_string(),
                state: "skipped_small".to_string(),
                cache_key: None,
                width: None,
                height: None,
                byte_size: None,
                error: None,
                source_fingerprint: Some(source_fingerprint.clone()),
            },
            &source_fingerprint,
        )?;
        if !published {
            return Err(anyhow::anyhow!(
                "{THUMBNAIL_SOURCE_CHANGED_ERROR}: {file_id}"
            ));
        }
        database.mark_task_succeeded(task_id)?;
        return Ok(());
    }

    let cache_key = cache_key_for(&source.cache_identity(), GRID_320_PROFILE);
    let generated = write_placeholder_thumbnail(cache_root, &cache_key)?;
    before_publish(database);
    let published = database.upsert_thumbnail_state_if_source_fingerprint_current(
        ThumbnailStateUpsert {
            file_id,
            profile: GRID_320_PROFILE.to_string(),
            state: "ready".to_string(),
            cache_key: Some(cache_key.clone()),
            width: Some(generated.width),
            height: Some(generated.height),
            byte_size: Some(generated.byte_size),
            error: None,
            source_fingerprint: Some(source_fingerprint.clone()),
        },
        &source_fingerprint,
    )?;
    if !published {
        cleanup_thumbnail_cache_file(cache_root, &cache_key);
        return Err(anyhow::anyhow!(
            "{THUMBNAIL_SOURCE_CHANGED_ERROR}: {file_id}"
        ));
    }
    database.mark_task_succeeded(task_id)?;
    Ok(())
}

fn cleanup_thumbnail_cache_file(cache_root: &Path, cache_key: &str) {
    let path = cache_root.join(cache_key);
    let _ = fs::remove_file(&path);
    let mut current = path.parent();
    while let Some(directory) = current {
        if directory == cache_root {
            break;
        }
        if fs::remove_dir(directory).is_err() {
            break;
        }
        current = directory.parent();
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};

    use super::*;
    use crate::db::{FileUpsert, FolderUpsert, NewRoot};

    #[test]
    fn thumbnail_task_writes_cache_placeholder_and_marks_task_succeeded() {
        let temp_root = unique_temp_dir("media");
        fs::create_dir_all(&temp_root).expect("create media root");
        fs::write(temp_root.join("image.jpg"), b"not a real image").expect("write media file");
        let cache_root = unique_temp_dir("cache");
        fs::create_dir_all(&cache_root).expect("create cache root");

        let mut database = Database::open_in_memory().expect("open database");
        database.apply_migrations().expect("apply migrations");
        let file_id = seed_media_file(&database, &temp_root, "image.jpg");
        let request = database
            .request_thumbnail_task(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("request thumbnail task");

        let task_id = request.task_id.expect("thumbnail task id");
        run_thumbnail_task_with_cache(&mut database, task_id, &cache_root)
            .expect("run thumbnail task");

        let task = database
            .get_task(task_id)
            .expect("get task")
            .expect("task exists");
        assert_eq!(task.status, "succeeded");
        assert_eq!(task.error, None);

        let thumbnail = database
            .get_thumbnail(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("get thumbnail")
            .expect("thumbnail exists");
        assert_eq!(thumbnail.state, "ready");
        assert_eq!(thumbnail.output_format, crate::thumbnails::GENERATED_FORMAT);
        let cache_key = thumbnail.cache_key.expect("cache key");
        assert!(crate::thumbnails::is_safe_cache_key(&cache_key));
        assert_eq!(thumbnail.width, Some(320));
        assert_eq!(thumbnail.height, Some(320));
        assert!(thumbnail.byte_size.expect("byte size") > 0);

        let cache_path = cache_root.join(&cache_key);
        assert!(cache_path.exists());
        let cache_bytes = fs::read(cache_path).expect("read generated thumbnail bytes");
        assert_eq!(&cache_bytes[0..4], b"RIFF");
        assert_eq!(&cache_bytes[8..12], b"WEBP");
        assert!(fs::metadata(temp_root.join(&cache_key)).is_err());

        fs::remove_dir_all(temp_root).expect("cleanup media root");
        fs::remove_dir_all(cache_root).expect("cleanup cache root");
    }

    #[test]
    fn startup_recovery_resets_stale_running_thumbnail_tasks() {
        let temp_root = unique_temp_dir("media");
        fs::create_dir_all(&temp_root).expect("create media root");
        fs::write(temp_root.join("image.jpg"), b"not a real image").expect("write media file");

        let database = Database::open_in_memory().expect("open database");
        database.apply_migrations().expect("apply migrations");
        let file_id = seed_media_file(&database, &temp_root, "image.jpg");
        let request = database
            .request_thumbnail_task(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("request thumbnail task");
        let task_id = request.task_id.expect("task id");
        database.mark_task_running(task_id).expect("mark running");

        let reset = database
            .reset_running_thumbnail_tasks_for_recovery()
            .expect("reset thumbnail tasks");
        assert_eq!(reset, 1);
        let task = database
            .get_task(task_id)
            .expect("get task")
            .expect("task exists");
        assert_eq!(task.status, "pending");
        let pending = database
            .list_pending_thumbnail_task_ids()
            .expect("list pending thumbnails");
        assert_eq!(pending, vec![task_id]);

        fs::remove_dir_all(temp_root).expect("cleanup media root");
    }

    #[test]
    fn thumbnail_task_does_not_publish_ready_when_source_changes_before_completion() {
        let temp_root = unique_temp_dir("media");
        fs::create_dir_all(&temp_root).expect("create media root");
        fs::write(temp_root.join("image.jpg"), b"not a real image").expect("write media file");
        let cache_root = unique_temp_dir("cache");
        fs::create_dir_all(&cache_root).expect("create cache root");

        let mut database = Database::open_in_memory().expect("open database");
        database.apply_migrations().expect("apply migrations");
        let file_id = seed_media_file(&database, &temp_root, "image.jpg");
        let request = database
            .request_thumbnail_task(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("request thumbnail task");
        let task_id = request.task_id.expect("thumbnail task id");

        let error = run_thumbnail_task_with_cache_and_before_publish(
            &mut database,
            task_id,
            &cache_root,
            |database| {
                let source = database
                    .get_thumbnail_source(file_id)
                    .expect("get source")
                    .expect("source exists");
                database
                    .upsert_file(FileUpsert {
                        root_id: source.root_id,
                        folder_id: source.folder_id,
                        name: source.name,
                        ext: ".jpg".to_string(),
                        size: source.size + 1,
                        mtime: source.mtime + 1,
                        ctime: None,
                        file_key: Some("worker-identity-changed".to_string()),
                    })
                    .expect("change source identity");
            },
        )
        .expect_err("stale thumbnail publish should fail");

        assert!(error.to_string().contains("source changed"));
        let thumbnail = database
            .get_thumbnail(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("get thumbnail")
            .expect("thumbnail exists");
        assert_ne!(thumbnail.state, "ready");
        assert_eq!(thumbnail.cache_key, None);
        let cache_entries = fs::read_dir(&cache_root)
            .expect("read cache root")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect cache entries");
        assert_eq!(cache_entries.len(), 0);

        fs::remove_dir_all(temp_root).expect("cleanup media root");
        fs::remove_dir_all(cache_root).expect("cleanup cache root");
    }

    #[test]
    fn stale_thumbnail_error_handler_leaves_current_source_regeneratable() {
        let temp_root = unique_temp_dir("media");
        fs::create_dir_all(&temp_root).expect("create media root");
        fs::write(temp_root.join("image.jpg"), b"not a real image").expect("write media file");

        let mut database = Database::open_in_memory().expect("open database");
        database.apply_migrations().expect("apply migrations");
        let file_id = seed_media_file(&database, &temp_root, "image.jpg");
        let request = database
            .request_thumbnail_task(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("request thumbnail task");
        let task_id = request.task_id.expect("thumbnail task id");
        database.mark_task_running(task_id).expect("mark running");

        handle_task_error(
            &mut database,
            task_id,
            anyhow::anyhow!("thumbnail source changed while processing: {file_id}"),
        );

        let task = database
            .get_task(task_id)
            .expect("get task")
            .expect("task exists");
        assert_eq!(task.status, "failed");
        let thumbnail = database
            .get_thumbnail(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("get thumbnail")
            .expect("thumbnail exists");
        assert_eq!(thumbnail.state, "pending");
        assert_eq!(thumbnail.cache_key, None);

        let next_request = database
            .request_thumbnail_task(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("request thumbnail again");
        assert_eq!(next_request.thumbnail.state, "queued");
        assert!(next_request.queued);

        fs::remove_dir_all(temp_root).expect("cleanup media root");
    }

    #[test]
    fn thumbnail_error_handler_records_failed_with_attempt_fingerprint_when_source_matches() {
        let temp_root = unique_temp_dir("media");
        fs::create_dir_all(&temp_root).expect("create media root");
        fs::write(temp_root.join("image.jpg"), b"not a real image").expect("write media file");

        let mut database = Database::open_in_memory().expect("open database");
        database.apply_migrations().expect("apply migrations");
        let file_id = seed_media_file(&database, &temp_root, "image.jpg");
        let source_fingerprint = database
            .get_thumbnail_source(file_id)
            .expect("get source")
            .expect("source exists")
            .source_fingerprint(crate::thumbnails::GRID_320_PROFILE);
        let request = database
            .request_thumbnail_task(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("request thumbnail task");
        let task_id = request.task_id.expect("thumbnail task id");
        database.mark_task_running(task_id).expect("mark running");

        handle_task_error(&mut database, task_id, anyhow::anyhow!("decode failed"));

        let thumbnail = database
            .get_thumbnail(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("get thumbnail")
            .expect("thumbnail exists");
        assert_eq!(thumbnail.state, "failed");
        assert_eq!(thumbnail.error.as_deref(), Some("decode failed"));
        assert_eq!(
            thumbnail.source_fingerprint.as_deref(),
            Some(source_fingerprint.as_str())
        );

        fs::remove_dir_all(temp_root).expect("cleanup media root");
    }

    #[test]
    fn thumbnail_error_handler_resets_generic_failure_when_source_changed() {
        let temp_root = unique_temp_dir("media");
        fs::create_dir_all(&temp_root).expect("create media root");
        fs::write(temp_root.join("image.jpg"), b"not a real image").expect("write media file");

        let mut database = Database::open_in_memory().expect("open database");
        database.apply_migrations().expect("apply migrations");
        let file_id = seed_media_file(&database, &temp_root, "image.jpg");
        let request = database
            .request_thumbnail_task(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("request thumbnail task");
        let task_id = request.task_id.expect("thumbnail task id");
        database.mark_task_running(task_id).expect("mark running");
        let source = database
            .get_thumbnail_source(file_id)
            .expect("get source")
            .expect("source exists");
        database
            .upsert_file(FileUpsert {
                root_id: source.root_id,
                folder_id: source.folder_id,
                name: source.name,
                ext: ".jpg".to_string(),
                size: source.size + 1,
                mtime: source.mtime + 1,
                ctime: None,
                file_key: Some("worker-identity-changed".to_string()),
            })
            .expect("change source identity");

        handle_task_error(&mut database, task_id, anyhow::anyhow!("decode failed"));

        let thumbnail = database
            .get_thumbnail(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("get thumbnail")
            .expect("thumbnail exists");
        assert_eq!(thumbnail.state, "pending");
        assert_eq!(thumbnail.cache_key, None);
        assert_eq!(thumbnail.source_fingerprint, None);

        let next_request = database
            .request_thumbnail_task(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("request thumbnail again");
        assert_eq!(next_request.thumbnail.state, "queued");
        assert!(next_request.queued);

        fs::remove_dir_all(temp_root).expect("cleanup media root");
    }

    #[test]
    fn coalesced_running_thumbnail_failure_does_not_fail_new_source() {
        let temp_root = unique_temp_dir("media");
        fs::create_dir_all(&temp_root).expect("create media root");
        fs::write(temp_root.join("image.jpg"), b"not a real image").expect("write media file");

        let mut database = Database::open_in_memory().expect("open database");
        database.apply_migrations().expect("apply migrations");
        let file_id = seed_media_file(&database, &temp_root, "image.jpg");
        let first = database
            .request_thumbnail_task(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("request thumbnail task");
        let task_id = first.task_id.expect("thumbnail task id");
        database.mark_task_running(task_id).expect("mark running");

        let old_source_fingerprint = database
            .get_thumbnail_source(file_id)
            .expect("get source")
            .expect("source exists")
            .source_fingerprint(crate::thumbnails::GRID_320_PROFILE);
        let source = database
            .get_thumbnail_source(file_id)
            .expect("get source")
            .expect("source exists");
        database
            .upsert_file(FileUpsert {
                root_id: source.root_id,
                folder_id: source.folder_id,
                name: source.name,
                ext: ".jpg".to_string(),
                size: source.size + 1,
                mtime: source.mtime + 1,
                ctime: None,
                file_key: Some("coalesced-current-source".to_string()),
            })
            .expect("change source identity");

        let coalesced = database
            .request_thumbnail_task(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("request thumbnail after source change");
        assert_eq!(coalesced.task_id, Some(task_id));
        assert!(!coalesced.queued);
        assert_ne!(
            coalesced.thumbnail.source_fingerprint.as_deref(),
            Some(old_source_fingerprint.as_str())
        );
        let coalesced_task = database
            .get_task(task_id)
            .expect("get coalesced task")
            .expect("coalesced task exists");
        assert_eq!(
            coalesced_task.thumbnail_source_fingerprint.as_deref(),
            Some(old_source_fingerprint.as_str())
        );

        handle_task_error(&mut database, task_id, anyhow::anyhow!("decode failed"));

        let thumbnail = database
            .get_thumbnail(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("get thumbnail")
            .expect("thumbnail exists");
        assert_eq!(thumbnail.state, "pending");
        assert_eq!(thumbnail.cache_key, None);
        assert_eq!(thumbnail.source_fingerprint, None);

        let next_request = database
            .request_thumbnail_task(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("request thumbnail again");
        assert_eq!(next_request.thumbnail.state, "queued");
        assert!(next_request.queued);

        fs::remove_dir_all(temp_root).expect("cleanup media root");
    }

    fn seed_media_file(database: &Database, root_path: &Path, name: &str) -> i64 {
        let root_id = database
            .add_root(NewRoot {
                path: root_path.to_string_lossy().to_string(),
                display_name: "Thumbnail Worker".to_string(),
            })
            .expect("add root");
        let folder_id = database
            .upsert_folder(FolderUpsert {
                root_id,
                parent_id: None,
                name: String::new(),
                path_hash: "root-hash".to_string(),
                mtime: Some(1),
            })
            .expect("insert folder");
        let file_id = database
            .upsert_file(FileUpsert {
                root_id,
                folder_id,
                name: name.to_string(),
                ext: ".jpg".to_string(),
                size: 16,
                mtime: 2,
                ctime: None,
                file_key: Some("worker-identity".to_string()),
            })
            .expect("insert file");
        database
            .upsert_media_kind(file_id, "image")
            .expect("insert media kind");
        file_id
    }

    fn unique_temp_dir(label: &str) -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

        std::env::temp_dir().join(format!(
            "megle_thumbnail_task_test_{}_{}_{}_{}",
            label,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time")
                .as_nanos(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ))
    }
}
