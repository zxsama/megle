pub mod migrations;

use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::Serialize;

#[allow(dead_code)]
pub const WAL_MODE: &str = "WAL";

pub struct Database {
    connection: Connection,
    path: Option<PathBuf>,
}

pub struct NewRoot {
    pub path: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RootRecord {
    pub id: i64,
    pub path: String,
    pub display_name: String,
    pub enabled: bool,
    pub created_at: i64,
    pub last_scan_at: Option<i64>,
    pub root_folder_id: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct MediaPageQuery {
    pub root_id: Option<i64>,
    pub folder_id: Option<i64>,
    pub limit: i64,
    pub cursor: Option<String>,
    pub sort: String,
    pub kind: Option<String>,
}

pub struct FolderUpsert {
    pub root_id: i64,
    pub parent_id: Option<i64>,
    pub name: String,
    pub path_hash: String,
    pub mtime: Option<i64>,
}

pub struct FileUpsert {
    pub root_id: i64,
    pub folder_id: i64,
    pub name: String,
    pub ext: String,
    pub size: i64,
    pub mtime: i64,
    pub ctime: Option<i64>,
    pub file_key: Option<String>,
}

pub struct ScanWriteBatch {
    pub folders: Vec<FolderUpsert>,
    pub files: Vec<ScanFileUpsert>,
}

pub struct ScanFileUpsert {
    pub file: FileUpsert,
    pub media_kind: String,
}

#[derive(Debug)]
pub struct ScanWriteBatchResult {
    pub folder_ids: Vec<i64>,
    pub file_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderRecord {
    pub id: i64,
    pub root_id: i64,
    pub parent_id: Option<i64>,
    pub name: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaRecord {
    pub id: i64,
    pub root_id: i64,
    pub folder_id: i64,
    pub name: String,
    pub ext: String,
    pub size: i64,
    pub mtime: i64,
    pub kind: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration_ms: Option<i64>,
    pub codec: Option<String>,
    pub thumbnail_state: Option<String>,
    pub thumbnail_cache_key: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRecord {
    pub id: i64,
    pub kind: String,
    pub priority: i64,
    pub status: String,
    pub root_id: Option<i64>,
    pub file_id: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub items_seen: i64,
    pub items_total: Option<i64>,
    pub folders_seen: i64,
    pub media_files_seen: i64,
    pub skipped_files: i64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TaskScanProgress {
    pub items_seen: i64,
    pub items_total: Option<i64>,
    pub folders_seen: i64,
    pub media_files_seen: i64,
    pub skipped_files: i64,
}

impl Database {
    pub fn open(path: impl AsRef<Path>) -> anyhow::Result<Self> {
        let path = path.as_ref().to_path_buf();
        let connection = Connection::open(&path)?;
        Self::from_connection(connection, Some(path))
    }

    pub fn open_in_memory() -> anyhow::Result<Self> {
        let connection = Connection::open_in_memory()?;
        Self::from_connection(connection, None)
    }

    fn from_connection(connection: Connection, path: Option<PathBuf>) -> anyhow::Result<Self> {
        connection.pragma_update(None, "foreign_keys", "ON")?;
        Ok(Self { connection, path })
    }

    pub fn reopen(&self) -> anyhow::Result<Option<Self>> {
        let Some(path) = &self.path else {
            return Ok(None);
        };
        Ok(Some(Self::open(path)?))
    }

    pub fn apply_migrations(&self) -> anyhow::Result<()> {
        self.connection
            .execute_batch(migrations::INITIAL_MIGRATION)?;
        if !self.migration_applied(2)? {
            self.connection
                .execute_batch(migrations::TASK_PROGRESS_MIGRATION)?;
        }
        Ok(())
    }

    fn migration_applied(&self, version: i64) -> anyhow::Result<bool> {
        let count: i64 = self.connection.query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = ?1",
            [version],
            |row| row.get(0),
        )?;
        Ok(count != 0)
    }

    pub fn list_roots(&self) -> anyhow::Result<Vec<RootRecord>> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT roots.id, roots.path, roots.display_name, roots.enabled, roots.created_at,
                   roots.last_scan_at,
                   root_folder.id AS root_folder_id
            FROM roots
            LEFT JOIN folders root_folder
              ON root_folder.root_id = roots.id
             AND root_folder.parent_id IS NULL
             AND root_folder.name = ''
            ORDER BY roots.id ASC
            "#,
        )?;
        let rows = statement.query_map([], root_from_row)?;

        let mut roots = Vec::new();
        for row in rows {
            roots.push(row?);
        }
        Ok(roots)
    }

    pub fn get_root(&self, root_id: i64) -> anyhow::Result<Option<RootRecord>> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT roots.id, roots.path, roots.display_name, roots.enabled, roots.created_at,
                   roots.last_scan_at,
                   root_folder.id AS root_folder_id
            FROM roots
            LEFT JOIN folders root_folder
              ON root_folder.root_id = roots.id
             AND root_folder.parent_id IS NULL
             AND root_folder.name = ''
            WHERE roots.id = ?1
            "#,
        )?;
        let mut rows = statement.query([root_id])?;
        let Some(row) = rows.next()? else {
            return Ok(None);
        };
        Ok(Some(root_from_row(row)?))
    }

    pub fn add_root(&self, root: NewRoot) -> anyhow::Result<i64> {
        let now = unix_timestamp();
        self.connection.execute(
            r#"
            INSERT INTO roots(path, display_name, enabled, created_at)
            VALUES (?1, ?2, 1, ?3)
            ON CONFLICT(path) DO UPDATE SET
              display_name = excluded.display_name,
              enabled = 1
            "#,
            (&root.path, &root.display_name, now),
        )?;
        let id = self.connection.query_row(
            "SELECT id FROM roots WHERE path = ?1",
            [&root.path],
            |row| row.get(0),
        )?;
        Ok(id)
    }

    pub fn create_root_scan_task(&self, root_id: i64) -> anyhow::Result<i64> {
        let now = unix_timestamp();
        self.connection.execute(
            r#"
            INSERT INTO tasks(kind, priority, status, root_id, file_id, created_at, updated_at, error)
            VALUES ('root_scan', 0, 'pending', ?1, NULL, ?2, ?2, NULL)
            "#,
            (root_id, now),
        )?;
        Ok(self.connection.last_insert_rowid())
    }

    pub fn reset_running_root_scan_tasks_for_recovery(&self) -> anyhow::Result<usize> {
        let updated = self.connection.execute(
            r#"
            UPDATE tasks
            SET status = 'pending', updated_at = ?1, error = NULL
            WHERE kind = 'root_scan' AND status = 'running'
            "#,
            [unix_timestamp()],
        )?;
        Ok(updated)
    }

    pub fn list_pending_root_scan_task_ids(&self) -> anyhow::Result<Vec<i64>> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT id
            FROM tasks
            WHERE kind = 'root_scan' AND status = 'pending'
            ORDER BY priority DESC, created_at ASC, id ASC
            "#,
        )?;
        let rows = statement.query_map([], |row| row.get(0))?;

