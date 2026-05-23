use tokio::sync::mpsc;

use std::fs;
use std::path::Path;

use crate::db::{Database, TaskScanProgress, ThumbBlobRecord, ThumbnailStateUpsert};
use crate::scan::{ScanOptions, TaskAttemptGuard};
use crate::thumbnails::{
    cache_key_for, generate_image_thumbnail_bytes, generate_video_thumbnail_bytes,
    ThumbnailDecision, ThumbnailPolicy, GENERATED_FORMAT, GRID_320_PROFILE,
};

const TASK_PROGRESS_FLUSH_INTERVAL_ITEMS: i64 = 100;
const THUMBNAIL_SOURCE_CHANGED_ERROR: &str = "thumbnail source changed while processing";
const FFMPEG_NOT_AVAILABLE_ERROR: &str = "ffmpeg not available";

pub type TaskSender = mpsc::Sender<i64>;

pub fn start_worker(worker_database: Database) -> TaskSender {
    start_worker_with_ffmpeg(worker_database, crate::thumbnails::ffmpeg_available())
}

/// Variant that lets callers (and tests) decide whether the worker should
/// attempt video poster generation. Used by Core startup to detect ffmpeg
/// once and forward the result without re-spawning per task.
pub fn start_worker_with_ffmpeg(worker_database: Database, ffmpeg_available: bool) -> TaskSender {
    if !ffmpeg_available {
        tracing::warn!(
            "ffmpeg binary not found on PATH; video thumbnail tasks will fail with \"{FFMPEG_NOT_AVAILABLE_ERROR}\""
        );
    }
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
    // Take the startup pending-task snapshot synchronously, before spawning
    // the worker task. This avoids a race where a freshly-enqueued task is
    // both delivered through the channel and picked up by the in-spawn
    // recovery drain.
    let recovery_task_ids = worker_database
        .list_pending_root_scan_task_ids()
        .expect("list pending root_scan tasks for startup recovery");
    let recovery_thumbnail_task_ids = worker_database
        .list_pending_thumbnail_task_ids()
        .expect("list pending thumbnail tasks for startup recovery");

    let (sender, mut receiver) = mpsc::channel(128);
    tokio::spawn(async move {
        for task_id in recovery_task_ids {
            run_task(&mut worker_database, task_id, ffmpeg_available);
        }
        for task_id in recovery_thumbnail_task_ids {
            run_task(&mut worker_database, task_id, ffmpeg_available);
        }
        while let Some(task_id) = receiver.recv().await {
            run_task(&mut worker_database, task_id, ffmpeg_available);
            // Persisted pending tasks (e.g. ones the watcher created when
            // the channel was full or closed) would otherwise wait forever
            // for a queue message that never arrives. Drain them in
            // scheduler order before going back to `recv().await`. The
            // just-completed task is no longer in the pending list, so
            // this does not double-process the channel-delivered task.
            drain_pending_persisted_tasks(&mut worker_database, ffmpeg_available);
        }
    });
    sender
}

/// Run any pending root_scan and thumbnail tasks persisted in the database
/// that haven't already been observed via the in-memory channel. This covers
/// the case where the watcher persisted a pending task but `try_send` failed
/// (channel full or closed).
fn drain_pending_persisted_tasks(database: &mut Database, ffmpeg_available: bool) {
    let pending_root_scan_ids = match database.list_pending_root_scan_task_ids() {
        Ok(ids) => ids,
        Err(error) => {
            tracing::warn!(%error, "failed to list pending root_scan tasks for drain");
            return;
        }
    };
    for task_id in pending_root_scan_ids {
        run_task(database, task_id, ffmpeg_available);
    }
    let pending_thumbnail_ids = match database.list_pending_thumbnail_task_ids() {
        Ok(ids) => ids,
        Err(error) => {
            tracing::warn!(%error, "failed to list pending thumbnail tasks for drain");
            return;
        }
    };
    for task_id in pending_thumbnail_ids {
        run_task(database, task_id, ffmpeg_available);
    }
}

fn run_task(database: &mut Database, task_id: i64, ffmpeg_available: bool) {
    let attempt_generation = database.current_task_attempt_generation(task_id).ok();
    if let Err(error) = run_task_with_database(database, task_id, ffmpeg_available) {
        if let Some(attempt_generation) = attempt_generation {
            handle_task_error_for_attempt(database, task_id, attempt_generation, error);
        } else {
            handle_task_error(database, task_id, error);
        }
    }
}

