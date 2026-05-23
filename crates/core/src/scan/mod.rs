use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::fs::Metadata;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use walkdir::WalkDir;

use crate::db::{
    Database, FileUpsert, FolderUpsert, RootRecord, ScanFileUpsert, ScanWriteBatch,
    TaskScanProgress,
};
use crate::thumbnails::generate_preview_placeholder;

pub const DEFAULT_SCAN_WRITE_BATCH_SIZE: usize = 1_000;

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScanPriority {
    Interactive,
    Background,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    pub folders_seen: usize,
    pub media_files_seen: usize,
    pub skipped_files: usize,
}

pub struct ScanOptions<'a> {
    pub write_batch_size: usize,
    pub progress_callback: Option<&'a mut dyn FnMut(TaskScanProgress)>,
    pub cancellation_callback: Option<&'a mut dyn FnMut() -> anyhow::Result<()>>,
    pub task_attempt_guard: Option<TaskAttemptGuard>,
    #[cfg(test)]
    pub batch_observer: Option<std::rc::Rc<dyn Fn(ScanBatchStats)>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TaskAttemptGuard {
    pub task_id: i64,
    pub attempt_generation: i64,
}

impl Default for ScanOptions<'_> {
    fn default() -> Self {
        Self {
            write_batch_size: DEFAULT_SCAN_WRITE_BATCH_SIZE,
            progress_callback: None,
            cancellation_callback: None,
            task_attempt_guard: None,
            #[cfg(test)]
            batch_observer: None,
        }
    }
}

#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScanBatchStats {
    pub folders: usize,
    pub files: usize,
}

#[cfg(test)]
pub fn scan_root(database: &mut Database, root: &RootRecord) -> anyhow::Result<ScanSummary> {
    scan_root_with_options(database, root, ScanOptions::default())
}

#[allow(dead_code)]
pub fn scan_root_with_progress(
    database: &mut Database,
    root: &RootRecord,
    progress_callback: &mut dyn FnMut(TaskScanProgress),
) -> anyhow::Result<ScanSummary> {
    scan_root_with_options(
        database,
        root,
        ScanOptions {
            write_batch_size: DEFAULT_SCAN_WRITE_BATCH_SIZE,
            progress_callback: Some(progress_callback),
            cancellation_callback: None,
            task_attempt_guard: None,
            #[cfg(test)]
            batch_observer: None,
        },
    )
}

pub fn scan_root_with_options(
    database: &mut Database,
    root: &RootRecord,
    mut options: ScanOptions<'_>,
) -> anyhow::Result<ScanSummary> {
    let root_path = PathBuf::from(&root.path);
    check_scan_cancelled(&mut options)?;
    ensure_root_enabled(database, root.id)?;
    let scan_generation = database.begin_root_scan_reconciliation(root.id)?;
    let root_batch = ScanWriteBatch {
        folders: vec![FolderUpsert {
            root_id: root.id,
            parent_id: None,
            name: String::new(),
            path_hash: hash_path(&root_path),
            mtime: metadata_time(root_path.metadata().ok().as_ref(), TimeField::Modified),
        }],
        files: Vec::new(),
        scan_generation: Some(scan_generation),
    };
    observe_scan_batch(&options, root_batch.folders.len(), root_batch.files.len());
    check_scan_cancelled(&mut options)?;
    ensure_root_enabled(database, root.id)?;
    let root_result = commit_scan_batch_with_optional_task_guard(database, root_batch, &options)?;
    let root_folder_id = root_result.folder_ids[0];

    let mut folder_ids = HashMap::new();
    folder_ids.insert(root_path.clone(), root_folder_id);
    let mut pending_files = Vec::new();
    let mut pending_file_paths: Vec<Option<PathBuf>> = Vec::new();
    let write_batch_size = options.write_batch_size.max(1);

    let mut summary = ScanSummary {
        folders_seen: 1,
        media_files_seen: 0,
        skipped_files: 0,
    };
    let mut items_seen = 0_i64;
    emit_progress(&mut options, items_seen, &summary);
    check_scan_cancelled(&mut options)?;

    for entry in WalkDir::new(&root_path).min_depth(1) {
        check_scan_cancelled(&mut options)?;
        let entry = entry?;
        let path = entry.path();
        let metadata = entry.metadata()?;
        items_seen += 1;

        if metadata.is_dir() {
            let parent_id = parent_folder_id(path, &folder_ids)?;
            let batch = ScanWriteBatch {
                folders: vec![FolderUpsert {
                    root_id: root.id,
                    parent_id: Some(parent_id),
                    name: file_name(path),
                    path_hash: hash_path(path),
                    mtime: metadata_time(Some(&metadata), TimeField::Modified),
                }],
                files: Vec::new(),
                scan_generation: Some(scan_generation),
            };
            observe_scan_batch(&options, batch.folders.len(), batch.files.len());
            check_scan_cancelled(&mut options)?;
            ensure_root_enabled(database, root.id)?;
            let result = commit_scan_batch_with_optional_task_guard(database, batch, &options)?;
            let folder_id = result.folder_ids[0];
            folder_ids.insert(path.to_path_buf(), folder_id);
            summary.folders_seen += 1;
            emit_progress(&mut options, items_seen, &summary);
            check_scan_cancelled(&mut options)?;
            continue;
        }

        if !metadata.is_file() {
            summary.skipped_files += 1;
            emit_progress(&mut options, items_seen, &summary);
            check_scan_cancelled(&mut options)?;
            continue;
        }

        let Some(kind) = media_kind(path) else {
            summary.skipped_files += 1;
            emit_progress(&mut options, items_seen, &summary);
            check_scan_cancelled(&mut options)?;
            continue;
        };

        let folder_id = parent_folder_id(path, &folder_ids)?;
        pending_files.push(ScanFileUpsert {
            file: FileUpsert {
                root_id: root.id,
                folder_id,
                name: file_name(path),
                ext: extension(path),
                size: metadata.len() as i64,
                mtime: metadata_time(Some(&metadata), TimeField::Modified).unwrap_or(0),
                ctime: metadata_time(Some(&metadata), TimeField::Created),
                file_key: None,
            },
            media_kind: kind.to_string(),
        });
        // Track the source path alongside the queued upsert so the post-flush
        // dimension probe can map file_ids back to absolute paths. Only image
        // entries carry a path; videos go through ffmpeg later.
        pending_file_paths.push(if kind == "image" {
            Some(path.to_path_buf())
        } else {
            None
        });
        summary.media_files_seen += 1;
        emit_progress(&mut options, items_seen, &summary);
        check_scan_cancelled(&mut options)?;

        if pending_files.len() >= write_batch_size {
            flush_scan_files(
                database,
                root.id,
                scan_generation,
                &mut options,
                &mut pending_files,
                &mut pending_file_paths,
            )?;
        }
    }

    flush_scan_files(
        database,
        root.id,
        scan_generation,
        &mut options,
        &mut pending_files,
        &mut pending_file_paths,
    )?;
    check_scan_cancelled(&mut options)?;
    ensure_root_enabled(database, root.id)?;
    if let Some(guard) = options.task_attempt_guard {
        let reconciled = database.reconcile_root_scan_completion_for_task_attempt(
            root.id,
            scan_generation,
            guard.task_id,
            guard.attempt_generation,
        )?;
        if !reconciled {
            return Err(anyhow::anyhow!(
                "task {} attempt superseded before scan reconciliation",
                guard.task_id
            ));
        }
        database.mark_root_scanned_for_task_attempt(
            root.id,
            guard.task_id,
            guard.attempt_generation,
        )?;
    } else {
        database.reconcile_root_scan_completion(root.id, scan_generation)?;
        database.mark_root_scanned(root.id)?;
    }
    Ok(summary)
}

