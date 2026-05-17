//! File operations: rename, move, delete (recycle / permanent).
//!
//! Each public entry point performs:
//!   1. Source/target resolution from the database.
//!   2. Input validation (illegal name, path separator, traversal,
//!      Windows-reserved names, length).
//!   3. Conflict checks against the database and the filesystem.
//!   4. A `BEGIN IMMEDIATE` transaction that performs the FS mutation and
//!      DB updates as a single unit; FS errors roll back DB changes and
//!      record a `failed` row in `file_operations`.
//!   5. FTS sync for any affected files so search reflects renames.
//!
//! The contract surfaces operation kinds `rename`, `move`,
//! `delete_recycle`, `delete_permanent` — see
//! `contracts/core-api/openapi.yaml`.

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, OptionalExtension, Transaction, TransactionBehavior};
use serde::Serialize;

use crate::db::{Database, Page};

/// Discriminants for `file_operations.operation`.
#[allow(dead_code)]
pub const FILE_OPERATION_VALUES: &[&str] =
    &["rename", "move", "delete_recycle", "delete_permanent"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileOperationKind {
    Rename,
    Move,
    DeleteRecycle,
    DeletePermanent,
}

impl FileOperationKind {
    pub fn as_str(self) -> &'static str {
        match self {
            FileOperationKind::Rename => "rename",
            FileOperationKind::Move => "move",
            FileOperationKind::DeleteRecycle => "delete_recycle",
            FileOperationKind::DeletePermanent => "delete_permanent",
        }
    }
}

/// One persisted entry in `file_operations`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileOperationRecord {
    pub id: i64,
    pub operation: String,
    pub source_path: String,
    pub target_path: Option<String>,
    pub status: String,
    pub created_at: i64,
    pub finished_at: Option<i64>,
    pub error: Option<String>,
}

/// Stable error codes that the API surfaces in JSON bodies.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FsOpsErrorCode {
    InvalidName,
    InvalidRequest,
    NotFound,
    NameConflict,
    CrossVolume,
    FsError,
    OutsideRoot,
}

impl FsOpsErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            FsOpsErrorCode::InvalidName => "invalid_name",
            FsOpsErrorCode::InvalidRequest => "invalid_request",
            FsOpsErrorCode::NotFound => "not_found",
            FsOpsErrorCode::NameConflict => "name_conflict",
            FsOpsErrorCode::CrossVolume => "cross_volume",
            FsOpsErrorCode::FsError => "fs_error",
            FsOpsErrorCode::OutsideRoot => "outside_root",
        }
    }
}

#[derive(Debug)]
pub struct FsOpsError {
    pub code: FsOpsErrorCode,
    pub message: String,
}

impl FsOpsError {
    fn new(code: FsOpsErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl std::fmt::Display for FsOpsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code.as_str(), self.message)
    }
}

impl std::error::Error for FsOpsError {}

impl From<rusqlite::Error> for FsOpsError {
    fn from(error: rusqlite::Error) -> Self {
        FsOpsError::new(FsOpsErrorCode::FsError, error.to_string())
    }
}

impl From<anyhow::Error> for FsOpsError {
    fn from(error: anyhow::Error) -> Self {
        FsOpsError::new(FsOpsErrorCode::FsError, error.to_string())
    }
}

pub type FsOpsResult<T> = Result<T, FsOpsError>;

#[derive(Debug, Clone)]
pub struct RenameRequest {
    pub file_id: Option<i64>,
    pub folder_id: Option<i64>,
    pub new_name: String,
}

#[derive(Debug, Clone, Default)]
pub struct MoveRequest {
    pub file_ids: Vec<i64>,
    pub folder_ids: Vec<i64>,
    pub target_folder_id: i64,
}

#[derive(Debug, Clone, Default)]
pub struct DeleteRequest {
    pub file_ids: Vec<i64>,
    pub folder_ids: Vec<i64>,
    pub permanent: bool,
}

// -------------- public entry points -------------------------------------

pub fn rename(database: &mut Database, request: RenameRequest) -> FsOpsResult<FileOperationRecord> {
    let new_name = request.new_name.trim().to_string();
    validate_name(&new_name)?;

    match (request.file_id, request.folder_id) {
        (Some(file_id), None) => rename_file(database, file_id, &new_name),
        (None, Some(folder_id)) => rename_folder(database, folder_id, &new_name),
        (Some(_), Some(_)) => Err(FsOpsError::new(
            FsOpsErrorCode::InvalidRequest,
            "exactly one of fileId or folderId must be provided",
        )),
        (None, None) => Err(FsOpsError::new(
            FsOpsErrorCode::InvalidRequest,
            "either fileId or folderId must be provided",
        )),
    }
}

pub fn move_items(
    database: &mut Database,
    request: MoveRequest,
) -> FsOpsResult<Vec<FileOperationRecord>> {
    if request.file_ids.is_empty() && request.folder_ids.is_empty() {
        return Err(FsOpsError::new(
            FsOpsErrorCode::InvalidRequest,
            "at least one fileId or folderId must be provided",
        ));
    }

    let target = load_folder_path(&database.connection_for_fsops(), request.target_folder_id)?
        .ok_or_else(|| {
            FsOpsError::new(
                FsOpsErrorCode::NotFound,
                format!("target folder not found: {}", request.target_folder_id),
            )
        })?;

    let mut records = Vec::new();

    for file_id in &request.file_ids {
        records.push(move_file(database, *file_id, &target)?);
    }
    for folder_id in &request.folder_ids {
        if *folder_id == request.target_folder_id {
            return Err(FsOpsError::new(
                FsOpsErrorCode::InvalidRequest,
                format!("cannot move folder {folder_id} into itself"),
            ));
        }
        records.push(move_folder(database, *folder_id, &target)?);
    }

    Ok(records)
}