fn handle_task_error(database: &mut Database, task_id: i64, error: anyhow::Error) {
    if let Ok(attempt_generation) = database.current_task_attempt_generation(task_id) {
        handle_task_error_for_attempt(database, task_id, attempt_generation, error);
    }
}

fn handle_task_error_for_attempt(
    database: &mut Database,
    task_id: i64,
    attempt_generation: i64,
    error: anyhow::Error,
) {
    if !database
        .task_attempt_is_current(task_id, attempt_generation)
        .unwrap_or(false)
    {
        return;
    }
    if database.task_is_cancelled(task_id).unwrap_or(false) {
        return;
    }
    let error_message = error.to_string();
    if let Ok(Some(task)) = database.get_task(task_id) {
        if task.kind == "thumbnail" {
            if let Some(file_id) = task.file_id {
                if error_message.contains(THUMBNAIL_SOURCE_CHANGED_ERROR) {
                    let _ = database.reset_thumbnail_after_stale_source_for_task_attempt(
                        file_id,
                        GRID_320_PROFILE,
                        &error_message,
                        task_id,
                        attempt_generation,
                    );
                } else {
                    let _ = database
                        .publish_thumbnail_failure_for_attempted_source_for_task_attempt(
                            file_id,
                            GRID_320_PROFILE,
                            task.thumbnail_source_fingerprint.as_deref(),
                            &error_message,
                            task_id,
                            attempt_generation,
                        );
                }
            }
        }
    }
    let _ = database.mark_task_failed_for_attempt(task_id, attempt_generation, &error_message);
}

fn run_task_with_database(
    database: &mut Database,
    task_id: i64,
    ffmpeg_available: bool,
) -> anyhow::Result<()> {
    let task = database
        .get_task(task_id)?
        .ok_or_else(|| anyhow::anyhow!("task not found: {task_id}"))?;
    if task.status == "cancelled" {
        return Ok(());
    }
    if task.status != "pending" {
        // Another worker path (channel send vs scheduler drain) already
        // moved this task out of `pending`. Skipping silently here is safe:
        // whichever path actually claimed the task is responsible for its
        // terminal status, and reporting "not pending" as a failure here
        // would clobber that path's outcome.
        return Ok(());
    }
    let attempt_generation = task.attempt_generation;
    match task.kind.as_str() {
        "root_scan" => {
            database.mark_task_running_for_attempt(task_id, attempt_generation)?;
            let root_id = task
                .root_id
                .ok_or_else(|| anyhow::anyhow!("root_scan task missing root id: {task_id}"))?;
            let root = database
                .get_root(root_id)?
                .ok_or_else(|| anyhow::anyhow!("root not found: {root_id}"))?;
            if !root.enabled {
                return Err(anyhow::anyhow!("root is disabled: {root_id}"));
            }
            let progress_database = std::cell::RefCell::new(database.reopen()?);
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
                    if let Some(progress_database) = progress_database.borrow_mut().as_mut() {
                        if progress_database
                            .update_task_scan_progress_for_attempt(
                                task_id,
                                attempt_generation,
                                progress,
                            )
                            .is_ok()
                        {
                            last_flushed_items = progress.items_seen;
                        }
                    }
                }
            };
            let mut cancellation_callback = || {
                if let Some(progress_database) = progress_database.borrow_mut().as_mut() {
                    progress_database.ensure_task_not_cancelled(task_id)?;
                    if !progress_database.task_attempt_is_current(task_id, attempt_generation)? {
                        return Err(anyhow::anyhow!(
                            "task {task_id} attempt superseded while scanning"
                        ));
                    }
                }
                Ok(())
            };
            let summary = crate::scan::scan_root_with_options(
                database,
                &root,
                ScanOptions {
                    write_batch_size: crate::scan::DEFAULT_SCAN_WRITE_BATCH_SIZE,
                    progress_callback: Some(&mut progress_callback),
                    cancellation_callback: Some(&mut cancellation_callback),
                    task_attempt_guard: Some(TaskAttemptGuard {
                        task_id,
                        attempt_generation,
                    }),
                    #[cfg(test)]
                    batch_observer: None,
                },
            )?;
            drop(progress_callback);
            database.ensure_task_not_cancelled(task_id)?;
            if !database.task_attempt_is_current(task_id, attempt_generation)? {
                return Err(anyhow::anyhow!(
                    "task {task_id} attempt superseded before completion"
                ));
            }
            latest_progress = TaskScanProgress {
                items_seen: latest_progress.items_seen,
                items_total: None,
                folders_seen: summary.folders_seen as i64,
                media_files_seen: summary.media_files_seen as i64,
                skipped_files: summary.skipped_files as i64,
            };
            database.update_task_scan_progress_for_attempt(
                task_id,
                attempt_generation,
                latest_progress,
            )?;
            database.mark_task_succeeded_for_attempt(task_id, attempt_generation)?;
            Ok(())
        }
        "thumbnail" => {
            let cache_root = database.default_thumbnail_cache_dir();
            run_thumbnail_task_with_cache_for_attempt(
                database,
                task_id,
                attempt_generation,
                &cache_root,
                ffmpeg_available,
            )
        }
        other => Err(anyhow::anyhow!("unsupported task kind: {other}")),
    }
}