fn commit_scan_batch_with_optional_task_guard(
    database: &mut Database,
    batch: ScanWriteBatch,
    options: &ScanOptions<'_>,
) -> anyhow::Result<crate::db::ScanWriteBatchResult> {
    if let Some(guard) = options.task_attempt_guard {
        return database.commit_scan_batch_for_task_attempt(
            batch,
            guard.task_id,
            guard.attempt_generation,
        );
    }
    database.commit_scan_batch(batch)
}

fn parent_folder_id(path: &Path, folder_ids: &HashMap<PathBuf, i64>) -> anyhow::Result<i64> {
    let parent = path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("scan path has no parent: {}", path.display()))?;
    folder_ids
        .get(parent)
        .copied()
        .ok_or_else(|| anyhow::anyhow!("missing scanned parent folder id for {}", parent.display()))
}

fn flush_scan_files(
    database: &mut Database,
    root_id: i64,
    scan_generation: i64,
    options: &mut ScanOptions<'_>,
    pending_files: &mut Vec<ScanFileUpsert>,
    pending_file_paths: &mut Vec<Option<PathBuf>>,
) -> anyhow::Result<()> {
    if pending_files.is_empty() {
        pending_file_paths.clear();
        return Ok(());
    }

    observe_scan_batch(options, 0, pending_files.len());
    check_scan_cancelled(options)?;
    ensure_root_enabled(database, root_id)?;
    let paths = std::mem::take(pending_file_paths);
    let result = commit_scan_batch_with_optional_task_guard(
        database,
        ScanWriteBatch {
            folders: Vec::new(),
            files: std::mem::take(pending_files),
            scan_generation: Some(scan_generation),
        },
        options,
    )?;
    probe_image_dimensions(database, options, &result.file_ids, &paths)?;
    Ok(())
}

