use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::fs::Metadata;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use walkdir::WalkDir;

use crate::db::{Database, FileUpsert, FolderUpsert, RootRecord};

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

pub fn scan_root(database: &Database, root: &RootRecord) -> anyhow::Result<ScanSummary> {
    let root_path = PathBuf::from(&root.path);
    let root_folder_id = database.upsert_folder(FolderUpsert {
        root_id: root.id,
        parent_id: None,
        name: String::new(),
        path_hash: hash_path(&root_path),
        mtime: metadata_time(root_path.metadata().ok().as_ref(), TimeField::Modified),
    })?;

    let mut folder_ids = HashMap::new();
    folder_ids.insert(root_path.clone(), root_folder_id);

    let mut summary = ScanSummary {
        folders_seen: 1,
        media_files_seen: 0,
        skipped_files: 0,
    };

    for entry in WalkDir::new(&root_path).min_depth(1) {
        let entry = entry?;
        let path = entry.path();
        let metadata = entry.metadata()?;

        if metadata.is_dir() {
            let parent_id = path
                .parent()
                .and_then(|parent| folder_ids.get(parent).copied())
                .unwrap_or(root_folder_id);
            let folder_id = database.upsert_folder(FolderUpsert {
                root_id: root.id,
                parent_id: Some(parent_id),
                name: file_name(path),
                path_hash: hash_path(path),
                mtime: metadata_time(Some(&metadata), TimeField::Modified),
            })?;
            folder_ids.insert(path.to_path_buf(), folder_id);
            summary.folders_seen += 1;
            continue;
        }

        if !metadata.is_file() {
            summary.skipped_files += 1;
            continue;
        }

        let Some(kind) = media_kind(path) else {
            summary.skipped_files += 1;
            continue;
        };

        let folder_id = path
            .parent()
            .and_then(|parent| folder_ids.get(parent).copied())
            .unwrap_or(root_folder_id);
        let file_id = database.upsert_file(FileUpsert {
            root_id: root.id,
            folder_id,
            name: file_name(path),
            ext: extension(path),
            size: metadata.len() as i64,
            mtime: metadata_time(Some(&metadata), TimeField::Modified).unwrap_or(0),
            ctime: metadata_time(Some(&metadata), TimeField::Created),
            file_key: None,
        })?;
        database.upsert_media_kind(file_id, kind)?;
        summary.media_files_seen += 1;
    }

    database.mark_root_scanned(root.id)?;
    Ok(summary)
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

        let database = Database::open_in_memory().expect("open database");
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

        let summary = scan_root(&database, &root).expect("scan root");
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
        assert_eq!(page.len(), 2);

        fs::remove_dir_all(temp_root).expect("cleanup temp root");
    }

    fn unique_temp_dir() -> PathBuf {
        std::env::temp_dir().join(format!(
            "megle_scan_test_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time")
                .as_nanos()
        ))
    }
}
