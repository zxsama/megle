pub mod migrations;

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use rusqlite::types::Value;
use rusqlite::{params_from_iter, Connection, Transaction, TransactionBehavior};
use serde::Serialize;

use crate::thumbnails::{
    is_safe_cache_key, source_fingerprint_for, CacheIdentity, ThumbnailDecision, ThumbnailPolicy,
    GENERATED_FORMAT, GRID_320_PROFILE, GRID_320_SHORT_SIDE_PX,
};

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

#[derive(Debug, Clone)]
pub struct Page<T> {
    pub items: Vec<T>,
    pub next_cursor: Option<String>,
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
    pub scan_generation: Option<i64>,
}

pub struct ScanFileUpsert {
    pub file: FileUpsert,
    pub media_kind: String,
}

#[allow(dead_code)]
pub struct ThumbnailStateUpsert {
    pub file_id: i64,
    pub profile: String,
    pub state: String,
    pub cache_key: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub byte_size: Option<i64>,
    pub error: Option<String>,
    pub source_fingerprint: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ThumbnailTaskRequest {
    pub thumbnail: ThumbnailRecord,
    pub task_id: Option<i64>,
    pub queued: bool,
}

#[derive(Debug, Clone)]
pub struct ThumbnailSourceRecord {
    pub file_id: i64,
    pub root_id: i64,
    pub folder_id: i64,
    pub name: String,
    pub size: i64,
    pub mtime: i64,
    pub file_key: Option<String>,
    pub media_kind: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub metadata_status: Option<String>,
}

impl ThumbnailSourceRecord {
    pub fn cache_identity(&self) -> CacheIdentity<'_> {
        CacheIdentity {
            file_id: self.file_id,
            root_id: self.root_id,
            folder_id: self.folder_id,
            name: &self.name,
            size: self.size,
            mtime: self.mtime,
            file_key: self.file_key.as_deref(),
        }
    }

    pub fn source_fingerprint(&self, profile: &str) -> String {
        source_fingerprint_for(&self.cache_identity(), profile)
    }

    fn has_reliable_dimensions(&self) -> bool {
        self.metadata_status.as_deref() == Some("ready")
    }
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
pub struct ThumbnailRecord {
    pub file_id: i64,
    pub profile: String,
    pub state: String,
    pub short_side_px: i64,
    pub output_format: String,
    pub cache_key: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub byte_size: Option<i64>,
    pub error: Option<String>,
    pub source_fingerprint: Option<String>,
    pub updated_at: Option<i64>,
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
    #[serde(skip_serializing)]
    pub thumbnail_source_fingerprint: Option<String>,
    #[serde(skip_serializing)]
    pub attempt_generation: i64,
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
        // Set busy_timeout BEFORE any other operation so the busy handler
        // is registered for every subsequent SQL statement, including the
        // foreign_keys PRAGMA, migration writes, and transaction
        // escalation.
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        Ok(Self { connection, path })
    }

    pub fn reopen(&self) -> anyhow::Result<Option<Self>> {
        let Some(path) = &self.path else {
            return Ok(None);
        };
        Ok(Some(Self::open(path)?))
    }

    pub fn default_thumbnail_cache_dir(&self) -> PathBuf {
        if let Some(path) = &self.path {
            return path
                .parent()
                .map(|parent| parent.join("thumbnail-cache"))
                .unwrap_or_else(|| PathBuf::from("thumbnail-cache"));
        }
        std::env::temp_dir().join("megle-thumbnail-cache")
    }