/// Best-effort header-only width/height probe for image files written in the
/// most recent scan batch. Failures are demoted to a debug log so a single
/// unreadable file never aborts the scan; metadata stays `pending` and a
/// later metadata task can retry.
///
/// The probe is cancellation-aware: we check for cancellation between files
/// (and at a coarser cadence between every 100 entries) so a request issued
/// while a multi-million-file root is mid-batch is honored without waiting
/// for the next WalkDir boundary.
fn probe_image_dimensions(
    database: &Database,
    options: &mut ScanOptions<'_>,
    file_ids: &[i64],
    paths: &[Option<PathBuf>],
) -> anyhow::Result<()> {
    if file_ids.len() != paths.len() {
        // Defensive: if the parallel vectors ever drift we'd rather skip the
        // probe than misattribute dimensions. The scan still succeeds.
        tracing::warn!(
            file_ids = file_ids.len(),
            paths = paths.len(),
            "scan dimension probe arrays out of sync; skipping"
        );
        return Ok(());
    }
    // Cancellation cap: at most this many probes between cancellation
    // checks. The check is also performed before every probe entry so a
    // tight cancellation window still gets honored within ~1 file.
    const PROBE_CANCEL_CHECK_INTERVAL: usize = 100;

    for (index, (file_id, path)) in file_ids.iter().zip(paths.iter()).enumerate() {
        check_scan_cancelled(options)?;
        if index > 0 && index % PROBE_CANCEL_CHECK_INTERVAL == 0 {
            // Redundant on the surface, but kept explicit so a future
            // edit that loosens the per-iteration check above still has a
            // batch-grained safety net the issue called out.
            check_scan_cancelled(options)?;
        }
        let Some(path) = path.as_deref() else {
            continue;
        };
        match image::ImageReader::open(path)
            .and_then(|reader| reader.with_guessed_format())
            .map_err(anyhow::Error::from)
            .and_then(|reader| reader.into_dimensions().map_err(anyhow::Error::from))
        {
            Ok((width, height)) => {
                if let Err(error) =
                    database.update_media_dimensions(*file_id, width as i64, height as i64)
                {
                    tracing::debug!(file_id = *file_id, %error, "failed to record probed dimensions");
                }
                match generate_preview_placeholder(path) {
                    Ok(placeholder) => {
                        if let Err(error) = database.update_media_preview_placeholder(
                            *file_id,
                            &placeholder.data,
                            placeholder.output_format,
                        ) {
                            tracing::debug!(
                                file_id = *file_id,
                                %error,
                                "failed to record preview placeholder"
                            );
                        }
                    }
                    Err(error) => {
                        tracing::debug!(
                            file_id = *file_id,
                            path = %path.display(),
                            %error,
                            "preview placeholder generation failed"
                        );
                    }
                }
            }
            Err(error) => {
                tracing::debug!(
                    file_id = *file_id,
                    path = %path.display(),
                    %error,
                    "image dimension probe failed; metadata stays pending"
                );
            }
        }
    }
    Ok(())
}

fn ensure_root_enabled(database: &Database, root_id: i64) -> anyhow::Result<()> {
    if database.root_enabled(root_id)? {
        return Ok(());
    }
    Err(anyhow::anyhow!("root is disabled: {root_id}"))
}

fn observe_scan_batch(options: &ScanOptions, folders: usize, files: usize) {
    #[cfg(test)]
    if let Some(observer) = &options.batch_observer {
        observer(ScanBatchStats { folders, files });
    }

    #[cfg(not(test))]
    let _ = (options, folders, files);
}

fn check_scan_cancelled(options: &mut ScanOptions<'_>) -> anyhow::Result<()> {
    if let Some(callback) = options.cancellation_callback.as_deref_mut() {
        callback()?;
    }
    Ok(())
}

fn emit_progress(options: &mut ScanOptions<'_>, items_seen: i64, summary: &ScanSummary) {
    if let Some(callback) = options.progress_callback.as_deref_mut() {
        callback(TaskScanProgress {
            items_seen,
            items_total: None,
            folders_seen: summary.folders_seen as i64,
            media_files_seen: summary.media_files_seen as i64,
            skipped_files: summary.skipped_files as i64,
        });
    }
}

fn media_kind(path: &Path) -> Option<&'static str> {
    match extension(path).as_str() {
        ".avif" | ".bmp" | ".gif" | ".heic" | ".jpeg" | ".jpg" | ".png" | ".psd" | ".raw"
        | ".tif" | ".tiff" | ".webp" => Some("image"),
        ".avi" | ".m4v" | ".mkv" | ".mov" | ".mp4" | ".webm" | ".wmv" => Some("video"),
        _ => None,
    }
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{}", value.to_ascii_lowercase()))
        .unwrap_or_default()
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_string()
}