#[cfg(test)]
fn run_thumbnail_task_with_cache(
    database: &mut Database,
    task_id: i64,
    cache_root: &Path,
    ffmpeg_available: bool,
) -> anyhow::Result<()> {
    let attempt_generation = database.current_task_attempt_generation(task_id)?;
    run_thumbnail_task_with_cache_for_attempt(
        database,
        task_id,
        attempt_generation,
        cache_root,
        ffmpeg_available,
    )
}

fn run_thumbnail_task_with_cache_for_attempt(
    database: &mut Database,
    task_id: i64,
    attempt_generation: i64,
    cache_root: &Path,
    ffmpeg_available: bool,
) -> anyhow::Result<()> {
    run_thumbnail_task_with_cache_and_before_publish_for_attempt(
        database,
        task_id,
        attempt_generation,
        cache_root,
        ffmpeg_available,
        |_| {},
    )
}

#[cfg(test)]
fn run_thumbnail_task_with_cache_and_before_publish(
    database: &mut Database,
    task_id: i64,
    cache_root: &Path,
    ffmpeg_available: bool,
    before_publish: impl FnOnce(&mut Database),
) -> anyhow::Result<()> {
    let attempt_generation = database.current_task_attempt_generation(task_id)?;
    run_thumbnail_task_with_cache_and_before_publish_for_attempt(
        database,
        task_id,
        attempt_generation,
        cache_root,
        ffmpeg_available,
        before_publish,
    )
}

fn run_thumbnail_task_with_cache_and_before_publish_for_attempt(
    database: &mut Database,
    task_id: i64,
    attempt_generation: i64,
    cache_root: &Path,
    ffmpeg_available: bool,
    before_publish: impl FnOnce(&mut Database),
) -> anyhow::Result<()> {
    let task = database
        .get_task(task_id)?
        .ok_or_else(|| anyhow::anyhow!("task not found: {task_id}"))?;
    if task.status == "cancelled" {
        return Ok(());
    }
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
        database.mark_thumbnail_task_running_for_attempt(
            task_id,
            attempt_generation,
            &source_fingerprint,
        )?;
    }
    database.ensure_task_not_cancelled(task_id)?;
    if !database.task_attempt_is_current(task_id, attempt_generation)? {
        return Err(anyhow::anyhow!(
            "task {task_id} attempt superseded before thumbnail processing"
        ));
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
        database.ensure_task_not_cancelled(task_id)?;
        if !database.task_attempt_is_current(task_id, attempt_generation)? {
            return Err(anyhow::anyhow!(
                "task {task_id} attempt superseded before thumbnail publish"
            ));
        }
        let published = database
            .upsert_thumbnail_state_if_source_fingerprint_and_task_attempt_current(
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
                task_id,
                attempt_generation,
            )?;
        if !published {
            return Err(anyhow::anyhow!(
                "{THUMBNAIL_SOURCE_CHANGED_ERROR}: {file_id}"
            ));
        }
        database.mark_task_succeeded_for_attempt(task_id, attempt_generation)?;
        return Ok(());
    }

    let cache_key = cache_key_for(&source.cache_identity(), GRID_320_PROFILE);
    let source_path = database
        .resolve_file_source_path(file_id)?
        .ok_or_else(|| anyhow::anyhow!("source path not found for file {file_id}"))?;
    let media_kind = source.media_kind.as_deref();
    let generated = match media_kind {
        Some("image") => generate_image_thumbnail_bytes(&source_path)?,
        Some("video") => {
            if !ffmpeg_available {
                return Err(anyhow::anyhow!(FFMPEG_NOT_AVAILABLE_ERROR));
            }
            generate_video_thumbnail_bytes(&source_path)?
        }
        Some(other) => {
            return Err(anyhow::anyhow!(
                "thumbnail decode failed: unsupported media kind \"{other}\""
            ));
        }
        None => {
            return Err(anyhow::anyhow!(
                "thumbnail decode failed: media kind not classified"
            ));
        }
    };
    before_publish(database);
    if let Err(error) = database.ensure_task_not_cancelled(task_id) {
        cleanup_thumbnail_cache_file(cache_root, &cache_key);
        return Err(error);
    }
    if !database.task_attempt_is_current(task_id, attempt_generation)? {
        cleanup_thumbnail_cache_file(cache_root, &cache_key);
        return Err(anyhow::anyhow!(
            "task {task_id} attempt superseded before thumbnail publish"
        ));
    }
    let now = unix_timestamp();
    let blob = ThumbBlobRecord {
        file_id,
        profile: GRID_320_PROFILE.to_string(),
        data: generated.data,
        width: generated.width,
        height: generated.height,
        byte_size: generated.byte_size,
        output_format: GENERATED_FORMAT.to_string(),
        created_at: now,
        updated_at: now,
    };
    let published = database
        .publish_thumbnail_blob_and_state_if_source_fingerprint_and_task_attempt_current(
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
            blob,
            &source_fingerprint,
            task_id,
            attempt_generation,
        )?;
    if !published {
        cleanup_thumbnail_cache_file(cache_root, &cache_key);
        return Err(anyhow::anyhow!(
            "{THUMBNAIL_SOURCE_CHANGED_ERROR}: {file_id}"
        ));
    }
    database.mark_task_succeeded_for_attempt(task_id, attempt_generation)?;
    Ok(())
}