pub fn delete(
    database: &mut Database,
    request: DeleteRequest,
) -> FsOpsResult<Vec<FileOperationRecord>> {
    if request.file_ids.is_empty() && request.folder_ids.is_empty() {
        return Err(FsOpsError::new(
            FsOpsErrorCode::InvalidRequest,
            "at least one fileId or folderId must be provided",
        ));
    }

    let mut records = Vec::new();
    for file_id in &request.file_ids {
        records.push(delete_file(database, *file_id, request.permanent)?);
    }
    for folder_id in &request.folder_ids {
        records.push(delete_folder(database, *folder_id, request.permanent)?);
    }

    Ok(records)
}

pub fn list_recent(
    database: &Database,
    limit: i64,
    cursor: Option<&str>,
) -> FsOpsResult<Page<FileOperationRecord>> {
    let limit = limit.clamp(1, 200);
    let cursor_id = match cursor {
        Some(value) => Some(parse_cursor(value)?),
        None => None,
    };

    let conn = database.connection_for_fsops();
    let sql = format!(
        "SELECT id, operation, source_path, target_path, status, created_at, finished_at, error \
         FROM file_operations {} ORDER BY id DESC LIMIT {}",
        if cursor_id.is_some() {
            "WHERE id < ?1"
        } else {
            ""
        },
        if cursor_id.is_some() { "?2" } else { "?1" }
    );
    let mut statement = conn.prepare(&sql)?;
    let rows = if let Some(cursor_id) = cursor_id {
        statement.query_map(params![cursor_id, limit + 1], record_from_row)?
    } else {
        statement.query_map(params![limit + 1], record_from_row)?
    };
    let mut records: Vec<FileOperationRecord> = Vec::new();
    for row in rows {
        records.push(row?);
    }
    let next_cursor = if records.len() > limit as usize {
        records.pop();
        records.last().map(|record| record.id.to_string())
    } else {
        None
    };
    Ok(Page {
        items: records,
        next_cursor,
    })
}

// -------------- internal: rename ----------------------------------------

fn rename_file(
    database: &mut Database,
    file_id: i64,
    new_name: &str,
) -> FsOpsResult<FileOperationRecord> {
    let conn = database.connection_for_fsops_mut();
    let info = match load_file_info(conn, file_id)? {
        Some(info) => info,
        None => {
            return Err(FsOpsError::new(
                FsOpsErrorCode::NotFound,
                format!("file not found: {file_id}"),
            ))
        }
    };
    let target_path = info.parent_dir.join(new_name);
    let source_path_string = info.path.to_string_lossy().to_string();
    let target_path_string = target_path.to_string_lossy().to_string();

    if info.name == new_name {
        // Nothing to do; record an idempotent succeeded row.
        return write_succeeded(
            conn,
            FileOperationKind::Rename,
            &source_path_string,
            Some(&target_path_string),
            |_tx| Ok(()),
        );
    }

    if file_exists_in_folder_conn(conn, info.folder_id, new_name)? || target_path.exists() {
        return Err(FsOpsError::new(
            FsOpsErrorCode::NameConflict,
            format!("a file named '{new_name}' already exists in this folder"),
        ));
    }

    let transaction = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;

    if let Err(error) = fs::rename(&info.path, &target_path) {
        record_failure(
            &transaction,
            FileOperationKind::Rename,
            &source_path_string,
            Some(&target_path_string),
            &error.to_string(),
        )?;
        transaction.commit()?;
        return Err(FsOpsError::new(
            FsOpsErrorCode::FsError,
            format!("rename failed: {error}"),
        ));
    }

    let new_ext = extension_from_name(new_name);
    transaction.execute(
        "UPDATE files SET name = ?1, ext = ?2 WHERE id = ?3",
        params![new_name, new_ext, file_id],
    )?;

    crate::db::sync_media_fts_for_file_in_transaction_pub(&transaction, file_id)?;

    let record = insert_operation(
        &transaction,
        FileOperationKind::Rename,
        &source_path_string,
        Some(&target_path_string),
        "succeeded",
        None,
    )?;
    transaction.commit()?;
    Ok(record)
}