        let mut task_ids = Vec::new();
        for row in rows {
            task_ids.push(row?);
        }
        Ok(task_ids)
    }

    pub fn list_tasks(&self) -> anyhow::Result<Vec<TaskRecord>> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT id, kind, priority, status, root_id, file_id, created_at, updated_at,
                   items_seen, items_total, folders_seen, media_files_seen, skipped_files, error
            FROM tasks
            ORDER BY id ASC
            "#,
        )?;
        let rows = statement.query_map([], task_from_row)?;

        let mut tasks = Vec::new();
        for row in rows {
            tasks.push(row?);
        }
        Ok(tasks)
    }

    pub fn get_task(&self, task_id: i64) -> anyhow::Result<Option<TaskRecord>> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT id, kind, priority, status, root_id, file_id, created_at, updated_at,
                   items_seen, items_total, folders_seen, media_files_seen, skipped_files, error
            FROM tasks
            WHERE id = ?1
            "#,
        )?;
        let mut rows = statement.query([task_id])?;
        Ok(rows.next()?.map(task_from_row).transpose()?)
    }

    pub fn mark_task_running(&self, task_id: i64) -> anyhow::Result<()> {
        let updated = self.connection.execute(
            "UPDATE tasks SET status = 'running', updated_at = ?1, error = NULL WHERE id = ?2 AND status = 'pending'",
            (unix_timestamp(), task_id),
        )?;
        self.ensure_one_task_updated(task_id, updated, "pending")?;
        Ok(())
    }

    pub fn mark_task_succeeded(&self, task_id: i64) -> anyhow::Result<()> {
        let updated = self.connection.execute(
            "UPDATE tasks SET status = 'succeeded', updated_at = ?1, error = NULL WHERE id = ?2 AND status = 'running'",
            (unix_timestamp(), task_id),
        )?;
        self.ensure_one_task_updated(task_id, updated, "running")?;
        Ok(())
    }

    pub fn mark_task_failed(&self, task_id: i64, error: &str) -> anyhow::Result<()> {
        let updated = self.connection.execute(
            "UPDATE tasks SET status = 'failed', updated_at = ?1, error = ?2 WHERE id = ?3 AND status IN ('pending', 'running')",
            (unix_timestamp(), error, task_id),
        )?;
        if updated == 0 {
            return self.ensure_one_task_updated(task_id, updated, "pending or running");
        }
        Ok(())
    }

    pub fn update_task_scan_progress(
        &self,
        task_id: i64,
        progress: TaskScanProgress,
    ) -> anyhow::Result<()> {
        let updated = self.connection.execute(
            r#"
            UPDATE tasks
            SET updated_at = ?1,
                items_seen = ?2,
                items_total = ?3,
                folders_seen = ?4,
                media_files_seen = ?5,
                skipped_files = ?6
            WHERE id = ?7 AND status = 'running'
            "#,
            (
                unix_timestamp(),
                progress.items_seen,
                progress.items_total,
                progress.folders_seen,
                progress.media_files_seen,
                progress.skipped_files,
                task_id,
            ),
        )?;
        self.ensure_one_task_updated(task_id, updated, "running")?;
        Ok(())
    }

    pub fn list_media_page(&self, query: MediaPageQuery) -> anyhow::Result<Vec<MediaRecord>> {
        let limit = query.limit.clamp(1, 500);
        let sort_clause = match query.sort.as_str() {
            "mtime_asc" => "files.mtime ASC, files.id ASC",
            "name_asc" => "files.name ASC, files.id ASC",
            "name_desc" => "files.name DESC, files.id DESC",
            _ => "files.mtime DESC, files.id DESC",
        };

        let sql = format!(
            r#"
            SELECT files.id, files.root_id, files.folder_id, files.name, files.ext,
                   files.size, files.mtime, media.kind, media.width, media.height,
                   media.duration_ms, media.codec,
                   thumbs.state, thumbs.cache_key
            FROM files
            LEFT JOIN media ON media.file_id = files.id
            LEFT JOIN thumbs ON thumbs.file_id = files.id AND thumbs.profile = 'grid'
            WHERE files.status = 'active'
              AND (?2 IS NULL OR files.root_id = ?2)
              AND (?3 IS NULL OR files.folder_id = ?3)
              AND (?4 IS NULL OR media.kind = ?4)
            ORDER BY {sort_clause}
            LIMIT ?1
            "#,
            sort_clause = sort_clause,
        );

        let _cursor = query.cursor;

        let mut statement = self.connection.prepare(&sql)?;
        let rows = statement.query_map(
            rusqlite::params![limit, query.root_id, query.folder_id, query.kind],
            media_from_row,
        )?;

        let mut items = Vec::new();
        for row in rows {
            items.push(row?);
        }
        Ok(items)
    }

    pub fn get_media(&self, file_id: i64) -> anyhow::Result<Option<MediaRecord>> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT files.id, files.root_id, files.folder_id, files.name, files.ext,
                   files.size, files.mtime, media.kind, media.width, media.height,
                   media.duration_ms, media.codec, thumbs.state, thumbs.cache_key
            FROM files
            LEFT JOIN media ON media.file_id = files.id
            LEFT JOIN thumbs ON thumbs.file_id = files.id AND thumbs.profile = 'grid'
            WHERE files.id = ?1 AND files.status = 'active'
            "#,
        )?;
        let mut rows = statement.query([file_id])?;
        let Some(row) = rows.next()? else {
            return Ok(None);
        };
        Ok(Some(media_from_row(row)?))
    }

    pub fn list_folder_children(&self, folder_id: i64) -> anyhow::Result<Vec<FolderRecord>> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT id, root_id, parent_id, name, status
            FROM folders
            WHERE parent_id = ?1 AND status = 'active'
            ORDER BY name ASC, id ASC
            "#,
        )?;
        let rows = statement.query_map([folder_id], |row| {
            Ok(FolderRecord {
                id: row.get(0)?,
                root_id: row.get(1)?,
                parent_id: row.get(2)?,
                name: row.get(3)?,
                status: row.get(4)?,
            })
        })?;

        let mut folders = Vec::new();
        for row in rows {
            folders.push(row?);
        }
        Ok(folders)
    }

    pub fn folder_exists(&self, folder_id: i64) -> anyhow::Result<bool> {
        let exists: i64 = self.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM folders WHERE id = ?1 AND status = 'active')",
            [folder_id],
            |row| row.get(0),
        )?;
        Ok(exists != 0)
    }

    #[allow(dead_code)]
    pub fn upsert_folder(&self, folder: FolderUpsert) -> anyhow::Result<i64> {
        if let Some(existing_id) =
            self.find_folder_id(folder.root_id, folder.parent_id, &folder.name)?
        {
            self.connection.execute(
                r#"
                UPDATE folders
                SET path_hash = ?1, mtime = ?2, status = 'active'
                WHERE id = ?3
                "#,
                (&folder.path_hash, folder.mtime, existing_id),
            )?;
            return Ok(existing_id);
        }

        self.connection.execute(
            r#"
            INSERT INTO folders(root_id, parent_id, name, path_hash, mtime, status)
            VALUES (?1, ?2, ?3, ?4, ?5, 'active')
            "#,
            (
                folder.root_id,
                folder.parent_id,
                &folder.name,
                &folder.path_hash,
                folder.mtime,
            ),
        )?;
        Ok(self.connection.last_insert_rowid())
    }

    #[allow(dead_code)]
    pub fn upsert_file(&self, file: FileUpsert) -> anyhow::Result<i64> {
        self.connection.execute(
            r#"
            INSERT INTO files(root_id, folder_id, name, ext, size, mtime, ctime, file_key, status)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'active')
            ON CONFLICT(folder_id, name) DO UPDATE SET
              ext = excluded.ext,
              size = excluded.size,
              mtime = excluded.mtime,
              ctime = excluded.ctime,
              file_key = excluded.file_key,
              status = 'active'
            "#,
            (
                file.root_id,
                file.folder_id,
                &file.name,
                &file.ext,
                file.size,
                file.mtime,
                file.ctime,
                &file.file_key,
            ),
        )?;
        let id = self.connection.query_row(
            "SELECT id FROM files WHERE folder_id = ?1 AND name = ?2",
            (file.folder_id, &file.name),
            |row| row.get(0),
        )?;
        Ok(id)
    }

    #[allow(dead_code)]
    pub fn upsert_media_kind(&self, file_id: i64, kind: &str) -> anyhow::Result<()> {
        self.connection.execute(
            r#"
            INSERT INTO media(file_id, kind, metadata_status)
            VALUES (?1, ?2, 'pending')
            ON CONFLICT(file_id) DO UPDATE SET
              kind = excluded.kind
            "#,
            (file_id, kind),
        )?;
        Ok(())
    }

    pub fn commit_scan_batch(
        &mut self,
        batch: ScanWriteBatch,
    ) -> anyhow::Result<ScanWriteBatchResult> {
        let transaction = self.connection.transaction()?;
        let mut folder_ids = Vec::with_capacity(batch.folders.len());
        let mut file_ids = Vec::with_capacity(batch.files.len());

        for folder in batch.folders {
            folder_ids.push(upsert_folder_in_transaction(&transaction, folder)?);
        }

        for file in batch.files {
            let file_id = upsert_file_in_transaction(&transaction, file.file)?;
            upsert_media_kind_in_transaction(&transaction, file_id, &file.media_kind)?;
            file_ids.push(file_id);
        }

        transaction.commit()?;
        Ok(ScanWriteBatchResult {
            folder_ids,
            file_ids,
        })
    }

    pub fn mark_root_scanned(&self, root_id: i64) -> anyhow::Result<()> {
        self.connection.execute(
            "UPDATE roots SET last_scan_at = ?1 WHERE id = ?2",
            (unix_timestamp(), root_id),
        )?;
        Ok(())
    }

    #[allow(dead_code)]
    fn find_folder_id(
        &self,
        root_id: i64,
        parent_id: Option<i64>,
        name: &str,
    ) -> anyhow::Result<Option<i64>> {
        if let Some(parent_id) = parent_id {
            let mut statement = self.connection.prepare(
                r#"
                SELECT id FROM folders
                WHERE root_id = ?1 AND parent_id = ?2 AND name = ?3
                "#,
            )?;
            let mut rows = statement.query((root_id, parent_id, name))?;
            Ok(rows.next()?.map(|row| row.get(0)).transpose()?)
        } else {
            let mut statement = self.connection.prepare(
                r#"
                SELECT id FROM folders
                WHERE root_id = ?1 AND parent_id IS NULL AND name = ?2
                "#,
            )?;
            let mut rows = statement.query((root_id, name))?;
            Ok(rows.next()?.map(|row| row.get(0)).transpose()?)
        }
    }

    fn ensure_one_task_updated(
        &self,
        task_id: i64,
        updated: usize,
        expected_status: &str,
    ) -> anyhow::Result<()> {
        if updated == 1 {
            return Ok(());
        }

        let Some(task) = self.get_task(task_id)? else {
            return Err(anyhow::anyhow!("task not found: {task_id}"));
        };
        Err(anyhow::anyhow!(
            "task {task_id} is not {expected_status}; current status is {}",
            task.status
        ))
    }
}