    pub fn apply_migrations(&self) -> anyhow::Result<()> {
        self.connection
            .execute_batch(migrations::INITIAL_MIGRATION)?;
        if !self.migration_applied(2)? {
            self.connection
                .execute_batch(migrations::TASK_PROGRESS_MIGRATION)?;
        }
        if !self.migration_applied(3)? {
            self.connection
                .execute_batch(migrations::BROWSING_INDEXES_MIGRATION)?;
        }
        if !self.migration_applied(4)? {
            let result = self
                .connection
                .execute_batch(migrations::THUMBNAIL_STATE_MIGRATION);
            self.connection.pragma_update(None, "foreign_keys", "ON")?;
            result?;
        }
        if !self.migration_applied(5)? {
            let result = self
                .connection
                .execute_batch(migrations::THUMBNAIL_SOURCE_FINGERPRINT_MIGRATION);
            self.connection.pragma_update(None, "foreign_keys", "ON")?;
            result?;
        }
        if !self.migration_applied(6)? {
            self.connection
                .execute_batch(migrations::THUMBNAIL_TASK_ATTEMPT_FINGERPRINT_MIGRATION)?;
        }
        if !self.migration_applied(7)? {
            self.ensure_task_contract_prerequisite_columns()?;
            let result = self
                .connection
                .execute_batch(migrations::TASK_STATUS_CONTRACT_MIGRATION);
            self.connection.pragma_update(None, "foreign_keys", "ON")?;
            result?;
        }
        if !self.migration_applied(8)? {
            self.apply_task_attempt_generation_migration()?;
        }
        if !self.migration_applied(9)? {
            self.apply_scan_reconciliation_migration()?;
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

    fn ensure_task_contract_prerequisite_columns(&self) -> anyhow::Result<()> {
        for (column, definition) in [
            ("items_seen", "items_seen INTEGER NOT NULL DEFAULT 0"),
            ("items_total", "items_total INTEGER"),
            ("folders_seen", "folders_seen INTEGER NOT NULL DEFAULT 0"),
            (
                "media_files_seen",
                "media_files_seen INTEGER NOT NULL DEFAULT 0",
            ),
            ("skipped_files", "skipped_files INTEGER NOT NULL DEFAULT 0"),
            (
                "thumbnail_source_fingerprint",
                "thumbnail_source_fingerprint TEXT",
            ),
            (
                "attempt_generation",
                "attempt_generation INTEGER NOT NULL DEFAULT 0",
            ),
        ] {
            if !self.table_has_column("tasks", column)? {
                self.connection
                    .execute_batch(&format!("ALTER TABLE tasks ADD COLUMN {definition}"))?;
            }
        }
        Ok(())
    }

    fn apply_scan_reconciliation_migration(&self) -> anyhow::Result<()> {
        if !self.table_has_column("roots", "active_scan_generation")? {
            self.connection
                .execute_batch(migrations::SCAN_RECONCILIATION_MIGRATION)?;
        }
        for table in ["folders", "files"] {
            if !self.table_has_column(table, "scan_seen_at")? {
                self.connection.execute_batch(&format!(
                    "ALTER TABLE {table} ADD COLUMN scan_seen_at INTEGER"
                ))?;
            }
        }
        self.connection.execute(
            r#"
            INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
            VALUES (9, 'scan_reconciliation', unixepoch())
            "#,
            [],
        )?;
        Ok(())
    }

    fn table_has_column(&self, table: &str, column: &str) -> anyhow::Result<bool> {
        let mut statement = self
            .connection
            .prepare(&format!("PRAGMA table_info({table})"))?;
        let columns = statement.query_map([], |row| row.get::<_, String>(1))?;
        for candidate in columns {
            if candidate? == column {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn apply_task_attempt_generation_migration(&self) -> anyhow::Result<()> {
        let transaction = self.connection.unchecked_transaction()?;
        if !table_has_column_in_transaction(&transaction, "tasks", "attempt_generation")? {
            transaction.execute_batch(
                "ALTER TABLE tasks ADD COLUMN attempt_generation INTEGER NOT NULL DEFAULT 0",
            )?;
        }
        transaction.execute(
            r#"
            INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
            VALUES (8, 'task_attempt_generation', unixepoch())
            "#,
            [],
        )?;
        transaction.commit()?;
        Ok(())
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
            WHERE roots.enabled = 1
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
        let transaction = self.connection.unchecked_transaction()?;
        let existing = {
            let mut statement =
                transaction.prepare("SELECT id, enabled FROM roots WHERE path = ?1")?;
            let mut rows = statement.query([&root.path])?;
            rows.next()?
                .map(|row| {
                    Ok::<(i64, bool), rusqlite::Error>((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)? != 0,
                    ))
                })
                .transpose()?
        };
        let id = if let Some((id, enabled)) = existing {
            if !enabled {
                transaction.execute("DELETE FROM folders WHERE root_id = ?1", [id])?;
                transaction.execute("DELETE FROM files WHERE root_id = ?1", [id])?;
            }
            transaction.execute(
                r#"
                UPDATE roots
                SET display_name = ?1,
                    enabled = 1,
                    last_scan_at = CASE WHEN ?2 = 0 THEN NULL ELSE last_scan_at END
                WHERE id = ?3
                "#,
                (&root.display_name, enabled as i64, id),
            )?;
            id
        } else {
            transaction.execute(
                r#"
                INSERT INTO roots(path, display_name, enabled, created_at)
                VALUES (?1, ?2, 1, ?3)
                "#,
                (&root.path, &root.display_name, now),
            )?;
            transaction.last_insert_rowid()
        };
        transaction.commit()?;
        Ok(id)
    }

    pub fn disable_root(&self, root_id: i64) -> anyhow::Result<bool> {
        let transaction = self.connection.unchecked_transaction()?;
        let updated = transaction.execute(
            "UPDATE roots SET enabled = 0 WHERE id = ?1 AND enabled = 1",
            [root_id],
        )?;
        if updated != 0 {
            cancel_root_scan_tasks_in_transaction(&transaction, root_id)?;
        }
        transaction.commit()?;
        Ok(updated != 0)
    }

    pub fn create_root_scan_task(&self, root_id: i64) -> anyhow::Result<i64> {
        let root = self
            .get_root(root_id)?
            .ok_or_else(|| anyhow::anyhow!("root not found: {root_id}"))?;
        if !root.enabled {
            return Err(anyhow::anyhow!("root is disabled: {root_id}"));
        }
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

    pub fn reset_running_thumbnail_tasks_for_recovery(&self) -> anyhow::Result<usize> {
        let now = unix_timestamp();
        let transaction = self.connection.unchecked_transaction()?;
        let updated = transaction.execute(
            r#"
            UPDATE tasks
            SET status = 'pending',
                updated_at = ?1,
                thumbnail_source_fingerprint = NULL,
                error = NULL
            WHERE kind = 'thumbnail' AND status = 'running'
            "#,
            [now],
        )?;
        transaction.execute(
            r#"
            UPDATE thumbs
            SET state = 'queued',
                cache_key = NULL,
                width = NULL,
                height = NULL,
                byte_size = NULL,
                error = NULL,
                updated_at = ?1
            WHERE profile = 'grid_320'
              AND state = 'queued'
              AND file_id IN (
                SELECT file_id FROM tasks
                WHERE kind = 'thumbnail' AND status = 'pending'
              )
            "#,
            [now],
        )?;
        transaction.commit()?;
        Ok(updated)
    }

    pub fn list_pending_root_scan_task_ids(&self) -> anyhow::Result<Vec<i64>> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT tasks.id
            FROM tasks
            JOIN roots ON roots.id = tasks.root_id AND roots.enabled = 1
            WHERE tasks.kind = 'root_scan' AND tasks.status = 'pending'
            ORDER BY tasks.priority DESC, tasks.created_at ASC, tasks.id ASC
            "#,
        )?;
        let rows = statement.query_map([], |row| row.get(0))?;

        let mut task_ids = Vec::new();
        for row in rows {
            task_ids.push(row?);
        }
        Ok(task_ids)
    }

    pub fn list_pending_thumbnail_task_ids(&self) -> anyhow::Result<Vec<i64>> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT tasks.id
            FROM tasks
            JOIN files ON files.id = tasks.file_id AND files.status = 'active'
            JOIN roots ON roots.id = files.root_id AND roots.enabled = 1
            WHERE tasks.kind = 'thumbnail' AND tasks.status = 'pending'
            ORDER BY tasks.priority DESC, tasks.created_at ASC, tasks.id ASC
            "#,
        )?;
        let rows = statement.query_map([], |row| row.get(0))?;

        let mut task_ids = Vec::new();
        for row in rows {
            task_ids.push(row?);
        }
        Ok(task_ids)
    }

    pub fn fail_pending_root_scan_tasks_for_disabled_roots(&self) -> anyhow::Result<usize> {
        let updated = self.connection.execute(
            r#"
            UPDATE tasks
            SET status = 'failed',
                updated_at = ?1,
                error = 'root is disabled'
            WHERE kind = 'root_scan'
              AND status = 'pending'
              AND root_id IN (SELECT id FROM roots WHERE enabled = 0)
            "#,
            [unix_timestamp()],
        )?;
        Ok(updated)
    }

    pub fn list_tasks(&self) -> anyhow::Result<Vec<TaskRecord>> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT id, kind, priority, status, root_id, file_id, created_at, updated_at,
                   items_seen, items_total, folders_seen, media_files_seen, skipped_files,
                   thumbnail_source_fingerprint, attempt_generation, error
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
                   items_seen, items_total, folders_seen, media_files_seen, skipped_files,
                   thumbnail_source_fingerprint, attempt_generation, error
            FROM tasks
            WHERE id = ?1
            "#,
        )?;
        let mut rows = statement.query([task_id])?;
        Ok(rows.next()?.map(task_from_row).transpose()?)
    }

    #[cfg(test)]
    pub(crate) fn mark_task_running_current_attempt_for_test(
        &self,
        task_id: i64,
    ) -> anyhow::Result<()> {
        let attempt_generation = self.current_task_attempt_generation(task_id)?;
        self.mark_task_running_for_attempt(task_id, attempt_generation)
    }

    pub fn mark_task_running_for_attempt(
        &self,
        task_id: i64,
        attempt_generation: i64,
    ) -> anyhow::Result<()> {
        let updated = self.connection.execute(
            "UPDATE tasks SET status = 'running', updated_at = ?1, error = NULL WHERE id = ?2 AND status = 'pending' AND attempt_generation = ?3",
            (unix_timestamp(), task_id, attempt_generation),
        )?;
        self.ensure_one_task_attempt_updated(task_id, updated, "pending", attempt_generation)?;
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn mark_thumbnail_task_running_current_attempt_for_test(
        &self,
        task_id: i64,
        source_fingerprint: &str,
    ) -> anyhow::Result<()> {
        let attempt_generation = self.current_task_attempt_generation(task_id)?;
        self.mark_thumbnail_task_running_for_attempt(
            task_id,
            attempt_generation,
            source_fingerprint,
        )
    }

    pub fn mark_thumbnail_task_running_for_attempt(
        &self,
        task_id: i64,
        attempt_generation: i64,
        source_fingerprint: &str,
    ) -> anyhow::Result<()> {
        let updated = self.connection.execute(
            r#"
            UPDATE tasks
            SET status = 'running',
                updated_at = ?1,
                thumbnail_source_fingerprint = ?2,
                error = NULL
            WHERE id = ?3
              AND kind = 'thumbnail'
              AND status = 'pending'
              AND attempt_generation = ?4
            "#,
            (
                unix_timestamp(),
                source_fingerprint,
                task_id,
                attempt_generation,
            ),
        )?;
        self.ensure_one_task_attempt_updated(
            task_id,
            updated,
            "pending thumbnail",
            attempt_generation,
        )?;
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn mark_task_succeeded_current_attempt_for_test(
        &self,
        task_id: i64,
    ) -> anyhow::Result<()> {
        let attempt_generation = self.current_task_attempt_generation(task_id)?;
        self.mark_task_succeeded_for_attempt(task_id, attempt_generation)
    }

    pub fn mark_task_succeeded_for_attempt(
        &self,
        task_id: i64,
        attempt_generation: i64,
    ) -> anyhow::Result<()> {
        let updated = self.connection.execute(
            "UPDATE tasks SET status = 'succeeded', updated_at = ?1, error = NULL WHERE id = ?2 AND status = 'running' AND attempt_generation = ?3",
            (unix_timestamp(), task_id, attempt_generation),
        )?;
        self.ensure_one_task_attempt_updated(task_id, updated, "running", attempt_generation)?;
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn mark_task_failed_current_attempt_for_test(
        &self,
        task_id: i64,
        error: &str,
    ) -> anyhow::Result<()> {
        let attempt_generation = self.current_task_attempt_generation(task_id)?;
        self.mark_task_failed_for_attempt(task_id, attempt_generation, error)
    }

    pub fn mark_task_failed_for_attempt(
        &self,
        task_id: i64,
        attempt_generation: i64,
        error: &str,
    ) -> anyhow::Result<()> {
        let updated = self.connection.execute(
            "UPDATE tasks SET status = 'failed', updated_at = ?1, error = ?2 WHERE id = ?3 AND status IN ('pending', 'running') AND attempt_generation = ?4",
            (unix_timestamp(), error, task_id, attempt_generation),
        )?;
        if updated == 0 {
            return self.ensure_one_task_attempt_updated(
                task_id,
                updated,
                "pending or running",
                attempt_generation,
            );
        }
        Ok(())
    }

    pub fn cancel_task(&self, task_id: i64) -> anyhow::Result<TaskRecord> {
        let updated = self.connection.execute(
            r#"
            UPDATE tasks
            SET status = 'cancelled',
                updated_at = ?1,
                error = 'cancelled'
            WHERE id = ?2 AND status IN ('pending', 'running')
            "#,
            (unix_timestamp(), task_id),
        )?;
        if updated == 0 {
            let Some(task) = self.get_task(task_id)? else {
                return Err(anyhow::anyhow!("task not found: {task_id}"));
            };
            return Err(anyhow::anyhow!(
                "task {task_id} is not cancellable; current status is {}",
                task.status
            ));
        }
        self.get_task(task_id)?
            .ok_or_else(|| anyhow::anyhow!("task not found: {task_id}"))
    }

    pub fn retry_task(&self, task_id: i64) -> anyhow::Result<TaskRecord> {
        let task = self
            .get_task(task_id)?
            .ok_or_else(|| anyhow::anyhow!("task not found: {task_id}"))?;
        if task.status != "failed" && task.status != "cancelled" {
            return Err(anyhow::anyhow!(
                "task {task_id} is not retryable; current status is {}",
                task.status
            ));
        }

        match task.kind.as_str() {
            "root_scan" => self.retry_root_scan_task(&task),
            "thumbnail" => self.retry_thumbnail_task(&task),
            other => Err(anyhow::anyhow!(
                "task {task_id} is not retryable; unsupported kind is {other}"
            )),
        }
    }

    fn retry_root_scan_task(&self, task: &TaskRecord) -> anyhow::Result<TaskRecord> {
        let root_id = task
            .root_id
            .ok_or_else(|| anyhow::anyhow!("root_scan task missing root id: {}", task.id))?;
        let root = self
            .get_root(root_id)?
            .ok_or_else(|| anyhow::anyhow!("root not found: {root_id}"))?;
        if !root.enabled {
            return Err(anyhow::anyhow!("root is disabled: {root_id}"));
        }

        let updated = self.connection.execute(
            r#"
            UPDATE tasks
            SET status = 'pending',
                updated_at = ?1,
                attempt_generation = attempt_generation + 1,
                items_seen = 0,
                items_total = NULL,
                folders_seen = 0,
                media_files_seen = 0,
                skipped_files = 0,
                thumbnail_source_fingerprint = NULL,
                error = NULL
            WHERE id = ?2 AND status IN ('failed', 'cancelled')
            "#,
            (unix_timestamp(), task.id),
        )?;
        self.ensure_one_task_updated(task.id, updated, "failed or cancelled")?;
        self.get_task(task.id)?
            .ok_or_else(|| anyhow::anyhow!("task not found: {}", task.id))
    }

    fn retry_thumbnail_task(&self, task: &TaskRecord) -> anyhow::Result<TaskRecord> {
        let file_id = task
            .file_id
            .ok_or_else(|| anyhow::anyhow!("thumbnail task missing file id: {}", task.id))?;
        let source = self
            .get_thumbnail_source(file_id)?
            .ok_or_else(|| anyhow::anyhow!("media item not found: {file_id}"))?;
        let source_fingerprint = source.source_fingerprint(GRID_320_PROFILE);
        let now = unix_timestamp();
        let transaction = self.connection.unchecked_transaction()?;
        let updated = transaction.execute(
            r#"
            UPDATE tasks
            SET status = 'pending',
                updated_at = ?1,
                attempt_generation = attempt_generation + 1,
                items_seen = 0,
                items_total = NULL,
                folders_seen = 0,
                media_files_seen = 0,
                skipped_files = 0,
                thumbnail_source_fingerprint = NULL,
                error = NULL
            WHERE id = ?2 AND status IN ('failed', 'cancelled')
            "#,
            (now, task.id),
        )?;
        if updated != 1 {
            return Err(anyhow::anyhow!(
                "task {} is not retryable; current status is {}",
                task.id,
                task.status
            ));
        }
        upsert_thumbnail_state_in_transaction(
            &transaction,
            ThumbnailStateUpsert {
                file_id,
                profile: GRID_320_PROFILE.to_string(),
                state: "queued".to_string(),
                cache_key: None,
                width: None,
                height: None,
                byte_size: None,
                error: None,
                source_fingerprint: Some(source_fingerprint),
            },
        )?;
        transaction.commit()?;
        self.get_task(task.id)?
            .ok_or_else(|| anyhow::anyhow!("task not found: {}", task.id))
    }

    pub fn task_is_cancelled(&self, task_id: i64) -> anyhow::Result<bool> {
        Ok(self
            .get_task(task_id)?
            .map(|task| task.status == "cancelled")
            .unwrap_or(false))
    }

    pub fn ensure_task_not_cancelled(&self, task_id: i64) -> anyhow::Result<()> {
        if self.task_is_cancelled(task_id)? {
            return Err(anyhow::anyhow!("task cancelled: {task_id}"));
        }
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn update_task_scan_progress_current_attempt_for_test(
        &self,
        task_id: i64,
        progress: TaskScanProgress,
    ) -> anyhow::Result<()> {
        let attempt_generation = self.current_task_attempt_generation(task_id)?;
        self.update_task_scan_progress_for_attempt(task_id, attempt_generation, progress)
    }

    pub fn update_task_scan_progress_for_attempt(
        &self,
        task_id: i64,
        attempt_generation: i64,
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
            WHERE id = ?7 AND status = 'running' AND attempt_generation = ?8
            "#,
            (
                unix_timestamp(),
                progress.items_seen,
                progress.items_total,
                progress.folders_seen,
                progress.media_files_seen,
                progress.skipped_files,
                task_id,
                attempt_generation,
            ),
        )?;
        self.ensure_one_task_attempt_updated(task_id, updated, "running", attempt_generation)?;
        Ok(())
    }

    pub fn list_media_page(&self, query: MediaPageQuery) -> anyhow::Result<Page<MediaRecord>> {
        let limit = query.limit.clamp(1, 500);
        let sort = normalize_media_sort(&query.sort);
        let cursor = query
            .cursor
            .as_deref()
            .map(|cursor| decode_media_cursor(cursor, sort))
            .transpose()?;
        let sort_clause = match sort {
            "mtime_asc" => "files.mtime ASC, files.id ASC",
            "name_asc" => "files.name ASC, files.id ASC",
            "name_desc" => "files.name DESC, files.id DESC",
            _ => "files.mtime DESC, files.id DESC",
        };
        let mut predicates = vec!["files.status = 'active'".to_string()];
        let mut parameters = Vec::new();
        if let Some(root_id) = query.root_id {
            predicates.push("files.root_id = ?".to_string());
            parameters.push(Value::Integer(root_id));
        }
        if let Some(folder_id) = query.folder_id {
            predicates.push("files.folder_id = ?".to_string());
            parameters.push(Value::Integer(folder_id));
        }
        if let Some(kind) = query.kind.as_deref() {
            predicates.push("media.kind = ?".to_string());
            parameters.push(Value::Text(kind.to_string()));
        }
        if let Some(cursor) = &cursor {
            let predicate = match sort {
                "name_asc" => "files.name > ? OR (files.name = ? AND files.id > ?)",
                "name_desc" => "files.name < ? OR (files.name = ? AND files.id < ?)",
                "mtime_asc" => "files.mtime > ? OR (files.mtime = ? AND files.id > ?)",
                _ => "files.mtime < ? OR (files.mtime = ? AND files.id < ?)",
            };
            predicates.push(format!("({predicate})"));
            match &cursor.key {
                MediaCursorKey::Name(name) => {
                    parameters.push(Value::Text(name.clone()));
                    parameters.push(Value::Text(name.clone()));
                }
                MediaCursorKey::Mtime(mtime) => {
                    parameters.push(Value::Integer(*mtime));
                    parameters.push(Value::Integer(*mtime));
                }
            }
            parameters.push(Value::Integer(cursor.id));
        }
        parameters.push(Value::Integer(limit + 1));

        let sql = format!(
            r#"
            SELECT files.id, files.root_id, files.folder_id, files.name, files.ext,
                   files.size, files.mtime, media.kind, media.width, media.height,
                   media.duration_ms, media.codec,
                   media.metadata_status, files.file_key,
                   thumbs.profile, thumbs.state, thumbs.short_side_px,
                   thumbs.output_format, thumbs.cache_key, thumbs.width, thumbs.height,
                   thumbs.byte_size, thumbs.error, thumbs.source_fingerprint, thumbs.updated_at
            FROM files
            LEFT JOIN media ON media.file_id = files.id
            LEFT JOIN thumbs ON thumbs.file_id = files.id AND thumbs.profile = 'grid_320'
            JOIN roots ON roots.id = files.root_id AND roots.enabled = 1
            WHERE {where_clause}
            ORDER BY {sort_clause}
            LIMIT ?
            "#,
            where_clause = predicates.join(" AND "),
            sort_clause = sort_clause,
        );

        let mut statement = self.connection.prepare(&sql)?;
        let rows = statement.query_map(params_from_iter(parameters), media_from_row)?;

        let mut items = Vec::new();
        for row in rows {
            items.push(row?);
        }
        let next_cursor = if items.len() > limit as usize {
            items.pop();
            items.last().map(|item| encode_media_cursor(sort, item))
        } else {
            None
        };
        Ok(Page { items, next_cursor })
    }

    pub fn get_media(&self, file_id: i64) -> anyhow::Result<Option<MediaRecord>> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT files.id, files.root_id, files.folder_id, files.name, files.ext,
                   files.size, files.mtime, media.kind, media.width, media.height,
                   media.duration_ms, media.codec,
                   media.metadata_status, files.file_key,
                   thumbs.profile, thumbs.state, thumbs.short_side_px,
                   thumbs.output_format, thumbs.cache_key, thumbs.width, thumbs.height,
                   thumbs.byte_size, thumbs.error, thumbs.source_fingerprint, thumbs.updated_at
            FROM files
            LEFT JOIN media ON media.file_id = files.id
            LEFT JOIN thumbs ON thumbs.file_id = files.id AND thumbs.profile = 'grid_320'
            JOIN roots ON roots.id = files.root_id AND roots.enabled = 1
            WHERE files.id = ?1 AND files.status = 'active'
            "#,
        )?;
        let mut rows = statement.query([file_id])?;
        let Some(row) = rows.next()? else {
            return Ok(None);
        };
        Ok(Some(media_from_row(row)?))
    }

    pub fn get_thumbnail(
        &self,
        file_id: i64,
        profile: &str,
    ) -> anyhow::Result<Option<ThumbnailRecord>> {
        let mut thumbnail = {
            let mut statement = self.connection.prepare(
                r#"
                SELECT files.id, thumbs.profile, thumbs.state, thumbs.short_side_px,
                       thumbs.output_format, thumbs.cache_key, thumbs.width, thumbs.height,
                       thumbs.byte_size, thumbs.error, thumbs.source_fingerprint, thumbs.updated_at
                FROM files
                JOIN roots ON roots.id = files.root_id AND roots.enabled = 1
                LEFT JOIN thumbs ON thumbs.file_id = files.id AND thumbs.profile = ?2
                WHERE files.id = ?1 AND files.status = 'active'
                "#,
            )?;
            let mut rows = statement.query((file_id, profile))?;
            let Some(row) = rows.next()? else {
                return Ok(None);
            };
            thumbnail_from_row(row, profile)?
        };
        if let Some(source) = self.get_thumbnail_source(file_id)? {
            normalize_thumbnail_record_for_source(&mut thumbnail, &source);
        }
        Ok(Some(thumbnail))
    }

    pub fn reset_thumbnail_after_stale_source_for_task_attempt(
        &self,
        file_id: i64,
        profile: &str,
        error: &str,
        task_id: i64,
        attempt_generation: i64,
    ) -> anyhow::Result<bool> {
        let transaction = self.connection.unchecked_transaction()?;
        if !task_attempt_running_in_transaction(&transaction, task_id, attempt_generation)? {
            transaction.commit()?;
            return Ok(false);
        }
        reset_thumbnail_after_stale_source_in_transaction(&transaction, file_id, profile, error)?;
        transaction.commit()?;
        Ok(true)
    }

    pub fn publish_thumbnail_failure_for_attempted_source_for_task_attempt(
        &self,
        file_id: i64,
        profile: &str,
        attempted_source_fingerprint: Option<&str>,
        error: &str,
        task_id: i64,
        attempt_generation: i64,
    ) -> anyhow::Result<bool> {
        let transaction = self.connection.unchecked_transaction()?;
        if !task_attempt_running_in_transaction(&transaction, task_id, attempt_generation)? {
            transaction.commit()?;
            return Ok(false);
        }
        let current_source = thumbnail_source_in_transaction(&transaction, file_id)?
            .ok_or_else(|| anyhow::anyhow!("media item not found: {file_id}"))?;
        let current_source_fingerprint = current_source.source_fingerprint(profile);
        let is_current_attempt =
            attempted_source_fingerprint == Some(current_source_fingerprint.as_str());

        if is_current_attempt {
            upsert_thumbnail_state_in_transaction(
                &transaction,
                ThumbnailStateUpsert {
                    file_id,
                    profile: profile.to_string(),
                    state: "failed".to_string(),
                    cache_key: None,
                    width: None,
                    height: None,
                    byte_size: None,
                    error: Some(error.to_string()),
                    source_fingerprint: Some(current_source_fingerprint),
                },
            )?;
            transaction.commit()?;
            return Ok(true);
        }

        reset_thumbnail_after_stale_source_in_transaction(&transaction, file_id, profile, error)?;
        transaction.commit()?;
        Ok(false)
    }

    pub fn get_thumbnail_source(
        &self,
        file_id: i64,
    ) -> anyhow::Result<Option<ThumbnailSourceRecord>> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT files.id, files.root_id, files.folder_id, files.name, files.size,
                   files.mtime, files.file_key, media.kind, media.width, media.height,
                   media.metadata_status
            FROM files
            JOIN roots ON roots.id = files.root_id AND roots.enabled = 1
            LEFT JOIN media ON media.file_id = files.id
            WHERE files.id = ?1 AND files.status = 'active'
            "#,
        )?;
        let mut rows = statement.query([file_id])?;
        Ok(rows.next()?.map(thumbnail_source_from_row).transpose()?)
    }

    pub fn request_thumbnail_task(
        &self,
        file_id: i64,
        profile: &str,
    ) -> anyhow::Result<ThumbnailTaskRequest> {
        if profile != GRID_320_PROFILE {
            return Err(anyhow::anyhow!("unsupported thumbnail profile: {profile}"));
        }

        let source = self
            .get_thumbnail_source(file_id)?
            .ok_or_else(|| anyhow::anyhow!("media item not found: {file_id}"))?;
        let source_fingerprint = source.source_fingerprint(profile);

        let transaction = self.connection.unchecked_transaction()?;
        let current = thumbnail_for_update_in_transaction(&transaction, file_id, profile)?;
        if let Some(current) = current {
            if thumbnail_state_is_terminal_for_current_source(
                &current,
                &source,
                source_fingerprint.as_str(),
            ) {
                let task_id = latest_thumbnail_task_id_in_transaction(&transaction, file_id)?;
                transaction.commit()?;
                return Ok(ThumbnailTaskRequest {
                    thumbnail: current,
                    task_id,
                    queued: false,
                });
            }
        }
        let existing_task_id = pending_or_running_thumbnail_task_id(&transaction, file_id)?;
        let mut queued = false;
        let task_id = if let Some(task_id) = existing_task_id {
            task_id
        } else {
            let now = unix_timestamp();
            transaction.execute(
                r#"
                INSERT INTO tasks(
                    kind, priority, status, root_id, file_id, created_at, updated_at,
                    thumbnail_source_fingerprint, error
                )
                VALUES ('thumbnail', 10, 'pending', NULL, ?1, ?2, ?2, ?3, NULL)
                "#,
                (file_id, now, source_fingerprint.as_str()),
            )?;
            queued = true;
            transaction.last_insert_rowid()
        };
        upsert_thumbnail_state_in_transaction(
            &transaction,
            ThumbnailStateUpsert {
                file_id,
                profile: profile.to_string(),
                state: "queued".to_string(),
                cache_key: None,
                width: None,
                height: None,
                byte_size: None,
                error: None,
                source_fingerprint: Some(source_fingerprint),
            },
        )?;
        transaction.commit()?;

        let thumbnail = self
            .get_thumbnail(file_id, profile)?
            .ok_or_else(|| anyhow::anyhow!("media item not found: {file_id}"))?;
        Ok(ThumbnailTaskRequest {
            thumbnail,
            task_id: Some(task_id),
            queued,
        })
    }

    pub fn list_folder_children_page(
        &self,
        folder_id: i64,
        limit: i64,
        cursor: Option<String>,
    ) -> anyhow::Result<Page<FolderRecord>> {
        let limit = limit.clamp(1, 500);
        let cursor = cursor.as_deref().map(decode_folder_cursor).transpose()?;
        let cursor_clause = if cursor.is_some() {
            "AND (folders.name > ?2 OR (folders.name = ?2 AND folders.id > ?3))"
        } else {
            ""
        };
        let sql = format!(
            r#"
            SELECT folders.id, folders.root_id, folders.parent_id, folders.name, folders.status
            FROM folders
            JOIN roots ON roots.id = folders.root_id AND roots.enabled = 1
            WHERE folders.parent_id = ?1 AND folders.status = 'active'
              {cursor_clause}
            ORDER BY folders.name ASC, folders.id ASC
            LIMIT ?4
            "#,
            cursor_clause = cursor_clause,
        );
        let mut parameters = vec![Value::Integer(folder_id)];
        if let Some(cursor) = &cursor {
            parameters.push(Value::Text(cursor.name.clone()));
            parameters.push(Value::Integer(cursor.id));
        } else {
            parameters.push(Value::Null);
            parameters.push(Value::Null);
        }
        parameters.push(Value::Integer(limit + 1));
        let mut statement = self.connection.prepare(&sql)?;
        let rows = statement.query_map(params_from_iter(parameters), |row| {
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
        let next_cursor = if folders.len() > limit as usize {
            folders.pop();
            folders.last().map(encode_folder_cursor)
        } else {
            None
        };
        Ok(Page {
            items: folders,
            next_cursor,
        })
    }

    pub fn list_folder_children(&self, folder_id: i64) -> anyhow::Result<Vec<FolderRecord>> {
        Ok(self.list_folder_children_page(folder_id, 500, None)?.items)
    }

    pub(crate) fn get_folder_id_by_path(
        &self,
        root_id: i64,
        root_path: &Path,
        folder_path: &Path,
    ) -> anyhow::Result<Option<i64>> {
        let root = self
            .get_root(root_id)?
            .ok_or_else(|| anyhow::anyhow!("root not found: {root_id}"))?;
        let Some(mut folder_id) = root.root_folder_id else {
            return Ok(None);
        };
        let Ok(relative) = folder_path.strip_prefix(root_path) else {
            return Ok(None);
        };
        if relative.as_os_str().is_empty() {
            return Ok(Some(folder_id));
        }

        for component in relative.components() {
            let name = component.as_os_str().to_string_lossy();
            let Some(next_id) = self.find_folder_id(root_id, Some(folder_id), &name)? else {
                return Ok(None);
            };
            folder_id = next_id;
        }

        Ok(Some(folder_id))
    }

    pub(crate) fn ensure_folder_chain_for_path(
        &self,
        root_id: i64,
        root_path: &Path,
        folder_path: &Path,
    ) -> anyhow::Result<i64> {
        let _root = self
            .get_root(root_id)?
            .ok_or_else(|| anyhow::anyhow!("root not found: {root_id}"))?;
        let root_folder_id = self.upsert_folder(FolderUpsert {
            root_id,
            parent_id: None,
            name: String::new(),
            path_hash: hash_path(root_path),
            mtime: metadata_time(root_path.metadata().ok().as_ref()),
        })?;
        let Ok(relative) = folder_path.strip_prefix(root_path) else {
            return Err(anyhow::anyhow!(
                "folder path is outside root {}: {}",
                root_path.display(),
                folder_path.display()
            ));
        };
        if relative.as_os_str().is_empty() {
            return Ok(root_folder_id);
        }

        let mut parent_id = root_folder_id;
        let mut current_path = root_path.to_path_buf();
        for component in relative.components() {
            current_path.push(component.as_os_str());
            let name = component.as_os_str().to_string_lossy().to_string();
            parent_id = self.upsert_folder(FolderUpsert {
                root_id,
                parent_id: Some(parent_id),
                name,
                path_hash: hash_path(&current_path),
                mtime: metadata_time(current_path.metadata().ok().as_ref()),
            })?;
        }

        Ok(parent_id)
    }

    pub(crate) fn mark_file_missing_by_path(
        &self,
        root_id: i64,
        root_path: &Path,
        file_path: &Path,
    ) -> anyhow::Result<bool> {
        let Some(parent_path) = file_path.parent() else {
            return Ok(false);
        };
        let Some(folder_id) = self.get_folder_id_by_path(root_id, root_path, parent_path)? else {
            return Ok(false);
        };
        let file_name = file_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        let updated = self.connection.execute(
            "UPDATE files SET status = 'missing' WHERE root_id = ?1 AND folder_id = ?2 AND name = ?3 AND status = 'active'",
            (root_id, folder_id, file_name),
        )?;
        Ok(updated != 0)
    }

    pub(crate) fn mark_folder_subtree_missing_by_path(
        &self,
        root_id: i64,
        root_path: &Path,
        folder_path: &Path,
    ) -> anyhow::Result<bool> {
        let Some(folder_id) = self.get_folder_id_by_path(root_id, root_path, folder_path)? else {
            return Ok(false);
        };
        let transaction = self.connection.unchecked_transaction()?;
        transaction.execute(
            r#"
            WITH RECURSIVE subtree(id) AS (
              SELECT id FROM folders WHERE id = ?1
              UNION ALL
              SELECT folders.id
              FROM folders
              JOIN subtree ON folders.parent_id = subtree.id
            )
            UPDATE folders
            SET status = 'missing'
            WHERE id IN (SELECT id FROM subtree)
            "#,
            [folder_id],
        )?;
        transaction.execute(
            r#"
            WITH RECURSIVE subtree(id) AS (
              SELECT id FROM folders WHERE id = ?1
              UNION ALL
              SELECT folders.id
              FROM folders
              JOIN subtree ON folders.parent_id = subtree.id
            )
            UPDATE files
            SET status = 'missing'
            WHERE folder_id IN (SELECT id FROM subtree)
            "#,
            [folder_id],
        )?;
        transaction.commit()?;
        Ok(true)
    }

    #[allow(dead_code)]
    pub(crate) fn has_active_root_scan_task(&self, root_id: i64) -> anyhow::Result<bool> {
        let exists: i64 = self.connection.query_row(
            r#"
            SELECT EXISTS(
              SELECT 1
              FROM tasks
              WHERE kind = 'root_scan'
                AND root_id = ?1
                AND status IN ('pending', 'running')
            )
            "#,
            [root_id],
            |row| row.get(0),
        )?;
        Ok(exists != 0)
    }

    /// Returns true if there is already a `pending` root_scan task for the
    /// given root. Unlike `has_active_root_scan_task`, this ignores `running`
    /// tasks so the watcher can persist exactly one follow-up rescan to cover
    /// directory create / move-in events that happened after WalkDir already
    /// passed the affected path during a still-running scan.
    pub(crate) fn has_pending_root_scan_task(&self, root_id: i64) -> anyhow::Result<bool> {
        let exists: i64 = self.connection.query_row(
            r#"
            SELECT EXISTS(
              SELECT 1
              FROM tasks
              WHERE kind = 'root_scan'
                AND root_id = ?1
                AND status = 'pending'
            )
            "#,
            [root_id],
            |row| row.get(0),
        )?;
        Ok(exists != 0)
    }

    pub(crate) fn begin_root_scan_reconciliation(&self, root_id: i64) -> anyhow::Result<i64> {
        let transaction =
            Transaction::new_unchecked(&self.connection, TransactionBehavior::Immediate)?;
        ensure_root_enabled_in_transaction(&transaction, root_id)?;
        let scan_generation = next_root_scan_generation_in_transaction(&transaction, root_id)?;
        transaction.execute(
            "UPDATE roots SET active_scan_generation = ?1 WHERE id = ?2",
            (scan_generation, root_id),
        )?;
        transaction.commit()?;
        Ok(scan_generation)
    }

    pub(crate) fn reconcile_root_scan_completion(
        &self,
        root_id: i64,
        scan_generation: i64,
    ) -> anyhow::Result<()> {
        let transaction =
            Transaction::new_unchecked(&self.connection, TransactionBehavior::Immediate)?;
        ensure_root_enabled_in_transaction(&transaction, root_id)?;
        let active_scan_generation = active_scan_generation_in_transaction(&transaction, root_id)?;
        if active_scan_generation != Some(scan_generation) {
            return Err(anyhow::anyhow!(
                "root scan generation mismatch for root {root_id}; expected active generation {}, current active generation {:?}",
                scan_generation,
                active_scan_generation
            ));
        }
        transaction.execute(
            r#"
            UPDATE files
            SET status = 'missing'
            WHERE root_id = ?1
              AND status = 'active'
              AND COALESCE(scan_seen_at, 0) != ?2
            "#,
            (root_id, scan_generation),
        )?;
        transaction.execute(
            r#"
            UPDATE folders
            SET status = 'missing'
            WHERE root_id = ?1
              AND parent_id IS NOT NULL
              AND status = 'active'
              AND COALESCE(scan_seen_at, 0) != ?2
            "#,
            (root_id, scan_generation),
        )?;
        transaction.execute(
            "UPDATE roots SET active_scan_generation = NULL WHERE id = ?1 AND active_scan_generation = ?2",
            (root_id, scan_generation),
        )?;
        transaction.commit()?;
        Ok(())
    }

    /// Task-attempt-guarded counterpart to `reconcile_root_scan_completion`.
    ///
    /// Reconciliation runs only if the task attempt is still current and
    /// running. A stale or superseded attempt returns `Ok(false)` without
    /// reconciling rows or clearing `active_scan_generation`, so a retried
    /// attempt's generation is preserved for the next run.
    pub(crate) fn reconcile_root_scan_completion_for_task_attempt(
        &self,
        root_id: i64,
        scan_generation: i64,
        task_id: i64,
        attempt_generation: i64,
    ) -> anyhow::Result<bool> {
        let transaction =
            Transaction::new_unchecked(&self.connection, TransactionBehavior::Immediate)?;
        if !task_attempt_running_in_transaction(&transaction, task_id, attempt_generation)? {
            transaction.commit()?;
            return Ok(false);
        }
        ensure_root_enabled_in_transaction(&transaction, root_id)?;
        let active_scan_generation = active_scan_generation_in_transaction(&transaction, root_id)?;
        if active_scan_generation != Some(scan_generation) {
            return Err(anyhow::anyhow!(
                "root scan generation mismatch for root {root_id}; expected active generation {}, current active generation {:?}",
                scan_generation,
                active_scan_generation
            ));
        }
        transaction.execute(
            r#"
            UPDATE files
            SET status = 'missing'
            WHERE root_id = ?1
              AND status = 'active'
              AND COALESCE(scan_seen_at, 0) != ?2
            "#,
            (root_id, scan_generation),
        )?;
        transaction.execute(
            r#"
            UPDATE folders
            SET status = 'missing'
            WHERE root_id = ?1
              AND parent_id IS NOT NULL
              AND status = 'active'
              AND COALESCE(scan_seen_at, 0) != ?2
            "#,
            (root_id, scan_generation),
        )?;
        transaction.execute(
            "UPDATE roots SET active_scan_generation = NULL WHERE id = ?1 AND active_scan_generation = ?2",
            (root_id, scan_generation),
        )?;
        transaction.commit()?;
        Ok(true)
    }

    pub fn folder_exists(&self, folder_id: i64) -> anyhow::Result<bool> {
        let exists: i64 = self.connection.query_row(
            r#"
            SELECT EXISTS(
              SELECT 1
              FROM folders
              JOIN roots ON roots.id = folders.root_id AND roots.enabled = 1
              WHERE folders.id = ?1 AND folders.status = 'active'
            )
            "#,
            [folder_id],
            |row| row.get(0),
        )?;
        Ok(exists != 0)
    }

    #[allow(dead_code)]
    pub fn upsert_folder(&self, folder: FolderUpsert) -> anyhow::Result<i64> {
        let transaction =
            Transaction::new_unchecked(&self.connection, TransactionBehavior::Immediate)?;
        let scan_generation = active_scan_generation_in_transaction(&transaction, folder.root_id)?;
        let folder_id = upsert_folder_in_transaction(&transaction, folder, scan_generation)?;
        transaction.commit()?;
        Ok(folder_id)
    }

    #[allow(dead_code)]
    pub fn upsert_file(&self, file: FileUpsert) -> anyhow::Result<i64> {
        let root_id = file.root_id;
        let transaction =
            Transaction::new_unchecked(&self.connection, TransactionBehavior::Immediate)?;
        let scan_generation = active_scan_generation_in_transaction(&transaction, root_id)?;
        let file_id = upsert_file_in_transaction(&transaction, file, scan_generation)?;
        transaction.commit()?;
        Ok(file_id)
    }

    #[allow(dead_code)]
    pub fn upsert_media_kind(&self, file_id: i64, kind: &str) -> anyhow::Result<()> {
        self.connection.execute(
            r#"
            INSERT INTO media(file_id, kind, metadata_status)
            VALUES (?1, ?2, 'pending')
            ON CONFLICT(file_id) DO UPDATE SET
              kind = excluded.kind,
              width = NULL,
              height = NULL,
              duration_ms = NULL,
              codec = NULL,
              orientation = NULL,
              has_alpha = NULL,
              dominant_color = NULL,
              phash = NULL,
              metadata_status = 'pending'
            "#,
            (file_id, kind),
        )?;
        Ok(())
    }

    pub fn commit_scan_batch(
        &mut self,
        batch: ScanWriteBatch,
    ) -> anyhow::Result<ScanWriteBatchResult> {
        // Use BEGIN IMMEDIATE rather than the default DEFERRED transaction
        // so the SQLite busy handler is engaged on transaction start. With
        // multiple writer connections (API, scan worker, watcher) on the
        // same WAL file, an in-flight DEFERRED transaction that later
        // escalates to a write can return SQLITE_BUSY without honoring
        // `busy_timeout`. Acquiring the write lock up front lets the busy
        // handler retry transparently and prevents transient "database is
        // locked" failures.
        let transaction =
            Transaction::new_unchecked(&self.connection, TransactionBehavior::Immediate)?;
        let root_ids = scan_batch_root_ids(&batch);
        for root_id in root_ids {
            ensure_root_enabled_in_transaction(&transaction, root_id)?;
        }
        let mut folder_ids = Vec::with_capacity(batch.folders.len());
        let mut file_ids = Vec::with_capacity(batch.files.len());

        let scan_generation = batch.scan_generation;

        for folder in batch.folders {
            folder_ids.push(upsert_folder_in_transaction(
                &transaction,
                folder,
                scan_generation,
            )?);
        }

        for file in batch.files {
            let file_id = upsert_file_in_transaction(&transaction, file.file, scan_generation)?;
            upsert_media_kind_in_transaction(&transaction, file_id, &file.media_kind)?;
            file_ids.push(file_id);
        }

        transaction.commit()?;
        Ok(ScanWriteBatchResult {
            folder_ids,
            file_ids,
        })
    }

    pub fn commit_scan_batch_for_task_attempt(
        &mut self,
        batch: ScanWriteBatch,
        task_id: i64,
        attempt_generation: i64,
    ) -> anyhow::Result<ScanWriteBatchResult> {
        // Use BEGIN IMMEDIATE rather than the default DEFERRED transaction
        // so the SQLite busy handler is engaged on transaction start; see
        // `commit_scan_batch` for the full rationale.
        let transaction =
            Transaction::new_unchecked(&self.connection, TransactionBehavior::Immediate)?;
        ensure_task_attempt_running_in_transaction(&transaction, task_id, attempt_generation)?;
        let root_ids = scan_batch_root_ids(&batch);
        for root_id in root_ids {
            ensure_root_enabled_in_transaction(&transaction, root_id)?;
        }
        let mut folder_ids = Vec::with_capacity(batch.folders.len());
        let mut file_ids = Vec::with_capacity(batch.files.len());

        let scan_generation = batch.scan_generation;

        for folder in batch.folders {
            folder_ids.push(upsert_folder_in_transaction(
                &transaction,
                folder,
                scan_generation,
            )?);
        }

        for file in batch.files {
            let file_id = upsert_file_in_transaction(&transaction, file.file, scan_generation)?;
            upsert_media_kind_in_transaction(&transaction, file_id, &file.media_kind)?;
            file_ids.push(file_id);
        }

        transaction.commit()?;
        Ok(ScanWriteBatchResult {
            folder_ids,
            file_ids,
        })
    }

    #[allow(dead_code)]
    pub fn upsert_thumbnail_state(&self, state: ThumbnailStateUpsert) -> anyhow::Result<()> {
        upsert_thumbnail_state_in_connection(&self.connection, state)?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn upsert_thumbnail_state_if_source_fingerprint_current(
        &self,
        state: ThumbnailStateUpsert,
        expected_source_fingerprint: &str,
    ) -> anyhow::Result<bool> {
        let transaction = self.connection.unchecked_transaction()?;
        let current_source = thumbnail_source_in_transaction(&transaction, state.file_id)?
            .ok_or_else(|| anyhow::anyhow!("media item not found: {}", state.file_id))?;
        if current_source.source_fingerprint(&state.profile) != expected_source_fingerprint {
            transaction.commit()?;
            return Ok(false);
        }
        upsert_thumbnail_state_in_transaction(&transaction, state)?;
        transaction.commit()?;
        Ok(true)
    }

    pub fn upsert_thumbnail_state_if_source_fingerprint_and_task_attempt_current(
        &self,
        state: ThumbnailStateUpsert,
        expected_source_fingerprint: &str,
        task_id: i64,
        attempt_generation: i64,
    ) -> anyhow::Result<bool> {
        let transaction = self.connection.unchecked_transaction()?;
        if !task_attempt_running_in_transaction(&transaction, task_id, attempt_generation)? {
            transaction.commit()?;
            return Ok(false);
        }
        let current_source = thumbnail_source_in_transaction(&transaction, state.file_id)?
            .ok_or_else(|| anyhow::anyhow!("media item not found: {}", state.file_id))?;
        if current_source.source_fingerprint(&state.profile) != expected_source_fingerprint {
            transaction.commit()?;
            return Ok(false);
        }
        upsert_thumbnail_state_in_transaction(&transaction, state)?;
        transaction.commit()?;
        Ok(true)
    }

    pub fn mark_root_scanned(&self, root_id: i64) -> anyhow::Result<()> {
        self.connection.execute(
            "UPDATE roots SET last_scan_at = ?1 WHERE id = ?2 AND enabled = 1",
            (unix_timestamp(), root_id),
        )?;
        Ok(())
    }

    pub fn mark_root_scanned_for_task_attempt(
        &self,
        root_id: i64,
        task_id: i64,
        attempt_generation: i64,
    ) -> anyhow::Result<()> {
        let transaction = self.connection.unchecked_transaction()?;
        ensure_task_attempt_running_in_transaction(&transaction, task_id, attempt_generation)?;
        let updated = transaction.execute(
            "UPDATE roots SET last_scan_at = ?1 WHERE id = ?2 AND enabled = 1",
            (unix_timestamp(), root_id),
        )?;
        if updated != 1 {
            return Err(anyhow::anyhow!("root is disabled: {root_id}"));
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn root_enabled(&self, root_id: i64) -> anyhow::Result<bool> {
        let enabled: i64 = self.connection.query_row(
            "SELECT enabled FROM roots WHERE id = ?1",
            [root_id],
            |row| row.get(0),
        )?;
        Ok(enabled != 0)
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

    fn ensure_one_task_attempt_updated(
        &self,
        task_id: i64,
        updated: usize,
        expected_status: &str,
        expected_attempt_generation: i64,
    ) -> anyhow::Result<()> {
        if updated == 1 {
            return Ok(());
        }

        let Some(task) = self.get_task(task_id)? else {
            return Err(anyhow::anyhow!("task not found: {task_id}"));
        };
        if task.attempt_generation != expected_attempt_generation {
            return Err(anyhow::anyhow!(
                "task {task_id} attempt mismatch; expected attempt {}, current attempt {}",
                expected_attempt_generation,
                task.attempt_generation
            ));
        }
        Err(anyhow::anyhow!(
            "task {task_id} is not {expected_status}; current status is {}",
            task.status
        ))
    }

    pub(crate) fn current_task_attempt_generation(&self, task_id: i64) -> anyhow::Result<i64> {
        self.get_task(task_id)?
            .map(|task| task.attempt_generation)
            .ok_or_else(|| anyhow::anyhow!("task not found: {task_id}"))
    }

    pub(crate) fn task_attempt_is_current(
        &self,
        task_id: i64,
        attempt_generation: i64,
    ) -> anyhow::Result<bool> {
        Ok(self
            .get_task(task_id)?
            .map(|task| task.attempt_generation == attempt_generation)
            .unwrap_or(false))
    }
}

fn upsert_folder_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    folder: FolderUpsert,
    scan_generation: Option<i64>,
) -> anyhow::Result<i64> {
    if let Some(existing_id) =
        find_folder_id_in_transaction(transaction, folder.root_id, folder.parent_id, &folder.name)?
    {
        transaction.execute(
            r#"
            UPDATE folders
            SET path_hash = ?1, mtime = ?2, status = 'active', scan_seen_at = ?3
            WHERE id = ?4
            "#,
            (
                &folder.path_hash,
                folder.mtime,
                scan_generation,
                existing_id,
            ),
        )?;
        return Ok(existing_id);
    }

    transaction.execute(
        r#"
        INSERT INTO folders(root_id, parent_id, name, path_hash, mtime, status, scan_seen_at)
        VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6)
        "#,
        (
            folder.root_id,
            folder.parent_id,
            &folder.name,
            &folder.path_hash,
            folder.mtime,
            scan_generation,
        ),
    )?;
    Ok(transaction.last_insert_rowid())
}

fn scan_batch_root_ids(batch: &ScanWriteBatch) -> Vec<i64> {
    let mut root_ids = Vec::new();
    for root_id in batch
        .folders
        .iter()
        .map(|folder| folder.root_id)
        .chain(batch.files.iter().map(|file| file.file.root_id))
    {
        if !root_ids.contains(&root_id) {
            root_ids.push(root_id);
        }
    }
    root_ids
}

fn ensure_root_enabled_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    root_id: i64,
) -> anyhow::Result<()> {
    let enabled: i64 = transaction.query_row(
        "SELECT enabled FROM roots WHERE id = ?1",
        [root_id],
        |row| row.get(0),
    )?;
    if enabled != 0 {
        return Ok(());
    }
    Err(anyhow::anyhow!("root is disabled: {root_id}"))
}

fn active_scan_generation_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    root_id: i64,
) -> anyhow::Result<Option<i64>> {
    let generation = transaction.query_row(
        "SELECT active_scan_generation FROM roots WHERE id = ?1",
        [root_id],
        |row| row.get::<_, Option<i64>>(0),
    )?;
    Ok(generation)
}

fn next_root_scan_generation_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    root_id: i64,
) -> anyhow::Result<i64> {
    let max_existing: Option<i64> = transaction.query_row(
        r#"
        SELECT MAX(value)
        FROM (
          SELECT active_scan_generation AS value
          FROM roots
          WHERE id = ?1 AND active_scan_generation IS NOT NULL
          UNION ALL
          SELECT scan_seen_at AS value
          FROM folders
          WHERE root_id = ?1 AND scan_seen_at IS NOT NULL
          UNION ALL
          SELECT scan_seen_at AS value
          FROM files
          WHERE root_id = ?1 AND scan_seen_at IS NOT NULL
        )
        "#,
        [root_id],
        |row| row.get(0),
    )?;
    let next_after_existing = max_existing.unwrap_or(0) + 1;
    Ok(unix_timestamp_millis().max(next_after_existing))
}