fn rename_folder(
    database: &mut Database,
    folder_id: i64,
    new_name: &str,
) -> FsOpsResult<FileOperationRecord> {
    let conn = database.connection_for_fsops_mut();
    let info = match load_folder_info(conn, folder_id)? {
        Some(info) => info,
        None => {
            return Err(FsOpsError::new(
                FsOpsErrorCode::NotFound,
                format!("folder not found: {folder_id}"),
            ))
        }
    };
    if info.parent_id.is_none() {
        return Err(FsOpsError::new(
            FsOpsErrorCode::InvalidRequest,
            "cannot rename a root folder",
        ));
    }
    let parent_dir = info
        .path
        .parent()
        .ok_or_else(|| {
            FsOpsError::new(FsOpsErrorCode::InvalidRequest, "folder has no parent path")
        })?
        .to_path_buf();
    let target_path = parent_dir.join(new_name);
    let source_path_string = info.path.to_string_lossy().to_string();
    let target_path_string = target_path.to_string_lossy().to_string();

    if info.name == new_name {
        return write_succeeded(
            conn,
            FileOperationKind::Rename,
            &source_path_string,
            Some(&target_path_string),
            |_tx| Ok(()),
        );
    }

    if folder_name_exists_in_parent_conn(conn, info.parent_id, info.root_id, new_name)?
        || target_path.exists()
    {
        return Err(FsOpsError::new(
            FsOpsErrorCode::NameConflict,
            format!("a folder named '{new_name}' already exists in this parent"),
        ));
    }

    let transaction = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;

    if let Err(error) = fs::rename(&info.path, &target_path) {
        record_failure(
            &transaction,
            FileOperationKind::Rename,
            &source_path_string,
            Some(&target_path_string),
            &error.to_string(),
        )?;
        transaction.commit()?;
        return Err(FsOpsError::new(
            FsOpsErrorCode::FsError,
            format!("rename failed: {error}"),
        ));
    }

    transaction.execute(
        "UPDATE folders SET name = ?1 WHERE id = ?2",
        params![new_name, folder_id],
    )?;

    let descendant_files = collect_descendant_file_ids(&transaction, folder_id)?;
    for file_id in descendant_files {
        crate::db::sync_media_fts_for_file_in_transaction_pub(&transaction, file_id)?;
    }

    let record = insert_operation(
        &transaction,
        FileOperationKind::Rename,
        &source_path_string,
        Some(&target_path_string),
        "succeeded",
        None,
    )?;
    transaction.commit()?;
    Ok(record)
}

// -------------- internal: move ------------------------------------------

fn move_file(
    database: &mut Database,
    file_id: i64,
    target: &FolderTarget,
) -> FsOpsResult<FileOperationRecord> {
    let conn = database.connection_for_fsops_mut();
    let info = match load_file_info(conn, file_id)? {
        Some(info) => info,
        None => {
            return Err(FsOpsError::new(
                FsOpsErrorCode::NotFound,
                format!("file not found: {file_id}"),
            ))
        }
    };
    if info.root_id != target.root_id {
        return Err(FsOpsError::new(
            FsOpsErrorCode::CrossVolume,
            "cross_volume: source and target are in different roots",
        ));
    }
    if info.folder_id == target.folder_id {
        return write_succeeded(
            conn,
            FileOperationKind::Move,
            &info.path.to_string_lossy(),
            Some(&info.path.to_string_lossy()),
            |_tx| Ok(()),
        );
    }
    if file_exists_in_folder_conn(conn, target.folder_id, &info.name)? {
        return Err(FsOpsError::new(
            FsOpsErrorCode::NameConflict,
            format!(
                "a file named '{}' already exists in target folder",
                info.name
            ),
        ));
    }
    let target_path = target.path.join(&info.name);
    if target_path.exists() {
        return Err(FsOpsError::new(
            FsOpsErrorCode::NameConflict,
            format!(
                "a file named '{}' already exists at the target path",
                info.name
            ),
        ));
    }

    let source_path_string = info.path.to_string_lossy().to_string();
    let target_path_string = target_path.to_string_lossy().to_string();

    let transaction = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;

    if let Err(error) = fs::rename(&info.path, &target_path) {
        record_failure(
            &transaction,
            FileOperationKind::Move,
            &source_path_string,
            Some(&target_path_string),
            &error.to_string(),
        )?;
        transaction.commit()?;
        return Err(FsOpsError::new(
            FsOpsErrorCode::FsError,
            format!("move failed: {error}"),
        ));
    }

    transaction.execute(
        "UPDATE files SET folder_id = ?1 WHERE id = ?2",
        params![target.folder_id, file_id],
    )?;
    crate::db::sync_media_fts_for_file_in_transaction_pub(&transaction, file_id)?;

    let record = insert_operation(
        &transaction,
        FileOperationKind::Move,
        &source_path_string,
        Some(&target_path_string),
        "succeeded",
        None,
    )?;
    transaction.commit()?;
    Ok(record)
}