fn hash_path(path: &Path) -> String {
    let mut hasher = DefaultHasher::new();
    path.to_string_lossy().hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

#[derive(Debug, Clone, Copy)]
enum TimeField {
    Created,
    Modified,
}

fn metadata_time(metadata: Option<&Metadata>, field: TimeField) -> Option<i64> {
    let metadata = metadata?;
    let time = match field {
        TimeField::Created => metadata.created(),
        TimeField::Modified => metadata.modified(),
    }
    .ok()?;
    time.duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs() as i64)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;
    use crate::db::{Database, MediaPageQuery, NewRoot};

    #[test]
    fn scan_root_indexes_media_files_and_skips_non_media() {
        let temp_root = unique_temp_dir();
        fs::create_dir_all(temp_root.join("photos")).expect("create photos dir");
        fs::write(temp_root.join("photos").join("image.JPG"), b"fake jpg").expect("write image");
        fs::write(temp_root.join("clip.mp4"), b"fake mp4").expect("write video");
        fs::write(temp_root.join("notes.txt"), b"not media").expect("write notes");

        let mut database = Database::open_in_memory().expect("open database");
        database.apply_migrations().expect("apply migrations");
        let root_id = database
            .add_root(NewRoot {
                path: temp_root.to_string_lossy().to_string(),
                display_name: "scan-test".to_string(),
            })
            .expect("add root");
        let root = database
            .list_roots()
            .expect("list roots")
            .into_iter()
            .find(|item| item.id == root_id)
            .expect("find root");

        let summary = scan_root(&mut database, &root).expect("scan root");
        assert_eq!(summary.folders_seen, 2);
        assert_eq!(summary.media_files_seen, 2);
        assert_eq!(summary.skipped_files, 1);

        let page = database
            .list_media_page(MediaPageQuery {
                root_id: Some(root_id),
                folder_id: None,
                limit: 10,
                cursor: None,
                sort: "name_asc".to_string(),
                kind: None,
            })
            .expect("list media");
        assert_eq!(page.items.len(), 2);

        fs::remove_dir_all(temp_root).expect("cleanup temp root");
    }

    #[test]
    fn scan_root_with_tiny_write_batch_preserves_summary_and_media_rows() {
        let temp_root = unique_temp_dir();
        fs::create_dir_all(temp_root.join("photos").join("raw")).expect("create photos dir");
        fs::write(temp_root.join("photos").join("image.JPG"), b"fake jpg").expect("write image");
        fs::write(
            temp_root.join("photos").join("raw").join("scan.png"),
            b"fake png",
        )
        .expect("write png");
        fs::write(temp_root.join("clip.mp4"), b"fake mp4").expect("write video");
        fs::write(temp_root.join("notes.txt"), b"not media").expect("write notes");

        let mut database = Database::open_in_memory().expect("open database");
        database.apply_migrations().expect("apply migrations");
        let root_id = database
            .add_root(NewRoot {
                path: temp_root.to_string_lossy().to_string(),
                display_name: "tiny-batch-scan-test".to_string(),
            })
            .expect("add root");
        let root = database
            .list_roots()
            .expect("list roots")
            .into_iter()
            .find(|item| item.id == root_id)
            .expect("find root");

        let summary = scan_root_with_options(
            &mut database,
            &root,
            ScanOptions {
                write_batch_size: 2,
                progress_callback: None,
                cancellation_callback: None,
                task_attempt_guard: None,
                batch_observer: None,
            },
        )
        .expect("scan root");
        assert_eq!(summary.folders_seen, 3);
        assert_eq!(summary.media_files_seen, 3);
        assert_eq!(summary.skipped_files, 1);

        let root = database
            .get_root(root_id)
            .expect("get root")
            .expect("root exists");
        assert!(root.last_scan_at.is_some());

        let page = database
            .list_media_page(MediaPageQuery {
                root_id: Some(root_id),
                folder_id: None,
                limit: 10,
                cursor: None,
                sort: "name_asc".to_string(),
                kind: None,
            })
            .expect("list media");
        assert_eq!(page.items.len(), 3);

        fs::remove_dir_all(temp_root).expect("cleanup temp root");
    }

    #[test]
    fn scan_root_places_nested_files_under_nested_folder_ids() {
        let temp_root = unique_temp_dir();
        fs::create_dir_all(temp_root.join("photos").join("raw")).expect("create raw dir");
        fs::write(
            temp_root.join("photos").join("raw").join("scan.png"),
            b"fake png",
        )
        .expect("write png");

        let mut database = Database::open_in_memory().expect("open database");
        database.apply_migrations().expect("apply migrations");
        let root_id = add_test_root(&database, &temp_root, "nested-folder-scan-test");
        let root = test_root(&database, root_id);

        scan_root(&mut database, &root).expect("scan root");

        let root = database
            .get_root(root_id)
            .expect("get root")
            .expect("root exists");
        let root_folder_id = root.root_folder_id.expect("root folder id");
        let photos_folder = only_child_named(&database, root_folder_id, "photos");
        let raw_folder = only_child_named(&database, photos_folder.id, "raw");
        let media = database
            .list_media_page(MediaPageQuery {
                root_id: Some(root_id),
                folder_id: Some(raw_folder.id),
                limit: 10,
                cursor: None,
                sort: "name_asc".to_string(),
                kind: None,
            })
            .expect("list media");

        assert_eq!(media.items.len(), 1);
        assert_eq!(media.items[0].name, "scan.png");
        assert_eq!(media.items[0].folder_id, raw_folder.id);

        fs::remove_dir_all(temp_root).expect("cleanup temp root");
    }

    #[test]
    fn repeated_scan_root_does_not_duplicate_folder_file_or_media_rows() {
        let temp_root = unique_temp_dir();
        fs::create_dir_all(temp_root.join("photos").join("raw")).expect("create raw dir");
        fs::write(temp_root.join("clip.mp4"), b"fake mp4").expect("write mp4");
        fs::write(
            temp_root.join("photos").join("raw").join("scan.png"),
            b"fake png",
        )
        .expect("write png");

        let mut database = Database::open_in_memory().expect("open database");
        database.apply_migrations().expect("apply migrations");
        let root_id = add_test_root(&database, &temp_root, "repeat-scan-test");
        let root = test_root(&database, root_id);

        scan_root(&mut database, &root).expect("first scan");
        scan_root(&mut database, &root).expect("second scan");

        let root = database
            .get_root(root_id)
            .expect("get root")
            .expect("root exists");
        let root_folder_id = root.root_folder_id.expect("root folder id");
        let root_children = database
            .list_folder_children(root_folder_id)
            .expect("list root children");
        assert_eq!(root_children.len(), 1);
        let raw_children = database
            .list_folder_children(root_children[0].id)
            .expect("list photos children");
        assert_eq!(raw_children.len(), 1);

        let media = database
            .list_media_page(MediaPageQuery {
                root_id: Some(root_id),
                folder_id: None,
                limit: 10,
                cursor: None,
                sort: "name_asc".to_string(),
                kind: None,
            })
            .expect("list media");
        assert_eq!(media.items.len(), 2);

        fs::remove_dir_all(temp_root).expect("cleanup temp root");
    }

    #[test]
    fn completed_scan_marks_deleted_media_missing() {
        let temp_root = unique_temp_dir();
        fs::create_dir_all(&temp_root).expect("create root dir");
        fs::write(temp_root.join("keep.jpg"), b"keep").expect("write keep image");
        fs::write(temp_root.join("delete.jpg"), b"delete").expect("write delete image");

        let mut database = Database::open_in_memory().expect("open database");
        database.apply_migrations().expect("apply migrations");
        let root_id = add_test_root(&database, &temp_root, "scan-reconcile-delete-test");
        let root = test_root(&database, root_id);

        scan_root(&mut database, &root).expect("first scan");
        fs::remove_file(temp_root.join("delete.jpg")).expect("delete image");
        scan_root(&mut database, &root).expect("second scan");

        let media = database
            .list_media_page(MediaPageQuery {
                root_id: Some(root_id),
                folder_id: None,
                limit: 10,
                cursor: None,
                sort: "name_asc".to_string(),
                kind: None,
            })
            .expect("list media");
        let names: Vec<&str> = media.items.iter().map(|item| item.name.as_str()).collect();
        assert_eq!(names, vec!["keep.jpg"]);

        fs::remove_dir_all(temp_root).expect("cleanup temp root");
    }

    #[test]
    fn completed_scan_marks_moved_out_media_missing() {
        let temp_root = unique_temp_dir();
        let outside_dir = unique_temp_dir();
        fs::create_dir_all(&temp_root).expect("create root dir");
        fs::create_dir_all(&outside_dir).expect("create outside dir");
        fs::write(temp_root.join("move-out.jpg"), b"move").expect("write image");

        let mut database = Database::open_in_memory().expect("open database");
        database.apply_migrations().expect("apply migrations");
        let root_id = add_test_root(&database, &temp_root, "scan-reconcile-move-out-test");
        let root = test_root(&database, root_id);

        scan_root(&mut database, &root).expect("first scan");
        fs::rename(
            temp_root.join("move-out.jpg"),
            outside_dir.join("move-out.jpg"),
        )
        .expect("move image outside root");
        scan_root(&mut database, &root).expect("second scan");

        let media = database
            .list_media_page(MediaPageQuery {
                root_id: Some(root_id),
                folder_id: None,
                limit: 10,
                cursor: None,
                sort: "name_asc".to_string(),
                kind: None,
            })
            .expect("list media");
        assert!(media.items.is_empty());

        fs::remove_dir_all(temp_root).expect("cleanup temp root");
        fs::remove_dir_all(outside_dir).expect("cleanup outside dir");
    }

    #[test]
    fn folder_boundaries_do_not_flush_pending_files_before_batch_threshold() {
        use std::cell::RefCell;
        use std::rc::Rc;

        let temp_root = unique_temp_dir();
        fs::create_dir_all(temp_root.join("after-file")).expect("create after-file dir");
        fs::create_dir_all(temp_root.join("after-file-2")).expect("create after-file-2 dir");
        fs::write(temp_root.join("a.mp4"), b"fake mp4").expect("write first video");
        fs::write(temp_root.join("b.mp4"), b"fake mp4").expect("write second video");
        let observed = Rc::new(RefCell::new(Vec::new()));

        let mut database = Database::open_in_memory().expect("open database");
        database.apply_migrations().expect("apply migrations");
        let root_id = add_test_root(&database, &temp_root, "batch-boundary-scan-test");
        let root = test_root(&database, root_id);

        let observed_batches = Rc::clone(&observed);
        scan_root_with_options(
            &mut database,
            &root,
            ScanOptions {
                write_batch_size: 10,
                progress_callback: None,
                cancellation_callback: None,
                task_attempt_guard: None,
                batch_observer: Some(Rc::new(move |stats| {
                    observed_batches.borrow_mut().push(stats);
                })),
            },
        )
        .expect("scan root");

        let file_commit_sizes: Vec<usize> = observed
            .borrow()
            .iter()
            .filter_map(|stats| (stats.files > 0).then_some(stats.files))
            .collect();
        assert_eq!(file_commit_sizes, vec![2]);

        fs::remove_dir_all(temp_root).expect("cleanup temp root");
    }

    #[test]
    fn scan_root_stops_before_writing_next_batch_when_root_is_disabled() {
        let temp_root = unique_temp_dir();
        fs::create_dir_all(&temp_root).expect("create root dir");
        fs::write(temp_root.join("a.jpg"), b"fake jpg").expect("write first image");
        fs::write(temp_root.join("b.jpg"), b"fake jpg").expect("write second image");
        fs::write(temp_root.join("c.jpg"), b"fake jpg").expect("write third image");

        let db_dir = unique_temp_dir();
        fs::create_dir_all(&db_dir).expect("create db dir");
        let db_path = db_dir.join("scan-cancel.sqlite");
        let mut database = Database::open(&db_path).expect("open database");
        database.apply_migrations().expect("apply migrations");
        let root_id = add_test_root(&database, &temp_root, "disable-during-scan-test");
        let root = test_root(&database, root_id);

        let disable_db_path = db_path.clone();
        let mut disabled = false;
        let mut progress_callback = move |progress: TaskScanProgress| {
            if !disabled && progress.media_files_seen >= 1 {
                let disable_database = Database::open(&disable_db_path).expect("open disable db");
                disable_database
                    .disable_root(root_id)
                    .expect("disable root");
                disabled = true;
            }
        };

        let error = scan_root_with_options(
            &mut database,
            &root,
            ScanOptions {
                write_batch_size: 2,
                progress_callback: Some(&mut progress_callback),
                cancellation_callback: None,
                task_attempt_guard: None,
                batch_observer: None,
            },
        )
        .expect_err("disabled root should stop scan");
        assert!(error.to_string().contains("disabled"));

        let media = database
            .list_media_page(MediaPageQuery {
                root_id: Some(root_id),
                folder_id: None,
                limit: 10,
                cursor: None,
                sort: "name_asc".to_string(),
                kind: None,
            })
            .expect("list media");
        assert!(media.items.is_empty());

        fs::remove_dir_all(temp_root).expect("cleanup temp root");
        let _ = fs::remove_dir_all(db_dir);
    }

    #[test]
    fn guarded_scan_completion_does_not_reconcile_when_task_attempt_is_superseded() {
        // Regression for Blocker 2: a guarded scan whose task attempt has
        // been superseded must not finish reconciliation. It must error out
        // (the existing batch guard rejects writes against a stale attempt,
        // and the new task-attempt-guarded reconciliation refuses to run
        // against a stale attempt), and it must leave the new (retried)
        // attempt and root state untouched: the root is not marked scanned
        // and the retried attempt remains pending.
        let temp_root = unique_temp_dir();
        fs::create_dir_all(&temp_root).expect("create root dir");
        fs::write(temp_root.join("a.jpg"), b"fake jpg").expect("write image a");
        fs::write(temp_root.join("b.jpg"), b"fake jpg").expect("write image b");

        let mut database = Database::open_in_memory().expect("open database");
        database.apply_migrations().expect("apply migrations");
        let root_id = add_test_root(&database, &temp_root, "stale-attempt-scan-test");
        let root = test_root(&database, root_id);

        // Persist a task and mark its first attempt running. The scan code
        // expects the task to already be running before a guarded scan.
        let task_id = database
            .create_root_scan_task(root_id)
            .expect("create root scan task");
        let old_attempt = database
            .get_task(task_id)
            .expect("get task")
            .expect("task exists")
            .attempt_generation;
        database
            .mark_task_running_for_attempt(task_id, old_attempt)
            .expect("mark running");

        // Supersede the attempt before the scan starts: cancel + retry
        // bumps the attempt generation, so the in-flight scan is now stale.
        database.cancel_task(task_id).expect("cancel task");
        database.retry_task(task_id).expect("retry task");

        let error = scan_root_with_options(
            &mut database,
            &root,
            ScanOptions {
                write_batch_size: DEFAULT_SCAN_WRITE_BATCH_SIZE,
                progress_callback: None,
                cancellation_callback: None,
                task_attempt_guard: Some(TaskAttemptGuard {
                    task_id,
                    attempt_generation: old_attempt,
                }),
                batch_observer: None,
            },
        )
        .expect_err("stale attempt scan must not succeed");
        let message = error.to_string();
        assert!(
            message.contains("attempt") || message.contains("superseded"),
            "unexpected error message: {message}"
        );

        // The retried (current) attempt remains pending and unmodified.
        let task = database
            .get_task(task_id)
            .expect("get task")
            .expect("task exists");
        assert_eq!(task.status, "pending");
        assert!(task.attempt_generation > old_attempt);

        // The root must not have been marked scanned by the stale path.
        let root = database.get_root(root_id).expect("get root").expect("root");
        assert_eq!(root.last_scan_at, None);

        fs::remove_dir_all(temp_root).expect("cleanup temp root");
    }

    #[test]
    fn scan_root_checks_cancellation_before_flushing_pending_files() {
        use std::cell::Cell;
        use std::rc::Rc;

        let temp_root = unique_temp_dir();
        fs::create_dir_all(&temp_root).expect("create root dir");
        fs::write(temp_root.join("a.jpg"), b"fake jpg").expect("write first image");
        fs::write(temp_root.join("b.jpg"), b"fake jpg").expect("write second image");
        fs::write(temp_root.join("c.jpg"), b"fake jpg").expect("write third image");

        let mut database = Database::open_in_memory().expect("open database");
        database.apply_migrations().expect("apply migrations");
        let root_id = add_test_root(&database, &temp_root, "cancel-callback-scan-test");
        let root = test_root(&database, root_id);

        let cancel_requested = Rc::new(Cell::new(false));
        let progress_cancel_requested = Rc::clone(&cancel_requested);
        let mut progress_callback = |progress: TaskScanProgress| {
            if progress.media_files_seen >= 1 {
                progress_cancel_requested.set(true);
            }
        };
        let callback_cancel_requested = Rc::clone(&cancel_requested);
        let mut cancellation_callback = || {
            if callback_cancel_requested.get() {
                return Err(anyhow::anyhow!("task cancelled: test"));
            }
            Ok(())
        };

        let error = scan_root_with_options(
            &mut database,
            &root,
            ScanOptions {
                write_batch_size: 10,
                progress_callback: Some(&mut progress_callback),
                cancellation_callback: Some(&mut cancellation_callback),
                task_attempt_guard: None,
                batch_observer: None,
            },
        )
        .expect_err("cancelled task should stop scan");
        assert!(error.to_string().contains("cancelled"));

        let media = database
            .list_media_page(MediaPageQuery {
                root_id: Some(root_id),
                folder_id: None,
                limit: 10,
                cursor: None,
                sort: "name_asc".to_string(),
                kind: None,
            })
            .expect("list media");
        assert!(media.items.is_empty());

        let root = database.get_root(root_id).expect("get root").expect("root");
        assert_eq!(root.last_scan_at, None);

        fs::remove_dir_all(temp_root).expect("cleanup temp root");
    }

    #[test]
    fn scan_root_probes_image_dimensions_and_marks_metadata_ready() {
        let temp_root = unique_temp_dir();
        fs::create_dir_all(&temp_root).expect("create root dir");
        let image_path = temp_root.join("photo.png");
        let buffer = image::ImageBuffer::from_fn(800u32, 600u32, |x, y| {
            image::Rgb([(x % 255) as u8, (y % 255) as u8, 0])
        });
        image::DynamicImage::ImageRgb8(buffer)
            .save(&image_path)
            .expect("write 800x600 png");

        let mut database = Database::open_in_memory().expect("open database");
        database.apply_migrations().expect("apply migrations");
        let root_id = add_test_root(&database, &temp_root, "scan-dimension-probe-test");
        let root = test_root(&database, root_id);

        scan_root(&mut database, &root).expect("scan root");

        let media = database
            .list_media_page(MediaPageQuery {
                root_id: Some(root_id),
                folder_id: None,
                limit: 10,
                cursor: None,
                sort: "name_asc".to_string(),
                kind: None,
            })
            .expect("list media");
        assert_eq!(media.items.len(), 1);
        let entry = &media.items[0];
        assert_eq!(entry.name, "photo.png");
        assert_eq!(entry.width, Some(800));
        assert_eq!(entry.height, Some(600));

        // Inspect the source record so we cover the metadata_status side
        // of the probe. The thumbnail pipeline relies on this to pick
        // skipped_small vs generatable.
        let source = database
            .get_thumbnail_source(entry.id)
            .expect("get source")
            .expect("source exists");
        assert_eq!(source.metadata_status.as_deref(), Some("ready"));

        fs::remove_dir_all(temp_root).expect("cleanup temp root");
    }

    #[test]
    fn scan_root_writes_preview_placeholder_for_images() {
        let temp_root = unique_temp_dir();
        fs::create_dir_all(&temp_root).expect("create media root");
        write_test_image(&temp_root.join("image.jpg"), 800, 400);

        let mut database = Database::open_in_memory().expect("open database");
        database.apply_migrations().expect("apply migrations");
        let root_id = database
            .add_root(NewRoot {
                path: temp_root.display().to_string(),
                display_name: "preview-placeholder".to_string(),
            })
            .expect("add root");
        let root = database
            .get_root(root_id)
            .expect("get root")
            .expect("root exists");

        crate::scan::scan_root(&mut database, &root).expect("scan root");

        let media = database
            .get_media(1)
            .expect("get media")
            .expect("media exists");
        let placeholder = media
            .preview_placeholder
            .as_deref()
            .expect("preview placeholder bytes");
        assert_eq!(&placeholder[0..4], b"RIFF");
        assert_eq!(&placeholder[8..12], b"WEBP");
        assert!(placeholder.len() <= 8192);
        let dimensions = image::load_from_memory(placeholder)
            .expect("decode preview placeholder")
            .into_rgba8()
            .dimensions();
        assert!(dimensions.0 <= crate::thumbnails::PREVIEW_PLACEHOLDER_MAX_SIDE_PX);
        assert!(dimensions.1 <= crate::thumbnails::PREVIEW_PLACEHOLDER_MAX_SIDE_PX);
        assert_eq!(
            media.preview_placeholder_format.as_deref(),
            Some("image/webp")
        );

        fs::remove_dir_all(temp_root).expect("cleanup temp root");
    }

    #[test]
    fn scan_root_leaves_metadata_pending_when_image_dimensions_probe_fails() {
        let temp_root = unique_temp_dir();
        fs::create_dir_all(&temp_root).expect("create root dir");
        // Empty `.png` is not decodable; the probe must not fail the scan.
        fs::write(temp_root.join("broken.png"), b"").expect("write broken png");

        let mut database = Database::open_in_memory().expect("open database");
        database.apply_migrations().expect("apply migrations");
        let root_id = add_test_root(&database, &temp_root, "scan-dimension-probe-error-test");
        let root = test_root(&database, root_id);

        scan_root(&mut database, &root).expect("scan root succeeds despite probe failure");

        let media = database
            .list_media_page(MediaPageQuery {
                root_id: Some(root_id),
                folder_id: None,
                limit: 10,
                cursor: None,
                sort: "name_asc".to_string(),
                kind: None,
            })
            .expect("list media");
        assert_eq!(media.items.len(), 1);
        let entry = &media.items[0];
        assert_eq!(entry.width, None);
        assert_eq!(entry.height, None);
        let source = database
            .get_thumbnail_source(entry.id)
            .expect("get source")
            .expect("source exists");
        assert_eq!(source.metadata_status.as_deref(), Some("pending"));

        fs::remove_dir_all(temp_root).expect("cleanup temp root");
    }

    #[test]
    fn probe_image_dimensions_honors_cancellation_inside_the_loop() {
        // Direct unit-level coverage for the dimension-probe cancellation
        // hotfix. Without the cancel check inside the loop, an in-flight
        // probe over a freshly committed batch would not see a cancellation
        // request until the next WalkDir boundary; with a 1M-file root that
        // is far too coarse. Asserting the probe itself errors on cancel
        // pins the intended behavior at the function boundary.
        use std::cell::Cell;
        use std::rc::Rc;

        let database = Database::open_in_memory().expect("open database");
        database.apply_migrations().expect("apply migrations");

        // The first call returns Ok so the loop reaches the second
        // iteration; the second call signals cancellation. This pins the
        // requirement that the cancel check fires on every iteration, not
        // only on entry.
        let calls = Rc::new(Cell::new(0u32));
        let calls_for_cb = Rc::clone(&calls);
        let mut callback = move || -> anyhow::Result<()> {
            let next = calls_for_cb.get() + 1;
            calls_for_cb.set(next);
            if next >= 2 {
                return Err(anyhow::anyhow!("task cancelled: probe-test"));
            }
            Ok(())
        };
        let mut options = ScanOptions {
            write_batch_size: DEFAULT_SCAN_WRITE_BATCH_SIZE,
            progress_callback: None,
            cancellation_callback: Some(&mut callback),
            task_attempt_guard: None,
            #[cfg(test)]
            batch_observer: None,
        };

        // Two synthetic file ids with no associated paths. The probe will
        // hit the cancel check at the top of every iteration; on the
        // second iteration the callback returns Err.
        let file_ids = vec![1_i64, 2_i64];
        let paths: Vec<Option<PathBuf>> = vec![None, None];
        let error = probe_image_dimensions(&database, &mut options, &file_ids, &paths)
            .expect_err("cancellation must surface as Err from the probe loop");
        assert!(
            error.to_string().contains("cancelled"),
            "expected cancellation error, got: {error}"
        );
        assert_eq!(
            calls.get(),
            2,
            "cancellation must be checked on every probe iteration"
        );
    }

    fn add_test_root(database: &Database, temp_root: &Path, display_name: &str) -> i64 {
        database
            .add_root(NewRoot {
                path: temp_root.to_string_lossy().to_string(),
                display_name: display_name.to_string(),
            })
            .expect("add root")
    }

    fn test_root(database: &Database, root_id: i64) -> RootRecord {
        database
            .list_roots()
            .expect("list roots")
            .into_iter()
            .find(|item| item.id == root_id)
            .expect("find root")
    }

    fn only_child_named(
        database: &Database,
        folder_id: i64,
        name: &str,
    ) -> crate::db::FolderRecord {
        let children = database
            .list_folder_children(folder_id)
            .expect("list folder children");
        children
            .into_iter()
            .find(|folder| folder.name == name)
            .unwrap_or_else(|| panic!("missing child folder {name} under {folder_id}"))
    }

    fn unique_temp_dir() -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

        std::env::temp_dir().join(format!(
            "megle_scan_test_{}_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time")
                .as_nanos(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ))
    }

    fn write_test_image(path: &Path, width: u32, height: u32) {
        let buffer = image::ImageBuffer::from_fn(width, height, |x, y| {
            image::Rgb([(x % 255) as u8, (y % 255) as u8, 32])
        });
        image::DynamicImage::ImageRgb8(buffer)
            .save(path)
            .expect("write test image");
    }
}