fn task_attempt_running_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    task_id: i64,
    attempt_generation: i64,
) -> anyhow::Result<bool> {
    let mut statement = transaction.prepare(
        r#"
        SELECT status, attempt_generation
        FROM tasks
        WHERE id = ?1
        "#,
    )?;
    let mut rows = statement.query([task_id])?;
    let Some(row) = rows.next()? else {
        return Err(anyhow::anyhow!("task not found: {task_id}"));
    };
    let status: String = row.get(0)?;
    let current_attempt: i64 = row.get(1)?;
    Ok(status == "running" && current_attempt == attempt_generation)
}

fn hash_path(path: &Path) -> String {
    let mut hasher = DefaultHasher::new();
    path.to_string_lossy().hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn metadata_time(metadata: Option<&std::fs::Metadata>) -> Option<i64> {
    let metadata = metadata?;
    let time = metadata.modified().ok()?;
    time.duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs() as i64)
}

fn ensure_task_attempt_running_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    task_id: i64,
    attempt_generation: i64,
) -> anyhow::Result<()> {
    if task_attempt_running_in_transaction(transaction, task_id, attempt_generation)? {
        return Ok(());
    }
    let (status, current_attempt): (String, i64) = transaction.query_row(
        "SELECT status, attempt_generation FROM tasks WHERE id = ?1",
        [task_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    if current_attempt != attempt_generation {
        return Err(anyhow::anyhow!(
            "task {task_id} attempt mismatch; expected attempt {}, current attempt {}",
            attempt_generation,
            current_attempt
        ));
    }
    Err(anyhow::anyhow!(
        "task {task_id} is not running; current status is {status}"
    ))
}

fn cancel_root_scan_tasks_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    root_id: i64,
) -> anyhow::Result<usize> {
    let updated = transaction.execute(
        r#"
        UPDATE tasks
        SET status = 'failed',
            updated_at = ?1,
            error = 'root is disabled'
        WHERE kind = 'root_scan'
          AND root_id = ?2
          AND status IN ('pending', 'running')
        "#,
        (unix_timestamp(), root_id),
    )?;
    Ok(updated)
}

fn upsert_file_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    file: FileUpsert,
    scan_generation: Option<i64>,
) -> anyhow::Result<i64> {
    let root_id = file.root_id;
    let folder_id = file.folder_id;
    let name = file.name.clone();
    let size = file.size;
    let mtime = file.mtime;
    let file_key = file.file_key.clone();
    transaction.execute(
        r#"
        INSERT INTO files(root_id, folder_id, name, ext, size, mtime, ctime, file_key, status, scan_seen_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'active', ?9)
        ON CONFLICT(folder_id, name) DO UPDATE SET
          ext = excluded.ext,
          size = excluded.size,
          mtime = excluded.mtime,
          ctime = excluded.ctime,
          file_key = excluded.file_key,
          status = 'active',
          scan_seen_at = excluded.scan_seen_at
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
            scan_generation,
        ),
    )?;
    let id = transaction.query_row(
        "SELECT id FROM files WHERE folder_id = ?1 AND name = ?2",
        (file.folder_id, &file.name),
        |row| row.get(0),
    )?;
    invalidate_stale_thumbnail_states_in_transaction(
        transaction,
        CacheIdentity {
            file_id: id,
            root_id,
            folder_id,
            name: &name,
            size,
            mtime,
            file_key: file_key.as_deref(),
        },
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
          kind = excluded.kind,
          width = NULL,
          height = NULL,
          duration_ms = NULL,
          codec = NULL,
          orientation = NULL,
          has_alpha = NULL,
          dominant_color = NULL,
          phash = NULL,
          metadata_status = 'pending'
        "#,
        (file_id, kind),
    )?;
    Ok(())
}