fn move_folder(
    database: &mut Database,
    folder_id: i64,
    target: &FolderTarget,
) -> FsOpsResult<FileOperationRecord> {
    let conn = database.connection_for_fsops_mut();
    let info = match load_folder_info(conn, folder_id)? {
        Some(info) => info,
        None => {
            return Err(FsOpsError::new(
                FsOpsErrorCode::NotFound,
                format!("folder not found: {folder_id}"),
            ))
        }
    };
    if info.parent_id.is_none() {
        return Err(FsOpsError::new(
            FsOpsErrorCode::InvalidRequest,
            "cannot move a root folder",
        ));
    }
    if info.root_id != target.root_id {
        return Err(FsOpsError::new(
            FsOpsErrorCode::CrossVolume,
            "cross_volume: source and target are in different roots",
        ));
    }
    if folder_is_ancestor_of(conn, folder_id, target.folder_id)? {
        return Err(FsOpsError::new(
            FsOpsErrorCode::InvalidRequest,
            "cannot move a folder into its own descendant",
        ));
    }
    if folder_name_exists_in_parent_conn(conn, Some(target.folder_id), info.root_id, &info.name)? {
        return Err(FsOpsError::new(
            FsOpsErrorCode::NameConflict,
            format!(
                "a folder named '{}' already exists in target folder",
                info.name
            ),
        ));
    }
    let target_path = target.path.join(&info.name);
    if target_path.exists() {
        return Err(FsOpsError::new(
            FsOpsErrorCode::NameConflict,
            format!(
                "a folder named '{}' already exists at the target path",
                info.name
            ),
        ));
    }

    let source_path_string = info.path.to_string_lossy().to_string();
    let target_path_string = target_path.to_string_lossy().to_string();

    let transaction = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;

    if let Err(error) = fs::rename(&info.path, &target_path) {
        record_failure(
            &transaction,
            FileOperationKind::Move,
            &source_path_string,
            Some(&target_path_string),
            &error.to_string(),
        )?;
        transaction.commit()?;
        return Err(FsOpsError::new(
            FsOpsErrorCode::FsError,
            format!("move failed: {error}"),
        ));
    }

    transaction.execute(
        "UPDATE folders SET parent_id = ?1 WHERE id = ?2",
        params![target.folder_id, folder_id],
    )?;
    let descendant_files = collect_descendant_file_ids(&transaction, folder_id)?;
    for file_id in descendant_files {
        crate::db::sync_media_fts_for_file_in_transaction_pub(&transaction, file_id)?;
    }

    let record = insert_operation(
        &transaction,
        FileOperationKind::Move,
        &source_path_string,
        Some(&target_path_string),
        "succeeded",
        None,
    )?;
    transaction.commit()?;
    Ok(record)
}

// -------------- internal: delete ----------------------------------------

fn delete_file(
    database: &mut Database,
    file_id: i64,
    permanent: bool,
) -> FsOpsResult<FileOperationRecord> {
    let conn = database.connection_for_fsops_mut();
    let info = match load_file_info(conn, file_id)? {
        Some(info) => info,
        None => {
            return Err(FsOpsError::new(
                FsOpsErrorCode::NotFound,
                format!("file not found: {file_id}"),
            ))
        }
    };
    let kind = if permanent {
        FileOperationKind::DeletePermanent
    } else {
        FileOperationKind::DeleteRecycle
    };
    let source_path_string = info.path.to_string_lossy().to_string();

    if permanent {
        ensure_inside_enabled_root(conn, info.root_id, &info.path)?;
    }

    let transaction = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
    let fs_result = if permanent {
        fs::remove_file(&info.path).map_err(|error| error.to_string())
    } else {
        trash::delete(&info.path).map_err(|error| error.to_string())
    };

    if let Err(error) = fs_result {
        record_failure(&transaction, kind, &source_path_string, None, &error)?;
        transaction.commit()?;
        return Err(FsOpsError::new(
            FsOpsErrorCode::FsError,
            format!("delete failed: {error}"),
        ));
    }

    transaction.execute(
        "UPDATE files SET status = 'deleted' WHERE id = ?1",
        params![file_id],
    )?;
    transaction.execute("DELETE FROM media_fts WHERE rowid = ?1", params![file_id])?;

    let record = insert_operation(
        &transaction,
        kind,
        &source_path_string,
        None,
        "succeeded",
        None,
    )?;
    transaction.commit()?;
    Ok(record)
}

fn delete_folder(
    database: &mut Database,
    folder_id: i64,
    permanent: bool,
) -> FsOpsResult<FileOperationRecord> {
    let conn = database.connection_for_fsops_mut();
    let info = match load_folder_info(conn, folder_id)? {
        Some(info) => info,
        None => {
            return Err(FsOpsError::new(
                FsOpsErrorCode::NotFound,
                format!("folder not found: {folder_id}"),
            ))
        }
    };
    if info.parent_id.is_none() {
        return Err(FsOpsError::new(
            FsOpsErrorCode::InvalidRequest,
            "cannot delete a root folder",
        ));
    }
    let kind = if permanent {
        FileOperationKind::DeletePermanent
    } else {
        FileOperationKind::DeleteRecycle
    };
    let source_path_string = info.path.to_string_lossy().to_string();

    if permanent {
        ensure_inside_enabled_root(conn, info.root_id, &info.path)?;
    }

    let transaction = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
    let fs_result = if permanent {
        fs::remove_dir_all(&info.path).map_err(|error| error.to_string())
    } else {
        trash::delete(&info.path).map_err(|error| error.to_string())
    };

    if let Err(error) = fs_result {
        record_failure(&transaction, kind, &source_path_string, None, &error)?;
        transaction.commit()?;
        return Err(FsOpsError::new(
            FsOpsErrorCode::FsError,
            format!("delete failed: {error}"),
        ));
    }

    let descendant_files = collect_descendant_file_ids(&transaction, folder_id)?;
    transaction.execute(
        r#"
        WITH RECURSIVE subtree(id) AS (
          SELECT id FROM folders WHERE id = ?1
          UNION ALL
          SELECT folders.id
          FROM folders
          JOIN subtree ON folders.parent_id = subtree.id
        )
        UPDATE folders SET status = 'deleted'
        WHERE id IN (SELECT id FROM subtree)
        "#,
        params![folder_id],
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
        UPDATE files SET status = 'deleted'
        WHERE folder_id IN (SELECT id FROM subtree)
        "#,
        params![folder_id],
    )?;
    for file_id in &descendant_files {
        transaction.execute("DELETE FROM media_fts WHERE rowid = ?1", params![*file_id])?;
    }

    let record = insert_operation(
        &transaction,
        kind,
        &source_path_string,
        None,
        "succeeded",
        None,
    )?;
    transaction.commit()?;
    Ok(record)
}