fn upsert_folder_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    folder: FolderUpsert,
) -> anyhow::Result<i64> {
    if let Some(existing_id) =
        find_folder_id_in_transaction(transaction, folder.root_id, folder.parent_id, &folder.name)?
    {
        transaction.execute(
            r#"
            UPDATE folders
            SET path_hash = ?1, mtime = ?2, status = 'active'
            WHERE id = ?3
            "#,
            (&folder.path_hash, folder.mtime, existing_id),
        )?;
        return Ok(existing_id);
    }

    transaction.execute(
        r#"
        INSERT INTO folders(root_id, parent_id, name, path_hash, mtime, status)
        VALUES (?1, ?2, ?3, ?4, ?5, 'active')
        "#,
        (
            folder.root_id,
            folder.parent_id,
            &folder.name,
            &folder.path_hash,
            folder.mtime,
        ),
    )?;
    Ok(transaction.last_insert_rowid())
}

fn upsert_file_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    file: FileUpsert,
) -> anyhow::Result<i64> {
    transaction.execute(
        r#"
        INSERT INTO files(root_id, folder_id, name, ext, size, mtime, ctime, file_key, status)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'active')
        ON CONFLICT(folder_id, name) DO UPDATE SET
          ext = excluded.ext,
          size = excluded.size,
          mtime = excluded.mtime,
          ctime = excluded.ctime,
          file_key = excluded.file_key,
          status = 'active'
        "#,
        (
            file.root_id,
            file.folder_id,
            &file.name,
            &file.ext,
            file.size,
            file.mtime,
            file.ctime,
            &file.file_key,
        ),
    )?;
    let id = transaction.query_row(
        "SELECT id FROM files WHERE folder_id = ?1 AND name = ?2",
        (file.folder_id, &file.name),
        |row| row.get(0),
    )?;
    Ok(id)
}