fn invalidate_stale_thumbnail_states_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    identity: CacheIdentity<'_>,
) -> anyhow::Result<()> {
    invalidate_stale_thumbnail_states(
        transaction,
        identity.file_id,
        GRID_320_PROFILE,
        &source_fingerprint_for(&identity, GRID_320_PROFILE),
    )
}

fn invalidate_stale_thumbnail_states(
    connection: &rusqlite::Connection,
    file_id: i64,
    profile: &str,
    source_fingerprint: &str,
) -> anyhow::Result<()> {
    connection.execute(
        r#"
        UPDATE thumbs
        SET state = 'pending',
            cache_key = NULL,
            width = NULL,
            height = NULL,
            byte_size = NULL,
            error = NULL,
            source_fingerprint = NULL,
            updated_at = ?1
        WHERE file_id = ?2
          AND profile = ?3
          AND state NOT IN ('pending', 'queued')
          AND (source_fingerprint IS NULL OR source_fingerprint <> ?4)
        "#,
        (unix_timestamp(), file_id, profile, source_fingerprint),
    )?;
    Ok(())
}

fn upsert_thumbnail_state_in_connection(
    connection: &rusqlite::Connection,
    state: ThumbnailStateUpsert,
) -> anyhow::Result<()> {
    connection.execute(
        r#"
        INSERT INTO thumbs(
            file_id, profile, state, cache_key, width, height, byte_size,
            short_side_px, output_format, error, source_fingerprint, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 320, 'image/webp', ?8, ?9, ?10)
        ON CONFLICT(file_id, profile) DO UPDATE SET
            state = excluded.state,
            cache_key = excluded.cache_key,
            width = excluded.width,
            height = excluded.height,
            byte_size = excluded.byte_size,
            short_side_px = excluded.short_side_px,
            output_format = excluded.output_format,
            error = excluded.error,
            source_fingerprint = excluded.source_fingerprint,
            updated_at = excluded.updated_at
        "#,
        (
            state.file_id,
            &state.profile,
            &state.state,
            state.cache_key.as_deref(),
            state.width,
            state.height,
            state.byte_size,
            state.error.as_deref(),
            state.source_fingerprint.as_deref(),
            unix_timestamp(),
        ),
    )?;
    Ok(())
}

fn upsert_thumbnail_state_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    state: ThumbnailStateUpsert,
) -> anyhow::Result<()> {
    transaction.execute(
        r#"
        INSERT INTO thumbs(
            file_id, profile, state, cache_key, width, height, byte_size,
            short_side_px, output_format, error, source_fingerprint, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 320, 'image/webp', ?8, ?9, ?10)
        ON CONFLICT(file_id, profile) DO UPDATE SET
            state = excluded.state,
            cache_key = excluded.cache_key,
            width = excluded.width,
            height = excluded.height,
            byte_size = excluded.byte_size,
            short_side_px = excluded.short_side_px,
            output_format = excluded.output_format,
            error = excluded.error,
            source_fingerprint = excluded.source_fingerprint,
            updated_at = excluded.updated_at
        "#,
        (
            state.file_id,
            &state.profile,
            &state.state,
            state.cache_key.as_deref(),
            state.width,
            state.height,
            state.byte_size,
            state.error.as_deref(),
            state.source_fingerprint.as_deref(),
            unix_timestamp(),
        ),
    )?;
    Ok(())
}

fn pending_or_running_thumbnail_task_id(
    transaction: &rusqlite::Transaction<'_>,
    file_id: i64,
) -> anyhow::Result<Option<i64>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT id
        FROM tasks
        WHERE kind = 'thumbnail'
          AND file_id = ?1
          AND status IN ('pending', 'running')
        ORDER BY
          CASE status WHEN 'running' THEN 0 ELSE 1 END,
          priority DESC,
          created_at ASC,
          id ASC
        LIMIT 1
        "#,
    )?;
    let mut rows = statement.query([file_id])?;
    Ok(rows.next()?.map(|row| row.get(0)).transpose()?)
}

fn latest_thumbnail_task_id_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    file_id: i64,
) -> anyhow::Result<Option<i64>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT id
        FROM tasks
        WHERE kind = 'thumbnail' AND file_id = ?1
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        "#,
    )?;
    let mut rows = statement.query([file_id])?;
    Ok(rows.next()?.map(|row| row.get(0)).transpose()?)
}

fn thumbnail_for_update_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    file_id: i64,
    profile: &str,
) -> anyhow::Result<Option<ThumbnailRecord>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT files.id, thumbs.profile, thumbs.state, thumbs.short_side_px,
               thumbs.output_format, thumbs.cache_key, thumbs.width, thumbs.height,
               thumbs.byte_size, thumbs.error, thumbs.source_fingerprint, thumbs.updated_at
        FROM files
        LEFT JOIN thumbs ON thumbs.file_id = files.id AND thumbs.profile = ?2
        WHERE files.id = ?1 AND files.status = 'active'
        "#,
    )?;
    let mut rows = statement.query((file_id, profile))?;
    Ok(rows
        .next()?
        .map(|row| thumbnail_from_row(row, profile))
        .transpose()?)
}

fn thumbnail_source_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    file_id: i64,
) -> anyhow::Result<Option<ThumbnailSourceRecord>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT files.id, files.root_id, files.folder_id, files.name, files.size,
               files.mtime, files.file_key, media.kind, media.width, media.height,
               media.metadata_status
        FROM files
        JOIN roots ON roots.id = files.root_id AND roots.enabled = 1
        LEFT JOIN media ON media.file_id = files.id
        WHERE files.id = ?1 AND files.status = 'active'
        "#,
    )?;
    let mut rows = statement.query([file_id])?;
    Ok(rows.next()?.map(thumbnail_source_from_row).transpose()?)
}

fn table_has_column_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    table: &str,
    column: &str,
) -> anyhow::Result<bool> {
    let mut statement = transaction.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = statement.query_map([], |row| row.get::<_, String>(1))?;
    for candidate in columns {
        if candidate? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn reset_thumbnail_after_stale_source_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    file_id: i64,
    profile: &str,
    error: &str,
) -> anyhow::Result<()> {
    let now = unix_timestamp();
    let updated = transaction.execute(
        r#"
        UPDATE thumbs
        SET state = 'pending',
            cache_key = NULL,
            width = NULL,
            height = NULL,
            byte_size = NULL,
            error = ?1,
            source_fingerprint = NULL,
            updated_at = ?2
        WHERE file_id = ?3
          AND profile = ?4
          AND state IN ('pending', 'queued', 'failed')
        "#,
        (error, now, file_id, profile),
    )?;
    if updated == 0 {
        transaction.execute(
            r#"
            INSERT OR IGNORE INTO thumbs(
                file_id, profile, state, cache_key, width, height, byte_size,
                short_side_px, output_format, error, source_fingerprint, updated_at
            )
            VALUES (?1, ?2, 'pending', NULL, NULL, NULL, NULL, 320, 'image/webp', ?3, NULL, ?4)
            "#,
            (file_id, profile, error, now),
        )?;
    }
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
    let id: i64 = row.get(0)?;
    let root_id: i64 = row.get(1)?;
    let folder_id: i64 = row.get(2)?;
    let name: String = row.get(3)?;
    let ext: String = row.get(4)?;
    let size: i64 = row.get(5)?;
    let mtime: i64 = row.get(6)?;
    let kind: Option<String> = row.get(7)?;
    let width: Option<i64> = row.get(8)?;
    let height: Option<i64> = row.get(9)?;
    let duration_ms: Option<i64> = row.get(10)?;
    let codec: Option<String> = row.get(11)?;
    let source = ThumbnailSourceRecord {
        file_id: id,
        root_id,
        folder_id,
        name: name.clone(),
        size,
        mtime,
        file_key: row.get(13)?,
        media_kind: kind.clone(),
        width,
        height,
        metadata_status: row.get(12)?,
    };
    let (thumbnail_state, thumbnail_cache_key) = media_thumbnail_summary_from_row(row, &source)?;

    Ok(MediaRecord {
        id,
        root_id,
        folder_id,
        name,
        ext,
        size,
        mtime,
        kind,
        width,
        height,
        duration_ms,
        codec,
        thumbnail_state,
        thumbnail_cache_key,
    })
}

fn media_thumbnail_summary_from_row(
    row: &rusqlite::Row<'_>,
    source: &ThumbnailSourceRecord,
) -> rusqlite::Result<(Option<String>, Option<String>)> {
    let Some(state) = row.get(15)? else {
        return Ok((None, None));
    };
    let mut thumbnail = ThumbnailRecord {
        file_id: source.file_id,
        profile: row
            .get::<_, Option<String>>(14)?
            .unwrap_or_else(|| GRID_320_PROFILE.to_string()),
        state,
        short_side_px: row
            .get::<_, Option<i64>>(16)?
            .unwrap_or(GRID_320_SHORT_SIDE_PX),
        output_format: row
            .get::<_, Option<String>>(17)?
            .unwrap_or_else(|| GENERATED_FORMAT.to_string()),
        cache_key: row.get(18)?,
        width: row.get(19)?,
        height: row.get(20)?,
        byte_size: row.get(21)?,
        error: row.get(22)?,
        source_fingerprint: row.get(23)?,
        updated_at: row.get(24)?,
    };
    normalize_thumbnail_record_for_source(&mut thumbnail, source);
    let thumbnail_cache_key = if thumbnail.state == "ready"
        && thumbnail
            .cache_key
            .as_deref()
            .is_some_and(is_safe_thumbnail_cache_key)
    {
        thumbnail.cache_key
    } else {
        None
    };
    Ok((Some(thumbnail.state), thumbnail_cache_key))
}

fn thumbnail_source_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ThumbnailSourceRecord> {
    Ok(ThumbnailSourceRecord {
        file_id: row.get(0)?,
        root_id: row.get(1)?,
        folder_id: row.get(2)?,
        name: row.get(3)?,
        size: row.get(4)?,
        mtime: row.get(5)?,
        file_key: row.get(6)?,
        media_kind: row.get(7)?,
        width: row.get(8)?,
        height: row.get(9)?,
        metadata_status: row.get(10)?,
    })
}

fn normalize_thumbnail_record_for_source(
    thumbnail: &mut ThumbnailRecord,
    source: &ThumbnailSourceRecord,
) {
    if thumbnail.state == "ready" && !thumbnail_source_fingerprint_matches(thumbnail, source) {
        reset_thumbnail_record_to_pending(thumbnail);
    }
    if thumbnail.state == "failed" && !failed_is_current_for_source(thumbnail, source) {
        reset_thumbnail_record_to_pending(thumbnail);
    }
    if thumbnail.state == "skipped_small" && !skipped_small_is_current_for_source(thumbnail, source)
    {
        reset_thumbnail_record_to_pending(thumbnail);
    }
}

fn thumbnail_state_is_terminal_for_current_source(
    thumbnail: &ThumbnailRecord,
    source: &ThumbnailSourceRecord,
    source_fingerprint: &str,
) -> bool {
    if thumbnail.source_fingerprint.as_deref() != Some(source_fingerprint) {
        return false;
    }
    match thumbnail.state.as_str() {
        "ready" | "failed" => true,
        "skipped_small" => skipped_small_is_current_for_source(thumbnail, source),
        _ => false,
    }
}

fn failed_is_current_for_source(
    thumbnail: &ThumbnailRecord,
    source: &ThumbnailSourceRecord,
) -> bool {
    thumbnail_source_fingerprint_matches(thumbnail, source)
}

fn skipped_small_is_current_for_source(
    thumbnail: &ThumbnailRecord,
    source: &ThumbnailSourceRecord,
) -> bool {
    thumbnail_source_fingerprint_matches(thumbnail, source)
        && source.has_reliable_dimensions()
        && ThumbnailPolicy::grid_320().initial_state(
            source.media_kind.as_deref(),
            source.width,
            source.height,
        ) == ThumbnailDecision::SkippedSmall
}

fn thumbnail_source_fingerprint_matches(
    thumbnail: &ThumbnailRecord,
    source: &ThumbnailSourceRecord,
) -> bool {
    thumbnail.source_fingerprint.as_deref()
        == Some(
            source
                .source_fingerprint(thumbnail.profile.as_str())
                .as_str(),
        )
}

fn reset_thumbnail_record_to_pending(thumbnail: &mut ThumbnailRecord) {
    thumbnail.state = "pending".to_string();
    thumbnail.cache_key = None;
    thumbnail.width = None;
    thumbnail.height = None;
    thumbnail.byte_size = None;
    thumbnail.error = None;
    thumbnail.source_fingerprint = None;
}

fn thumbnail_from_row(
    row: &rusqlite::Row<'_>,
    requested_profile: &str,
) -> rusqlite::Result<ThumbnailRecord> {
    let profile: Option<String> = row.get(1)?;
    let state: Option<String> = row.get(2)?;
    let short_side_px: Option<i64> = row.get(3)?;
    let output_format: Option<String> = row.get(4)?;
    let cache_key: Option<String> = row.get(5)?;
    let source_fingerprint: Option<String> = row.get(10)?;
    let state = match state {
        Some(state)
            if matches!(state.as_str(), "ready" | "skipped_small")
                && source_fingerprint.is_none() =>
        {
            "pending".to_string()
        }
        Some(state) => state,
        None => "pending".to_string(),
    };
    let cache_key_is_usable = state == "ready"
        && source_fingerprint.is_some()
        && cache_key
            .as_deref()
            .is_some_and(is_safe_thumbnail_cache_key);
    Ok(ThumbnailRecord {
        file_id: row.get(0)?,
        profile: profile.unwrap_or_else(|| requested_profile.to_string()),
        state,
        short_side_px: short_side_px.unwrap_or(GRID_320_SHORT_SIDE_PX),
        output_format: output_format.unwrap_or_else(|| GENERATED_FORMAT.to_string()),
        cache_key: if cache_key_is_usable { cache_key } else { None },
        width: if cache_key_is_usable {
            row.get(6)?
        } else {
            None
        },
        height: if cache_key_is_usable {
            row.get(7)?
        } else {
            None
        },
        byte_size: if cache_key_is_usable {
            row.get(8)?
        } else {
            None
        },
        error: row.get(9)?,
        source_fingerprint,
        updated_at: row.get(11)?,
    })
}

fn is_safe_thumbnail_cache_key(cache_key: &str) -> bool {
    is_safe_cache_key(cache_key)
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
        thumbnail_source_fingerprint: row.get(13)?,
        attempt_generation: row.get(14)?,
        error: row.get(15)?,
    })
}

#[derive(Debug)]
struct MediaCursor {
    key: MediaCursorKey,
    id: i64,
}

#[derive(Debug)]
enum MediaCursorKey {
    Name(String),
    Mtime(i64),
}

#[derive(Debug)]
struct FolderCursor {
    name: String,
    id: i64,
}

fn normalize_media_sort(sort: &str) -> &'static str {
    match sort {
        "mtime_asc" => "mtime_asc",
        "name_asc" => "name_asc",
        "name_desc" => "name_desc",
        _ => "mtime_desc",
    }
}

fn encode_media_cursor(sort: &str, item: &MediaRecord) -> String {
    match sort {
        "name_asc" | "name_desc" => {
            format!(
                "v1:media:{sort}:{}:{}",
                item.id,
                hex_encode(item.name.as_bytes())
            )
        }
        "mtime_asc" | "mtime_desc" => format!("v1:media:{sort}:{}:{}", item.id, item.mtime),
        _ => format!("v1:media:mtime_desc:{}:{}", item.id, item.mtime),
    }
}

fn decode_media_cursor(cursor: &str, expected_sort: &str) -> anyhow::Result<MediaCursor> {
    let mut parts = cursor.splitn(5, ':');
    let version = parts.next();
    let entity = parts.next();
    let sort = parts.next();
    let id = parts.next();
    let key = parts.next();
    if version != Some("v1") || entity != Some("media") || sort != Some(expected_sort) {
        return Err(anyhow::anyhow!("invalid media cursor"));
    }
    let id = id
        .ok_or_else(|| anyhow::anyhow!("invalid media cursor"))?
        .parse::<i64>()
        .map_err(|_| anyhow::anyhow!("invalid media cursor"))?;
    let key = key.ok_or_else(|| anyhow::anyhow!("invalid media cursor"))?;
    let key = match expected_sort {
        "name_asc" | "name_desc" => MediaCursorKey::Name(
            hex_decode_to_string(key).map_err(|_| anyhow::anyhow!("invalid media cursor"))?,
        ),
        "mtime_asc" | "mtime_desc" => MediaCursorKey::Mtime(
            key.parse::<i64>()
                .map_err(|_| anyhow::anyhow!("invalid media cursor"))?,
        ),
        _ => return Err(anyhow::anyhow!("invalid media cursor")),
    };
    Ok(MediaCursor { key, id })
}

fn encode_folder_cursor(folder: &FolderRecord) -> String {
    format!(
        "v1:folder:{}:{}",
        folder.id,
        hex_encode(folder.name.as_bytes())
    )
}