// -------------- helpers -------------------------------------------------

#[derive(Debug, Clone)]
struct FileInfo {
    folder_id: i64,
    root_id: i64,
    name: String,
    path: PathBuf,
    parent_dir: PathBuf,
}

#[derive(Debug, Clone)]
struct FolderInfo {
    parent_id: Option<i64>,
    root_id: i64,
    name: String,
    path: PathBuf,
}

#[derive(Debug, Clone)]
struct FolderTarget {
    folder_id: i64,
    root_id: i64,
    path: PathBuf,
}

fn load_file_info(conn: &rusqlite::Connection, file_id: i64) -> FsOpsResult<Option<FileInfo>> {
    let row = conn
        .query_row(
            r#"
            SELECT files.folder_id, files.root_id, files.name
            FROM files
            WHERE files.id = ?1 AND files.status = 'active'
            "#,
            params![file_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?;
    let Some((folder_id, root_id, name)) = row else {
        return Ok(None);
    };
    let parent_dir = match folder_path_for(conn, folder_id)? {
        Some(path) => path,
        None => return Ok(None),
    };
    let path = parent_dir.join(&name);
    Ok(Some(FileInfo {
        folder_id,
        root_id,
        name,
        path,
        parent_dir,
    }))
}

fn load_folder_info(
    conn: &rusqlite::Connection,
    folder_id: i64,
) -> FsOpsResult<Option<FolderInfo>> {
    let row = conn
        .query_row(
            r#"
            SELECT folders.parent_id, folders.root_id, folders.name
            FROM folders
            WHERE folders.id = ?1 AND folders.status = 'active'
            "#,
            params![folder_id],
            |row| {
                Ok((
                    row.get::<_, Option<i64>>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?;
    let Some((parent_id, root_id, name)) = row else {
        return Ok(None);
    };
    let path = match folder_path_for(conn, folder_id)? {
        Some(path) => path,
        None => return Ok(None),
    };
    Ok(Some(FolderInfo {
        parent_id,
        root_id,
        name,
        path,
    }))
}

fn load_folder_path(
    conn: &rusqlite::Connection,
    folder_id: i64,
) -> FsOpsResult<Option<FolderTarget>> {
    let Some(info) = load_folder_info(conn, folder_id)? else {
        return Ok(None);
    };
    Ok(Some(FolderTarget {
        folder_id,
        root_id: info.root_id,
        path: info.path,
    }))
}

/// Walk from a folder up to its root, joining names onto the root's path.
fn folder_path_for(conn: &rusqlite::Connection, folder_id: i64) -> FsOpsResult<Option<PathBuf>> {
    let mut chain: Vec<String> = Vec::new();
    let mut current_id = folder_id;
    let root_id;
    loop {
        let row: Option<(Option<i64>, i64, String)> = conn
            .query_row(
                "SELECT parent_id, root_id, name FROM folders WHERE id = ?1",
                params![current_id],
                |row| {
                    Ok((
                        row.get::<_, Option<i64>>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?;
        let Some((parent_id, current_root_id, name)) = row else {
            return Ok(None);
        };
        match parent_id {
            Some(parent) => {
                chain.push(name);
                current_id = parent;
            }
            None => {
                root_id = current_root_id;
                break;
            }
        }
    }
    let root_path: Option<String> = conn
        .query_row(
            "SELECT path FROM roots WHERE id = ?1",
            params![root_id],
            |row| row.get(0),
        )
        .optional()?;
    let Some(root_path) = root_path else {
        return Ok(None);
    };
    let mut path = PathBuf::from(root_path);
    for component in chain.iter().rev() {
        path.push(component);
    }
    Ok(Some(path))
}

fn folder_is_ancestor_of(
    conn: &rusqlite::Connection,
    ancestor_id: i64,
    descendant_id: i64,
) -> FsOpsResult<bool> {
    if ancestor_id == descendant_id {
        return Ok(true);
    }
    let mut current = descendant_id;
    loop {
        let parent: Option<Option<i64>> = conn
            .query_row(
                "SELECT parent_id FROM folders WHERE id = ?1",
                params![current],
                |row| row.get::<_, Option<i64>>(0),
            )
            .optional()?;
        let Some(parent) = parent else {
            return Ok(false);
        };
        match parent {
            Some(parent_id) if parent_id == ancestor_id => return Ok(true),
            Some(parent_id) => current = parent_id,
            None => return Ok(false),
        }
    }
}

fn file_exists_in_folder_conn(
    conn: &rusqlite::Connection,
    folder_id: i64,
    name: &str,
) -> FsOpsResult<bool> {
    let exists: i64 = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM files WHERE folder_id = ?1 AND name = ?2 AND status = 'active')",
        params![folder_id, name],
        |row| row.get(0),
    )?;
    Ok(exists != 0)
}

fn folder_name_exists_in_parent_conn(
    conn: &rusqlite::Connection,
    parent_id: Option<i64>,
    root_id: i64,
    name: &str,
) -> FsOpsResult<bool> {
    let exists: i64 = if let Some(parent_id) = parent_id {
        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM folders WHERE parent_id = ?1 AND name = ?2 AND status = 'active')",
            params![parent_id, name],
            |row| row.get(0),
        )?
    } else {
        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM folders WHERE parent_id IS NULL AND root_id = ?1 AND name = ?2 AND status = 'active')",
            params![root_id, name],
            |row| row.get(0),
        )?
    };
    Ok(exists != 0)
}

fn collect_descendant_file_ids(
    transaction: &Transaction<'_>,
    folder_id: i64,
) -> FsOpsResult<Vec<i64>> {
    let mut statement = transaction.prepare(
        r#"
        WITH RECURSIVE subtree(id) AS (
          SELECT id FROM folders WHERE id = ?1
          UNION ALL
          SELECT folders.id
          FROM folders
          JOIN subtree ON folders.parent_id = subtree.id
        )
        SELECT files.id
        FROM files
        WHERE files.folder_id IN (SELECT id FROM subtree)
        "#,
    )?;
    let rows = statement.query_map(params![folder_id], |row| row.get::<_, i64>(0))?;
    let mut ids = Vec::new();
    for row in rows {
        ids.push(row?);
    }
    Ok(ids)
}

fn ensure_inside_enabled_root(
    conn: &rusqlite::Connection,
    root_id: i64,
    path: &Path,
) -> FsOpsResult<()> {
    let row: Option<(String, i64)> = conn
        .query_row(
            "SELECT path, enabled FROM roots WHERE id = ?1",
            params![root_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()?;
    let Some((root_path, enabled)) = row else {
        return Err(FsOpsError::new(
            FsOpsErrorCode::OutsideRoot,
            "root not found",
        ));
    };
    if enabled == 0 {
        return Err(FsOpsError::new(
            FsOpsErrorCode::OutsideRoot,
            "permanent delete is not allowed in disabled roots",
        ));
    }
    if !path.starts_with(&root_path) {
        return Err(FsOpsError::new(
            FsOpsErrorCode::OutsideRoot,
            format!(
                "permanent delete refused: path is outside root {}",
                root_path
            ),
        ));
    }
    Ok(())
}

fn validate_name(name: &str) -> FsOpsResult<()> {
    if name.is_empty() {
        return Err(FsOpsError::new(
            FsOpsErrorCode::InvalidName,
            "name must not be empty",
        ));
    }
    if name.chars().count() > 255 {
        return Err(FsOpsError::new(
            FsOpsErrorCode::InvalidName,
            "name must be 255 characters or fewer",
        ));
    }
    if name == "." || name == ".." {
        return Err(FsOpsError::new(
            FsOpsErrorCode::InvalidName,
            "name must not be '.' or '..'",
        ));
    }
    if name.contains('/') || name.contains('\\') {
        return Err(FsOpsError::new(
            FsOpsErrorCode::InvalidName,
            "name must not contain path separators",
        ));
    }
    if is_windows_reserved(name) {
        return Err(FsOpsError::new(
            FsOpsErrorCode::InvalidName,
            format!("'{name}' is a reserved Windows name"),
        ));
    }
    Ok(())
}

fn is_windows_reserved(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
    matches!(
        stem.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

fn extension_from_name(name: &str) -> String {
    Path::new(name)
        .extension()
        .map(|ext| format!(".{}", ext.to_string_lossy()))
        .unwrap_or_default()
}

fn parse_cursor(cursor: &str) -> FsOpsResult<i64> {
    cursor.parse::<i64>().map_err(|_| {
        FsOpsError::new(
            FsOpsErrorCode::InvalidRequest,
            format!("invalid file_operations cursor: {cursor}"),
        )
    })
}

fn insert_operation(
    transaction: &Transaction<'_>,
    kind: FileOperationKind,
    source_path: &str,
    target_path: Option<&str>,
    status: &str,
    error: Option<&str>,
) -> FsOpsResult<FileOperationRecord> {
    transaction.execute(
        r#"
        INSERT INTO file_operations(operation, source_path, target_path, status, created_at, finished_at, error)
        VALUES (?1, ?2, ?3, ?4, unixepoch(), unixepoch(), ?5)
        "#,
        params![kind.as_str(), source_path, target_path, status, error],
    )?;
    let id = transaction.last_insert_rowid();
    let record = transaction.query_row(
        r#"
        SELECT id, operation, source_path, target_path, status, created_at, finished_at, error
        FROM file_operations
        WHERE id = ?1
        "#,
        params![id],
        record_from_row,
    )?;
    Ok(record)
}

fn record_failure(
    transaction: &Transaction<'_>,
    kind: FileOperationKind,
    source_path: &str,
    target_path: Option<&str>,
    error: &str,
) -> FsOpsResult<()> {
    transaction.execute(
        r#"
        INSERT INTO file_operations(operation, source_path, target_path, status, created_at, finished_at, error)
        VALUES (?1, ?2, ?3, 'failed', unixepoch(), unixepoch(), ?4)
        "#,
        params![kind.as_str(), source_path, target_path, error],
    )?;
    Ok(())
}

fn write_succeeded(
    conn: &mut rusqlite::Connection,
    kind: FileOperationKind,
    source_path: &str,
    target_path: Option<&str>,
    extra: impl FnOnce(&Transaction<'_>) -> FsOpsResult<()>,
) -> FsOpsResult<FileOperationRecord> {
    let transaction = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
    extra(&transaction)?;
    let record = insert_operation(
        &transaction,
        kind,
        source_path,
        target_path,
        "succeeded",
        None,
    )?;
    transaction.commit()?;
    Ok(record)
}

fn record_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<FileOperationRecord> {
    Ok(FileOperationRecord {
        id: row.get(0)?,
        operation: row.get(1)?,
        source_path: row.get(2)?,
        target_path: row.get(3)?,
        status: row.get(4)?,
        created_at: row.get(5)?,
        finished_at: row.get(6)?,
        error: row.get(7)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{Database, FileUpsert, FolderUpsert, NewRoot};
    use std::fs as stdfs;
    use std::path::PathBuf;

    struct TestEnv {
        database: Database,
        root_id: i64,
        root_folder_id: i64,
        root_path: PathBuf,
    }

    impl TestEnv {
        fn new(label: &str) -> Self {
            let root_path = unique_temp_dir(label);
            stdfs::create_dir_all(&root_path).expect("create root path");
            let database = Database::open_in_memory().expect("open database");
            database.apply_migrations().expect("apply migrations");
            let root_id = database
                .add_root(NewRoot {
                    path: root_path.to_string_lossy().into_owned(),
                    display_name: format!("test {label}"),
                })
                .expect("add root");
            let root_folder_id = database
                .upsert_folder(FolderUpsert {
                    root_id,
                    parent_id: None,
                    name: String::new(),
                    path_hash: format!("root-{label}"),
                    mtime: Some(1),
                })
                .expect("insert root folder");
            Self {
                database,
                root_id,
                root_folder_id,
                root_path,
            }
        }

        fn add_file(&mut self, folder_id: i64, name: &str) -> i64 {
            let path = self.folder_path(folder_id).join(name);
            stdfs::write(&path, b"x").expect("write test file");
            self.database
                .upsert_file(FileUpsert {
                    root_id: self.root_id,
                    folder_id,
                    name: name.to_string(),
                    ext: extension_from_name(name),
                    size: 1,
                    mtime: 2,
                    ctime: None,
                    file_key: None,
                })
                .expect("insert file")
        }

        fn add_folder(&mut self, parent_id: i64, name: &str) -> i64 {
            let path = self.folder_path(parent_id).join(name);
            stdfs::create_dir_all(&path).expect("create child folder");
            self.database
                .upsert_folder(FolderUpsert {
                    root_id: self.root_id,
                    parent_id: Some(parent_id),
                    name: name.to_string(),
                    path_hash: format!("hash-{}-{name}", parent_id),
                    mtime: Some(3),
                })
                .expect("insert folder")
        }

        fn folder_path(&self, folder_id: i64) -> PathBuf {
            folder_path_for(&self.database.connection_for_fsops(), folder_id)
                .expect("folder path lookup")
                .expect("folder path resolved")
        }
    }

    impl Drop for TestEnv {
        fn drop(&mut self) {
            let _ = stdfs::remove_dir_all(&self.root_path);
        }
    }

    fn unique_temp_dir(label: &str) -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        std::env::temp_dir().join(format!(
            "megle_fsops_{}_{}_{}_{}",
            label,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time")
                .as_nanos(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ))
    }

    #[test]
    fn rename_file_updates_disk_db_and_log() {
        let mut env = TestEnv::new("rename_ok");
        let file_id = env.add_file(env.root_folder_id, "old.jpg");
        let record = rename(
            &mut env.database,
            RenameRequest {
                file_id: Some(file_id),
                folder_id: None,
                new_name: "new.jpg".into(),
            },
        )
        .expect("rename");
        assert_eq!(record.operation, "rename");
        assert_eq!(record.status, "succeeded");
        assert!(env.root_path.join("new.jpg").exists());
        assert!(!env.root_path.join("old.jpg").exists());
        let media = env.database.get_media(file_id).expect("get media").unwrap();
        assert_eq!(media.name, "new.jpg");
    }

    #[test]
    fn rename_invalid_name_rejected() {
        let mut env = TestEnv::new("rename_invalid");
        let file_id = env.add_file(env.root_folder_id, "a.jpg");
        for bad in [
            "",
            "..",
            "with/slash.jpg",
            "with\\back.jpg",
            "CON",
            "Prn.txt",
        ] {
            let error = rename(
                &mut env.database,
                RenameRequest {
                    file_id: Some(file_id),
                    folder_id: None,
                    new_name: bad.into(),
                },
            )
            .expect_err(&format!("expected reject for {bad}"));
            assert_eq!(error.code, FsOpsErrorCode::InvalidName);
        }
    }

    #[test]
    fn rename_collision_returns_conflict() {
        let mut env = TestEnv::new("rename_conflict");
        let _ = env.add_file(env.root_folder_id, "a.jpg");
        let other_id = env.add_file(env.root_folder_id, "b.jpg");
        let error = rename(
            &mut env.database,
            RenameRequest {
                file_id: Some(other_id),
                folder_id: None,
                new_name: "a.jpg".into(),
            },
        )
        .expect_err("expected conflict");
        assert_eq!(error.code, FsOpsErrorCode::NameConflict);
    }

    #[test]
    fn rename_missing_file_returns_not_found() {
        let mut env = TestEnv::new("rename_404");
        let error = rename(
            &mut env.database,
            RenameRequest {
                file_id: Some(99_999),
                folder_id: None,
                new_name: "x.jpg".into(),
            },
        )
        .expect_err("expected not_found");
        assert_eq!(error.code, FsOpsErrorCode::NotFound);
    }

    #[test]
    fn move_file_within_root_succeeds() {
        let mut env = TestEnv::new("move_ok");
        let target_folder = env.add_folder(env.root_folder_id, "dst");
        let file_id = env.add_file(env.root_folder_id, "m.jpg");
        let records = move_items(
            &mut env.database,
            MoveRequest {
                file_ids: vec![file_id],
                folder_ids: vec![],
                target_folder_id: target_folder,
            },
        )
        .expect("move");
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].status, "succeeded");
        assert!(env.root_path.join("dst").join("m.jpg").exists());
        assert!(!env.root_path.join("m.jpg").exists());
        let media = env.database.get_media(file_id).expect("get").unwrap();
        assert_eq!(media.folder_id, target_folder);
    }

    #[test]
    fn move_cross_volume_returns_cross_volume() {
        let mut env_a = TestEnv::new("move_a");
        let env_b = TestEnv::new("move_b");
        let file_id = env_a.add_file(env_a.root_folder_id, "x.jpg");
        // Register the second root in env_a's database to simulate two roots.
        let other_root = env_a
            .database
            .add_root(NewRoot {
                path: env_b.root_path.to_string_lossy().into_owned(),
                display_name: "other".into(),
            })
            .expect("add second root");
        let other_root_folder = env_a
            .database
            .upsert_folder(FolderUpsert {
                root_id: other_root,
                parent_id: None,
                name: String::new(),
                path_hash: "other-root".into(),
                mtime: Some(1),
            })
            .expect("insert other root folder");
        let error = move_items(
            &mut env_a.database,
            MoveRequest {
                file_ids: vec![file_id],
                folder_ids: vec![],
                target_folder_id: other_root_folder,
            },
        )
        .expect_err("expected cross_volume");
        assert_eq!(error.code, FsOpsErrorCode::CrossVolume);
    }

    #[test]
    fn move_missing_target_returns_not_found() {
        let mut env = TestEnv::new("move_404");
        let file_id = env.add_file(env.root_folder_id, "m.jpg");
        let error = move_items(
            &mut env.database,
            MoveRequest {
                file_ids: vec![file_id],
                folder_ids: vec![],
                target_folder_id: 99_999,
            },
        )
        .expect_err("expected 404");
        assert_eq!(error.code, FsOpsErrorCode::NotFound);
    }

    #[test]
    fn delete_permanent_removes_disk_and_marks_db() {
        let mut env = TestEnv::new("delete_permanent");
        let file_id = env.add_file(env.root_folder_id, "z.jpg");
        let records = delete(
            &mut env.database,
            DeleteRequest {
                file_ids: vec![file_id],
                folder_ids: vec![],
                permanent: true,
            },
        )
        .expect("delete");
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].operation, "delete_permanent");
        assert!(!env.root_path.join("z.jpg").exists());
        assert!(env
            .database
            .get_media(file_id)
            .expect("query media")
            .is_none());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn delete_recycle_removes_from_disk() {
        let mut env = TestEnv::new("delete_recycle");
        let file_id = env.add_file(env.root_folder_id, "r.jpg");
        let records = delete(
            &mut env.database,
            DeleteRequest {
                file_ids: vec![file_id],
                folder_ids: vec![],
                permanent: false,
            },
        )
        .expect("recycle delete");
        assert_eq!(records[0].operation, "delete_recycle");
        assert!(!env.root_path.join("r.jpg").exists());
    }

    #[test]
    fn delete_with_files_and_folders_processes_both() {
        let mut env = TestEnv::new("delete_mixed");
        let file_id = env.add_file(env.root_folder_id, "mixed.jpg");
        let child = env.add_folder(env.root_folder_id, "subdir");
        let records = delete(
            &mut env.database,
            DeleteRequest {
                file_ids: vec![file_id],
                folder_ids: vec![child],
                permanent: true,
            },
        )
        .expect("delete mixed");
        assert_eq!(records.len(), 2);
        assert!(records.iter().all(|record| record.status == "succeeded"));
    }

    #[test]
    fn list_recent_returns_descending_ids() {
        let mut env = TestEnv::new("list_recent");
        for index in 0..3 {
            let file_id = env.add_file(env.root_folder_id, &format!("f{index}.jpg"));
            rename(
                &mut env.database,
                RenameRequest {
                    file_id: Some(file_id),
                    folder_id: None,
                    new_name: format!("g{index}.jpg"),
                },
            )
            .expect("rename");
        }
        let page = list_recent(&env.database, 50, None).expect("list");
        assert!(page.items.len() >= 3);
        for window in page.items.windows(2) {
            assert!(window[0].id > window[1].id, "ids must be DESC");
        }
    }

    #[test]
    fn rename_folder_updates_disk_and_db() {
        let mut env = TestEnv::new("rename_folder");
        let child = env.add_folder(env.root_folder_id, "old_dir");
        let _file_id = env.add_file(child, "inner.jpg");
        let record = rename(
            &mut env.database,
            RenameRequest {
                file_id: None,
                folder_id: Some(child),
                new_name: "new_dir".into(),
            },
        )
        .expect("rename folder");
        assert_eq!(record.operation, "rename");
        assert!(env.root_path.join("new_dir").join("inner.jpg").exists());
        assert!(!env.root_path.join("old_dir").exists());
    }
}