fn upsert_media_kind_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    file_id: i64,
    kind: &str,
) -> anyhow::Result<()> {
    transaction.execute(
        r#"
        INSERT INTO media(file_id, kind, metadata_status)
        VALUES (?1, ?2, 'pending')
        ON CONFLICT(file_id) DO UPDATE SET
          kind = excluded.kind
        "#,
        (file_id, kind),
    )?;
    Ok(())
}

fn find_folder_id_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    root_id: i64,
    parent_id: Option<i64>,
    name: &str,
) -> anyhow::Result<Option<i64>> {
    if let Some(parent_id) = parent_id {
        let mut statement = transaction.prepare(
            r#"
            SELECT id FROM folders
            WHERE root_id = ?1 AND parent_id = ?2 AND name = ?3
            "#,
        )?;
        let mut rows = statement.query((root_id, parent_id, name))?;
        Ok(rows.next()?.map(|row| row.get(0)).transpose()?)
    } else {
        let mut statement = transaction.prepare(
            r#"
            SELECT id FROM folders
            WHERE root_id = ?1 AND parent_id IS NULL AND name = ?2
            "#,
        )?;
        let mut rows = statement.query((root_id, name))?;
        Ok(rows.next()?.map(|row| row.get(0)).transpose()?)
    }
}