fn decode_folder_cursor(cursor: &str) -> anyhow::Result<FolderCursor> {
    let mut parts = cursor.splitn(4, ':');
    if parts.next() != Some("v1") || parts.next() != Some("folder") {
        return Err(anyhow::anyhow!("invalid folder cursor"));
    }
    let id = parts
        .next()
        .ok_or_else(|| anyhow::anyhow!("invalid folder cursor"))?
        .parse::<i64>()
        .map_err(|_| anyhow::anyhow!("invalid folder cursor"))?;
    let name = hex_decode_to_string(
        parts
            .next()
            .ok_or_else(|| anyhow::anyhow!("invalid folder cursor"))?,
    )
    .map_err(|_| anyhow::anyhow!("invalid folder cursor"))?;
    Ok(FolderCursor { name, id })
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn hex_decode_to_string(value: &str) -> anyhow::Result<String> {
    if value.len() % 2 != 0 {
        return Err(anyhow::anyhow!("invalid cursor hex"));
    }
    let mut bytes = Vec::with_capacity(value.len() / 2);
    let chars = value.as_bytes();
    for index in (0..chars.len()).step_by(2) {
        let high = hex_value(chars[index])?;
        let low = hex_value(chars[index + 1])?;
        bytes.push((high << 4) | low);
    }
    Ok(String::from_utf8(bytes)?)
}

fn hex_value(value: u8) -> anyhow::Result<u8> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        b'A'..=b'F' => Ok(value - b'A' + 10),
        _ => Err(anyhow::anyhow!("invalid cursor hex")),
    }
}

fn unix_timestamp() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