fn unix_timestamp() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
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
    fn thumbnail_task_writes_real_webp_and_marks_task_succeeded() {
        let temp_root = unique_temp_dir("media");
        fs::create_dir_all(&temp_root).expect("create media root");
        write_test_image(&temp_root.join("image.jpg"), 800, 400);
        let cache_root = unique_temp_dir("cache");
        fs::create_dir_all(&cache_root).expect("create cache root");

        let mut database = Database::open_in_memory().expect("open database");
        database.apply_migrations().expect("apply migrations");
        let file_id = seed_media_file(&database, &temp_root, "image.jpg");
        let request = database
            .request_thumbnail_task(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("request thumbnail task");

        let task_id = request.task_id.expect("thumbnail task id");
        run_thumbnail_task_with_cache(&mut database, task_id, &cache_root, true)
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
        // Source is 800x400 (landscape, short side 400). After resizing the
        // short side to 320 the long side becomes 640. Real WebP, not
        // placeholder.
        assert_eq!(thumbnail.width, Some(640));
        assert_eq!(thumbnail.height, Some(320));
        assert!(thumbnail.byte_size.expect("byte size") > 0);

        let blob = database
            .get_thumb_blob(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("read thumb blob")
            .expect("thumb blob exists");
        assert_eq!(&blob.data[0..4], b"RIFF");
        assert_eq!(&blob.data[8..12], b"WEBP");
        assert!(fs::read_dir(&cache_root)
            .expect("read cache root")
            .next()
            .is_none());
        assert!(fs::metadata(temp_root.join(&cache_key)).is_err());

        fs::remove_dir_all(temp_root).expect("cleanup media root");
        fs::remove_dir_all(cache_root).expect("cleanup cache root");
    }

    #[test]
    fn thumbnail_task_persists_grid_320_bytes_in_thumb_blobs() {
        let temp_root = unique_temp_dir("thumb_blob");
        fs::create_dir_all(&temp_root).expect("create media root");
        write_test_image(&temp_root.join("image.jpg"), 800, 400);

        let mut database = Database::open_in_memory().expect("open database");
        database.apply_migrations().expect("apply migrations");
        let file_id = seed_media_file(&database, &temp_root, "image.jpg");
        let request = database
            .request_thumbnail_task(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("request thumbnail");

        run_task(&mut database, request.task_id.expect("task id"), true);

        let blob = database
            .get_thumb_blob(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("read thumb blob")
            .expect("thumb blob exists");
        assert!(blob.data.starts_with(b"RIFF"));
        assert_eq!(&blob.data[8..12], b"WEBP");
        assert_eq!(blob.output_format, crate::thumbnails::GENERATED_FORMAT);
        assert_eq!(blob.width, 640);
        assert_eq!(blob.height, 320);
        assert_eq!(blob.byte_size, blob.data.len() as i64);

        fs::remove_dir_all(temp_root).expect("cleanup media root");
    }

    #[test]
    fn thumbnail_task_for_video_without_ffmpeg_marks_failed_with_clear_error() {
        let temp_root = unique_temp_dir("media");
        fs::create_dir_all(&temp_root).expect("create media root");
        // 1-byte placeholder masquerading as a video. We never invoke ffmpeg
        // because the worker is configured with ffmpeg_available = false.
        fs::write(temp_root.join("clip.mp4"), [0u8]).expect("write fake video");
        let cache_root = unique_temp_dir("cache");
        fs::create_dir_all(&cache_root).expect("create cache root");

        let mut database = Database::open_in_memory().expect("open database");
        database.apply_migrations().expect("apply migrations");
        let file_id = seed_media_file_with_kind(&database, &temp_root, "clip.mp4", "video");
        let request = database
            .request_thumbnail_task(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("request thumbnail task");
        let task_id = request.task_id.expect("thumbnail task id");

        run_task(&mut database, task_id, false);

        let task = database
            .get_task(task_id)
            .expect("get task")
            .expect("task exists");
        assert_eq!(task.status, "failed");
        assert_eq!(task.error.as_deref(), Some(FFMPEG_NOT_AVAILABLE_ERROR));

        let thumbnail = database
            .get_thumbnail(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("get thumbnail")
            .expect("thumbnail exists");
        assert_eq!(thumbnail.state, "failed");
        assert_eq!(thumbnail.error.as_deref(), Some(FFMPEG_NOT_AVAILABLE_ERROR));
        // No cache files should have been written.
        assert!(fs::read_dir(&cache_root)
            .expect("read cache root")
            .next()
            .is_none());

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
        database
            .mark_task_running_current_attempt_for_test(task_id)
            .expect("mark running");

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
    fn cancelled_thumbnail_tasks_are_not_recovered_or_run() {
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
        let task_id = request.task_id.expect("task id");
        database
            .cancel_task(task_id)
            .expect("cancel thumbnail task");

        assert_eq!(
            database
                .reset_running_thumbnail_tasks_for_recovery()
                .expect("recover thumbnails"),
            0
        );
        assert!(database
            .list_pending_thumbnail_task_ids()
            .expect("list pending thumbnails")
            .is_empty());

        run_task(&mut database, task_id, true);

        let task = database
            .get_task(task_id)
            .expect("get task")
            .expect("task exists");
        assert_eq!(task.status, "cancelled");
        let thumbnail = database
            .get_thumbnail(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("get thumbnail")
            .expect("thumbnail exists");
        assert_ne!(thumbnail.state, "ready");
        assert!(fs::read_dir(&cache_root)
            .expect("read cache root")
            .next()
            .is_none());

        fs::remove_dir_all(temp_root).expect("cleanup media root");
        fs::remove_dir_all(cache_root).expect("cleanup cache root");
    }

    #[test]
    fn thumbnail_task_does_not_publish_ready_when_source_changes_before_completion() {
        let temp_root = unique_temp_dir("media");
        fs::create_dir_all(&temp_root).expect("create media root");
        write_test_image(&temp_root.join("image.jpg"), 400, 400);
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
            true,
            |database: &mut Database| {
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
        assert!(database
            .get_thumb_blob(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("read thumb blob")
            .is_none());

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
        database
            .mark_task_running_current_attempt_for_test(task_id)
            .expect("mark running");

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
        database
            .mark_task_running_current_attempt_for_test(task_id)
            .expect("mark running");

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
        database
            .mark_task_running_current_attempt_for_test(task_id)
            .expect("mark running");
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
        database
            .mark_task_running_current_attempt_for_test(task_id)
            .expect("mark running");

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

    #[test]
    fn old_thumbnail_attempt_failure_does_not_mutate_retried_task_or_thumbnail() {
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
        let old_attempt = database
            .get_task(task_id)
            .expect("get task")
            .expect("task exists")
            .attempt_generation;
        database
            .mark_thumbnail_task_running_for_attempt(task_id, old_attempt, "old-source")
            .expect("mark old thumbnail attempt running");
        database.cancel_task(task_id).expect("cancel task");
        let retried = database.retry_task(task_id).expect("retry task");
        assert_eq!(retried.status, "pending");
        assert!(retried.attempt_generation > old_attempt);

        handle_task_error_for_attempt(
            &mut database,
            task_id,
            old_attempt,
            anyhow::anyhow!("late decode failure"),
        );

        let task = database
            .get_task(task_id)
            .expect("get task")
            .expect("task exists");
        assert_eq!(task.status, "pending");
        assert_eq!(task.error, None);
        assert_eq!(task.attempt_generation, retried.attempt_generation);

        let thumbnail = database
            .get_thumbnail(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("get thumbnail")
            .expect("thumbnail exists");
        assert_eq!(thumbnail.state, "queued");
        assert_eq!(thumbnail.error, None);

        fs::remove_dir_all(temp_root).expect("cleanup media root");
    }

    #[test]
    fn worker_drain_picks_up_persisted_pending_root_scan_task_after_send_failed() {
        // Regression for Blocker 3: when the watcher persists a pending
        // root_scan task but the in-memory channel is Full or Closed, the
        // task must not be stranded. The worker drains pending persisted
        // tasks in scheduler order, so the next drain tick picks it up and
        // runs it.
        let temp_root = unique_temp_dir("root");
        fs::create_dir_all(&temp_root).expect("create root dir");
        fs::write(temp_root.join("seed.jpg"), b"seed").expect("seed image");

        let mut database = Database::open_in_memory().expect("open database");
        database.apply_migrations().expect("apply migrations");
        let root_id = database
            .add_root(NewRoot {
                path: temp_root.to_string_lossy().to_string(),
                display_name: "drain-test".to_string(),
            })
            .expect("add root");

        // Simulate the watcher persisting a pending root_scan task while
        // its `try_send` to the worker channel fails (channel is full or
        // closed). We model that by creating the bounded channel,
        // exhausting it with a sentinel id, and persisting the task in DB
        // without delivering it to the channel.
        let (sender, mut receiver) = mpsc::channel::<i64>(1);
        sender
            .try_send(987654)
            .expect("fill channel with sentinel id");
        let task_id = database
            .create_root_scan_task(root_id)
            .expect("persist pending root scan task");
        // The watcher would call `task_queue.try_send(task_id)` here — and
        // it would fail because the channel is full. The task remains in
        // DB as pending.
        assert!(sender.try_send(task_id).is_err());

        // Sanity: the task is in the persisted pending list.
        let pending = database
            .list_pending_root_scan_task_ids()
            .expect("list pending root scans");
        assert_eq!(pending, vec![task_id]);

        // Drop the channel so the worker can never receive task_id from it.
        drop(sender);
        // Drain the sentinel from the receiver to mirror the worker's
        // channel-fed behavior, but task_id was never sent.
        assert_eq!(receiver.try_recv().expect("sentinel id"), 987654);

        // Run the drain helper: it must pick up the persisted pending task
        // and execute it, producing a terminal task status.
        drain_pending_persisted_tasks(&mut database, true);

        let task = database
            .get_task(task_id)
            .expect("get task")
            .expect("task exists");
        assert!(
            matches!(task.status.as_str(), "succeeded" | "failed"),
            "drained task should reach a terminal state, got {}",
            task.status
        );
        assert!(database
            .list_pending_root_scan_task_ids()
            .expect("list pending root scans after drain")
            .is_empty());

        fs::remove_dir_all(&temp_root).expect("cleanup temp root");
    }

    fn seed_media_file(database: &Database, root_path: &Path, name: &str) -> i64 {
        seed_media_file_with_kind(database, root_path, name, "image")
    }

    fn seed_media_file_with_kind(
        database: &Database,
        root_path: &Path,
        name: &str,
        kind: &str,
    ) -> i64 {
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
                ext: format!(
                    ".{}",
                    Path::new(name)
                        .extension()
                        .and_then(|value| value.to_str())
                        .unwrap_or("")
                ),
                size: 16,
                mtime: 2,
                ctime: None,
                file_key: Some("worker-identity".to_string()),
            })
            .expect("insert file");
        database
            .upsert_media_kind(file_id, kind)
            .expect("insert media kind");
        file_id
    }

    fn write_test_image(path: &Path, width: u32, height: u32) {
        let buffer = image::ImageBuffer::from_fn(width, height, |x, y| {
            image::Rgb([(x % 255) as u8, (y % 255) as u8, 0])
        });
        image::DynamicImage::ImageRgb8(buffer)
            .save(path)
            .expect("write test image");
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