fn root_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RootRecord> {
    Ok(RootRecord {
        id: row.get(0)?,
        path: row.get(1)?,
        display_name: row.get(2)?,
        enabled: row.get::<_, i64>(3)? != 0,
        created_at: row.get(4)?,
        last_scan_at: row.get(5)?,
        root_folder_id: row.get(6)?,
    })
}

fn media_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MediaRecord> {
    Ok(MediaRecord {
        id: row.get(0)?,
        root_id: row.get(1)?,
        folder_id: row.get(2)?,
        name: row.get(3)?,
        ext: row.get(4)?,
        size: row.get(5)?,
        mtime: row.get(6)?,
        kind: row.get(7)?,
        width: row.get(8)?,
        height: row.get(9)?,
        duration_ms: row.get(10)?,
        codec: row.get(11)?,
        thumbnail_state: row.get(12)?,
        thumbnail_cache_key: row.get(13)?,
    })
}

fn task_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TaskRecord> {
    Ok(TaskRecord {
        id: row.get(0)?,
        kind: row.get(1)?,
        priority: row.get(2)?,
        status: row.get(3)?,
        root_id: row.get(4)?,
        file_id: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        items_seen: row.get(8)?,
        items_total: row.get(9)?,
        folders_seen: row.get(10)?,
        media_files_seen: row.get(11)?,
        skipped_files: row.get(12)?,
        error: row.get(13)?,
    })
}