fn unix_timestamp_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
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

    fn seed_media_page_fixture(database: &Database) -> (i64, i64) {
        let root_id = database
            .add_root(NewRoot {
                path: "D:/Pictures".to_string(),
                display_name: "Pictures".to_string(),
            })
            .expect("add root");
        let folder_id = database
            .upsert_folder(FolderUpsert {
                root_id,
                parent_id: None,
                name: String::new(),
                path_hash: "root-hash".to_string(),
                mtime: Some(10),
            })
            .expect("insert root folder");

        for (index, name) in ["alpha.jpg", "bravo.jpg", "charlie.jpg", "delta.jpg"]
            .iter()
            .enumerate()
        {
            let file_id = database
                .upsert_file(FileUpsert {
                    root_id,
                    folder_id,
                    name: (*name).to_string(),
                    ext: ".jpg".to_string(),
                    size: 100 + index as i64,
                    mtime: 100 + index as i64,
                    ctime: None,
                    file_key: None,
                })
                .expect("insert file");
            database
                .upsert_media_kind(file_id, "image")
                .expect("insert media kind");
        }

        (root_id, folder_id)
    }

    fn media_names(items: &[MediaRecord]) -> Vec<&str> {
        items.iter().map(|item| item.name.as_str()).collect()
    }

    fn folder_names(items: &[FolderRecord]) -> Vec<&str> {
        items.iter().map(|item| item.name.as_str()).collect()
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

    const OLD_SCHEMA_WITH_LEGACY_THUMBS: &str = r#"
        PRAGMA foreign_keys = ON;

        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at INTEGER NOT NULL
        );

        CREATE TABLE roots (
          id INTEGER PRIMARY KEY,
          path TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL,
          last_scan_at INTEGER
        );

        CREATE TABLE folders (
          id INTEGER PRIMARY KEY,
          root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
          parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          path_hash TEXT NOT NULL,
          mtime INTEGER,
          status TEXT NOT NULL DEFAULT 'active',
          UNIQUE(root_id, parent_id, name)
        );

        CREATE TABLE files (
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

        CREATE TABLE media (
          file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          width INTEGER,
          height INTEGER,
          duration_ms INTEGER,
          codec TEXT,
          orientation INTEGER,
          has_alpha INTEGER,
          dominant_color TEXT,
          phash TEXT,
          metadata_status TEXT NOT NULL DEFAULT 'pending'
        );

        CREATE TABLE thumbs (
          file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
          profile TEXT NOT NULL,
          cache_key TEXT,
          width INTEGER,
          height INTEGER,
          byte_size INTEGER,
          state TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY(file_id, profile)
        );

        CREATE TABLE thumbs_new(stale TEXT);

        INSERT INTO schema_migrations(version, name, applied_at)
        VALUES
          (1, 'initial', unixepoch()),
          (2, 'task_progress', unixepoch()),
          (3, 'browsing_indexes', unixepoch());

        INSERT INTO roots(id, path, display_name, enabled, created_at)
        VALUES (1, 'D:/Pictures', 'Pictures', 1, 1);

        INSERT INTO folders(id, root_id, parent_id, name, path_hash, mtime)
        VALUES (1, 1, NULL, '', 'root-hash', 1);

        INSERT INTO files(id, root_id, folder_id, name, ext, size, mtime)
        VALUES
          (1, 1, 1, 'explicit.jpg', '.jpg', 100, 1),
          (2, 1, 1, 'queued.jpg', '.jpg', 100, 2),
          (3, 1, 1, 'tiny.jpg', '.jpg', 100, 3),
          (4, 1, 1, 'absolute.jpg', '.jpg', 100, 4),
          (5, 1, 1, 'ready.jpg', '.jpg', 100, 5);

        INSERT INTO media(file_id, kind, width, height, metadata_status)
        VALUES
          (1, 'image', 640, 480, 'ready'),
          (2, 'image', 640, 480, 'ready'),
          (3, 'image', 640, 480, 'ready'),
          (4, 'image', 640, 480, 'ready'),
          (5, 'image', 640, 480, 'ready');

        INSERT INTO thumbs(file_id, profile, cache_key, width, height, byte_size, state, updated_at)
        VALUES
          (1, 'grid', 'legacy/grid.webp', 320, 240, 111, 'ready', 10),
          (1, 'grid_320', 'explicit/stale.webp', 320, 240, 222, 'failed', 20),
          (2, 'grid', 'queued/stale.webp', 320, 240, 333, 'queued', 30),
          (3, 'tiny', 'tiny.webp', 80, 60, 444, 'ready', 40),
          (4, 'grid', 'C:\absolute\thumb.webp', 320, 240, 555, 'ready', 50),
          (5, 'grid', 'aa/bb/ready.webp', 320, 240, 666, 'ready', 60);
    "#;

    const VERSION_4_SCHEMA_WITH_READY_THUMBNAIL_WITHOUT_FINGERPRINT: &str = r#"
        PRAGMA foreign_keys = ON;

        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at INTEGER NOT NULL
        );

        CREATE TABLE roots (
          id INTEGER PRIMARY KEY,
          path TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL,
          last_scan_at INTEGER
        );

        CREATE TABLE folders (
          id INTEGER PRIMARY KEY,
          root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
          parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          path_hash TEXT NOT NULL,
          mtime INTEGER,
          status TEXT NOT NULL DEFAULT 'active',
          UNIQUE(root_id, parent_id, name)
        );

        CREATE TABLE files (
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

        CREATE TABLE media (
          file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          width INTEGER,
          height INTEGER,
          duration_ms INTEGER,
          codec TEXT,
          orientation INTEGER,
          has_alpha INTEGER,
          dominant_color TEXT,
          phash TEXT,
          metadata_status TEXT NOT NULL DEFAULT 'pending'
        );

        CREATE TABLE thumbs (
          file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
          profile TEXT NOT NULL CHECK(profile IN ('grid_320')),
          state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending', 'queued', 'ready', 'failed', 'skipped_small')),
          cache_key TEXT,
          width INTEGER,
          height INTEGER,
          byte_size INTEGER,
          short_side_px INTEGER NOT NULL DEFAULT 320 CHECK(short_side_px = 320),
          output_format TEXT NOT NULL DEFAULT 'image/webp' CHECK(output_format = 'image/webp'),
          error TEXT,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY(file_id, profile)
        );

        CREATE TABLE tasks (
          id INTEGER PRIMARY KEY,
          kind TEXT NOT NULL,
          priority INTEGER NOT NULL,
          status TEXT NOT NULL,
          root_id INTEGER REFERENCES roots(id) ON DELETE SET NULL,
          file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          items_seen INTEGER NOT NULL DEFAULT 0,
          items_total INTEGER,
          folders_seen INTEGER NOT NULL DEFAULT 0,
          media_files_seen INTEGER NOT NULL DEFAULT 0,
          skipped_files INTEGER NOT NULL DEFAULT 0,
          error TEXT
        );

        INSERT INTO schema_migrations(version, name, applied_at)
        VALUES
          (1, 'initial', unixepoch()),
          (2, 'task_progress', unixepoch()),
          (3, 'browsing_indexes', unixepoch()),
          (4, 'thumbnail_state', unixepoch());

        INSERT INTO roots(id, path, display_name, enabled, created_at)
        VALUES (1, 'D:/Pictures', 'Pictures', 1, 1);

        INSERT INTO folders(id, root_id, parent_id, name, path_hash, mtime)
        VALUES (1, 1, NULL, '', 'root-hash', 1);

        INSERT INTO files(id, root_id, folder_id, name, ext, size, mtime)
        VALUES
          (1, 1, 1, 'legacy-ready.jpg', '.jpg', 100, 1),
          (2, 1, 1, 'legacy-skipped.jpg', '.jpg', 100, 2);

        INSERT INTO media(file_id, kind, width, height, metadata_status)
        VALUES
          (1, 'image', 640, 480, 'ready'),
          (2, 'image', 128, 128, 'ready');

        INSERT INTO thumbs(file_id, profile, state, cache_key, width, height, byte_size, updated_at)
        VALUES (1, 'grid_320', 'ready', 'aa/bb/legacy.webp', 320, 320, 16, 10);

        INSERT INTO thumbs(file_id, profile, state, updated_at)
        VALUES (2, 'grid_320', 'skipped_small', 11);
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
            "thumbnail_source_fingerprint",
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
        assert_eq!(tasks[0].thumbnail_source_fingerprint, None);
        let invalid_status = database
            .connection
            .execute(
                "UPDATE OR IGNORE tasks SET status = 'paused' WHERE id = ?1",
                [tasks[0].id],
            )
            .expect("invalid task status should be ignored");
        assert_eq!(invalid_status, 0);
    }

    #[test]
    fn thumbnails_state_migration_is_rerunnable_and_prefers_explicit_grid_320_rows() {
        let database = Database::open_in_memory().expect("open in-memory database");
        database
            .connection
            .execute_batch(OLD_SCHEMA_WITH_LEGACY_THUMBS)
            .expect("apply old thumbnail schema");

        database
            .apply_migrations()
            .expect("apply thumbnail state migration");
        database
            .apply_migrations()
            .expect("rerun migrations after thumbnail state migration");

        let stale_table_count: i64 = database
            .connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'thumbs_new'",
                [],
                |row| row.get(0),
            )
            .expect("count stale temp tables");
        assert_eq!(stale_table_count, 0);

        let foreign_keys_enabled: i64 = database
            .connection
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .expect("foreign_keys pragma");
        assert_eq!(foreign_keys_enabled, 1);

        let foreign_key_violations: i64 = database
            .connection
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .expect("foreign key check");
        assert_eq!(foreign_key_violations, 0);

        let explicit = database
            .get_thumbnail(1, "grid_320")
            .expect("get explicit thumbnail")
            .expect("explicit thumbnail exists");
        assert_eq!(explicit.state, "pending");
        assert_eq!(explicit.cache_key, None);
        assert_eq!(explicit.width, None);
        assert_eq!(explicit.height, None);
        assert_eq!(explicit.byte_size, None);
        assert_eq!(explicit.error, None);
        assert_eq!(explicit.updated_at, Some(20));

        let queued = database
            .get_thumbnail(2, "grid_320")
            .expect("get queued thumbnail")
            .expect("queued thumbnail exists");
        assert_eq!(queued.state, "queued");
        assert_eq!(queued.cache_key, None);
        assert_eq!(queued.width, None);
        assert_eq!(queued.height, None);
        assert_eq!(queued.byte_size, None);

        let unsupported_count: i64 = database
            .connection
            .query_row("SELECT COUNT(*) FROM thumbs WHERE file_id = 3", [], |row| {
                row.get(0)
            })
            .expect("count unsupported profile rows");
        assert_eq!(unsupported_count, 0);

        let absolute = database
            .get_thumbnail(4, "grid_320")
            .expect("get absolute thumbnail")
            .expect("absolute thumbnail exists");
        assert_eq!(absolute.state, "pending");
        assert_eq!(absolute.cache_key, None);
        assert_eq!(absolute.width, None);
        assert_eq!(absolute.height, None);
        assert_eq!(absolute.byte_size, None);

        let ready = database
            .get_thumbnail(5, "grid_320")
            .expect("get ready thumbnail")
            .expect("ready thumbnail exists");
        assert_eq!(ready.state, "pending");
        assert_eq!(ready.cache_key, None);
        assert_eq!(ready.width, None);
        assert_eq!(ready.height, None);
        assert_eq!(ready.byte_size, None);
        assert_eq!(ready.source_fingerprint, None);
    }

    #[test]
    fn source_fingerprint_migration_upgrades_v4_database_and_invalidates_legacy_ready_rows() {
        let database = Database::open_in_memory().expect("open in-memory database");
        database
            .connection
            .execute_batch(VERSION_4_SCHEMA_WITH_READY_THUMBNAIL_WITHOUT_FINGERPRINT)
            .expect("apply version 4 schema");

        database
            .apply_migrations()
            .expect("apply source fingerprint migration");

        let thumb_columns: Vec<String> = {
            let mut statement = database
                .connection
                .prepare("PRAGMA table_info(thumbs)")
                .expect("inspect thumbs table");
            statement
                .query_map([], |row| row.get(1))
                .expect("query columns")
                .collect::<rusqlite::Result<Vec<String>>>()
                .expect("collect columns")
        };
        assert!(thumb_columns
            .iter()
            .any(|candidate| candidate == "source_fingerprint"));
        let version_5_count: i64 = database
            .connection
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = 5",
                [],
                |row| row.get(0),
            )
            .expect("query version 5");
        assert_eq!(version_5_count, 1);
        let version_6_count: i64 = database
            .connection
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = 6",
                [],
                |row| row.get(0),
            )
            .expect("query version 6");
        assert_eq!(version_6_count, 1);
        let version_7_count: i64 = database
            .connection
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = 7",
                [],
                |row| row.get(0),
            )
            .expect("query version 7");
        assert_eq!(version_7_count, 1);

        let thumbnail = database
            .get_thumbnail(1, crate::thumbnails::GRID_320_PROFILE)
            .expect("get thumbnail")
            .expect("thumbnail exists");
        assert_eq!(thumbnail.state, "pending");
        assert_eq!(thumbnail.cache_key, None);
        assert_eq!(thumbnail.width, None);
        assert_eq!(thumbnail.height, None);
        assert_eq!(thumbnail.byte_size, None);
        assert_eq!(thumbnail.source_fingerprint, None);

        let skipped = database
            .get_thumbnail(2, crate::thumbnails::GRID_320_PROFILE)
            .expect("get skipped thumbnail")
            .expect("skipped thumbnail exists");
        assert_eq!(skipped.state, "pending");
        assert_eq!(skipped.source_fingerprint, None);
    }

    #[test]
    fn task_attempt_generation_migration_recovers_partial_apply_and_defaults_existing_tasks() {
        let database = Database::open_in_memory().expect("open in-memory database");
        database
            .connection
            .execute_batch(migrations::INITIAL_MIGRATION)
            .expect("apply initial migration");
        database
            .connection
            .execute_batch(migrations::TASK_PROGRESS_MIGRATION)
            .expect("apply task progress migration");
        database
            .connection
            .execute_batch(migrations::BROWSING_INDEXES_MIGRATION)
            .expect("apply browsing indexes migration");
        database
            .connection
            .execute_batch(migrations::THUMBNAIL_STATE_MIGRATION)
            .expect("apply thumbnail state migration");
        database
            .connection
            .execute_batch(migrations::THUMBNAIL_SOURCE_FINGERPRINT_MIGRATION)
            .expect("apply thumbnail source fingerprint migration");
        database
            .connection
            .execute_batch(migrations::THUMBNAIL_TASK_ATTEMPT_FINGERPRINT_MIGRATION)
            .expect("apply thumbnail task fingerprint migration");
        database
            .connection
            .execute_batch(migrations::TASK_STATUS_CONTRACT_MIGRATION)
            .expect("apply task status contract migration");
        let root_id = database
            .add_root(NewRoot {
                path: "D:/Pictures".to_string(),
                display_name: "Pictures".to_string(),
            })
            .expect("add root before v8");
        let task_id = database
            .create_root_scan_task(root_id)
            .expect("create task before v8");

        database
            .apply_migrations()
            .expect("apply v8 attempt generation migration");
        let task = database
            .get_task(task_id)
            .expect("get migrated task")
            .expect("task exists");
        assert_eq!(task.attempt_generation, 0);
        let version_8_count: i64 = database
            .connection
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = 8",
                [],
                |row| row.get(0),
            )
            .expect("query version 8");
        assert_eq!(version_8_count, 1);

        database
            .connection
            .execute("DELETE FROM schema_migrations WHERE version = 8", [])
            .expect("simulate missing v8 version after partial apply");
        database
            .apply_migrations()
            .expect("recover partial v8 apply without duplicate column failure");
        let version_8_count: i64 = database
            .connection
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = 8",
                [],
                |row| row.get(0),
            )
            .expect("query recovered version 8");
        assert_eq!(version_8_count, 1);
    }

    #[test]
    fn task_attempt_mutators_expose_only_attempt_guarded_public_surface() {
        let source = include_str!("mod.rs");
        for forbidden in [
            concat!("pub fn ", "mark_task_running", "("),
            concat!("pub fn ", "mark_thumbnail_task_running", "("),
            concat!("pub fn ", "mark_task_succeeded", "("),
            concat!("pub fn ", "mark_task_failed", "("),
            concat!("pub fn ", "update_task_scan_progress", "("),
        ] {
            assert!(
                !source.contains(forbidden),
                "unguarded task attempt mutator remains public: {forbidden}"
            );
        }
    }

    #[test]
    fn terminal_thumbnail_without_source_fingerprint_is_not_exposed_as_current() {
        let database = migrated_database();
        let (root_id, folder_id) = seed_media_page_fixture(&database);
        let file_id = database
            .upsert_file(FileUpsert {
                root_id,
                folder_id,
                name: "legacy-null-fingerprint.jpg".to_string(),
                ext: ".jpg".to_string(),
                size: 100,
                mtime: 10,
                ctime: None,
                file_key: None,
            })
            .expect("insert file");
        database
            .upsert_media_kind(file_id, "image")
            .expect("insert media");
        database
            .connection
            .execute(
                r#"
                INSERT INTO thumbs(file_id, profile, state, cache_key, width, height, byte_size, updated_at)
                VALUES (?1, 'grid_320', 'ready', 'aa/bb/legacy-null.webp', 320, 320, 16, 10)
                "#,
                [file_id],
            )
            .expect("insert legacy ready thumbnail");

        let thumbnail = database
            .get_thumbnail(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("get thumbnail")
            .expect("thumbnail exists");

        assert_eq!(thumbnail.state, "pending");
        assert_eq!(thumbnail.cache_key, None);
        assert_eq!(thumbnail.width, None);
        assert_eq!(thumbnail.height, None);
        assert_eq!(thumbnail.byte_size, None);

        database
            .connection
            .execute(
                "UPDATE thumbs SET state = 'skipped_small', cache_key = NULL, width = NULL, height = NULL, byte_size = NULL WHERE file_id = ?1",
                [file_id],
            )
            .expect("mark legacy skipped thumbnail");
        let skipped = database
            .get_thumbnail(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("get skipped thumbnail")
            .expect("thumbnail exists");
        assert_eq!(skipped.state, "pending");
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
        let source_fingerprint = database
            .get_thumbnail_source(file_id)
            .expect("get thumbnail source")
            .expect("thumbnail source exists")
            .source_fingerprint(crate::thumbnails::GRID_320_PROFILE);

        database
            .connection
            .execute(
                r#"
                INSERT INTO thumbs(
                    file_id, profile, cache_key, width, height, byte_size,
                    state, source_fingerprint, updated_at
                )
                VALUES (?1, 'grid_320', 'aa/bb/key.webp', 427, 320, 4096, 'ready', ?2, 30)
                "#,
                (file_id, source_fingerprint),
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

        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].id, file_id);
        assert_eq!(page.items[0].name, "image.jpg");
        assert_eq!(page.items[0].kind.as_deref(), Some("image"));
        assert_eq!(page.items[0].thumbnail_state.as_deref(), Some("ready"));
        assert_eq!(
            page.items[0].thumbnail_cache_key.as_deref(),
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
    fn media_records_expose_thumbnail_cache_key_only_for_ready_safe_relative_keys() {
        let database = migrated_database();
        let (root_id, folder_id) = seed_media_page_fixture(&database);
        for (index, name) in [
            "empty-cache.jpg",
            "dot-slash.jpg",
            "double-slash.jpg",
            "dot-segment.jpg",
        ]
        .iter()
        .enumerate()
        {
            let file_id = database
                .upsert_file(FileUpsert {
                    root_id,
                    folder_id,
                    name: (*name).to_string(),
                    ext: ".jpg".to_string(),
                    size: 200 + index as i64,
                    mtime: 200 + index as i64,
                    ctime: None,
                    file_key: None,
                })
                .expect("insert invalid cache-key file");
            database
                .upsert_media_kind(file_id, "image")
                .expect("insert media kind");
        }
        let file_ids: Vec<i64> = database
            .connection
            .prepare("SELECT id FROM files WHERE root_id = ?1 ORDER BY name ASC")
            .expect("prepare expanded file ids")
            .query_map([root_id], |row| row.get(0))
            .expect("query expanded file ids")
            .collect::<rusqlite::Result<Vec<i64>>>()
            .expect("collect expanded file ids");

        for (file_id, state, cache_key) in [
            (file_ids[0], "ready", "aa/bb/ready.webp"),
            (file_ids[1], "queued", "queued/stale.webp"),
            (file_ids[2], "ready", "C:\\absolute\\thumb.webp"),
            (file_ids[3], "ready", "../escape.webp"),
            (file_ids[4], "ready", ""),
            (file_ids[5], "ready", "./thumb.webp"),
            (file_ids[6], "ready", "aa//thumb.webp"),
            (file_ids[7], "ready", "aa/./thumb.webp"),
        ] {
            let source_fingerprint = if state == "ready" {
                Some(
                    database
                        .get_thumbnail_source(file_id)
                        .expect("get thumbnail source")
                        .expect("thumbnail source exists")
                        .source_fingerprint(crate::thumbnails::GRID_320_PROFILE),
                )
            } else {
                None
            };
            database
                .connection
                .execute(
                    r#"
                    INSERT INTO thumbs(
                        file_id, profile, state, cache_key, width, height, byte_size,
                        source_fingerprint, updated_at
                    )
                    VALUES (?1, 'grid_320', ?2, ?3, 320, 240, 1024, ?4, 100)
                    "#,
                    (file_id, state, cache_key, source_fingerprint),
                )
                .expect("insert thumbnail state");
        }

        let page = database
            .list_media_page(MediaPageQuery {
                root_id: Some(root_id),
                folder_id: Some(folder_id),
                limit: 10,
                cursor: None,
                sort: "name_asc".to_string(),
                kind: Some("image".to_string()),
            })
            .expect("list media page");
        assert_eq!(
            media_names(&page.items),
            vec![
                "alpha.jpg",
                "bravo.jpg",
                "charlie.jpg",
                "delta.jpg",
                "dot-segment.jpg",
                "dot-slash.jpg",
                "double-slash.jpg",
                "empty-cache.jpg"
            ]
        );
        assert_eq!(
            page.items[0].thumbnail_cache_key.as_deref(),
            Some("aa/bb/ready.webp")
        );
        assert_eq!(page.items[1].thumbnail_state.as_deref(), Some("queued"));
        assert_eq!(page.items[1].thumbnail_cache_key, None);
        assert_eq!(page.items[2].thumbnail_state.as_deref(), Some("ready"));
        assert_eq!(page.items[2].thumbnail_cache_key, None);
        assert_eq!(page.items[3].thumbnail_state.as_deref(), Some("ready"));
        assert_eq!(page.items[3].thumbnail_cache_key, None);
        for item in &page.items[4..] {
            assert_eq!(item.thumbnail_state.as_deref(), Some("ready"));
            assert_eq!(item.thumbnail_cache_key, None);
        }

        let absolute = database
            .get_media(file_ids[2])
            .expect("get media")
            .expect("media exists");
        assert_eq!(absolute.thumbnail_state.as_deref(), Some("ready"));
        assert_eq!(absolute.thumbnail_cache_key, None);
        let dot_segment = database
            .get_media(file_ids[7])
            .expect("get dot segment media")
            .expect("media exists");
        assert_eq!(dot_segment.thumbnail_state.as_deref(), Some("ready"));
        assert_eq!(dot_segment.thumbnail_cache_key, None);
    }

    #[test]
    fn media_records_normalize_terminal_thumbnail_state_by_source_fingerprint() {
        let database = migrated_database();
        let (root_id, folder_id) = seed_media_page_fixture(&database);
        let cases = [
            ("current-ready.jpg", "ready", "current"),
            ("null-ready.jpg", "ready", "null"),
            ("stale-ready.jpg", "ready", "stale"),
            ("null-failed.jpg", "failed", "null"),
            ("stale-failed.jpg", "failed", "stale"),
            ("null-skipped.jpg", "skipped_small", "null"),
            ("stale-skipped.jpg", "skipped_small", "stale"),
        ];
        let mut expected = Vec::new();

        for (index, (name, state, fingerprint_mode)) in cases.iter().enumerate() {
            let file_id = database
                .upsert_file(FileUpsert {
                    root_id,
                    folder_id,
                    name: (*name).to_string(),
                    ext: ".jpg".to_string(),
                    size: 900 + index as i64,
                    mtime: 900 + index as i64,
                    ctime: None,
                    file_key: Some(format!("identity-{index}")),
                })
                .expect("insert thumbnail freshness file");
            database
                .upsert_media_kind(file_id, "image")
                .expect("insert media kind");
            database
                .connection
                .execute(
                    "UPDATE media SET width = 640, height = 480, metadata_status = 'ready' WHERE file_id = ?1",
                    [file_id],
                )
                .expect("set media metadata");
            let current_source_fingerprint = database
                .get_thumbnail_source(file_id)
                .expect("get thumbnail source")
                .expect("thumbnail source exists")
                .source_fingerprint(crate::thumbnails::GRID_320_PROFILE);
            let source_fingerprint = match *fingerprint_mode {
                "current" => Some(current_source_fingerprint),
                "stale" => Some("stale-source-fingerprint-that-must-not-match".to_string()),
                "null" => None,
                other => panic!("unsupported fingerprint mode: {other}"),
            };
            database
                .upsert_thumbnail_state(ThumbnailStateUpsert {
                    file_id,
                    profile: crate::thumbnails::GRID_320_PROFILE.to_string(),
                    state: (*state).to_string(),
                    cache_key: Some(format!("aa/bb/{name}.webp")),
                    width: Some(320),
                    height: Some(320),
                    byte_size: Some(64),
                    error: if *state == "failed" {
                        Some("decode failed".to_string())
                    } else {
                        None
                    },
                    source_fingerprint,
                })
                .expect("insert thumbnail state");
            expected.push((file_id, *name, *fingerprint_mode));
        }

        let page = database
            .list_media_page(MediaPageQuery {
                root_id: Some(root_id),
                folder_id: Some(folder_id),
                limit: 100,
                cursor: None,
                sort: "name_asc".to_string(),
                kind: Some("image".to_string()),
            })
            .expect("list media page");

        for (file_id, name, fingerprint_mode) in expected {
            let page_item = page
                .items
                .iter()
                .find(|item| item.id == file_id)
                .expect("page item exists");
            let detail_item = database
                .get_media(file_id)
                .expect("get media detail")
                .expect("media detail exists");
            assert_eq!(page_item.name, name);
            assert_eq!(detail_item.name, name);
            if fingerprint_mode == "current" {
                assert_eq!(page_item.thumbnail_state.as_deref(), Some("ready"));
                assert_eq!(detail_item.thumbnail_state.as_deref(), Some("ready"));
                assert_eq!(
                    page_item.thumbnail_cache_key.as_deref(),
                    Some("aa/bb/current-ready.jpg.webp")
                );
                assert_eq!(
                    detail_item.thumbnail_cache_key.as_deref(),
                    Some("aa/bb/current-ready.jpg.webp")
                );
            } else {
                assert_eq!(page_item.thumbnail_state.as_deref(), Some("pending"));
                assert_eq!(page_item.thumbnail_cache_key, None);
                assert_eq!(detail_item.thumbnail_state.as_deref(), Some("pending"));
                assert_eq!(detail_item.thumbnail_cache_key, None);
            }
        }
    }

    #[test]
    fn thumbnails_persist_grid_320_webp_state_and_reject_unknown_values() {
        let database = migrated_database();
        let (root_id, folder_id) = seed_media_page_fixture(&database);
        let file_id: i64 = database
            .connection
            .query_row(
                "SELECT id FROM files WHERE root_id = ?1 AND folder_id = ?2 ORDER BY id LIMIT 1",
                (root_id, folder_id),
                |row| row.get(0),
            )
            .expect("seeded file id");

        database
            .connection
            .execute(
                r#"
                INSERT INTO thumbs(
                    file_id, profile, state, cache_key, width, height, byte_size,
                    short_side_px, output_format, updated_at
                )
                VALUES (?1, 'grid_320', 'pending', NULL, NULL, NULL, NULL, 320, 'image/webp', 100)
                "#,
                [file_id],
            )
            .expect("insert pending thumbnail state");

        for state in ["queued", "ready", "failed", "skipped_small"] {
            database
                .connection
                .execute(
                    r#"
                    UPDATE thumbs
                    SET state = ?1,
                        cache_key = CASE WHEN ?1 = 'ready' THEN 'aa/bb/key.webp' ELSE NULL END,
                        width = CASE WHEN ?1 = 'ready' THEN 427 ELSE NULL END,
                        height = CASE WHEN ?1 = 'ready' THEN 320 ELSE NULL END,
                        byte_size = CASE WHEN ?1 = 'ready' THEN 4096 ELSE NULL END,
                        error = CASE WHEN ?1 = 'failed' THEN 'decode failed' ELSE NULL END
                    WHERE file_id = ?2 AND profile = 'grid_320'
                    "#,
                    (state, file_id),
                )
                .expect("update thumbnail state");
        }

        let row: (String, i64, String, Option<String>) = database
            .connection
            .query_row(
                r#"
                SELECT state, short_side_px, output_format, cache_key
                FROM thumbs
                WHERE file_id = ?1 AND profile = 'grid_320'
                "#,
                [file_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("thumbnail state row");
        assert_eq!(row.0, "skipped_small");
        assert_eq!(row.1, 320);
        assert_eq!(row.2, "image/webp");
        assert_eq!(row.3, None);

        let invalid_status = database
            .connection
            .execute(
                r#"
                UPDATE OR IGNORE thumbs
                SET state = 'unknown'
                WHERE file_id = ?1 AND profile = 'grid_320'
                "#,
                [file_id],
            )
            .expect("invalid thumbnail status is ignored by check constraint");
        assert_eq!(invalid_status, 0);

        let invalid_profile = database
            .connection
            .execute(
                r#"
                INSERT OR IGNORE INTO thumbs(file_id, profile, state, short_side_px, output_format, updated_at)
                VALUES (?1, 'grid', 'pending', 320, 'image/webp', 101)
                "#,
                [file_id],
            )
            .expect("invalid thumbnail profile is ignored by check constraint");
        assert_eq!(invalid_profile, 0);

        let invalid_format = database
            .connection
            .execute(
                r#"
                UPDATE OR IGNORE thumbs
                SET output_format = 'image/jpeg'
                WHERE file_id = ?1 AND profile = 'grid_320'
                "#,
                [file_id],
            )
            .expect("invalid thumbnail format is ignored by check constraint");
        assert_eq!(invalid_format, 0);
    }

    #[test]
    fn list_media_page_keyset_pages_all_supported_sorts_without_offset() {
        let database = migrated_database();
        let (root_id, folder_id) = seed_media_page_fixture(&database);

        for (sort, expected_pages) in [
            (
                "name_asc",
                vec![
                    vec!["alpha.jpg", "bravo.jpg"],
                    vec!["charlie.jpg", "delta.jpg"],
                ],
            ),
            (
                "name_desc",
                vec![
                    vec!["delta.jpg", "charlie.jpg"],
                    vec!["bravo.jpg", "alpha.jpg"],
                ],
            ),
            (
                "mtime_desc",
                vec![
                    vec!["delta.jpg", "charlie.jpg"],
                    vec!["bravo.jpg", "alpha.jpg"],
                ],
            ),
            (
                "mtime_asc",
                vec![
                    vec!["alpha.jpg", "bravo.jpg"],
                    vec!["charlie.jpg", "delta.jpg"],
                ],
            ),
        ] {
            let first_page = database
                .list_media_page(MediaPageQuery {
                    root_id: Some(root_id),
                    folder_id: Some(folder_id),
                    limit: 2,
                    cursor: None,
                    sort: sort.to_string(),
                    kind: Some("image".to_string()),
                })
                .expect("list first media page");
            assert_eq!(media_names(&first_page.items), expected_pages[0]);
            let cursor = first_page.next_cursor.expect("first page cursor");

            let second_page = database
                .list_media_page(MediaPageQuery {
                    root_id: Some(root_id),
                    folder_id: Some(folder_id),
                    limit: 2,
                    cursor: Some(cursor),
                    sort: sort.to_string(),
                    kind: Some("image".to_string()),
                })
                .expect("list second media page");
            assert_eq!(media_names(&second_page.items), expected_pages[1]);
            assert!(second_page.next_cursor.is_none());
        }
    }

    #[test]
    fn list_folder_children_paginates_by_name_with_stable_cursor() {
        let database = migrated_database();
        let root_id = database
            .add_root(NewRoot {
                path: "D:/Pictures".to_string(),
                display_name: "Pictures".to_string(),
            })
            .expect("add root");
        let root_folder_id = database
            .upsert_folder(FolderUpsert {
                root_id,
                parent_id: None,
                name: String::new(),
                path_hash: "root-hash".to_string(),
                mtime: Some(1),
            })
            .expect("insert root folder");
        for name in ["alpha", "bravo", "charlie"] {
            database
                .upsert_folder(FolderUpsert {
                    root_id,
                    parent_id: Some(root_folder_id),
                    name: name.to_string(),
                    path_hash: format!("{name}-hash"),
                    mtime: Some(2),
                })
                .expect("insert child folder");
        }

        let first_page = database
            .list_folder_children_page(root_folder_id, 2, None)
            .expect("list first child page");
        assert_eq!(folder_names(&first_page.items), vec!["alpha", "bravo"]);
        let cursor = first_page.next_cursor.expect("first child page cursor");

        let second_page = database
            .list_folder_children_page(root_folder_id, 2, Some(cursor))
            .expect("list second child page");
        assert_eq!(folder_names(&second_page.items), vec!["charlie"]);
        assert!(second_page.next_cursor.is_none());
    }

    #[test]
    fn disabled_root_is_hidden_from_roots_and_media_and_rejects_scan_tasks() {
        let database = migrated_database();
        let (root_id, _folder_id) = seed_media_page_fixture(&database);
        database.disable_root(root_id).expect("disable root");

        assert!(database.list_roots().expect("list roots").is_empty());
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

        let scan_task = database.create_root_scan_task(root_id);
        assert!(scan_task
            .expect_err("disabled root should reject scan task")
            .to_string()
            .contains("disabled"));
    }

    #[test]
    fn readding_disabled_root_does_not_resurrect_stale_index_rows_before_scan() {
        let database = migrated_database();
        let (root_id, _folder_id) = seed_media_page_fixture(&database);
        database.disable_root(root_id).expect("disable root");

        let same_root_id = database
            .add_root(NewRoot {
                path: "D:/Pictures".to_string(),
                display_name: "Pictures Again".to_string(),
            })
            .expect("readd root");
        assert_eq!(same_root_id, root_id);

        let roots = database.list_roots().expect("list roots");
        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].display_name, "Pictures Again");
        assert!(roots[0].root_folder_id.is_none());

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
                scan_generation: None,
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
                scan_generation: None,
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
                scan_generation: None,
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
                scan_generation: None,
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
    fn incremental_upsert_during_active_scan_is_not_reconciled_missing() {
        let mut database = migrated_database();
        let root_id = database
            .add_root(NewRoot {
                path: "D:/Pictures".to_string(),
                display_name: "Pictures".to_string(),
            })
            .expect("add root");

        let first_generation = database
            .begin_root_scan_reconciliation(root_id)
            .expect("begin first scan");
        let root_result = database
            .commit_scan_batch(ScanWriteBatch {
                folders: vec![FolderUpsert {
                    root_id,
                    parent_id: None,
                    name: String::new(),
                    path_hash: "root-hash".to_string(),
                    mtime: Some(10),
                }],
                files: Vec::new(),
                scan_generation: Some(first_generation),
            })
            .expect("commit first root folder");
        let root_folder_id = root_result.folder_ids[0];
        database
            .commit_scan_batch(ScanWriteBatch {
                folders: Vec::new(),
                files: vec![ScanFileUpsert {
                    file: FileUpsert {
                        root_id,
                        folder_id: root_folder_id,
                        name: "deleted.jpg".to_string(),
                        ext: ".jpg".to_string(),
                        size: 10,
                        mtime: 10,
                        ctime: None,
                        file_key: None,
                    },
                    media_kind: "image".to_string(),
                }],
                scan_generation: Some(first_generation),
            })
            .expect("commit old media");
        database
            .reconcile_root_scan_completion(root_id, first_generation)
            .expect("complete first scan");

        let second_generation = database
            .begin_root_scan_reconciliation(root_id)
            .expect("begin second scan");
        database
            .commit_scan_batch(ScanWriteBatch {
                folders: vec![FolderUpsert {
                    root_id,
                    parent_id: None,
                    name: String::new(),
                    path_hash: "root-hash".to_string(),
                    mtime: Some(20),
                }],
                files: Vec::new(),
                scan_generation: Some(second_generation),
            })
            .expect("commit second root folder");

        let concurrent_file_id = database
            .upsert_file(FileUpsert {
                root_id,
                folder_id: root_folder_id,
                name: "concurrent.jpg".to_string(),
                ext: ".jpg".to_string(),
                size: 20,
                mtime: 20,
                ctime: None,
                file_key: None,
            })
            .expect("watcher-style upsert during active scan");
        database
            .upsert_media_kind(concurrent_file_id, "image")
            .expect("watcher-style media upsert");

        database
            .reconcile_root_scan_completion(root_id, second_generation)
            .expect("complete second scan");
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
        assert_eq!(media_names(&page.items), vec!["concurrent.jpg"]);
    }

    #[test]
    fn stale_task_attempt_cannot_reconcile_root_scan_completion() {
        // Regression for Blocker 2: when a guarded scan finishes after its
        // task attempt has been superseded (cancel + retry), reconciliation
        // must NOT run. It must not mark rows missing for the new generation
        // and must not clear the new attempt's `active_scan_generation`.
        let mut database = migrated_database();
        let root_id = database
            .add_root(NewRoot {
                path: "D:/Pictures".to_string(),
                display_name: "Pictures".to_string(),
            })
            .expect("add root");

        // Seed an initial scan so we have rows to potentially clobber.
        let seed_generation = database
            .begin_root_scan_reconciliation(root_id)
            .expect("begin seed scan");
        let root_folder_id = database
            .commit_scan_batch(ScanWriteBatch {
                folders: vec![FolderUpsert {
                    root_id,
                    parent_id: None,
                    name: String::new(),
                    path_hash: "root-hash".to_string(),
                    mtime: Some(10),
                }],
                files: Vec::new(),
                scan_generation: Some(seed_generation),
            })
            .expect("commit root folder")
            .folder_ids[0];
        database
            .commit_scan_batch(ScanWriteBatch {
                folders: Vec::new(),
                files: vec![ScanFileUpsert {
                    file: FileUpsert {
                        root_id,
                        folder_id: root_folder_id,
                        name: "keep.jpg".to_string(),
                        ext: ".jpg".to_string(),
                        size: 10,
                        mtime: 10,
                        ctime: None,
                        file_key: None,
                    },
                    media_kind: "image".to_string(),
                }],
                scan_generation: Some(seed_generation),
            })
            .expect("commit seed file");
        database
            .reconcile_root_scan_completion(root_id, seed_generation)
            .expect("finish seed scan");

        // Begin a guarded scan tied to a running task.
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
            .expect("mark old attempt running");
        let stale_generation = database
            .begin_root_scan_reconciliation(root_id)
            .expect("begin stale scan");

        // Supersede the task attempt mid-scan: cancel + retry bumps the
        // attempt generation, so the in-flight scan is now stale.
        database.cancel_task(task_id).expect("cancel task");
        database.retry_task(task_id).expect("retry task");

        // The guarded reconciliation must report not-current and must NOT
        // clear `active_scan_generation` or mark seed rows missing.
        let reconciled = database
            .reconcile_root_scan_completion_for_task_attempt(
                root_id,
                stale_generation,
                task_id,
                old_attempt,
            )
            .expect("guarded reconciliation should not error on stale attempt");
        assert!(
            !reconciled,
            "stale attempt must not reconcile after supersede"
        );

        // active_scan_generation must still be the stale generation; the
        // stale attempt did not clear it.
        let active_generation: Option<i64> = database
            .connection
            .query_row(
                "SELECT active_scan_generation FROM roots WHERE id = ?1",
                [root_id],
                |row| row.get(0),
            )
            .expect("read active scan generation");
        assert_eq!(active_generation, Some(stale_generation));

        // Seed file must remain active (not marked missing by stale
        // reconciliation against a generation that never wrote rows).
        let keep_status: String = database
            .connection
            .query_row(
                "SELECT status FROM files WHERE name = 'keep.jpg' AND root_id = ?1",
                [root_id],
                |row| row.get(0),
            )
            .expect("read keep.jpg status");
        assert_eq!(keep_status, "active");

        // The retried (current) attempt is still able to perform guarded
        // reconciliation under its own generation.
        let new_attempt = database
            .get_task(task_id)
            .expect("get task")
            .expect("task exists")
            .attempt_generation;
        assert!(new_attempt > old_attempt);
        database
            .mark_task_running_for_attempt(task_id, new_attempt)
            .expect("mark new attempt running");
        let new_generation = database
            .begin_root_scan_reconciliation(root_id)
            .expect("begin new attempt reconciliation");
        assert!(new_generation >= stale_generation);
        let reconciled_now = database
            .reconcile_root_scan_completion_for_task_attempt(
                root_id,
                new_generation,
                task_id,
                new_attempt,
            )
            .expect("current attempt reconciliation");
        assert!(reconciled_now);
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
                scan_generation: None,
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
    fn commit_scan_batch_rejects_disabled_root_inside_write_transaction() {
        let mut database = migrated_database();
        let root_id = database
            .add_root(NewRoot {
                path: "D:/Pictures".to_string(),
                display_name: "Pictures".to_string(),
            })
            .expect("add root");
        database.disable_root(root_id).expect("disable root");

        let error = database
            .commit_scan_batch(ScanWriteBatch {
                folders: vec![FolderUpsert {
                    root_id,
                    parent_id: None,
                    name: String::new(),
                    path_hash: "root-hash".to_string(),
                    mtime: Some(10),
                }],
                files: Vec::new(),
                scan_generation: None,
            })
            .expect_err("disabled root should reject scan batch");
        assert!(error.to_string().contains("disabled"));

        let folder_count: i64 = database
            .connection
            .query_row(
                "SELECT COUNT(*) FROM folders WHERE root_id = ?1",
                [root_id],
                |row| row.get(0),
            )
            .expect("count folders");
        assert_eq!(folder_count, 0);
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
            .mark_task_running_current_attempt_for_test(first_task_id)
            .expect("mark task running");
        let task = database
            .get_task(first_task_id)
            .expect("get task")
            .expect("task exists");
        assert_eq!(task.status, "running");
        assert_eq!(task.error, None);

        database
            .mark_task_succeeded_current_attempt_for_test(first_task_id)
            .expect("mark task succeeded");
        let task = database
            .get_task(first_task_id)
            .expect("get task")
            .expect("task exists");
        assert_eq!(task.status, "succeeded");
        assert_eq!(task.error, None);

        database
            .mark_task_failed_current_attempt_for_test(second_task_id, "scan failed")
            .expect("mark task failed");
        let task = database
            .get_task(second_task_id)
            .expect("get task")
            .expect("task exists");
        assert_eq!(task.status, "failed");
        assert_eq!(task.error.as_deref(), Some("scan failed"));
    }

    #[test]
    fn thumbnail_request_coalesces_task_and_records_state_transition() {
        let database = migrated_database();
        let (root_id, folder_id) = seed_media_page_fixture(&database);
        let file_id = database
            .upsert_file(FileUpsert {
                root_id,
                folder_id,
                name: "coalesce.jpg".to_string(),
                ext: ".jpg".to_string(),
                size: 4096,
                mtime: 123,
                ctime: None,
                file_key: Some("identity-1".to_string()),
            })
            .expect("insert file");
        database
            .upsert_media_kind(file_id, "image")
            .expect("insert media");

        let first = database
            .request_thumbnail_task(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("request thumbnail");
        let second = database
            .request_thumbnail_task(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("request thumbnail again");

        assert_eq!(first.thumbnail.state, "queued");
        assert_eq!(second.thumbnail.state, "queued");
        let task_id = first.task_id.expect("first request task id");
        assert_eq!(Some(task_id), second.task_id);
        assert!(first.queued);
        assert!(!second.queued);

        let tasks = database.list_tasks().expect("list tasks");
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, task_id);
        assert_eq!(tasks[0].kind, "thumbnail");
        assert_eq!(tasks[0].status, "pending");
        assert_eq!(tasks[0].root_id, None);
        assert_eq!(tasks[0].file_id, Some(file_id));

        let pending = database
            .list_pending_thumbnail_task_ids()
            .expect("list thumbnail tasks");
        assert_eq!(pending, vec![task_id]);

        database
            .mark_task_running_current_attempt_for_test(task_id)
            .expect("mark thumbnail running");
        let running_request = database
            .request_thumbnail_task(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("request while running");
        assert_eq!(running_request.task_id, Some(task_id));
        assert!(!running_request.queued);
        assert_eq!(database.list_tasks().expect("list tasks").len(), 1);

        let source_fingerprint = database
            .get_thumbnail_source(file_id)
            .expect("get thumbnail source")
            .expect("thumbnail source exists")
            .source_fingerprint(crate::thumbnails::GRID_320_PROFILE);
        database
            .upsert_thumbnail_state(ThumbnailStateUpsert {
                file_id,
                profile: crate::thumbnails::GRID_320_PROFILE.to_string(),
                state: "ready".to_string(),
                cache_key: Some("aa/bb/coalesce.webp".to_string()),
                width: Some(427),
                height: Some(320),
                byte_size: Some(64),
                error: None,
                source_fingerprint: Some(source_fingerprint),
            })
            .expect("mark thumbnail ready");
        database
            .mark_task_succeeded_current_attempt_for_test(task_id)
            .expect("mark task succeeded");

        let ready = database
            .request_thumbnail_task(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("request ready thumbnail");
        assert_eq!(ready.thumbnail.state, "ready");
        assert_eq!(ready.task_id, Some(task_id));
        assert!(!ready.queued);
        assert_eq!(database.list_tasks().expect("list tasks").len(), 1);
    }

    #[test]
    fn thumbnail_request_invalidates_ready_state_when_source_identity_changes() {
        let database = migrated_database();
        let (root_id, folder_id) = seed_media_page_fixture(&database);
        let file_id = database
            .upsert_file(FileUpsert {
                root_id,
                folder_id,
                name: "identity.jpg".to_string(),
                ext: ".jpg".to_string(),
                size: 100,
                mtime: 10,
                ctime: None,
                file_key: Some("identity-a".to_string()),
            })
            .expect("insert file");
        database
            .upsert_media_kind(file_id, "image")
            .expect("insert media");
        let first = database
            .request_thumbnail_task(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("request thumbnail");
        let first_task_id = first.task_id.expect("task id");
        database
            .mark_task_running_current_attempt_for_test(first_task_id)
            .expect("mark running");
        database
            .upsert_thumbnail_state(ThumbnailStateUpsert {
                file_id,
                profile: crate::thumbnails::GRID_320_PROFILE.to_string(),
                state: "ready".to_string(),
                cache_key: Some("aa/bb/stale.webp".to_string()),
                width: Some(320),
                height: Some(320),
                byte_size: Some(64),
                error: None,
                source_fingerprint: Some(
                    "stale-source-fingerprint-that-must-not-match".to_string(),
                ),
            })
            .expect("mark stale ready");
        database
            .mark_task_succeeded_current_attempt_for_test(first_task_id)
            .expect("mark succeeded");

        let request = database
            .request_thumbnail_task(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("request after source change");

        assert_eq!(request.thumbnail.state, "queued");
        assert!(request.queued);
        assert_ne!(request.task_id, Some(first_task_id));
        assert!(request.thumbnail.cache_key.is_none());
    }

    #[test]
    fn failed_thumbnail_without_source_fingerprint_is_regeneratable() {
        let database = migrated_database();
        let (root_id, folder_id) = seed_media_page_fixture(&database);
        let file_id = database
            .upsert_file(FileUpsert {
                root_id,
                folder_id,
                name: "failed-null.jpg".to_string(),
                ext: ".jpg".to_string(),
                size: 100,
                mtime: 10,
                ctime: None,
                file_key: Some("identity-a".to_string()),
            })
            .expect("insert file");
        database
            .upsert_media_kind(file_id, "image")
            .expect("insert media");
        database
            .upsert_thumbnail_state(ThumbnailStateUpsert {
                file_id,
                profile: crate::thumbnails::GRID_320_PROFILE.to_string(),
                state: "failed".to_string(),
                cache_key: None,
                width: None,
                height: None,
                byte_size: None,
                error: Some("decode failed".to_string()),
                source_fingerprint: None,
            })
            .expect("insert failed thumbnail without fingerprint");

        let thumbnail = database
            .get_thumbnail(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("get thumbnail")
            .expect("thumbnail exists");
        assert_eq!(thumbnail.state, "pending");
        assert_eq!(thumbnail.error, None);

        let request = database
            .request_thumbnail_task(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("request thumbnail");
        assert_eq!(request.thumbnail.state, "queued");
        assert!(request.queued);
    }

    #[test]
    fn failed_thumbnail_with_stale_source_fingerprint_is_regeneratable() {
        let database = migrated_database();
        let (root_id, folder_id) = seed_media_page_fixture(&database);
        let file_id = database
            .upsert_file(FileUpsert {
                root_id,
                folder_id,
                name: "failed-stale.jpg".to_string(),
                ext: ".jpg".to_string(),
                size: 100,
                mtime: 10,
                ctime: None,
                file_key: Some("identity-a".to_string()),
            })
            .expect("insert file");
        database
            .upsert_media_kind(file_id, "image")
            .expect("insert media");
        database
            .upsert_thumbnail_state(ThumbnailStateUpsert {
                file_id,
                profile: crate::thumbnails::GRID_320_PROFILE.to_string(),
                state: "failed".to_string(),
                cache_key: None,
                width: None,
                height: None,
                byte_size: None,
                error: Some("decode failed".to_string()),
                source_fingerprint: Some(
                    "stale-source-fingerprint-that-must-not-match".to_string(),
                ),
            })
            .expect("insert stale failed thumbnail");

        let thumbnail = database
            .get_thumbnail(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("get thumbnail")
            .expect("thumbnail exists");
        assert_eq!(thumbnail.state, "pending");
        assert_eq!(thumbnail.error, None);

        let request = database
            .request_thumbnail_task(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("request thumbnail");
        assert_eq!(request.thumbnail.state, "queued");
        assert!(request.queued);
    }

    #[test]
    fn failed_thumbnail_with_current_source_fingerprint_remains_terminal() {
        let database = migrated_database();
        let (root_id, folder_id) = seed_media_page_fixture(&database);
        let file_id = database
            .upsert_file(FileUpsert {
                root_id,
                folder_id,
                name: "failed-current.jpg".to_string(),
                ext: ".jpg".to_string(),
                size: 100,
                mtime: 10,
                ctime: None,
                file_key: Some("identity-a".to_string()),
            })
            .expect("insert file");
        database
            .upsert_media_kind(file_id, "image")
            .expect("insert media");
        let source_fingerprint = database
            .get_thumbnail_source(file_id)
            .expect("get thumbnail source")
            .expect("thumbnail source exists")
            .source_fingerprint(crate::thumbnails::GRID_320_PROFILE);
        database
            .upsert_thumbnail_state(ThumbnailStateUpsert {
                file_id,
                profile: crate::thumbnails::GRID_320_PROFILE.to_string(),
                state: "failed".to_string(),
                cache_key: None,
                width: None,
                height: None,
                byte_size: None,
                error: Some("decode failed".to_string()),
                source_fingerprint: Some(source_fingerprint),
            })
            .expect("insert current failed thumbnail");

        let request = database
            .request_thumbnail_task(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("request failed thumbnail");
        assert_eq!(request.thumbnail.state, "failed");
        assert_eq!(request.thumbnail.error.as_deref(), Some("decode failed"));
        assert!(!request.queued);
    }

    #[test]
    fn file_upsert_marks_non_pending_thumbnail_stale_when_source_identity_changes() {
        let database = migrated_database();
        let (root_id, folder_id) = seed_media_page_fixture(&database);
        let file_id = database
            .upsert_file(FileUpsert {
                root_id,
                folder_id,
                name: "source-change.jpg".to_string(),
                ext: ".jpg".to_string(),
                size: 100,
                mtime: 10,
                ctime: None,
                file_key: Some("source-a".to_string()),
            })
            .expect("insert file");
        database
            .upsert_media_kind(file_id, "image")
            .expect("insert media");
        let source_fingerprint = database
            .get_thumbnail_source(file_id)
            .expect("get source")
            .expect("source exists")
            .source_fingerprint(crate::thumbnails::GRID_320_PROFILE);
        database
            .upsert_thumbnail_state(ThumbnailStateUpsert {
                file_id,
                profile: crate::thumbnails::GRID_320_PROFILE.to_string(),
                state: "ready".to_string(),
                cache_key: Some("aa/bb/source-change.webp".to_string()),
                width: Some(320),
                height: Some(320),
                byte_size: Some(64),
                error: None,
                source_fingerprint: Some(source_fingerprint),
            })
            .expect("mark ready");

        database
            .upsert_file(FileUpsert {
                root_id,
                folder_id,
                name: "source-change.jpg".to_string(),
                ext: ".jpg".to_string(),
                size: 200,
                mtime: 20,
                ctime: None,
                file_key: Some("source-b".to_string()),
            })
            .expect("update source identity");

        let thumbnail = database
            .get_thumbnail(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("get thumbnail")
            .expect("thumbnail exists");
        assert_eq!(thumbnail.state, "pending");
        assert_eq!(thumbnail.cache_key, None);
        assert_eq!(thumbnail.source_fingerprint, None);
    }

    #[test]
    fn thumbnail_request_invalidates_skipped_small_state_when_source_identity_changes() {
        let database = migrated_database();
        let (root_id, folder_id) = seed_media_page_fixture(&database);
        let file_id = database
            .upsert_file(FileUpsert {
                root_id,
                folder_id,
                name: "small-then-large.jpg".to_string(),
                ext: ".jpg".to_string(),
                size: 100,
                mtime: 10,
                ctime: None,
                file_key: Some("small-a".to_string()),
            })
            .expect("insert file");
        database
            .upsert_media_kind(file_id, "image")
            .expect("insert media");
        database
            .connection
            .execute(
                "UPDATE media SET width = 128, height = 128, metadata_status = 'ready' WHERE file_id = ?1",
                [file_id],
            )
            .expect("set ready small metadata");
        let source_fingerprint = database
            .get_thumbnail_source(file_id)
            .expect("get thumbnail source")
            .expect("thumbnail source exists")
            .source_fingerprint(crate::thumbnails::GRID_320_PROFILE);
        database
            .upsert_thumbnail_state(ThumbnailStateUpsert {
                file_id,
                profile: crate::thumbnails::GRID_320_PROFILE.to_string(),
                state: "skipped_small".to_string(),
                cache_key: None,
                width: None,
                height: None,
                byte_size: None,
                error: None,
                source_fingerprint: Some(source_fingerprint),
            })
            .expect("worker marks skipped small");

        database
            .upsert_file(FileUpsert {
                root_id,
                folder_id,
                name: "small-then-large.jpg".to_string(),
                ext: ".jpg".to_string(),
                size: 10_000,
                mtime: 20,
                ctime: None,
                file_key: Some("small-b".to_string()),
            })
            .expect("update source identity");
        database
            .connection
            .execute(
                "UPDATE media SET width = 640, height = 480, metadata_status = 'ready' WHERE file_id = ?1",
                [file_id],
            )
            .expect("set ready large metadata");
        let request = database
            .request_thumbnail_task(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("request changed source thumbnail");

        assert_eq!(request.thumbnail.state, "queued");
        assert!(request.queued);
    }

    #[test]
    fn thumbnail_request_does_not_regress_ready_state_when_worker_wins_race() {
        let database = migrated_database();
        let (root_id, folder_id) = seed_media_page_fixture(&database);
        let file_id = database
            .upsert_file(FileUpsert {
                root_id,
                folder_id,
                name: "race.jpg".to_string(),
                ext: ".jpg".to_string(),
                size: 100,
                mtime: 10,
                ctime: None,
                file_key: Some("race-a".to_string()),
            })
            .expect("insert file");
        database
            .upsert_media_kind(file_id, "image")
            .expect("insert media");

        let first = database
            .request_thumbnail_task(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("request thumbnail");
        let task_id = first.task_id.expect("task id");
        database
            .mark_task_running_current_attempt_for_test(task_id)
            .expect("mark running");
        let fingerprint = database
            .get_thumbnail_source(file_id)
            .expect("get source")
            .expect("source exists")
            .source_fingerprint(crate::thumbnails::GRID_320_PROFILE);
        database
            .upsert_thumbnail_state(ThumbnailStateUpsert {
                file_id,
                profile: crate::thumbnails::GRID_320_PROFILE.to_string(),
                state: "ready".to_string(),
                cache_key: Some("aa/bb/race.webp".to_string()),
                width: Some(320),
                height: Some(320),
                byte_size: Some(64),
                error: None,
                source_fingerprint: Some(fingerprint),
            })
            .expect("worker marks ready");

        let second = database
            .request_thumbnail_task(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("request after ready");

        assert_eq!(second.thumbnail.state, "ready");
        assert!(!second.queued);
        assert_eq!(database.list_tasks().expect("list tasks").len(), 1);
    }

    #[test]
    fn skipped_small_requires_ready_metadata_and_upsert_media_resets_dimensions() {
        let database = migrated_database();
        let (root_id, folder_id) = seed_media_page_fixture(&database);
        let file_id = database
            .upsert_file(FileUpsert {
                root_id,
                folder_id,
                name: "metadata.jpg".to_string(),
                ext: ".jpg".to_string(),
                size: 100,
                mtime: 10,
                ctime: None,
                file_key: None,
            })
            .expect("insert file");
        database
            .connection
            .execute(
                r#"
                INSERT INTO media(file_id, kind, width, height, metadata_status)
                VALUES (?1, 'image', 128, 128, 'ready')
                "#,
                [file_id],
            )
            .expect("insert stale metadata");
        database
            .upsert_media_kind(file_id, "image")
            .expect("scan upsert media kind");

        let media = database
            .get_thumbnail_source(file_id)
            .expect("get source")
            .expect("source exists");
        assert_eq!(media.width, None);
        assert_eq!(media.height, None);
        assert_ne!(media.metadata_status.as_deref(), Some("ready"));

        let request = database
            .request_thumbnail_task(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("request thumbnail");
        assert_eq!(request.thumbnail.state, "queued");
        assert!(request.queued);
    }

    #[test]
    fn skipped_small_request_queues_worker_instead_of_publishing_terminal_inline() {
        let database = migrated_database();
        let (root_id, folder_id) = seed_media_page_fixture(&database);
        let file_id = database
            .upsert_file(FileUpsert {
                root_id,
                folder_id,
                name: "small-queued.jpg".to_string(),
                ext: ".jpg".to_string(),
                size: 100,
                mtime: 10,
                ctime: None,
                file_key: Some("small-queued".to_string()),
            })
            .expect("insert file");
        database
            .upsert_media_kind(file_id, "image")
            .expect("insert media");
        database
            .connection
            .execute(
                "UPDATE media SET width = 128, height = 128, metadata_status = 'ready' WHERE file_id = ?1",
                [file_id],
            )
            .expect("set small ready metadata");

        let request = database
            .request_thumbnail_task(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("request small thumbnail");

        assert_eq!(request.thumbnail.state, "queued");
        assert!(request.queued);
        let task_id = request.task_id.expect("queued task id");
        let task = database
            .get_task(task_id)
            .expect("get task")
            .expect("task exists");
        assert_eq!(task.kind, "thumbnail");
        assert_eq!(task.status, "pending");
        assert_eq!(task.file_id, Some(file_id));
    }

    #[test]
    fn skipped_small_is_requeued_after_metadata_reset_even_when_file_identity_matches() {
        let database = migrated_database();
        let (root_id, folder_id) = seed_media_page_fixture(&database);
        let file_id = database
            .upsert_file(FileUpsert {
                root_id,
                folder_id,
                name: "same-source-metadata-reset.jpg".to_string(),
                ext: ".jpg".to_string(),
                size: 100,
                mtime: 10,
                ctime: None,
                file_key: Some("same-source".to_string()),
            })
            .expect("insert file");
        database
            .upsert_media_kind(file_id, "image")
            .expect("insert media");
        database
            .connection
            .execute(
                "UPDATE media SET width = 128, height = 128, metadata_status = 'ready' WHERE file_id = ?1",
                [file_id],
            )
            .expect("set ready small metadata");

        let source_fingerprint = database
            .get_thumbnail_source(file_id)
            .expect("get thumbnail source")
            .expect("thumbnail source exists")
            .source_fingerprint(crate::thumbnails::GRID_320_PROFILE);
        database
            .upsert_thumbnail_state(ThumbnailStateUpsert {
                file_id,
                profile: crate::thumbnails::GRID_320_PROFILE.to_string(),
                state: "skipped_small".to_string(),
                cache_key: None,
                width: None,
                height: None,
                byte_size: None,
                error: None,
                source_fingerprint: Some(source_fingerprint),
            })
            .expect("worker marks skipped small");

        database
            .upsert_media_kind(file_id, "image")
            .expect("scan resets media metadata");
        let thumbnail = database
            .get_thumbnail(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("get thumbnail")
            .expect("thumbnail exists");
        assert_eq!(thumbnail.state, "pending");

        let request = database
            .request_thumbnail_task(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("request thumbnail after metadata reset");
        assert_eq!(request.thumbnail.state, "queued");
        assert!(request.queued);
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

        database
            .mark_task_running_current_attempt_for_test(task_id)
            .expect("mark running");
        database
            .update_task_scan_progress_current_attempt_for_test(
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
            .mark_task_succeeded_current_attempt_for_test(task_id)
            .expect("mark succeeded");
        let late_update = database.update_task_scan_progress_current_attempt_for_test(
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
            .mark_task_running_current_attempt_for_test(task_id + 100)
            .expect_err("missing task should fail");
        assert!(missing_error.to_string().contains("task not found"));

        database
            .mark_task_running_current_attempt_for_test(task_id)
            .expect("mark task running");
        database
            .mark_task_succeeded_current_attempt_for_test(task_id)
            .expect("mark task succeeded");
        let rerun_error = database
            .mark_task_running_current_attempt_for_test(task_id)
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
            .mark_task_running_current_attempt_for_test(succeeded_task_id)
            .expect("mark succeeded task running");
        database
            .mark_task_succeeded_current_attempt_for_test(succeeded_task_id)
            .expect("mark task succeeded");
        let succeeded_error = database
            .mark_task_failed_current_attempt_for_test(succeeded_task_id, "late failure")
            .expect_err("succeeded task should not be marked failed");
        assert!(succeeded_error
            .to_string()
            .contains("not pending or running"));

        database
            .mark_task_failed_current_attempt_for_test(failed_task_id, "first failure")
            .expect("mark task failed");
        let failed_error = database
            .mark_task_failed_current_attempt_for_test(failed_task_id, "second failure")
            .expect_err("failed task should not be marked failed again");
        assert!(failed_error.to_string().contains("not pending or running"));
    }

    #[test]
    fn cancel_pending_task_marks_cancelled_and_retry_resets_it_to_pending() {
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

        let cancelled = database.cancel_task(task_id).expect("cancel task");
        assert_eq!(cancelled.status, "cancelled");
        assert_eq!(cancelled.error.as_deref(), Some("cancelled"));

        let retried = database.retry_task(task_id).expect("retry cancelled task");
        assert_eq!(retried.id, task_id);
        assert_eq!(retried.status, "pending");
        assert_eq!(retried.error, None);
        assert_eq!(retried.items_seen, 0);
    }

    #[test]
    fn retry_and_cancel_reject_missing_and_finished_tasks() {
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

        let missing_cancel = database
            .cancel_task(task_id + 100)
            .expect_err("missing cancel should fail");
        assert!(missing_cancel.to_string().contains("task not found"));
        let missing_retry = database
            .retry_task(task_id + 100)
            .expect_err("missing retry should fail");
        assert!(missing_retry.to_string().contains("task not found"));

        database
            .mark_task_running_current_attempt_for_test(task_id)
            .expect("mark running");
        database
            .mark_task_succeeded_current_attempt_for_test(task_id)
            .expect("mark succeeded");

        let cancel_succeeded = database
            .cancel_task(task_id)
            .expect_err("succeeded task should reject cancel");
        assert!(cancel_succeeded.to_string().contains("not cancellable"));
        let retry_succeeded = database
            .retry_task(task_id)
            .expect_err("succeeded task should reject retry");
        assert!(retry_succeeded.to_string().contains("not retryable"));

        let task = database
            .get_task(task_id)
            .expect("get task")
            .expect("task exists");
        assert_eq!(task.status, "succeeded");
    }

    #[test]
    fn retry_thumbnail_task_uses_current_source_without_stale_attempt_fingerprint() {
        let database = migrated_database();
        let (root_id, folder_id) = seed_media_page_fixture(&database);
        let file_id = database
            .upsert_file(FileUpsert {
                root_id,
                folder_id,
                name: "retry-source.jpg".to_string(),
                ext: ".jpg".to_string(),
                size: 100,
                mtime: 10,
                ctime: None,
                file_key: Some("retry-source-a".to_string()),
            })
            .expect("insert retry source");
        database
            .upsert_media_kind(file_id, "image")
            .expect("insert media kind");
        let request = database
            .request_thumbnail_task(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("request thumbnail");
        let task_id = request.task_id.expect("thumbnail task id");
        database
            .mark_thumbnail_task_running_current_attempt_for_test(task_id, "stale-attempt")
            .expect("mark thumbnail running");
        database
            .mark_task_failed_current_attempt_for_test(task_id, "decode failed")
            .expect("mark thumbnail failed");

        database
            .upsert_file(FileUpsert {
                root_id,
                folder_id,
                name: "retry-source.jpg".to_string(),
                ext: ".jpg".to_string(),
                size: 200,
                mtime: 20,
                ctime: None,
                file_key: Some("retry-source-b".to_string()),
            })
            .expect("change retry source identity");
        let current_fingerprint = database
            .get_thumbnail_source(file_id)
            .expect("get current source")
            .expect("current source exists")
            .source_fingerprint(crate::thumbnails::GRID_320_PROFILE);

        let retried = database.retry_task(task_id).expect("retry thumbnail task");
        assert_eq!(retried.status, "pending");
        assert_eq!(retried.thumbnail_source_fingerprint, None);

        let thumbnail = database
            .get_thumbnail(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("get thumbnail")
            .expect("thumbnail exists");
        assert_eq!(thumbnail.state, "queued");
        assert_eq!(
            thumbnail.source_fingerprint.as_deref(),
            Some(current_fingerprint.as_str())
        );
    }

    #[test]
    fn old_root_scan_attempt_cannot_publish_after_cancelled_task_is_retried() {
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
        let old_attempt = database
            .get_task(task_id)
            .expect("get task")
            .expect("task exists")
            .attempt_generation;

        database
            .mark_task_running_for_attempt(task_id, old_attempt)
            .expect("mark old attempt running");
        database.cancel_task(task_id).expect("cancel task");
        let retried = database.retry_task(task_id).expect("retry task");
        assert_eq!(retried.status, "pending");
        assert!(retried.attempt_generation > old_attempt);

        let stale_publish = database
            .mark_task_succeeded_for_attempt(task_id, old_attempt)
            .expect_err("old attempt must not publish success");
        assert!(stale_publish.to_string().contains("attempt"));

        let task = database
            .get_task(task_id)
            .expect("get task")
            .expect("task exists");
        assert_eq!(task.status, "pending");
        assert_eq!(task.attempt_generation, retried.attempt_generation);
    }

    #[test]
    fn stale_root_scan_attempt_cannot_commit_batch_or_mark_root_scanned_after_retry() {
        let mut database = migrated_database();
        let root_id = database
            .add_root(NewRoot {
                path: "D:/Pictures".to_string(),
                display_name: "Pictures".to_string(),
            })
            .expect("add root");
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
            .expect("mark old attempt running");
        database.cancel_task(task_id).expect("cancel task");
        database.retry_task(task_id).expect("retry task");

        let batch_error = database
            .commit_scan_batch_for_task_attempt(
                ScanWriteBatch {
                    folders: vec![FolderUpsert {
                        root_id,
                        parent_id: None,
                        name: String::new(),
                        path_hash: "stale-root".to_string(),
                        mtime: Some(1),
                    }],
                    files: Vec::new(),
                    scan_generation: None,
                },
                task_id,
                old_attempt,
            )
            .expect_err("stale attempt must not commit batch");
        assert!(batch_error.to_string().contains("attempt"));

        let root = database.get_root(root_id).expect("get root").expect("root");
        assert_eq!(root.root_folder_id, None);

        let scanned_error = database
            .mark_root_scanned_for_task_attempt(root_id, task_id, old_attempt)
            .expect_err("stale attempt must not mark root scanned");
        assert!(scanned_error.to_string().contains("attempt"));
        let root = database.get_root(root_id).expect("get root").expect("root");
        assert_eq!(root.last_scan_at, None);
    }

    #[test]
    fn stale_thumbnail_attempt_cannot_publish_current_source_after_retry() {
        let database = migrated_database();
        let (root_id, folder_id) = seed_media_page_fixture(&database);
        let file_id = database
            .upsert_file(FileUpsert {
                root_id,
                folder_id,
                name: "stale-thumbnail-publish.jpg".to_string(),
                ext: ".jpg".to_string(),
                size: 100,
                mtime: 10,
                ctime: None,
                file_key: Some("same-source".to_string()),
            })
            .expect("insert file");
        database
            .upsert_media_kind(file_id, "image")
            .expect("insert media");
        let source_fingerprint = database
            .get_thumbnail_source(file_id)
            .expect("get source")
            .expect("source exists")
            .source_fingerprint(crate::thumbnails::GRID_320_PROFILE);
        let request = database
            .request_thumbnail_task(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("request thumbnail");
        let task_id = request.task_id.expect("task id");
        let old_attempt = database
            .get_task(task_id)
            .expect("get task")
            .expect("task exists")
            .attempt_generation;
        database
            .mark_thumbnail_task_running_for_attempt(task_id, old_attempt, &source_fingerprint)
            .expect("mark old thumbnail running");
        database.cancel_task(task_id).expect("cancel task");
        database.retry_task(task_id).expect("retry task");

        let published = database
            .upsert_thumbnail_state_if_source_fingerprint_and_task_attempt_current(
                ThumbnailStateUpsert {
                    file_id,
                    profile: crate::thumbnails::GRID_320_PROFILE.to_string(),
                    state: "ready".to_string(),
                    cache_key: Some("aa/bb/stale.webp".to_string()),
                    width: Some(320),
                    height: Some(320),
                    byte_size: Some(64),
                    error: None,
                    source_fingerprint: Some(source_fingerprint.clone()),
                },
                &source_fingerprint,
                task_id,
                old_attempt,
            )
            .expect("guard stale publish");
        assert!(!published);

        let thumbnail = database
            .get_thumbnail(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("get thumbnail")
            .expect("thumbnail exists");
        assert_eq!(thumbnail.state, "queued");
        assert_eq!(thumbnail.cache_key, None);
    }

    #[test]
    fn stale_thumbnail_attempt_cannot_publish_failure_after_retry() {
        let database = migrated_database();
        let (root_id, folder_id) = seed_media_page_fixture(&database);
        let file_id = database
            .upsert_file(FileUpsert {
                root_id,
                folder_id,
                name: "stale-failure-publish.jpg".to_string(),
                ext: ".jpg".to_string(),
                size: 100,
                mtime: 10,
                ctime: None,
                file_key: Some("failure-source".to_string()),
            })
            .expect("insert file");
        database
            .upsert_media_kind(file_id, "image")
            .expect("insert media");
        let source_fingerprint = database
            .get_thumbnail_source(file_id)
            .expect("get source")
            .expect("source exists")
            .source_fingerprint(crate::thumbnails::GRID_320_PROFILE);
        let request = database
            .request_thumbnail_task(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("request thumbnail");
        let task_id = request.task_id.expect("task id");
        let old_attempt = database
            .get_task(task_id)
            .expect("get task")
            .expect("task exists")
            .attempt_generation;
        database
            .mark_thumbnail_task_running_for_attempt(task_id, old_attempt, &source_fingerprint)
            .expect("mark old thumbnail running");
        assert!(database
            .task_attempt_is_current(task_id, old_attempt)
            .expect("old attempt current before retry"));
        database.cancel_task(task_id).expect("cancel task");
        database.retry_task(task_id).expect("retry task");

        let published = database
            .publish_thumbnail_failure_for_attempted_source_for_task_attempt(
                file_id,
                crate::thumbnails::GRID_320_PROFILE,
                Some(source_fingerprint.as_str()),
                "late decode failure",
                task_id,
                old_attempt,
            )
            .expect("guard stale failure publish");
        assert!(!published);

        let thumbnail = database
            .get_thumbnail(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("get thumbnail")
            .expect("thumbnail exists");
        assert_eq!(thumbnail.state, "queued");
        assert_eq!(thumbnail.error, None);
        assert_eq!(thumbnail.cache_key, None);
    }

    #[test]
    fn stale_thumbnail_attempt_cannot_reset_after_retry() {
        let database = migrated_database();
        let (root_id, folder_id) = seed_media_page_fixture(&database);
        let file_id = database
            .upsert_file(FileUpsert {
                root_id,
                folder_id,
                name: "stale-reset.jpg".to_string(),
                ext: ".jpg".to_string(),
                size: 100,
                mtime: 10,
                ctime: None,
                file_key: Some("reset-source".to_string()),
            })
            .expect("insert file");
        database
            .upsert_media_kind(file_id, "image")
            .expect("insert media");
        let request = database
            .request_thumbnail_task(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("request thumbnail");
        let task_id = request.task_id.expect("task id");
        let old_attempt = database
            .get_task(task_id)
            .expect("get task")
            .expect("task exists")
            .attempt_generation;
        database
            .mark_thumbnail_task_running_for_attempt(task_id, old_attempt, "old-source")
            .expect("mark old thumbnail running");
        assert!(database
            .task_attempt_is_current(task_id, old_attempt)
            .expect("old attempt current before retry"));
        database.cancel_task(task_id).expect("cancel task");
        database.retry_task(task_id).expect("retry task");

        let reset = database
            .reset_thumbnail_after_stale_source_for_task_attempt(
                file_id,
                crate::thumbnails::GRID_320_PROFILE,
                "late stale source",
                task_id,
                old_attempt,
            )
            .expect("guard stale reset");
        assert!(!reset);

        let thumbnail = database
            .get_thumbnail(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("get thumbnail")
            .expect("thumbnail exists");
        assert_eq!(thumbnail.state, "queued");
        assert_eq!(thumbnail.error, None);
        assert_ne!(thumbnail.source_fingerprint, None);
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
            .mark_task_running_current_attempt_for_test(stale_running)
            .expect("mark stale running");
        database
            .connection
            .execute(
                "UPDATE tasks SET error = 'interrupted' WHERE id = ?1",
                [stale_running],
            )
            .expect("set stale running error");
        database
            .mark_task_failed_current_attempt_for_test(failed, "scan failed")
            .expect("mark failed");
        database
            .mark_task_running_current_attempt_for_test(succeeded)
            .expect("mark succeeded running");
        database
            .mark_task_succeeded_current_attempt_for_test(succeeded)
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