fn unix_timestamp() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn migrated_database() -> Database {
        let database = Database::open_in_memory().expect("open in-memory database");
        database.apply_migrations().expect("apply migrations");
        database
    }

    const OLD_INITIAL_MIGRATION_WITHOUT_TASK_PROGRESS: &str = r#"
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS roots (
          id INTEGER PRIMARY KEY,
          path TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL,
          last_scan_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS folders (
          id INTEGER PRIMARY KEY,
          root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
          parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          path_hash TEXT NOT NULL,
          mtime INTEGER,
          status TEXT NOT NULL DEFAULT 'active',
          UNIQUE(root_id, parent_id, name)
        );

        CREATE TABLE IF NOT EXISTS files (
          id INTEGER PRIMARY KEY,
          root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
          folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          ext TEXT NOT NULL,
          size INTEGER NOT NULL,
          mtime INTEGER NOT NULL,
          ctime INTEGER,
          file_key TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          UNIQUE(folder_id, name)
        );

        CREATE TABLE IF NOT EXISTS tasks (
          id INTEGER PRIMARY KEY,
          kind TEXT NOT NULL,
          priority INTEGER NOT NULL,
          status TEXT NOT NULL,
          root_id INTEGER REFERENCES roots(id) ON DELETE SET NULL,
          file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          error TEXT
        );

        INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
        VALUES (1, 'initial', unixepoch());
    "#;

    #[test]
    fn add_root_lists_and_reenables_existing_root() {
        let database = migrated_database();
        let root_id = database
            .add_root(NewRoot {
                path: "D:/Pictures".to_string(),
                display_name: "Pictures".to_string(),
            })
            .expect("add root");

        let same_root_id = database
            .add_root(NewRoot {
                path: "D:/Pictures".to_string(),
                display_name: "Photos".to_string(),
            })
            .expect("upsert root");

        let roots = database.list_roots().expect("list roots");
        assert_eq!(root_id, same_root_id);
        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].path, "D:/Pictures");
        assert_eq!(roots[0].display_name, "Photos");
        assert!(roots[0].enabled);
    }

    #[test]
    fn migrations_upgrade_old_initial_tasks_table_with_progress_columns() {
        let database = Database::open_in_memory().expect("open in-memory database");
        database
            .connection
            .execute_batch(OLD_INITIAL_MIGRATION_WITHOUT_TASK_PROGRESS)
            .expect("apply old initial migration");

        let root_id = database
            .add_root(NewRoot {
                path: "D:/Pictures".to_string(),
                display_name: "Pictures".to_string(),
            })
            .expect("add root on old schema");
        database
            .create_root_scan_task(root_id)
            .expect("create task on old schema");

        database
            .apply_migrations()
            .expect("apply current migrations");
        let columns: Vec<String> = {
            let mut statement = database
                .connection
                .prepare("PRAGMA table_info(tasks)")
                .expect("inspect tasks table");
            statement
                .query_map([], |row| row.get(1))
                .expect("query columns")
                .collect::<rusqlite::Result<Vec<String>>>()
                .expect("collect columns")
        };
        for column in [
            "items_seen",
            "items_total",
            "folders_seen",
            "media_files_seen",
            "skipped_files",
        ] {
            assert!(columns.iter().any(|candidate| candidate == column));
        }

        let tasks = database.list_tasks().expect("list upgraded tasks");
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].items_seen, 0);
        assert_eq!(tasks[0].items_total, None);
        assert_eq!(tasks[0].folders_seen, 0);
        assert_eq!(tasks[0].media_files_seen, 0);
        assert_eq!(tasks[0].skipped_files, 0);
    }

    #[test]
    fn list_media_page_returns_media_and_grid_thumbnail_state() {
        let database = migrated_database();
        let root_id = database
            .add_root(NewRoot {
                path: "D:/Pictures".to_string(),
                display_name: "Pictures".to_string(),
            })
            .expect("add root");

        database
            .connection
            .execute(
                r#"
                INSERT INTO folders(root_id, parent_id, name, path_hash, mtime)
                VALUES (?1, NULL, '', 'root-hash', 10)
                "#,
                [root_id],
            )
            .expect("insert folder");
        let folder_id = database.connection.last_insert_rowid();

        database
            .connection
            .execute(
                r#"
                INSERT INTO files(root_id, folder_id, name, ext, size, mtime)
                VALUES (?1, ?2, 'image.jpg', '.jpg', 1000, 20)
                "#,
                (root_id, folder_id),
            )
            .expect("insert file");
        let file_id = database.connection.last_insert_rowid();

        database
            .connection
            .execute(
                r#"
                INSERT INTO media(file_id, kind, width, height, metadata_status)
                VALUES (?1, 'image', 640, 480, 'ready')
                "#,
                [file_id],
            )
            .expect("insert media");

        database
            .connection
            .execute(
                r#"
                INSERT INTO thumbs(file_id, profile, cache_key, width, height, byte_size, state, updated_at)
                VALUES (?1, 'grid', 'aa/bb/key.webp', 427, 320, 4096, 'ready', 30)
                "#,
                [file_id],
            )
            .expect("insert thumbnail");

        let page = database
            .list_media_page(MediaPageQuery {
                root_id: Some(root_id),
                folder_id: Some(folder_id),
                limit: 200,
                cursor: None,
                sort: "mtime_desc".to_string(),
                kind: Some("image".to_string()),
            })
            .expect("list media page");

        assert_eq!(page.len(), 1);
        assert_eq!(page[0].id, file_id);
        assert_eq!(page[0].name, "image.jpg");
        assert_eq!(page[0].kind.as_deref(), Some("image"));
        assert_eq!(page[0].thumbnail_state.as_deref(), Some("ready"));
        assert_eq!(
            page[0].thumbnail_cache_key.as_deref(),
            Some("aa/bb/key.webp")
        );

        let item = database
            .get_media(file_id)
            .expect("get media")
            .expect("media exists");
        assert_eq!(item.id, file_id);
        assert_eq!(item.name, "image.jpg");
        assert!(database
            .get_media(file_id + 10)
            .expect("get missing")
            .is_none());
    }

    #[test]
    fn commit_scan_batch_commits_folders_files_and_media_and_upserts_without_duplicates() {
        let mut database = migrated_database();
        let root_id = database
            .add_root(NewRoot {
                path: "D:/Pictures".to_string(),
                display_name: "Pictures".to_string(),
            })
            .expect("add root");

        let first_result = database
            .commit_scan_batch(ScanWriteBatch {
                folders: vec![FolderUpsert {
                    root_id,
                    parent_id: None,
                    name: String::new(),
                    path_hash: "root-hash".to_string(),
                    mtime: Some(10),
                }],
                files: Vec::new(),
            })
            .expect("commit root folder");

        let root_folder_id = first_result.folder_ids[0];
        let photos_result = database
            .commit_scan_batch(ScanWriteBatch {
                folders: vec![FolderUpsert {
                    root_id,
                    parent_id: Some(root_folder_id),
                    name: "photos".to_string(),
                    path_hash: "photos-hash".to_string(),
                    mtime: Some(20),
                }],
                files: Vec::new(),
            })
            .expect("commit child folder");
        let photos_folder_id = photos_result.folder_ids[0];
        let second_result = database
            .commit_scan_batch(ScanWriteBatch {
                folders: Vec::new(),
                files: vec![
                    ScanFileUpsert {
                        file: FileUpsert {
                            root_id,
                            folder_id: root_folder_id,
                            name: "clip.mp4".to_string(),
                            ext: ".mp4".to_string(),
                            size: 100,
                            mtime: 30,
                            ctime: None,
                            file_key: None,
                        },
                        media_kind: "video".to_string(),
                    },
                    ScanFileUpsert {
                        file: FileUpsert {
                            root_id,
                            folder_id: photos_folder_id,
                            name: "image.jpg".to_string(),
                            ext: ".jpg".to_string(),
                            size: 200,
                            mtime: 40,
                            ctime: None,
                            file_key: None,
                        },
                        media_kind: "image".to_string(),
                    },
                ],
            })
            .expect("commit files");
        assert_eq!(second_result.file_ids.len(), 2);

        database
            .commit_scan_batch(ScanWriteBatch {
                folders: vec![FolderUpsert {
                    root_id,
                    parent_id: Some(root_folder_id),
                    name: "photos".to_string(),
                    path_hash: "photos-hash-updated".to_string(),
                    mtime: Some(50),
                }],
                files: vec![ScanFileUpsert {
                    file: FileUpsert {
                        root_id,
                        folder_id: photos_folder_id,
                        name: "image.jpg".to_string(),
                        ext: ".jpg".to_string(),
                        size: 300,
                        mtime: 60,
                        ctime: None,
                        file_key: None,
                    },
                    media_kind: "image".to_string(),
                }],
            })
            .expect("upsert same rows");

        let folder_count: i64 = database
            .connection
            .query_row("SELECT COUNT(*) FROM folders", [], |row| row.get(0))
            .expect("count folders");
        let file_count: i64 = database
            .connection
            .query_row("SELECT COUNT(*) FROM files", [], |row| row.get(0))
            .expect("count files");
        let media_count: i64 = database
            .connection
            .query_row("SELECT COUNT(*) FROM media", [], |row| row.get(0))
            .expect("count media");
        let updated_size: i64 = database
            .connection
            .query_row(
                "SELECT size FROM files WHERE folder_id = ?1 AND name = 'image.jpg'",
                [photos_folder_id],
                |row| row.get(0),
            )
            .expect("updated file size");

        assert_eq!(folder_count, 2);
        assert_eq!(file_count, 2);
        assert_eq!(media_count, 2);
        assert_eq!(updated_size, 300);
    }

    #[test]
    fn commit_scan_batch_rolls_back_when_file_folder_is_invalid() {
        let mut database = migrated_database();
        let root_id = database
            .add_root(NewRoot {
                path: "D:/Pictures".to_string(),
                display_name: "Pictures".to_string(),
            })
            .expect("add root");

        let error = database
            .commit_scan_batch(ScanWriteBatch {
                folders: vec![FolderUpsert {
                    root_id,
                    parent_id: None,
                    name: String::new(),
                    path_hash: "root-hash".to_string(),
                    mtime: Some(10),
                }],
                files: vec![ScanFileUpsert {
                    file: FileUpsert {
                        root_id,
                        folder_id: 123456,
                        name: "orphan.jpg".to_string(),
                        ext: ".jpg".to_string(),
                        size: 100,
                        mtime: 20,
                        ctime: None,
                        file_key: None,
                    },
                    media_kind: "image".to_string(),
                }],
            })
            .expect_err("invalid folder id should rollback");

        assert!(error.to_string().contains("FOREIGN KEY"));
        let folder_count: i64 = database
            .connection
            .query_row("SELECT COUNT(*) FROM folders", [], |row| row.get(0))
            .expect("count folders");
        let file_count: i64 = database
            .connection
            .query_row("SELECT COUNT(*) FROM files", [], |row| row.get(0))
            .expect("count files");
        assert_eq!(folder_count, 0);
        assert_eq!(file_count, 0);
    }

    #[test]
    fn task_lifecycle_records_pending_running_success_and_failure() {
        let database = migrated_database();
        let root_id = database
            .add_root(NewRoot {
                path: "D:/Pictures".to_string(),
                display_name: "Pictures".to_string(),
            })
            .expect("add root");

        let first_task_id = database
            .create_root_scan_task(root_id)
            .expect("create root scan task");
        let second_task_id = database
            .create_root_scan_task(root_id)
            .expect("create second root scan task");

        let tasks = database.list_tasks().expect("list tasks");
        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].id, first_task_id);
        assert_eq!(tasks[0].kind, "root_scan");
        assert_eq!(tasks[0].priority, 0);
        assert_eq!(tasks[0].status, "pending");
        assert_eq!(tasks[0].root_id, Some(root_id));
        assert_eq!(tasks[0].file_id, None);
        assert_eq!(tasks[0].error, None);

        database
            .mark_task_running(first_task_id)
            .expect("mark task running");
        let task = database
            .get_task(first_task_id)
            .expect("get task")
            .expect("task exists");
        assert_eq!(task.status, "running");
        assert_eq!(task.error, None);

        database
            .mark_task_succeeded(first_task_id)
            .expect("mark task succeeded");
        let task = database
            .get_task(first_task_id)
            .expect("get task")
            .expect("task exists");
        assert_eq!(task.status, "succeeded");
        assert_eq!(task.error, None);

        database
            .mark_task_failed(second_task_id, "scan failed")
            .expect("mark task failed");
        let task = database
            .get_task(second_task_id)
            .expect("get task")
            .expect("task exists");
        assert_eq!(task.status, "failed");
        assert_eq!(task.error.as_deref(), Some("scan failed"));
    }

    #[test]
    fn task_scan_progress_defaults_updates_and_rejects_finished_tasks() {
        let database = migrated_database();
        let root_id = database
            .add_root(NewRoot {
                path: "D:/Pictures".to_string(),
                display_name: "Pictures".to_string(),
            })
            .expect("add root");
        let task_id = database
            .create_root_scan_task(root_id)
            .expect("create task");

        let pending_task = database
            .get_task(task_id)
            .expect("get task")
            .expect("task exists");
        assert_eq!(pending_task.items_seen, 0);
        assert_eq!(pending_task.items_total, None);
        assert_eq!(pending_task.folders_seen, 0);
        assert_eq!(pending_task.media_files_seen, 0);
        assert_eq!(pending_task.skipped_files, 0);

        database.mark_task_running(task_id).expect("mark running");
        database
            .update_task_scan_progress(
                task_id,
                TaskScanProgress {
                    items_seen: 6,
                    items_total: None,
                    folders_seen: 2,
                    media_files_seen: 3,
                    skipped_files: 1,
                },
            )
            .expect("update progress");

        let running_task = database
            .get_task(task_id)
            .expect("get running task")
            .expect("running task exists");
        assert_eq!(running_task.items_seen, 6);
        assert_eq!(running_task.items_total, None);
        assert_eq!(running_task.folders_seen, 2);
        assert_eq!(running_task.media_files_seen, 3);
        assert_eq!(running_task.skipped_files, 1);

        database
            .mark_task_succeeded(task_id)
            .expect("mark succeeded");
        let late_update = database.update_task_scan_progress(
            task_id,
            TaskScanProgress {
                items_seen: 7,
                items_total: None,
                folders_seen: 2,
                media_files_seen: 4,
                skipped_files: 1,
            },
        );
        assert!(late_update
            .expect_err("finished task should reject progress updates")
            .to_string()
            .contains("running"));
    }

    #[test]
    fn task_status_transitions_reject_missing_and_finished_tasks() {
        let database = migrated_database();
        let root_id = database
            .add_root(NewRoot {
                path: "D:/Pictures".to_string(),
                display_name: "Pictures".to_string(),
            })
            .expect("add root");
        let task_id = database
            .create_root_scan_task(root_id)
            .expect("create root scan task");

        let missing_error = database
            .mark_task_running(task_id + 100)
            .expect_err("missing task should fail");
        assert!(missing_error.to_string().contains("task not found"));

        database
            .mark_task_running(task_id)
            .expect("mark task running");
        database
            .mark_task_succeeded(task_id)
            .expect("mark task succeeded");
        let rerun_error = database
            .mark_task_running(task_id)
            .expect_err("finished task should not be rerun");
        assert!(rerun_error.to_string().contains("not pending"));
    }

    #[test]
    fn mark_task_failed_rejects_finished_tasks() {
        let database = migrated_database();
        let root_id = database
            .add_root(NewRoot {
                path: "D:/Pictures".to_string(),
                display_name: "Pictures".to_string(),
            })
            .expect("add root");
        let succeeded_task_id = database
            .create_root_scan_task(root_id)
            .expect("create succeeded task");
        let failed_task_id = database
            .create_root_scan_task(root_id)
            .expect("create failed task");

        database
            .mark_task_running(succeeded_task_id)
            .expect("mark succeeded task running");
        database
            .mark_task_succeeded(succeeded_task_id)
            .expect("mark task succeeded");
        let succeeded_error = database
            .mark_task_failed(succeeded_task_id, "late failure")
            .expect_err("succeeded task should not be marked failed");
        assert!(succeeded_error
            .to_string()
            .contains("not pending or running"));

        database
            .mark_task_failed(failed_task_id, "first failure")
            .expect("mark task failed");
        let failed_error = database
            .mark_task_failed(failed_task_id, "second failure")
            .expect_err("failed task should not be marked failed again");
        assert!(failed_error.to_string().contains("not pending or running"));
    }

    #[test]
    fn recovery_resets_running_root_scans_and_lists_pending_root_scans_in_scheduler_order() {
        let database = migrated_database();
        let root_id = database
            .add_root(NewRoot {
                path: "D:/Pictures".to_string(),
                display_name: "Pictures".to_string(),
            })
            .expect("add root");

        let low_priority_pending = database
            .create_root_scan_task(root_id)
            .expect("create low priority pending");
        let stale_running = database
            .create_root_scan_task(root_id)
            .expect("create stale running");
        let failed = database
            .create_root_scan_task(root_id)
            .expect("create failed");
        let succeeded = database
            .create_root_scan_task(root_id)
            .expect("create succeeded");
        let high_priority_pending = database
            .create_root_scan_task(root_id)
            .expect("create high priority pending");

        database
            .connection
            .execute(
                r#"
                INSERT INTO tasks(kind, priority, status, root_id, file_id, created_at, updated_at, error)
                VALUES ('thumbnail', 100, 'pending', NULL, NULL, 1, 1, NULL)
                "#,
                [],
            )
            .expect("insert non-root pending task");

        database
            .mark_task_running(stale_running)
            .expect("mark stale running");
        database
            .connection
            .execute(
                "UPDATE tasks SET error = 'interrupted' WHERE id = ?1",
                [stale_running],
            )
            .expect("set stale running error");
        database
            .mark_task_failed(failed, "scan failed")
            .expect("mark failed");
        database
            .mark_task_running(succeeded)
            .expect("mark succeeded running");
        database
            .mark_task_succeeded(succeeded)
            .expect("mark succeeded");
        database
            .connection
            .execute(
                "UPDATE tasks SET priority = 10, created_at = 0 WHERE id = ?1",
                [high_priority_pending],
            )
            .expect("raise pending priority");

        let reset_count = database
            .reset_running_root_scan_tasks_for_recovery()
            .expect("reset running root scan tasks");
        assert_eq!(reset_count, 1);

        let stale_task = database
            .get_task(stale_running)
            .expect("get stale task")
            .expect("stale task exists");
        assert_eq!(stale_task.status, "pending");
        assert_eq!(stale_task.error, None);

        let failed_task = database
            .get_task(failed)
            .expect("get failed task")
            .expect("failed task exists");
        assert_eq!(failed_task.status, "failed");
        assert_eq!(failed_task.error.as_deref(), Some("scan failed"));

        let succeeded_task = database
            .get_task(succeeded)
            .expect("get succeeded task")
            .expect("succeeded task exists");
        assert_eq!(succeeded_task.status, "succeeded");

        let pending_ids = database
            .list_pending_root_scan_task_ids()
            .expect("list pending root scan task ids");
        assert_eq!(
            pending_ids,
            vec![high_priority_pending, low_priority_pending, stale_running]
        );
    }
}
