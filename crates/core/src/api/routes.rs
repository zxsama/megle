use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use axum_extra::extract::Query as ExtraQuery;
use serde::{Deserialize, Serialize};
use std::fs;

use crate::api::AppState;
use crate::db::{
    FolderRecord, MediaPageQuery, MediaRecord, NewRoot, PluginRecord, RootRecord, SearchQuery,
    TagError, TagRecord, TaskRecord, ThumbnailRecord, UserMetadataPatch, UserMetadataRecord,
};
use crate::fsops::{
    self, DeleteRequest, FileOperationRecord, FsOpsError, FsOpsErrorCode, MoveRequest,
    RenameRequest,
};
use crate::plugins;
use crate::scan::ScanSummary;
use crate::thumbnails::{is_pending_status, normalize_profile};

#[allow(dead_code)]
pub const MEDIA_SORT_VALUES: &[&str] = &["mtime_desc", "mtime_asc", "name_asc", "name_desc"];
#[allow(dead_code)]
pub const SEARCH_SORT_VALUES: &[&str] = &[
    "mtime_desc",
    "mtime_asc",
    "name_asc",
    "name_desc",
    "rating_desc",
    "rating_asc",
];
#[allow(dead_code)]
pub const MEDIA_KIND_VALUES: &[&str] = &["image", "video", "other"];

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RouteGroup {
    Health,
    Roots,
    Folders,
    Media,
    Thumbnails,
    Preview,
    Tasks,
    FileOps,
    Plugins,
}

#[allow(dead_code)]
pub const PHASE1_ROUTE_GROUPS: &[RouteGroup] = &[
    RouteGroup::Health,
    RouteGroup::Roots,
    RouteGroup::Folders,
    RouteGroup::Media,
    RouteGroup::Thumbnails,
    RouteGroup::Preview,
    RouteGroup::Tasks,
    RouteGroup::FileOps,
    RouteGroup::Plugins,
];

#[allow(dead_code)]
pub const PHASE1_API_PATHS: &[&str] = &[
    "/api/health",
    "/api/roots",
    "/api/roots/{rootId}",
    "/api/folders/{folderId}/children",
    "/api/media",
    "/api/media/{fileId}",
    "/api/media/{fileId}/thumbnail",
    "/api/media/{fileId}/preview",
    "/api/media/{fileId}/metadata",
    "/api/media/{fileId}/tags",
    "/api/media/{fileId}/tags/{tagId}",
    "/api/tags",
    "/api/tags/{tagId}",
    "/api/search",
    "/api/tasks",
    "/api/tasks/scan",
    "/api/tasks/{taskId}/cancel",
    "/api/tasks/{taskId}/retry",
    "/api/file-ops/rename",
    "/api/file-ops/move",
    "/api/file-ops/delete",
    "/api/file-ops",
    "/api/plugins",
    "/api/plugins/discover",
    "/api/plugins/{pluginId}",
    "/api/plugins/{pluginId}/enable",
    "/api/plugins/{pluginId}/disable",
];

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
    version: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ListResponse<T> {
    items: Vec<T>,
    next_cursor: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AcceptedResponse {
    accepted: bool,
    task_id: Option<i64>,
    root_id: Option<i64>,
    scan: Option<ScanSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginListResponse {
    items: Vec<PluginRecord>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginDiscoveryError {
    manifest_path: String,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginDiscoveryResponse {
    discovered: u64,
    errors: Vec<PluginDiscoveryError>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeletePluginResponse {
    deleted: bool,
}

#[derive(Debug, Deserialize)]
struct AddRootRequest {
    path: String,
    #[serde(rename = "displayName", alias = "display_name")]
    display_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ScanTaskRequest {
    #[serde(rename = "rootId")]
    root_id: i64,
}

#[derive(Debug, Deserialize)]
struct ListFolderChildrenQuery {
    limit: Option<i64>,
    cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ListMediaQuery {
    #[serde(rename = "rootId")]
    root_id: Option<i64>,
    #[serde(rename = "folderId")]
    folder_id: Option<i64>,
    limit: Option<i64>,
    cursor: Option<String>,
    sort: Option<String>,
    kind: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ThumbnailQuery {
    profile: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CreateTagRequestBody {
    name: String,
    #[serde(default)]
    color: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AddFileTagRequestBody {
    #[serde(rename = "tagId")]
    tag_id: i64,
}

#[derive(Debug, Deserialize)]
struct SetFileTagsRequestBody {
    #[serde(rename = "tagIds")]
    tag_ids: Vec<i64>,
}

#[derive(Debug, Deserialize)]
struct SearchMediaQuery {
    q: Option<String>,
    #[serde(rename = "rootId")]
    root_id: Option<i64>,
    #[serde(rename = "folderId")]
    folder_id: Option<i64>,
    kind: Option<String>,
    #[serde(rename = "minRating")]
    min_rating: Option<i64>,
    favorite: Option<bool>,
    #[serde(default, rename = "tagId")]
    tag_id: Vec<i64>,
    sort: Option<String>,
    limit: Option<i64>,
    cursor: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeleteTagResponse {
    deleted: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileTagsResponse {
    file_id: i64,
    tag_ids: Vec<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameRequestBody {
    #[serde(default)]
    file_id: Option<i64>,
    #[serde(default)]
    folder_id: Option<i64>,
    new_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MoveRequestBody {
    #[serde(default)]
    file_ids: Option<Vec<i64>>,
    #[serde(default)]
    folder_ids: Option<Vec<i64>>,
    target_folder_id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteRequestBody {
    #[serde(default)]
    file_ids: Option<Vec<i64>>,
    #[serde(default)]
    folder_ids: Option<Vec<i64>>,
    #[serde(default)]
    permanent: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileOperationsResponse {
    operations: Vec<FileOperationRecord>,
}

#[derive(Debug, Deserialize)]
struct ListFileOperationsQuery {
    limit: Option<i64>,
    cursor: Option<String>,
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodedErrorResponse {
    error: String,
    code: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ThumbnailAsset {
    cache_key: String,
    width: i64,
    height: i64,
    byte_size: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ThumbnailResponse {
    file_id: i64,
    profile: String,
    state: String,
    short_side_px: i64,
    output_format: String,
    asset: Option<ThumbnailAsset>,
    error: Option<String>,
    updated_at: Option<i64>,
}

struct CoreError {
    status: StatusCode,
    message: String,
    code: Option<String>,
}

impl From<anyhow::Error> for CoreError {
    fn from(error: anyhow::Error) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: error.to_string(),
            code: None,
        }
    }
}

impl IntoResponse for CoreError {
    fn into_response(self) -> Response {
        if let Some(code) = self.code {
            (
                self.status,
                Json(CodedErrorResponse {
                    error: self.message,
                    code,
                }),
            )
                .into_response()
        } else {
            (
                self.status,
                Json(ErrorResponse {
                    error: self.message,
                }),
            )
                .into_response()
        }
    }
}

type ApiResult<T> = Result<T, CoreError>;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(get_health))
        .route("/api/roots", get(list_roots).post(add_root))
        .route("/api/roots/:root_id", axum::routing::delete(remove_root))
        .route(
            "/api/folders/:folder_id/children",
            get(list_folder_children),
        )
        .route("/api/media", get(list_media))
        .route("/api/media/:file_id", get(get_media))
        .route("/api/media/:file_id/thumbnail", get(get_thumbnail))
        .route("/api/media/:file_id/preview", get(get_preview))
        .route(
            "/api/media/:file_id/metadata",
            get(get_user_metadata).put(update_user_metadata),
        )
        .route(
            "/api/media/:file_id/tags",
            put(set_file_tags).post(add_file_tag),
        )
        .route(
            "/api/media/:file_id/tags/:tag_id",
            axum::routing::delete(remove_file_tag),
        )
        .route("/api/tags", get(list_tags).post(create_tag))
        .route("/api/tags/:tag_id", axum::routing::delete(delete_tag))
        .route("/api/search", get(search_media))
        .route("/api/tasks", get(list_tasks))
        .route("/api/tasks/scan", post(enqueue_scan))
        .route("/api/tasks/:task_id/cancel", post(cancel_task))
        .route("/api/tasks/:task_id/retry", post(retry_task))
        .route("/api/file-ops/rename", post(rename_file))
        .route("/api/file-ops/move", post(move_files))
        .route("/api/file-ops/delete", post(delete_files))
        .route("/api/file-ops", get(list_file_operations))
        .route("/api/plugins", get(list_plugins))
        .route("/api/plugins/discover", post(discover_plugins))
        .route(
            "/api/plugins/:plugin_id",
            get(get_plugin).delete(delete_plugin),
        )
        .route("/api/plugins/:plugin_id/enable", post(enable_plugin))
        .route("/api/plugins/:plugin_id/disable", post(disable_plugin))
        .with_state(state)
}

async fn get_health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: "megle-core",
        version: env!("CARGO_PKG_VERSION"),
    })
}

async fn list_roots(State(state): State<AppState>) -> ApiResult<Json<ListResponse<RootRecord>>> {
    let database = state.database.lock().expect("database mutex poisoned");
    let items = database.list_roots()?;
    Ok(Json(ListResponse {
        items,
        next_cursor: None,
    }))
}

async fn add_root(
    State(state): State<AppState>,
    Json(payload): Json<AddRootRequest>,
) -> ApiResult<(StatusCode, Json<AcceptedResponse>)> {
    let canonical_path = fs::canonicalize(&payload.path).map_err(|error| {
        CoreError::bad_request(format!(
            "root path does not exist or cannot be opened: {error}"
        ))
    })?;
    if !canonical_path.is_dir() {
        return Err(CoreError::bad_request(format!(
            "root path is not a directory: {}",
            canonical_path.display()
        )));
    }
    let canonical_path = canonical_path.to_string_lossy().into_owned();
    let display_name = payload
        .display_name
        .unwrap_or_else(|| fallback_display_name(&canonical_path));
    let (root_id, task_id, attempt_generation) = {
        let database = state.database.lock().expect("database mutex poisoned");
        let root_id = database.add_root(NewRoot {
            path: canonical_path,
            display_name,
        })?;
        let task_id = database.create_root_scan_task(root_id)?;
        let attempt_generation = database.current_task_attempt_generation(task_id)?;
        (root_id, task_id, attempt_generation)
    };
    enqueue_task(&state, task_id, attempt_generation).await?;
    Ok((
        StatusCode::ACCEPTED,
        Json(AcceptedResponse {
            accepted: true,
            task_id: Some(task_id),
            root_id: Some(root_id),
            scan: None,
        }),
    ))
}

async fn remove_root(
    State(state): State<AppState>,
    Path(root_id): Path<i64>,
) -> ApiResult<(StatusCode, Json<AcceptedResponse>)> {
    let database = state.database.lock().expect("database mutex poisoned");
    if !database.disable_root(root_id)? {
        return Err(CoreError::not_found(format!("root not found: {root_id}")));
    }
    Ok((StatusCode::ACCEPTED, Json(accepted())))
}

async fn list_folder_children(
    State(state): State<AppState>,
    Path(folder_id): Path<i64>,
    Query(query): Query<ListFolderChildrenQuery>,
) -> ApiResult<Json<ListResponse<FolderRecord>>> {
    let database = state.database.lock().expect("database mutex poisoned");
    if !database.folder_exists(folder_id)? {
        return Err(CoreError::not_found(format!(
            "folder not found: {folder_id}"
        )));
    }
    let page = database
        .list_folder_children_page(folder_id, query.limit.unwrap_or(200), query.cursor)
        .map_err(map_cursor_error)?;
    Ok(Json(ListResponse {
        items: page.items,
        next_cursor: page.next_cursor,
    }))
}

async fn list_media(
    State(state): State<AppState>,
    Query(query): Query<ListMediaQuery>,
) -> ApiResult<Json<ListResponse<MediaRecord>>> {
    let sort = parse_media_sort(query.sort.as_deref())?.to_string();
    let kind = parse_media_kind(query.kind.as_deref())?.map(str::to_string);
    let database = state.database.lock().expect("database mutex poisoned");
    let page = database
        .list_media_page(MediaPageQuery {
            root_id: query.root_id,
            folder_id: query.folder_id,
            limit: query.limit.unwrap_or(200),
            cursor: query.cursor,
            sort,
            kind,
        })
        .map_err(map_cursor_error)?;
    Ok(Json(ListResponse {
        items: page.items,
        next_cursor: page.next_cursor,
    }))
}

async fn get_media(
    State(state): State<AppState>,
    Path(file_id): Path<i64>,
) -> ApiResult<Json<MediaRecord>> {
    let database = state.database.lock().expect("database mutex poisoned");
    let item = database
        .get_media(file_id)?
        .ok_or_else(|| CoreError::not_found(format!("media item not found: {file_id}")))?;
    Ok(Json(item))
}

async fn get_thumbnail(
    State(state): State<AppState>,
    Path(file_id): Path<i64>,
    Query(query): Query<ThumbnailQuery>,
) -> ApiResult<(StatusCode, Json<ThumbnailResponse>)> {
    let profile = normalize_profile(query.profile.as_deref())
        .ok_or_else(|| CoreError::bad_request("unsupported thumbnail profile".to_string()))?;
    let (thumbnail, queued_task) = {
        let database = state.database.lock().expect("database mutex poisoned");
        let thumbnail = database
            .get_thumbnail(file_id, profile)?
            .ok_or_else(|| CoreError::not_found(format!("media item not found: {file_id}")))?;
        if is_pending_status(&thumbnail.state) {
            let request = database
                .request_thumbnail_task(file_id, profile)
                .map_err(map_thumbnail_request_error)?;
            let queued_task_id = if request.queued {
                request.task_id
            } else {
                None
            };
            let queued_task = queued_task_id
                .map(|task_id| {
                    database
                        .current_task_attempt_generation(task_id)
                        .map(|attempt| (task_id, attempt))
                })
                .transpose()?;
            (request.thumbnail, queued_task)
        } else {
            (thumbnail, None)
        }
    };
    if let Some((task_id, attempt_generation)) = queued_task {
        enqueue_task(&state, task_id, attempt_generation).await?;
    }
    let status = if is_pending_status(&thumbnail.state) {
        StatusCode::ACCEPTED
    } else {
        StatusCode::OK
    };
    Ok((status, Json(thumbnail_response(thumbnail))))
}

async fn get_preview(Path(_file_id): Path<i64>) -> (StatusCode, Json<AcceptedResponse>) {
    (StatusCode::ACCEPTED, Json(accepted()))
}

async fn list_tasks(State(state): State<AppState>) -> ApiResult<Json<ListResponse<TaskRecord>>> {
    let database = state.database.lock().expect("database mutex poisoned");
    let items = database.list_tasks()?;
    Ok(Json(ListResponse {
        items,
        next_cursor: None,
    }))
}

async fn enqueue_scan(
    State(state): State<AppState>,
    Json(payload): Json<ScanTaskRequest>,
) -> ApiResult<(StatusCode, Json<AcceptedResponse>)> {
    let (task_id, attempt_generation) = {
        let database = state.database.lock().expect("database mutex poisoned");
        let root = database
            .get_root(payload.root_id)?
            .ok_or_else(|| CoreError::not_found(format!("root not found: {}", payload.root_id)))?;
        if !root.enabled {
            return Err(CoreError::conflict(format!(
                "root is disabled: {}",
                payload.root_id
            )));
        }
        let task_id = database.create_root_scan_task(payload.root_id)?;
        let attempt_generation = database.current_task_attempt_generation(task_id)?;
        (task_id, attempt_generation)
    };
    enqueue_task(&state, task_id, attempt_generation).await?;
    Ok((
        StatusCode::ACCEPTED,
        Json(AcceptedResponse {
            accepted: true,
            task_id: Some(task_id),
            root_id: Some(payload.root_id),
            scan: None,
        }),
    ))
}

async fn cancel_task(
    State(state): State<AppState>,
    Path(task_id): Path<i64>,
) -> ApiResult<(StatusCode, Json<AcceptedResponse>)> {
    let task = {
        let database = state.database.lock().expect("database mutex poisoned");
        database
            .cancel_task(task_id)
            .map_err(map_task_action_error)?
    };
    Ok((
        StatusCode::OK,
        Json(AcceptedResponse {
            accepted: true,
            task_id: Some(task.id),
            root_id: task.root_id,
            scan: None,
        }),
    ))
}

async fn retry_task(
    State(state): State<AppState>,
    Path(task_id): Path<i64>,
) -> ApiResult<(StatusCode, Json<AcceptedResponse>)> {
    let task = {
        let database = state.database.lock().expect("database mutex poisoned");
        database
            .retry_task(task_id)
            .map_err(map_task_action_error)?
    };
    enqueue_task(&state, task.id, task.attempt_generation).await?;
    Ok((
        StatusCode::ACCEPTED,
        Json(AcceptedResponse {
            accepted: true,
            task_id: Some(task.id),
            root_id: task.root_id,
            scan: None,
        }),
    ))
}

async fn rename_file(
    State(state): State<AppState>,
    Json(payload): Json<RenameRequestBody>,
) -> ApiResult<Json<FileOperationRecord>> {
    let record = fsops::rename(
        &state.database,
        RenameRequest {
            file_id: payload.file_id,
            folder_id: payload.folder_id,
            new_name: payload.new_name,
        },
    )
    .map_err(map_fsops_error)?;
    Ok(Json(record))
}

async fn move_files(
    State(state): State<AppState>,
    Json(payload): Json<MoveRequestBody>,
) -> ApiResult<Json<FileOperationsResponse>> {
    let operations = fsops::move_items(
        &state.database,
        MoveRequest {
            file_ids: payload.file_ids.unwrap_or_default(),
            folder_ids: payload.folder_ids.unwrap_or_default(),
            target_folder_id: payload.target_folder_id,
        },
    )
    .map_err(map_fsops_error)?;
    Ok(Json(FileOperationsResponse { operations }))
}

async fn delete_files(
    State(state): State<AppState>,
    Json(payload): Json<DeleteRequestBody>,
) -> ApiResult<Json<FileOperationsResponse>> {
    let operations = fsops::delete(
        &state.database,
        DeleteRequest {
            file_ids: payload.file_ids.unwrap_or_default(),
            folder_ids: payload.folder_ids.unwrap_or_default(),
            permanent: payload.permanent.unwrap_or(false),
        },
    )
    .map_err(map_fsops_error)?;
    Ok(Json(FileOperationsResponse { operations }))
}

async fn list_file_operations(
    State(state): State<AppState>,
    Query(query): Query<ListFileOperationsQuery>,
) -> ApiResult<Json<ListResponse<FileOperationRecord>>> {
    let limit = query.limit.unwrap_or(50);
    if !(1..=200).contains(&limit) {
        return Err(CoreError::bad_request(format!(
            "limit must be between 1 and 200: {limit}"
        )));
    }
    let page = fsops::list_recent(&state.database, limit, query.cursor.as_deref())
        .map_err(map_fsops_error)?;
    Ok(Json(ListResponse {
        items: page.items,
        next_cursor: page.next_cursor,
    }))
}

async fn list_plugins(State(state): State<AppState>) -> ApiResult<Json<PluginListResponse>> {
    let database = state.database.lock().expect("database mutex poisoned");
    let items = database.list_plugins()?;
    Ok(Json(PluginListResponse { items }))
}

async fn discover_plugins(
    State(state): State<AppState>,
) -> ApiResult<(StatusCode, Json<PluginDiscoveryResponse>)> {
    let plugins_dir = resolve_plugins_dir(&state);
    // The locked variant performs the disk walk before acquiring the
    // mutex, then reacquires per upsert. This keeps other API endpoints
    // responsive while a large `plugins/` directory is enumerated.
    let report = plugins::discover_and_persist_locked(&state.database, &plugins_dir)?;
    let errors = report
        .errors
        .into_iter()
        .map(|entry| PluginDiscoveryError {
            manifest_path: entry.manifest_path.to_string_lossy().into_owned(),
            message: entry.message,
        })
        .collect();
    Ok((
        StatusCode::ACCEPTED,
        Json(PluginDiscoveryResponse {
            discovered: report.discovered as u64,
            errors,
        }),
    ))
}

async fn get_plugin(
    State(state): State<AppState>,
    Path(plugin_id): Path<String>,
) -> ApiResult<Json<PluginRecord>> {
    let database = state.database.lock().expect("database mutex poisoned");
    let plugin = database
        .get_plugin(&plugin_id)?
        .ok_or_else(|| not_found_plugin(&plugin_id))?;
    Ok(Json(plugin))
}

async fn enable_plugin(
    State(state): State<AppState>,
    Path(plugin_id): Path<String>,
) -> ApiResult<Json<PluginRecord>> {
    let database = state.database.lock().expect("database mutex poisoned");
    let existing = database
        .get_plugin(&plugin_id)?
        .ok_or_else(|| not_found_plugin(&plugin_id))?;
    if existing.status == "invalid" {
        return Err(CoreError::coded(
            StatusCode::CONFLICT,
            "manifest_invalid",
            format!("plugin manifest is invalid and cannot be enabled: {plugin_id}"),
        ));
    }
    let updated = database
        .set_plugin_enabled(&plugin_id, true)?
        .ok_or_else(|| not_found_plugin(&plugin_id))?;
    Ok(Json(updated))
}

async fn disable_plugin(
    State(state): State<AppState>,
    Path(plugin_id): Path<String>,
) -> ApiResult<Json<PluginRecord>> {
    let database = state.database.lock().expect("database mutex poisoned");
    let updated = database
        .set_plugin_enabled(&plugin_id, false)?
        .ok_or_else(|| not_found_plugin(&plugin_id))?;
    Ok(Json(updated))
}

async fn delete_plugin(
    State(state): State<AppState>,
    Path(plugin_id): Path<String>,
) -> ApiResult<Json<DeletePluginResponse>> {
    let database = state.database.lock().expect("database mutex poisoned");
    let deleted = database.delete_plugin(&plugin_id)?;
    if !deleted {
        return Err(not_found_plugin(&plugin_id));
    }
    Ok(Json(DeletePluginResponse { deleted: true }))
}

fn not_found_plugin(plugin_id: &str) -> CoreError {
    CoreError::coded(
        StatusCode::NOT_FOUND,
        "plugin_not_found",
        format!("plugin not found: {plugin_id}"),
    )
}

fn resolve_plugins_dir(state: &AppState) -> std::path::PathBuf {
    // Prefer the directory the startup code already resolved against the
    // active database path. Falling back to the env var or `./plugins`
    // would diverge from `main.rs` and was the root cause of Batch G HIGH 1.
    if let Some(configured) = state.plugins_dir.as_ref() {
        return configured.clone();
    }
    // Defensive fallback for callers that built `AppState` without going
    // through `router_with_config` (test helpers, the deprecated `router`
    // alias). Match the same env-var precedence as
    // `plugins::resolve_plugins_dir` so behavior stays predictable.
    if let Some(value) = std::env::var("MEGLE_PLUGINS_DIR")
        .ok()
        .filter(|s| !s.is_empty())
    {
        return std::path::PathBuf::from(value);
    }
    std::path::PathBuf::from("./plugins")
}

async fn list_tags(State(state): State<AppState>) -> ApiResult<Json<ListResponse<TagRecord>>> {
    let database = state.database.lock().expect("database mutex poisoned");
    let items = database.list_tags()?;
    Ok(Json(ListResponse {
        items,
        next_cursor: None,
    }))
}

async fn create_tag(
    State(state): State<AppState>,
    Json(payload): Json<CreateTagRequestBody>,
) -> ApiResult<(StatusCode, Json<TagRecord>)> {
    let database = state.database.lock().expect("database mutex poisoned");
    let color = payload.color.as_deref();
    let tag = database
        .create_tag(payload.name.as_str(), color)
        .map_err(map_tag_error)?;
    Ok((StatusCode::CREATED, Json(tag)))
}

async fn delete_tag(
    State(state): State<AppState>,
    Path(tag_id): Path<i64>,
) -> ApiResult<Json<DeleteTagResponse>> {
    let database = state.database.lock().expect("database mutex poisoned");
    let deleted = database.delete_tag(tag_id)?;
    if !deleted {
        return Err(CoreError::not_found(format!("tag not found: {tag_id}")));
    }
    Ok(Json(DeleteTagResponse { deleted: true }))
}

async fn get_user_metadata(
    State(state): State<AppState>,
    Path(file_id): Path<i64>,
) -> ApiResult<Json<UserMetadataRecord>> {
    let database = state.database.lock().expect("database mutex poisoned");
    let record = database
        .get_user_metadata(file_id)?
        .ok_or_else(|| CoreError::not_found(format!("media item not found: {file_id}")))?;
    Ok(Json(record))
}

async fn update_user_metadata(
    State(state): State<AppState>,
    Path(file_id): Path<i64>,
    Json(payload): Json<serde_json::Value>,
) -> ApiResult<Json<UserMetadataRecord>> {
    let patch = parse_user_metadata_patch(&payload)?;
    let database = state.database.lock().expect("database mutex poisoned");
    let record = database
        .upsert_user_metadata_partial(file_id, patch)
        .map_err(map_metadata_error)?;
    Ok(Json(record))
}

async fn set_file_tags(
    State(state): State<AppState>,
    Path(file_id): Path<i64>,
    Json(payload): Json<SetFileTagsRequestBody>,
) -> ApiResult<Json<FileTagsResponse>> {
    let database = state.database.lock().expect("database mutex poisoned");
    let tag_ids = database
        .set_file_tags(file_id, &payload.tag_ids)
        .map_err(map_tag_error)?;
    Ok(Json(FileTagsResponse { file_id, tag_ids }))
}

async fn add_file_tag(
    State(state): State<AppState>,
    Path(file_id): Path<i64>,
    Json(payload): Json<AddFileTagRequestBody>,
) -> ApiResult<Json<FileTagsResponse>> {
    let database = state.database.lock().expect("database mutex poisoned");
    let tag_ids = database
        .add_file_tag(file_id, payload.tag_id)
        .map_err(map_tag_error)?;
    Ok(Json(FileTagsResponse { file_id, tag_ids }))
}

async fn remove_file_tag(
    State(state): State<AppState>,
    Path((file_id, tag_id)): Path<(i64, i64)>,
) -> ApiResult<Json<FileTagsResponse>> {
    let database = state.database.lock().expect("database mutex poisoned");
    let tag_ids = database
        .remove_file_tag(file_id, tag_id)
        .map_err(map_tag_error)?;
    Ok(Json(FileTagsResponse { file_id, tag_ids }))
}

async fn search_media(
    State(state): State<AppState>,
    ExtraQuery(query): ExtraQuery<SearchMediaQuery>,
) -> ApiResult<Json<ListResponse<MediaRecord>>> {
    let sort = parse_search_sort(query.sort.as_deref())?.to_string();
    let kind = parse_media_kind(query.kind.as_deref())?.map(str::to_string);
    if let Some(min_rating) = query.min_rating {
        if !(1..=5).contains(&min_rating) {
            return Err(CoreError::bad_request(format!(
                "minRating must be between 1 and 5: {min_rating}"
            )));
        }
    }
    for tag_id in &query.tag_id {
        if *tag_id <= 0 {
            return Err(CoreError::bad_request(format!(
                "tagId must be positive: {tag_id}"
            )));
        }
    }
    let limit = query.limit.unwrap_or(100);
    if !(1..=500).contains(&limit) {
        return Err(CoreError::bad_request(format!(
            "limit must be between 1 and 500: {limit}"
        )));
    }
    let database = state.database.lock().expect("database mutex poisoned");
    let page = database
        .search_media_page(SearchQuery {
            q: query.q,
            root_id: query.root_id,
            folder_id: query.folder_id,
            kind,
            min_rating: query.min_rating,
            favorite: query.favorite,
            tag_ids: query.tag_id,
            sort,
            limit,
            cursor: query.cursor,
        })
        .map_err(map_cursor_error)?;
    Ok(Json(ListResponse {
        items: page.items,
        next_cursor: page.next_cursor,
    }))
}

#[allow(dead_code)]
fn empty_list<T>() -> ListResponse<T> {
    ListResponse {
        items: Vec::new(),
        next_cursor: None,
    }
}

fn accepted() -> AcceptedResponse {
    AcceptedResponse {
        accepted: true,
        task_id: None,
        root_id: None,
        scan: None,
    }
}

fn thumbnail_response(thumbnail: ThumbnailRecord) -> ThumbnailResponse {
    let asset = match (
        thumbnail.state.as_str(),
        thumbnail.cache_key,
        thumbnail.width,
        thumbnail.height,
        thumbnail.byte_size,
    ) {
        ("ready", Some(cache_key), Some(width), Some(height), Some(byte_size)) => {
            Some(ThumbnailAsset {
                cache_key,
                width,
                height,
                byte_size,
            })
        }
        _ => None,
    };
    ThumbnailResponse {
        file_id: thumbnail.file_id,
        profile: thumbnail.profile,
        state: thumbnail.state,
        short_side_px: thumbnail.short_side_px,
        output_format: thumbnail.output_format,
        asset,
        error: thumbnail.error,
        updated_at: thumbnail.updated_at,
    }
}

fn parse_media_sort(value: Option<&str>) -> ApiResult<&'static str> {
    let value = value.unwrap_or("mtime_desc");
    MEDIA_SORT_VALUES
        .iter()
        .copied()
        .find(|candidate| *candidate == value)
        .ok_or_else(|| CoreError::bad_request(format!("unsupported media sort: {value}")))
}

fn parse_search_sort(value: Option<&str>) -> ApiResult<&'static str> {
    let value = value.unwrap_or("mtime_desc");
    SEARCH_SORT_VALUES
        .iter()
        .copied()
        .find(|candidate| *candidate == value)
        .ok_or_else(|| CoreError::bad_request(format!("unsupported search sort: {value}")))
}

fn parse_media_kind(value: Option<&str>) -> ApiResult<Option<&'static str>> {
    let Some(value) = value else {
        return Ok(None);
    };
    MEDIA_KIND_VALUES
        .iter()
        .copied()
        .find(|candidate| *candidate == value)
        .map(Some)
        .ok_or_else(|| CoreError::bad_request(format!("unsupported media kind: {value}")))
}

fn map_cursor_error(error: anyhow::Error) -> CoreError {
    let message = error.to_string();
    if message.contains("invalid media cursor")
        || message.contains("invalid folder cursor")
        || message.contains("invalid cursor hex")
    {
        return CoreError::bad_request(message);
    }
    error.into()
}

fn map_thumbnail_request_error(error: anyhow::Error) -> CoreError {
    let message = error.to_string();
    if message.contains("media item not found") {
        return CoreError::not_found(message);
    }
    if message.contains("unsupported thumbnail profile") {
        return CoreError::bad_request(message);
    }
    error.into()
}

fn map_task_action_error(error: anyhow::Error) -> CoreError {
    let message = error.to_string();
    if message.contains("task not found") {
        return CoreError::not_found(message);
    }
    if message.contains("not cancellable")
        || message.contains("not retryable")
        || message.contains("root is disabled")
        || message.contains("root not found")
        || message.contains("media item not found")
        || message.contains("missing root id")
        || message.contains("missing file id")
    {
        return CoreError::conflict(message);
    }
    error.into()
}

fn map_tag_error(error: TagError) -> CoreError {
    match error {
        TagError::Duplicate => CoreError::conflict("tag name already exists".to_string()),
        TagError::InvalidName => {
            CoreError::bad_request("tag name must be 1..=64 characters".to_string())
        }
        TagError::InvalidColor => {
            CoreError::bad_request("tag color must be #rrggbb hex when provided".to_string())
        }
        TagError::UnknownTagId(tag_id) => CoreError::not_found(format!("tag not found: {tag_id}")),
        TagError::Other(error) => {
            let message = error.to_string();
            if message.contains("media item not found") {
                CoreError::not_found(message)
            } else {
                error.into()
            }
        }
    }
}

fn map_metadata_error(error: anyhow::Error) -> CoreError {
    let message = error.to_string();
    if message.contains("media item not found") {
        return CoreError::not_found(message);
    }
    error.into()
}

fn map_fsops_error(error: FsOpsError) -> CoreError {
    let status = match error.code {
        FsOpsErrorCode::InvalidName | FsOpsErrorCode::InvalidRequest => StatusCode::BAD_REQUEST,
        FsOpsErrorCode::NotFound => StatusCode::NOT_FOUND,
        FsOpsErrorCode::NameConflict
        | FsOpsErrorCode::CrossRoot
        | FsOpsErrorCode::OutsideRoot
        | FsOpsErrorCode::SymlinkRefused => StatusCode::CONFLICT,
        FsOpsErrorCode::FsError => StatusCode::INTERNAL_SERVER_ERROR,
    };
    CoreError::coded(status, error.code.as_str(), error.message)
}

fn parse_user_metadata_patch(value: &serde_json::Value) -> ApiResult<UserMetadataPatch> {
    let object = value.as_object().ok_or_else(|| {
        CoreError::bad_request("metadata update body must be an object".to_string())
    })?;
    let mut patch = UserMetadataPatch::default();

    if let Some(rating_value) = object.get("rating") {
        let rating = if rating_value.is_null() {
            None
        } else {
            let rating = rating_value.as_i64().ok_or_else(|| {
                CoreError::bad_request("rating must be an integer or null".to_string())
            })?;
            if !(0..=5).contains(&rating) {
                return Err(CoreError::bad_request(format!(
                    "rating must be between 0 and 5: {rating}"
                )));
            }
            Some(rating)
        };
        patch.rating = Some(rating);
    }

    if let Some(favorite_value) = object.get("favorite") {
        let favorite = favorite_value
            .as_bool()
            .ok_or_else(|| CoreError::bad_request("favorite must be a boolean".to_string()))?;
        patch.favorite = Some(favorite);
    }

    if let Some(note_value) = object.get("note") {
        let note = if note_value.is_null() {
            None
        } else {
            let note = note_value
                .as_str()
                .ok_or_else(|| CoreError::bad_request("note must be a string or null".to_string()))?
                .trim()
                .to_string();
            if note.chars().count() > 2048 {
                return Err(CoreError::bad_request(
                    "note must be 2048 characters or fewer".to_string(),
                ));
            }
            if note.is_empty() {
                None
            } else {
                Some(note)
            }
        };
        patch.note = Some(note);
    }

    Ok(patch)
}

async fn enqueue_task(state: &AppState, task_id: i64, attempt_generation: i64) -> ApiResult<()> {
    if let Err(error) = state.task_queue.send(task_id).await {
        let error = anyhow::anyhow!("background task queue is closed: {error}");
        let database = state.database.lock().expect("database mutex poisoned");
        database.mark_task_failed_for_attempt(task_id, attempt_generation, &error.to_string())?;
        return Err(error.into());
    }
    Ok(())
}

impl CoreError {
    fn bad_request(message: String) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message,
            code: None,
        }
    }

    fn conflict(message: String) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            message,
            code: None,
        }
    }

    fn not_found(message: String) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message,
            code: None,
        }
    }

    fn coded(status: StatusCode, code: &str, message: String) -> Self {
        Self {
            status,
            message,
            code: Some(code.to_string()),
        }
    }
}

fn fallback_display_name(path: &str) -> String {
    path.trim_end_matches(['\\', '/'])
        .rsplit(['\\', '/'])
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or(path)
        .to_string()
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use axum::body::{to_bytes, Body};
    use axum::http::{header, Method, Request, StatusCode};
    use base64::Engine as _;
    use tower::ServiceExt;

    use super::{fallback_display_name, router};
    use crate::api::{router_with_config, ApiConfig, AppState, BasicAuthCredentials};
    use crate::db::{Database, NewRoot};

    #[test]
    fn fallback_display_name_uses_last_path_component() {
        assert_eq!(fallback_display_name("D:\\Media\\Photos\\"), "Photos");
        assert_eq!(fallback_display_name("D:/Media/Videos"), "Videos");
        assert_eq!(fallback_display_name("D:\\"), "D:");
    }

    #[tokio::test]
    async fn roots_post_queues_scan_and_media_routes_read_after_worker_finishes() {
        let temp_root = unique_temp_dir();
        fs::create_dir_all(temp_root.join("photos")).expect("create photos dir");
        fs::write(temp_root.join("photos").join("image.jpg"), b"fake jpg").expect("write image");
        fs::write(temp_root.join("clip.mp4"), b"fake mp4").expect("write video");
        fs::write(temp_root.join("notes.txt"), b"not media").expect("write notes");

        let db_dir = unique_temp_dir();
        fs::create_dir_all(&db_dir).expect("create db dir");
        let (database, worker_database) = test_database_pair(db_dir.join("megle.sqlite"));
        let state = AppState::new_with_worker(database, worker_database);
        let app = router(state.clone());

        let add_root_body = serde_json::json!({
            "path": temp_root.to_string_lossy(),
            "display_name": "Integration Root"
        });
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/roots")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(add_root_body.to_string()))
                    .expect("build request"),
            )
            .await
            .expect("post root");
        assert_eq!(response.status(), StatusCode::ACCEPTED);
        let body = response_json(response).await;
        assert_eq!(body["accepted"], true);
        let task_id = body["taskId"].as_i64().expect("task id");
        assert!(body["scan"].is_null());
        let root_id = body["rootId"].as_i64().expect("root id");

        wait_for_task_status(&app, task_id, "succeeded").await;

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/roots")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("list roots");
        assert_eq!(response.status(), StatusCode::OK);
        let body = response_json(response).await;
        assert_eq!(body["items"].as_array().expect("items").len(), 1);
        assert_eq!(body["items"][0]["displayName"], "Integration Root");
        assert!(body["items"][0]["lastScanAt"].as_i64().is_some());
        let root_folder_id = body["items"][0]["rootFolderId"]
            .as_i64()
            .expect("root folder id");

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri(format!("/api/folders/{root_folder_id}/children"))
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("list folder children");
        assert_eq!(response.status(), StatusCode::OK);
        let body = response_json(response).await;
        assert_eq!(body["items"].as_array().expect("items").len(), 1);
        assert_eq!(body["items"][0]["name"], "photos");

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/folders/999999/children")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("list missing folder children");
        assert_eq!(response.status(), StatusCode::NOT_FOUND);

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri(format!("/api/media?rootId={root_id}&sort=name_asc"))
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("list media");
        assert_eq!(response.status(), StatusCode::OK);
        let body = response_json(response).await;
        let items = body["items"].as_array().expect("media items");
        assert_eq!(items.len(), 2);
        assert_eq!(items[0]["name"], "clip.mp4");
        assert_eq!(items[1]["name"], "image.jpg");
        let first_id = items[0]["id"].as_i64().expect("media id");

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri(format!("/api/media/{first_id}"))
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("get media");
        assert_eq!(response.status(), StatusCode::OK);
        let body = response_json(response).await;
        assert_eq!(body["id"], first_id);
        assert_eq!(body["name"], "clip.mp4");

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/media/999999")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("get missing media");
        assert_eq!(response.status(), StatusCode::NOT_FOUND);

        let _ = fs::remove_dir_all(temp_root);
        drop(app);
        drop(state);
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        let _ = fs::remove_dir_all(db_dir);
    }

    #[tokio::test]
    async fn thumbnail_route_queues_missing_grid_320_row() {
        let db_dir = unique_temp_dir();
        fs::create_dir_all(&db_dir).expect("create db dir");
        let db_path = db_dir.join("megle.sqlite");
        let database = Database::open(&db_path).expect("open database");
        database.apply_migrations().expect("apply migrations");
        let file_id = seed_media_file(&database);
        let (sender, mut receiver) = tokio::sync::mpsc::channel(4);
        let state = AppState {
            database: std::sync::Arc::new(std::sync::Mutex::new(database)),
            task_queue: sender,
            plugins_dir: None,
            _watcher: None,
        };
        let app = router(state.clone());

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri(format!("/api/media/{file_id}/thumbnail?profile=grid_320"))
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("get thumbnail state");
        assert_eq!(response.status(), StatusCode::ACCEPTED);
        let body = response_json(response).await;
        assert_eq!(body["fileId"], file_id);
        assert_eq!(body["profile"], "grid_320");
        assert_eq!(body["state"], "queued");
        assert_eq!(body["shortSidePx"], 320);
        assert_eq!(body["outputFormat"], "image/webp");
        assert!(body["asset"].is_null());
        let task_id = receiver.try_recv().expect("queued thumbnail task id");
        let database = state.database.lock().expect("database mutex poisoned");
        let tasks = database.list_tasks().expect("list tasks");
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, task_id);
        assert_eq!(tasks[0].kind, "thumbnail");
        assert_eq!(tasks[0].file_id, Some(file_id));

        let _ = fs::remove_dir_all(db_dir);
    }

    #[tokio::test]
    async fn thumbnail_route_queues_missing_thumbnail_once_on_repeated_requests() {
        let database = test_database();
        let file_id = seed_media_file(&database);
        let (sender, mut receiver) = tokio::sync::mpsc::channel(4);
        let state = AppState {
            database: std::sync::Arc::new(std::sync::Mutex::new(database)),
            task_queue: sender,
            plugins_dir: None,
            _watcher: None,
        };
        let app = router(state.clone());

        let first_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri(format!("/api/media/{file_id}/thumbnail?profile=grid_320"))
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("get thumbnail state");
        assert_eq!(first_response.status(), StatusCode::ACCEPTED);
        let first = response_json(first_response).await;
        assert_eq!(first["state"], "queued");

        let queued_task_id = receiver
            .try_recv()
            .expect("first request should enqueue exactly one task");

        let second_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri(format!("/api/media/{file_id}/thumbnail?profile=grid_320"))
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("get thumbnail state again");
        assert_eq!(second_response.status(), StatusCode::ACCEPTED);
        let second = response_json(second_response).await;
        assert_eq!(second["state"], "queued");
        assert!(receiver.try_recv().is_err());

        let database = state.database.lock().expect("database mutex poisoned");
        let tasks = database.list_tasks().expect("list tasks");
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, queued_task_id);
        assert_eq!(tasks[0].kind, "thumbnail");
        assert_eq!(tasks[0].file_id, Some(file_id));
    }

    #[tokio::test]
    async fn thumbnail_route_distinguishes_ready_and_skipped_small_states() {
        let db_dir = unique_temp_dir();
        fs::create_dir_all(&db_dir).expect("create db dir");
        let db_path = db_dir.join("megle.sqlite");
        let database = Database::open(&db_path).expect("open database");
        database.apply_migrations().expect("apply migrations");
        let ready_file_id = seed_media_file(&database);
        let skipped_file_id = seed_media_file_named(&database, "icon.png");
        let ready_source_fingerprint = database
            .get_thumbnail_source(ready_file_id)
            .expect("get ready source")
            .expect("ready source exists")
            .source_fingerprint(crate::thumbnails::GRID_320_PROFILE);
        let skipped_source_fingerprint = database
            .get_thumbnail_source(skipped_file_id)
            .expect("get skipped source")
            .expect("skipped source exists")
            .source_fingerprint(crate::thumbnails::GRID_320_PROFILE);
        drop(database);

        let conn = rusqlite::Connection::open(&db_path).expect("open seed connection");
        conn.execute(
            "UPDATE media SET width = 640, height = 480, metadata_status = 'ready' WHERE file_id = ?1",
            [ready_file_id],
        )
        .expect("set ready media dimensions");
        conn.execute(
            "UPDATE media SET width = 128, height = 128, metadata_status = 'ready' WHERE file_id = ?1",
            [skipped_file_id],
        )
        .expect("set skipped-small media dimensions");
        conn.execute(
            r#"
            INSERT INTO thumbs(
                file_id, profile, state, cache_key, width, height, byte_size,
                source_fingerprint, updated_at
            )
            VALUES (?1, 'grid_320', 'ready', 'aa/bb/key.webp', 427, 320, 4096, ?2, 10)
            "#,
            (ready_file_id, ready_source_fingerprint),
        )
        .expect("insert ready thumbnail");
        conn.execute(
            r#"
            INSERT INTO thumbs(file_id, profile, state, source_fingerprint, updated_at)
            VALUES (?1, 'grid_320', 'skipped_small', ?2, 11)
            "#,
            (skipped_file_id, skipped_source_fingerprint),
        )
        .expect("insert skipped thumbnail");
        drop(conn);

        let database = Database::open(&db_path).expect("reopen database");
        database.apply_migrations().expect("apply migrations");
        let app = router(AppState::new(database));

        let ready_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri(format!(
                        "/api/media/{ready_file_id}/thumbnail?profile=grid_320"
                    ))
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("get ready thumbnail state");
        assert_eq!(ready_response.status(), StatusCode::OK);
        let ready = response_json(ready_response).await;
        assert_eq!(ready["state"], "ready");
        assert_eq!(ready["asset"]["cacheKey"], "aa/bb/key.webp");
        assert_eq!(ready["asset"]["width"], 427);
        assert_eq!(ready["asset"]["height"], 320);
        assert_eq!(ready["asset"]["byteSize"], 4096);

        let skipped_response = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri(format!(
                        "/api/media/{skipped_file_id}/thumbnail?profile=grid_320"
                    ))
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("get skipped thumbnail state");
        assert_eq!(skipped_response.status(), StatusCode::OK);
        let skipped = response_json(skipped_response).await;
        assert_eq!(skipped["state"], "skipped_small");
        assert_eq!(skipped["profile"], "grid_320");
        assert!(skipped["asset"].is_null());

        let _ = fs::remove_dir_all(db_dir);
    }

    #[tokio::test]
    async fn thumbnail_route_handles_queued_failed_bad_profile_and_missing_media() {
        let db_dir = unique_temp_dir();
        fs::create_dir_all(&db_dir).expect("create db dir");
        let db_path = db_dir.join("megle.sqlite");
        let database = Database::open(&db_path).expect("open database");
        database.apply_migrations().expect("apply migrations");
        let queued_file_id = seed_media_file(&database);
        let failed_current_file_id = seed_media_file_named(&database, "failed-current.jpg");
        let failed_current_source_fingerprint = database
            .get_thumbnail_source(failed_current_file_id)
            .expect("get failed source")
            .expect("failed source exists")
            .source_fingerprint(crate::thumbnails::GRID_320_PROFILE);
        drop(database);

        let conn = rusqlite::Connection::open(&db_path).expect("open seed connection");
        conn.execute(
            r#"
            INSERT INTO thumbs(file_id, profile, state, cache_key, width, height, byte_size, updated_at)
            VALUES (?1, 'grid_320', 'queued', 'queued/stale.webp', 320, 240, 1024, 20)
            "#,
            [queued_file_id],
        )
        .expect("insert queued thumbnail");
        conn.execute(
            r#"
            INSERT INTO thumbs(
                file_id, profile, state, cache_key, width, height, byte_size,
                error, source_fingerprint, updated_at
            )
            VALUES (?1, 'grid_320', 'failed', 'failed/stale.webp', 320, 240, 1024, 'decode failed', ?2, 21)
            "#,
            (failed_current_file_id, failed_current_source_fingerprint),
        )
        .expect("insert failed thumbnail");
        drop(conn);

        let database = Database::open(&db_path).expect("reopen database");
        database.apply_migrations().expect("apply migrations");
        let app = router(AppState::new(database));

        let queued_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri(format!(
                        "/api/media/{queued_file_id}/thumbnail?profile=grid_320"
                    ))
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("get queued thumbnail state");
        assert_eq!(queued_response.status(), StatusCode::ACCEPTED);
        let queued = response_json(queued_response).await;
        assert_eq!(queued["state"], "queued");
        assert!(queued["asset"].is_null());

        let failed_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri(format!(
                        "/api/media/{failed_current_file_id}/thumbnail?profile=grid_320"
                    ))
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("get failed thumbnail state");
        assert_eq!(failed_response.status(), StatusCode::OK);
        let failed = response_json(failed_response).await;
        assert_eq!(failed["state"], "failed");
        assert_eq!(failed["error"], "decode failed");
        assert!(failed["asset"].is_null());

        let bad_profile = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri(format!(
                        "/api/media/{queued_file_id}/thumbnail?profile=grid"
                    ))
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("get thumbnail with bad profile");
        assert_eq!(bad_profile.status(), StatusCode::BAD_REQUEST);

        let missing = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/media/999999/thumbnail?profile=grid_320")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("get missing thumbnail");
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);

        let _ = fs::remove_dir_all(db_dir);
    }

    #[tokio::test]
    async fn thumbnail_route_requeues_failed_thumbnail_without_current_source_fingerprint() {
        let database = test_database();
        let null_failed_file_id = seed_media_file_named(&database, "failed-null.jpg");
        let stale_failed_file_id = seed_media_file_named(&database, "failed-stale.jpg");
        database
            .upsert_thumbnail_state(crate::db::ThumbnailStateUpsert {
                file_id: null_failed_file_id,
                profile: crate::thumbnails::GRID_320_PROFILE.to_string(),
                state: "failed".to_string(),
                cache_key: None,
                width: None,
                height: None,
                byte_size: None,
                error: Some("decode failed".to_string()),
                source_fingerprint: None,
            })
            .expect("insert null fingerprint failed thumbnail");
        database
            .upsert_thumbnail_state(crate::db::ThumbnailStateUpsert {
                file_id: stale_failed_file_id,
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
            .expect("insert stale fingerprint failed thumbnail");
        let (sender, mut receiver) = tokio::sync::mpsc::channel(4);
        let state = AppState {
            database: std::sync::Arc::new(std::sync::Mutex::new(database)),
            task_queue: sender,
            plugins_dir: None,
            _watcher: None,
        };
        let app = router(state);

        for file_id in [null_failed_file_id, stale_failed_file_id] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method(Method::GET)
                        .uri(format!("/api/media/{file_id}/thumbnail?profile=grid_320"))
                        .body(Body::empty())
                        .expect("build request"),
                )
                .await
                .expect("get failed thumbnail state");
            assert_eq!(response.status(), StatusCode::ACCEPTED);
            let body = response_json(response).await;
            assert_eq!(body["state"], "queued");
            assert!(body["asset"].is_null());
            receiver.try_recv().expect("queued thumbnail task id");
        }
    }

    #[tokio::test]
    async fn tasks_routes_list_queued_tasks_and_enqueue_scan_for_existing_root() {
        let temp_root = unique_temp_dir();
        fs::create_dir_all(&temp_root).expect("create root dir");
        let db_dir = unique_temp_dir();
        fs::create_dir_all(&db_dir).expect("create db dir");
        let (database, worker_database) = test_database_pair(db_dir.join("megle.sqlite"));
        let root_id = database
            .add_root(crate::db::NewRoot {
                path: temp_root.to_string_lossy().into_owned(),
                display_name: "Existing Root".to_string(),
            })
            .expect("add root");
        let state = AppState::new_with_worker(database, worker_database);
        let app = router(state);

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/tasks/scan")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::json!({ "rootId": root_id }).to_string(),
                    ))
                    .expect("build request"),
            )
            .await
            .expect("enqueue scan");
        assert_eq!(response.status(), StatusCode::ACCEPTED);
        let body = response_json(response).await;
        assert_eq!(body["accepted"], true);
        let task_id = body["taskId"].as_i64().expect("task id");
        assert_eq!(body["rootId"], root_id);
        assert!(body["scan"].is_null());

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/tasks")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("list tasks");
        assert_eq!(response.status(), StatusCode::OK);
        let body = response_json(response).await;
        let tasks = body["items"].as_array().expect("task items");
        assert!(tasks.iter().any(|task| {
            task["id"] == task_id
                && task["kind"] == "root_scan"
                && task["rootId"] == root_id
                && task["fileId"].is_null()
        }));

        wait_for_task_status(&app, task_id, "succeeded").await;
        let _ = fs::remove_dir_all(temp_root);
        drop(app);
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        let _ = fs::remove_dir_all(db_dir);
    }

    #[tokio::test]
    async fn worker_startup_processes_persisted_pending_root_scan_task() {
        let temp_root = unique_temp_dir();
        fs::create_dir_all(&temp_root).expect("create root dir");
        fs::write(temp_root.join("image.jpg"), b"fake jpg").expect("write image");
        let db_dir = unique_temp_dir();
        fs::create_dir_all(&db_dir).expect("create db dir");
        let db_path = db_dir.join("megle.sqlite");

        let database = Database::open(&db_path).expect("open database");
        database.apply_migrations().expect("apply migrations");
        let root_id = database
            .add_root(crate::db::NewRoot {
                path: temp_root.to_string_lossy().into_owned(),
                display_name: "Recovered Pending Root".to_string(),
            })
            .expect("add root");
        let task_id = database
            .create_root_scan_task(root_id)
            .expect("create root scan task");
        drop(database);

        let database = Database::open(&db_path).expect("reopen database");
        let worker_database = Database::open(&db_path).expect("reopen worker database");
        let state = AppState::new_with_worker(database, worker_database);
        let app = router(state);

        wait_for_task_status(&app, task_id, "succeeded").await;
        wait_for_media_count(&app, root_id, 1).await;

        drop(app);
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        let _ = fs::remove_dir_all(temp_root);
        let _ = fs::remove_dir_all(db_dir);
    }

    #[tokio::test]
    async fn root_scan_task_lists_final_progress_counters_after_worker_completes() {
        let temp_root = unique_temp_dir();
        fs::create_dir_all(temp_root.join("photos")).expect("create photos dir");
        fs::write(temp_root.join("photos").join("image.jpg"), b"fake jpg").expect("write image");
        fs::write(temp_root.join("clip.mp4"), b"fake mp4").expect("write video");
        fs::write(temp_root.join("notes.txt"), b"not media").expect("write skipped file");
        let db_dir = unique_temp_dir();
        fs::create_dir_all(&db_dir).expect("create db dir");
        let (database, worker_database) = test_database_pair(db_dir.join("megle.sqlite"));
        let root_id = database
            .add_root(crate::db::NewRoot {
                path: temp_root.to_string_lossy().into_owned(),
                display_name: "Progress Root".to_string(),
            })
            .expect("add root");
        let state = AppState::new_with_worker(database, worker_database);
        let app = router(state);

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/tasks/scan")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::json!({ "rootId": root_id }).to_string(),
                    ))
                    .expect("build request"),
            )
            .await
            .expect("enqueue scan");
        assert_eq!(response.status(), StatusCode::ACCEPTED);
        let task_id = response_json(response).await["taskId"]
            .as_i64()
            .expect("task id");

        let task = wait_for_task_status(&app, task_id, "succeeded").await;
        assert_eq!(task["itemsSeen"], 4);
        assert!(task["itemsTotal"].is_null());
        assert_eq!(task["foldersSeen"], 2);
        assert_eq!(task["mediaFilesSeen"], 2);
        assert_eq!(task["skippedFiles"], 1);

        drop(app);
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        fs::remove_dir_all(temp_root).expect("cleanup temp root");
        let _ = fs::remove_dir_all(db_dir);
    }

    #[tokio::test]
    async fn worker_startup_resets_and_processes_stale_running_root_scan_task() {
        let temp_root = unique_temp_dir();
        fs::create_dir_all(&temp_root).expect("create root dir");
        fs::write(temp_root.join("image.jpg"), b"fake jpg").expect("write image");
        let db_dir = unique_temp_dir();
        fs::create_dir_all(&db_dir).expect("create db dir");
        let db_path = db_dir.join("megle.sqlite");

        let database = Database::open(&db_path).expect("open database");
        database.apply_migrations().expect("apply migrations");
        let root_id = database
            .add_root(crate::db::NewRoot {
                path: temp_root.to_string_lossy().into_owned(),
                display_name: "Recovered Running Root".to_string(),
            })
            .expect("add root");
        let task_id = database
            .create_root_scan_task(root_id)
            .expect("create root scan task");
        database
            .mark_task_running_current_attempt_for_test(task_id)
            .expect("mark task running");
        drop(database);

        let database = Database::open(&db_path).expect("reopen database");
        let worker_database = Database::open(&db_path).expect("reopen worker database");
        let state = AppState::new_with_worker(database, worker_database);
        let app = router(state);

        wait_for_task_status(&app, task_id, "succeeded").await;
        wait_for_media_count(&app, root_id, 1).await;

        drop(app);
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        fs::remove_dir_all(temp_root).expect("cleanup temp root");
        let _ = fs::remove_dir_all(db_dir);
    }

    #[tokio::test]
    async fn tasks_scan_returns_not_found_for_missing_root() {
        let app = router(AppState::new(test_database()));

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/tasks/scan")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::json!({ "rootId": 999999 }).to_string(),
                    ))
                    .expect("build request"),
            )
            .await
            .expect("enqueue missing scan");
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let body = response_json(response).await;
        assert!(body["error"]
            .as_str()
            .expect("error")
            .contains("root not found"));
    }

    #[tokio::test]
    async fn media_and_folder_routes_return_bad_request_for_invalid_cursors() {
        let database = test_database();
        let root_id = database
            .add_root(crate::db::NewRoot {
                path: "D:/Pictures".to_string(),
                display_name: "Pictures".to_string(),
            })
            .expect("add root");
        let root_folder_id = database
            .upsert_folder(crate::db::FolderUpsert {
                root_id,
                parent_id: None,
                name: String::new(),
                path_hash: "root-hash".to_string(),
                mtime: Some(1),
            })
            .expect("insert root folder");
        let app = router(AppState::new(database));

        for uri in [
            "/api/media?cursor=not-a-cursor".to_string(),
            "/api/media?cursor=v1:media:mtime_desc:not-an-id:123".to_string(),
            "/api/media?cursor=v1:media:mtime_desc:1:not-a-mtime".to_string(),
            "/api/media?sort=name_asc&cursor=v1:media:name_asc:1:c3".to_string(),
            format!("/api/folders/{root_folder_id}/children?cursor=not-a-cursor"),
            format!("/api/folders/{root_folder_id}/children?cursor=v1:folder:not-an-id:616263"),
            format!("/api/folders/{root_folder_id}/children?cursor=v1:folder:1:c3"),
        ] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method(Method::GET)
                        .uri(uri)
                        .body(Body::empty())
                        .expect("build request"),
                )
                .await
                .expect("request with invalid cursor");
            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        }
    }

    #[tokio::test]
    async fn media_route_returns_bad_request_for_unknown_sort_or_kind() {
        let app = router(AppState::new(test_database()));

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/media?sort=size_asc")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("list media with bad sort");
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/media?kind=document")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("list media with bad kind");
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn roots_post_rejects_nonexistent_path_without_creating_task() {
        let state = AppState::new(test_database());
        let app = router(state.clone());
        let missing_path = unique_temp_dir().join("missing");

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/roots")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::json!({ "path": missing_path }).to_string(),
                    ))
                    .expect("build request"),
            )
            .await
            .expect("post missing root");

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let database = state.database.lock().expect("database mutex poisoned");
        assert!(database.list_roots().expect("list roots").is_empty());
        assert!(database.list_tasks().expect("list tasks").is_empty());
    }

    #[tokio::test]
    async fn remove_root_hides_root_media_and_rejects_future_scans() {
        let temp_root = unique_temp_dir();
        fs::create_dir_all(&temp_root).expect("create root dir");
        fs::write(temp_root.join("image.jpg"), b"fake jpg").expect("write image");
        let db_dir = unique_temp_dir();
        fs::create_dir_all(&db_dir).expect("create db dir");
        let (database, worker_database) = test_database_pair(db_dir.join("megle.sqlite"));
        let root_id = database
            .add_root(crate::db::NewRoot {
                path: temp_root.to_string_lossy().into_owned(),
                display_name: "Remove Root".to_string(),
            })
            .expect("add root");
        let task_id = database
            .create_root_scan_task(root_id)
            .expect("create root scan task");
        let state = AppState::new_with_worker(database, worker_database);
        let app = router(state);
        wait_for_task_status(&app, task_id, "succeeded").await;
        wait_for_media_count(&app, root_id, 1).await;

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::DELETE)
                    .uri(format!("/api/roots/{root_id}"))
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("delete root");
        assert_eq!(response.status(), StatusCode::ACCEPTED);

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/roots")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("list roots");
        assert_eq!(response.status(), StatusCode::OK);
        let body = response_json(response).await;
        assert!(body["items"].as_array().expect("root items").is_empty());

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri(format!("/api/media?rootId={root_id}&sort=name_asc"))
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("list media");
        assert_eq!(response.status(), StatusCode::OK);
        let body = response_json(response).await;
        assert!(body["items"].as_array().expect("media items").is_empty());

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/tasks/scan")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::json!({ "rootId": root_id }).to_string(),
                    ))
                    .expect("build request"),
            )
            .await
            .expect("enqueue scan for disabled root");
        assert_eq!(response.status(), StatusCode::CONFLICT);

        drop(app);
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        fs::remove_dir_all(temp_root).expect("cleanup temp root");
        let _ = fs::remove_dir_all(db_dir);
    }

    #[tokio::test]
    async fn disabled_pending_root_scan_recovered_at_startup_fails_without_scanning() {
        let temp_root = unique_temp_dir();
        fs::create_dir_all(&temp_root).expect("create root dir");
        fs::write(temp_root.join("image.jpg"), b"fake jpg").expect("write image");
        let db_dir = unique_temp_dir();
        fs::create_dir_all(&db_dir).expect("create db dir");
        let db_path = db_dir.join("megle.sqlite");

        let database = Database::open(&db_path).expect("open database");
        database.apply_migrations().expect("apply migrations");
        let root_id = database
            .add_root(crate::db::NewRoot {
                path: temp_root.to_string_lossy().into_owned(),
                display_name: "Disabled Pending Root".to_string(),
            })
            .expect("add root");
        let task_id = database
            .create_root_scan_task(root_id)
            .expect("create root scan task");
        database.disable_root(root_id).expect("disable root");
        drop(database);

        let database = Database::open(&db_path).expect("reopen database");
        let worker_database = Database::open(&db_path).expect("reopen worker database");
        let state = AppState::new_with_worker(database, worker_database);
        let app = router(state.clone());

        let task = wait_for_task_status(&app, task_id, "failed").await;
        assert!(task["error"]
            .as_str()
            .expect("task error")
            .contains("disabled"));

        let file_count: i64 = rusqlite::Connection::open(&db_path)
            .expect("open verification database")
            .query_row("SELECT COUNT(*) FROM files", [], |row| row.get(0))
            .expect("count files");
        assert_eq!(file_count, 0);

        drop(app);
        drop(state);
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        fs::remove_dir_all(temp_root).expect("cleanup temp root");
        let _ = fs::remove_dir_all(db_dir);
    }

    #[tokio::test]
    async fn enqueue_failure_marks_created_task_failed() {
        let temp_root = unique_temp_dir();
        fs::create_dir_all(&temp_root).expect("create root dir");
        let database = test_database();
        let root_id = database
            .add_root(crate::db::NewRoot {
                path: temp_root.to_string_lossy().into_owned(),
                display_name: "Existing Root".to_string(),
            })
            .expect("add root");
        let (_sender, receiver) = tokio::sync::mpsc::channel(1);
        drop(receiver);
        let state = AppState {
            database: std::sync::Arc::new(std::sync::Mutex::new(database)),
            task_queue: _sender,
            plugins_dir: None,
            _watcher: None,
        };
        let app = router(state.clone());

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/tasks/scan")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::json!({ "rootId": root_id }).to_string(),
                    ))
                    .expect("build request"),
            )
            .await
            .expect("enqueue scan");
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);

        let database = state.database.lock().expect("database mutex poisoned");
        let tasks = database.list_tasks().expect("list tasks");
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].status, "failed");
        assert!(tasks[0]
            .error
            .as_deref()
            .expect("task error")
            .contains("background task queue is closed"));
        fs::remove_dir_all(temp_root).expect("cleanup temp root");
    }

    #[tokio::test]
    async fn thumbnail_enqueue_failure_marks_task_failed_without_terminal_thumbnail_publish() {
        let database = test_database();
        let file_id = seed_media_file(&database);
        let (_sender, receiver) = tokio::sync::mpsc::channel(1);
        drop(receiver);
        let state = AppState {
            database: std::sync::Arc::new(std::sync::Mutex::new(database)),
            task_queue: _sender,
            plugins_dir: None,
            _watcher: None,
        };
        let app = router(state.clone());

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri(format!("/api/media/{file_id}/thumbnail?profile=grid_320"))
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("get thumbnail");
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);

        let database = state.database.lock().expect("database mutex poisoned");
        let tasks = database.list_tasks().expect("list tasks");
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].kind, "thumbnail");
        assert_eq!(tasks[0].status, "failed");
        let thumbnail = database
            .get_thumbnail(file_id, crate::thumbnails::GRID_320_PROFILE)
            .expect("get thumbnail")
            .expect("thumbnail exists");
        assert_eq!(thumbnail.state, "queued");
        assert_eq!(thumbnail.error, None);
    }

    #[tokio::test]
    async fn task_cancel_and_retry_routes_update_task_and_enqueue_retry() {
        let database = test_database();
        let root_id = database
            .add_root(crate::db::NewRoot {
                path: "D:/Pictures/Action Root".to_string(),
                display_name: "Action Root".to_string(),
            })
            .expect("add root");
        let task_id = database
            .create_root_scan_task(root_id)
            .expect("create task");
        let (sender, mut receiver) = tokio::sync::mpsc::channel(4);
        let state = AppState {
            database: std::sync::Arc::new(std::sync::Mutex::new(database)),
            task_queue: sender,
            plugins_dir: None,
            _watcher: None,
        };
        let app = router(state.clone());

        let cancel_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri(format!("/api/tasks/{task_id}/cancel"))
                    .body(Body::empty())
                    .expect("build cancel request"),
            )
            .await
            .expect("cancel task");
        assert_eq!(cancel_response.status(), StatusCode::OK);
        let cancel_body = response_json(cancel_response).await;
        assert_eq!(cancel_body["accepted"], true);
        assert_eq!(cancel_body["taskId"], task_id);
        assert!(receiver.try_recv().is_err());

        let retry_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri(format!("/api/tasks/{task_id}/retry"))
                    .body(Body::empty())
                    .expect("build retry request"),
            )
            .await
            .expect("retry task");
        assert_eq!(retry_response.status(), StatusCode::ACCEPTED);
        let retry_body = response_json(retry_response).await;
        assert_eq!(retry_body["accepted"], true);
        assert_eq!(retry_body["taskId"], task_id);
        assert_eq!(retry_body["rootId"], root_id);
        assert_eq!(receiver.try_recv().expect("retry enqueued task"), task_id);

        let database = state.database.lock().expect("database mutex poisoned");
        let task = database
            .get_task(task_id)
            .expect("get task")
            .expect("task exists");
        assert_eq!(task.status, "pending");
    }

    #[tokio::test]
    async fn task_action_routes_return_not_found_and_conflict_for_invalid_actions() {
        let database = test_database();
        let root_id = database
            .add_root(crate::db::NewRoot {
                path: "D:/Pictures/Finished Root".to_string(),
                display_name: "Finished Root".to_string(),
            })
            .expect("add root");
        let task_id = database
            .create_root_scan_task(root_id)
            .expect("create task");
        database
            .mark_task_running_current_attempt_for_test(task_id)
            .expect("mark running");
        database
            .mark_task_succeeded_current_attempt_for_test(task_id)
            .expect("mark succeeded");
        let state = AppState::new(database);
        let app = router(state);

        let missing_cancel = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/tasks/999999/cancel")
                    .body(Body::empty())
                    .expect("build missing cancel request"),
            )
            .await
            .expect("cancel missing task");
        assert_eq!(missing_cancel.status(), StatusCode::NOT_FOUND);

        let retry_finished = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri(format!("/api/tasks/{task_id}/retry"))
                    .body(Body::empty())
                    .expect("build retry finished request"),
            )
            .await
            .expect("retry finished task");
        assert_eq!(retry_finished.status(), StatusCode::CONFLICT);

        let cancel_finished = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri(format!("/api/tasks/{task_id}/cancel"))
                    .body(Body::empty())
                    .expect("build cancel finished request"),
            )
            .await
            .expect("cancel finished task");
        assert_eq!(cancel_finished.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn configured_session_token_is_required_for_api_routes() {
        let app = router_with_config(
            test_database(),
            ApiConfig {
                session_token: Some("test-session".to_string()),
                allowed_origin: None,
                ..ApiConfig::default()
            },
        );

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/health")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("missing token request");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/health")
                    .header("x-megle-session", "wrong-session")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("wrong token request");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/health")
                    .header("x-megle-session", "test-session")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("correct token request");
        assert_eq!(response.status(), StatusCode::OK);
    }

    /// Empty-string env vars (e.g. `${MEGLE_SESSION_TOKEN:-}` from
    /// `compose.yaml`) used to be threaded into `ApiConfig.session_token` as
    /// `Some("")`, which made the auth middleware compare every incoming
    /// request to the empty string and reject `/api/health` with 401. Startup
    /// in `main.rs` now filters empty strings out of the optional credential
    /// vars so they collapse to `None`. This test documents the resulting
    /// behavior: with an unconfigured token the API (and `/api/health`) is
    /// reachable without any session header.
    #[tokio::test]
    async fn empty_string_session_token_does_not_reject_health() {
        // What `main.rs` produces from `MEGLE_SESSION_TOKEN=""`: filtered to
        // `None`, identical to the var being unset.
        let session_token = Some(String::new()).filter(|s: &String| !s.is_empty());
        assert!(
            session_token.is_none(),
            "empty string must collapse to None"
        );

        let app = router_with_config(
            test_database(),
            ApiConfig {
                session_token,
                ..ApiConfig::default()
            },
        );

        // No `X-Megle-Session` header at all should now succeed.
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/health")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("missing header request");
        assert_eq!(response.status(), StatusCode::OK);

        // An empty header value should also succeed since no token is
        // configured.
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/health")
                    .header("x-megle-session", "")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("empty header request");
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn configured_cors_allows_only_the_exact_development_origin() {
        let app = router_with_config(
            test_database(),
            ApiConfig {
                session_token: Some("test-session".to_string()),
                allowed_origin: Some("http://127.0.0.1:5173".parse().expect("origin")),
                ..ApiConfig::default()
            },
        );

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::OPTIONS)
                    .uri("/api/health")
                    .header(header::ORIGIN, "http://127.0.0.1:5173")
                    .header(header::ACCESS_CONTROL_REQUEST_METHOD, "GET")
                    .header(header::ACCESS_CONTROL_REQUEST_HEADERS, "x-megle-session")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("cors preflight");

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN),
            Some(&"http://127.0.0.1:5173".parse().expect("origin header"))
        );
        let allow_headers = response
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_HEADERS)
            .and_then(|value| value.to_str().ok())
            .expect("allow headers")
            .to_ascii_lowercase();
        assert!(allow_headers.contains("content-type"));
        assert!(allow_headers.contains("x-megle-session"));
        assert_ne!(
            response.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN),
            Some(&"*".parse().expect("wildcard header"))
        );

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::OPTIONS)
                    .uri("/api/health")
                    .header(header::ORIGIN, "http://127.0.0.1:5174")
                    .header(header::ACCESS_CONTROL_REQUEST_METHOD, "GET")
                    .header(header::ACCESS_CONTROL_REQUEST_HEADERS, "x-megle-session")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("disallowed cors preflight");
        assert_ne!(
            response.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN),
            Some(&"http://127.0.0.1:5174".parse().expect("origin header"))
        );
    }

    #[tokio::test]
    async fn create_tag_returns_201_then_409_on_duplicate_and_400_on_empty() {
        let app = router(AppState::new(test_database()));

        let create = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/tags")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::json!({ "name": "Vacation", "color": "#aabbcc" }).to_string(),
                    ))
                    .expect("build create request"),
            )
            .await
            .expect("create tag");
        assert_eq!(create.status(), StatusCode::CREATED);
        let body = response_json(create).await;
        assert_eq!(body["name"], "Vacation");
        assert_eq!(body["color"], "#aabbcc");

        let duplicate = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/tags")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::json!({ "name": "Vacation" }).to_string(),
                    ))
                    .expect("build duplicate request"),
            )
            .await
            .expect("duplicate tag");
        assert_eq!(duplicate.status(), StatusCode::CONFLICT);

        let invalid = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/tags")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(serde_json::json!({ "name": "   " }).to_string()))
                    .expect("build invalid request"),
            )
            .await
            .expect("invalid tag");
        assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);

        let bad_color = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/tags")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::json!({ "name": "Other", "color": "blue" }).to_string(),
                    ))
                    .expect("build bad color request"),
            )
            .await
            .expect("invalid color");
        assert_eq!(bad_color.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn update_user_metadata_validates_rating_and_returns_404_for_missing_file() {
        let database = test_database();
        let file_id = seed_media_file(&database);
        let app = router(AppState::new(database));

        let valid = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::PUT)
                    .uri(format!("/api/media/{file_id}/metadata"))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "rating": 4,
                            "favorite": true,
                            "note": "trip notes"
                        })
                        .to_string(),
                    ))
                    .expect("build request"),
            )
            .await
            .expect("update metadata");
        assert_eq!(valid.status(), StatusCode::OK);
        let body = response_json(valid).await;
        assert_eq!(body["fileId"], file_id);
        assert_eq!(body["rating"], 4);
        assert_eq!(body["favorite"], true);
        assert_eq!(body["note"], "trip notes");

        let invalid = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::PUT)
                    .uri(format!("/api/media/{file_id}/metadata"))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(serde_json::json!({ "rating": 6 }).to_string()))
                    .expect("build invalid request"),
            )
            .await
            .expect("invalid rating");
        assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);

        let missing = app
            .oneshot(
                Request::builder()
                    .method(Method::PUT)
                    .uri("/api/media/999999/metadata")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::json!({ "favorite": true }).to_string(),
                    ))
                    .expect("build missing request"),
            )
            .await
            .expect("missing file");
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn add_file_tag_returns_404_for_unknown_tag_and_200_for_existing() {
        let database = test_database();
        let file_id = seed_media_file(&database);
        let tag = database.create_tag("trip", None).expect("create tag");
        let app = router(AppState::new(database));

        let unknown = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri(format!("/api/media/{file_id}/tags"))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::json!({ "tagId": 99999 }).to_string(),
                    ))
                    .expect("build unknown tag request"),
            )
            .await
            .expect("unknown tag");
        assert_eq!(unknown.status(), StatusCode::NOT_FOUND);

        let added = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri(format!("/api/media/{file_id}/tags"))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::json!({ "tagId": tag.id }).to_string(),
                    ))
                    .expect("build add tag request"),
            )
            .await
            .expect("add tag");
        assert_eq!(added.status(), StatusCode::OK);
        let body = response_json(added).await;
        assert_eq!(body["fileId"], file_id);
        assert_eq!(body["tagIds"], serde_json::json!([tag.id]));
    }

    #[tokio::test]
    async fn search_route_filters_by_kind_and_query_and_respects_rating_desc_null_last() {
        let database = test_database();
        let root_id = database
            .add_root(NewRoot {
                path: "D:/Search Route Root".to_string(),
                display_name: "Search Route".to_string(),
            })
            .expect("add root");
        let folder_id = database
            .upsert_folder(crate::db::FolderUpsert {
                root_id,
                parent_id: None,
                name: String::new(),
                path_hash: "search-route".to_string(),
                mtime: Some(1),
            })
            .expect("seed folder");

        let mut file_ids = Vec::new();
        for (name, ext, mtime, kind) in [
            ("foo image.jpg", ".jpg", 100, "image"),
            ("bar image.jpg", ".jpg", 200, "image"),
            ("foo clip.mp4", ".mp4", 300, "video"),
        ] {
            let id = database
                .upsert_file(crate::db::FileUpsert {
                    root_id,
                    folder_id,
                    name: name.to_string(),
                    ext: ext.to_string(),
                    size: 100,
                    mtime,
                    ctime: None,
                    file_key: None,
                })
                .expect("insert file");
            database
                .upsert_media_kind(id, kind)
                .expect("upsert media kind");
            file_ids.push(id);
        }
        // Set ratings so rating_desc has a deterministic ordering.
        database
            .upsert_user_metadata_partial(
                file_ids[1],
                crate::db::UserMetadataPatch {
                    rating: Some(Some(5)),
                    favorite: None,
                    note: None,
                },
            )
            .expect("rate bar image");
        database
            .upsert_user_metadata_partial(
                file_ids[0],
                crate::db::UserMetadataPatch {
                    rating: Some(Some(2)),
                    favorite: None,
                    note: None,
                },
            )
            .expect("rate foo image");
        let app = router(AppState::new(database));

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri(format!("/api/search?q=foo&kind=image&rootId={root_id}"))
                    .body(Body::empty())
                    .expect("build search request"),
            )
            .await
            .expect("search request");
        assert_eq!(response.status(), StatusCode::OK);
        let body = response_json(response).await;
        let items = body["items"].as_array().expect("items");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["id"], file_ids[0]);
        assert_eq!(items[0]["name"], "foo image.jpg");

        let rated = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri(format!("/api/search?rootId={root_id}&sort=rating_desc"))
                    .body(Body::empty())
                    .expect("build rating request"),
            )
            .await
            .expect("rating search request");
        assert_eq!(rated.status(), StatusCode::OK);
        let body = response_json(rated).await;
        let items = body["items"].as_array().expect("rated items");
        assert_eq!(items.len(), 3);
        // First two are rated 5, then 2.
        assert_eq!(items[0]["id"], file_ids[1]);
        assert_eq!(items[1]["id"], file_ids[0]);
        // The unrated video comes last.
        assert_eq!(items[2]["id"], file_ids[2]);
        assert!(items[2]["rating"].is_null());
    }

    #[tokio::test]
    async fn search_with_multiple_tag_ids_filters_by_and() {
        // The search route must collect repeated `tagId` query parameters
        // into a Vec and AND them together. Stock `axum::extract::Query`
        // collapses duplicate keys, so we use `axum_extra`'s Query for
        // this handler. This regression test exercises that wiring with
        // two `tagId` values.
        let database = test_database();
        let root_id = database
            .add_root(NewRoot {
                path: "D:/Search Tags Root".to_string(),
                display_name: "Search Tags".to_string(),
            })
            .expect("add root");
        let folder_id = database
            .upsert_folder(crate::db::FolderUpsert {
                root_id,
                parent_id: None,
                name: String::new(),
                path_hash: "tags-route".to_string(),
                mtime: Some(1),
            })
            .expect("seed folder");

        let mut file_ids = Vec::new();
        for (name, mtime) in [("alpha.jpg", 100), ("beta.jpg", 200), ("gamma.jpg", 300)] {
            let id = database
                .upsert_file(crate::db::FileUpsert {
                    root_id,
                    folder_id,
                    name: name.to_string(),
                    ext: ".jpg".to_string(),
                    size: 100,
                    mtime,
                    ctime: None,
                    file_key: None,
                })
                .expect("insert file");
            database
                .upsert_media_kind(id, "image")
                .expect("upsert media kind");
            file_ids.push(id);
        }
        let red = database.create_tag("red", None).expect("red");
        let blue = database.create_tag("blue", None).expect("blue");
        // alpha: red+blue, beta: red only, gamma: blue only.
        database
            .set_file_tags(file_ids[0], &[red.id, blue.id])
            .expect("alpha tags");
        database
            .set_file_tags(file_ids[1], &[red.id])
            .expect("beta tags");
        database
            .set_file_tags(file_ids[2], &[blue.id])
            .expect("gamma tags");

        let app = router(AppState::new(database));
        let uri = format!(
            "/api/search?rootId={root_id}&tagId={}&tagId={}",
            red.id, blue.id
        );
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri(uri)
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("search");
        assert_eq!(response.status(), StatusCode::OK);
        let body = response_json(response).await;
        let items = body["items"].as_array().expect("items");
        assert_eq!(
            items.len(),
            1,
            "expected only alpha to satisfy red AND blue, got {items:?}"
        );
        assert_eq!(items[0]["id"], file_ids[0]);
        assert_eq!(items[0]["name"], "alpha.jpg");
    }

    #[tokio::test]
    async fn file_ops_rename_route_returns_record_and_404_400_409() {
        let temp_root = unique_temp_dir();
        fs::create_dir_all(&temp_root).expect("create root dir");
        fs::write(temp_root.join("alpha.jpg"), b"a").expect("write alpha");
        fs::write(temp_root.join("beta.jpg"), b"b").expect("write beta");
        let db_dir = unique_temp_dir();
        fs::create_dir_all(&db_dir).expect("create db dir");
        let database = Database::open(db_dir.join("megle.sqlite")).expect("open db");
        database.apply_migrations().expect("apply migrations");
        let root_id = database
            .add_root(NewRoot {
                path: temp_root.to_string_lossy().into_owned(),
                display_name: "ops".to_string(),
            })
            .expect("add root");
        let folder_id = database
            .upsert_folder(crate::db::FolderUpsert {
                root_id,
                parent_id: None,
                name: String::new(),
                path_hash: "ops-root".to_string(),
                mtime: Some(1),
            })
            .expect("upsert folder");
        let alpha_id = database
            .upsert_file(crate::db::FileUpsert {
                root_id,
                folder_id,
                name: "alpha.jpg".to_string(),
                ext: ".jpg".to_string(),
                size: 1,
                mtime: 1,
                ctime: None,
                file_key: None,
            })
            .expect("upsert alpha");
        let _beta_id = database
            .upsert_file(crate::db::FileUpsert {
                root_id,
                folder_id,
                name: "beta.jpg".to_string(),
                ext: ".jpg".to_string(),
                size: 1,
                mtime: 1,
                ctime: None,
                file_key: None,
            })
            .expect("upsert beta");
        let app = router(AppState::new(database));

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/file-ops/rename")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::json!({"fileId": alpha_id, "newName": "alpha2.jpg"})
                            .to_string(),
                    ))
                    .expect("build request"),
            )
            .await
            .expect("rename");
        assert_eq!(response.status(), StatusCode::OK);
        let body = response_json(response).await;
        assert_eq!(body["operation"], "rename");
        assert_eq!(body["status"], "succeeded");

        let conflict = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/file-ops/rename")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::json!({"fileId": alpha_id, "newName": "beta.jpg"}).to_string(),
                    ))
                    .expect("build conflict request"),
            )
            .await
            .expect("rename conflict");
        assert_eq!(conflict.status(), StatusCode::CONFLICT);
        let body = response_json(conflict).await;
        assert_eq!(body["code"], "name_conflict");

        let invalid = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/file-ops/rename")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::json!({"fileId": alpha_id, "newName": "with/slash.jpg"})
                            .to_string(),
                    ))
                    .expect("build invalid request"),
            )
            .await
            .expect("rename invalid");
        assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);

        let missing = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/file-ops/rename")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::json!({"fileId": 999_999, "newName": "x.jpg"}).to_string(),
                    ))
                    .expect("build missing request"),
            )
            .await
            .expect("rename missing");
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);

        drop(app);
        let _ = fs::remove_dir_all(&temp_root);
        let _ = fs::remove_dir_all(&db_dir);
    }

    #[tokio::test]
    async fn file_ops_move_route_returns_operations_and_cross_root_409() {
        let temp_root = unique_temp_dir();
        let other_root = unique_temp_dir();
        fs::create_dir_all(&temp_root).expect("create root dir");
        fs::create_dir_all(temp_root.join("dst")).expect("create dst");
        fs::create_dir_all(&other_root).expect("create other root dir");
        fs::write(temp_root.join("m.jpg"), b"m").expect("write m");
        let db_dir = unique_temp_dir();
        fs::create_dir_all(&db_dir).expect("create db dir");
        let database = Database::open(db_dir.join("megle.sqlite")).expect("open db");
        database.apply_migrations().expect("apply migrations");
        let root_id = database
            .add_root(NewRoot {
                path: temp_root.to_string_lossy().into_owned(),
                display_name: "ops".to_string(),
            })
            .expect("add root");
        let other_root_id = database
            .add_root(NewRoot {
                path: other_root.to_string_lossy().into_owned(),
                display_name: "other".to_string(),
            })
            .expect("add other root");
        let folder_id = database
            .upsert_folder(crate::db::FolderUpsert {
                root_id,
                parent_id: None,
                name: String::new(),
                path_hash: "ops-root".to_string(),
                mtime: Some(1),
            })
            .expect("upsert root folder");
        let dst_id = database
            .upsert_folder(crate::db::FolderUpsert {
                root_id,
                parent_id: Some(folder_id),
                name: "dst".to_string(),
                path_hash: "dst-folder".to_string(),
                mtime: Some(1),
            })
            .expect("upsert dst");
        let other_root_folder_id = database
            .upsert_folder(crate::db::FolderUpsert {
                root_id: other_root_id,
                parent_id: None,
                name: String::new(),
                path_hash: "other-root".to_string(),
                mtime: Some(1),
            })
            .expect("upsert other folder");
        let file_id = database
            .upsert_file(crate::db::FileUpsert {
                root_id,
                folder_id,
                name: "m.jpg".to_string(),
                ext: ".jpg".to_string(),
                size: 1,
                mtime: 1,
                ctime: None,
                file_key: None,
            })
            .expect("upsert file");
        let app = router(AppState::new(database));

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/file-ops/move")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "fileIds": [file_id],
                            "targetFolderId": dst_id
                        })
                        .to_string(),
                    ))
                    .expect("build move request"),
            )
            .await
            .expect("move");
        assert_eq!(response.status(), StatusCode::OK);
        let body = response_json(response).await;
        let ops = body["operations"].as_array().expect("operations");
        assert_eq!(ops.len(), 1);
        assert_eq!(ops[0]["operation"], "move");
        assert_eq!(ops[0]["status"], "succeeded");

        // Now try cross-root: move from same source to other root's folder.
        // Reseed a file at temp_root.
        fs::write(temp_root.join("x.jpg"), b"x").expect("write x");
        let cross_root_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/file-ops/move")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "fileIds": [file_id],
                            "targetFolderId": other_root_folder_id
                        })
                        .to_string(),
                    ))
                    .expect("build cross-root request"),
            )
            .await
            .expect("cross root");
        assert_eq!(cross_root_response.status(), StatusCode::CONFLICT);
        let body = response_json(cross_root_response).await;
        assert_eq!(body["code"], "cross_root");

        drop(app);
        let _ = fs::remove_dir_all(&temp_root);
        let _ = fs::remove_dir_all(&other_root);
        let _ = fs::remove_dir_all(&db_dir);
    }

    #[tokio::test]
    async fn file_ops_delete_route_supports_recycle_and_permanent() {
        let temp_root = unique_temp_dir();
        fs::create_dir_all(&temp_root).expect("create root dir");
        fs::write(temp_root.join("p.jpg"), b"p").expect("write p");
        let db_dir = unique_temp_dir();
        fs::create_dir_all(&db_dir).expect("create db dir");
        let database = Database::open(db_dir.join("megle.sqlite")).expect("open db");
        database.apply_migrations().expect("apply migrations");
        let root_id = database
            .add_root(NewRoot {
                path: temp_root.to_string_lossy().into_owned(),
                display_name: "ops".to_string(),
            })
            .expect("add root");
        let folder_id = database
            .upsert_folder(crate::db::FolderUpsert {
                root_id,
                parent_id: None,
                name: String::new(),
                path_hash: "ops-root".to_string(),
                mtime: Some(1),
            })
            .expect("upsert folder");
        let file_id = database
            .upsert_file(crate::db::FileUpsert {
                root_id,
                folder_id,
                name: "p.jpg".to_string(),
                ext: ".jpg".to_string(),
                size: 1,
                mtime: 1,
                ctime: None,
                file_key: None,
            })
            .expect("upsert file");
        let app = router(AppState::new(database));

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/file-ops/delete")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "fileIds": [file_id],
                            "permanent": true
                        })
                        .to_string(),
                    ))
                    .expect("build delete request"),
            )
            .await
            .expect("delete");
        assert_eq!(response.status(), StatusCode::OK);
        let body = response_json(response).await;
        let ops = body["operations"].as_array().expect("operations");
        assert_eq!(ops.len(), 1);
        assert_eq!(ops[0]["operation"], "delete_permanent");
        assert!(!temp_root.join("p.jpg").exists());

        let empty = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/file-ops/delete")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::json!({ "permanent": true }).to_string(),
                    ))
                    .expect("build empty request"),
            )
            .await
            .expect("delete empty");
        assert_eq!(empty.status(), StatusCode::BAD_REQUEST);

        drop(app);
        let _ = fs::remove_dir_all(&temp_root);
        let _ = fs::remove_dir_all(&db_dir);
    }

    #[tokio::test]
    async fn file_ops_list_returns_keyset_page() {
        let temp_root = unique_temp_dir();
        fs::create_dir_all(&temp_root).expect("create root dir");
        let db_dir = unique_temp_dir();
        fs::create_dir_all(&db_dir).expect("create db dir");
        let database = Database::open(db_dir.join("megle.sqlite")).expect("open db");
        database.apply_migrations().expect("apply migrations");
        let root_id = database
            .add_root(NewRoot {
                path: temp_root.to_string_lossy().into_owned(),
                display_name: "ops".to_string(),
            })
            .expect("add root");
        let folder_id = database
            .upsert_folder(crate::db::FolderUpsert {
                root_id,
                parent_id: None,
                name: String::new(),
                path_hash: "ops-root".to_string(),
                mtime: Some(1),
            })
            .expect("upsert folder");
        for index in 0..3 {
            let name = format!("f{index}.jpg");
            fs::write(temp_root.join(&name), b"x").expect("write file");
            let file_id = database
                .upsert_file(crate::db::FileUpsert {
                    root_id,
                    folder_id,
                    name: name.clone(),
                    ext: ".jpg".to_string(),
                    size: 1,
                    mtime: 1,
                    ctime: None,
                    file_key: None,
                })
                .expect("upsert file");
            // Trigger a rename to log a row.
            // Via direct fsops call would require &mut Database, so use the route.
            let _ = file_id;
        }
        // Drive renames through the route for genuine logs.
        let app = router(AppState::new(database));
        for index in 0..3 {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method(Method::POST)
                        .uri("/api/file-ops/rename")
                        .header(header::CONTENT_TYPE, "application/json")
                        .body(Body::from(
                            serde_json::json!({
                                "fileId": index + 1,
                                "newName": format!("renamed{index}.jpg")
                            })
                            .to_string(),
                        ))
                        .expect("build request"),
                )
                .await
                .expect("rename");
            assert_eq!(response.status(), StatusCode::OK, "rename {index}");
        }

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/file-ops?limit=2")
                    .body(Body::empty())
                    .expect("build list request"),
            )
            .await
            .expect("list");
        assert_eq!(response.status(), StatusCode::OK);
        let body = response_json(response).await;
        let items = body["items"].as_array().expect("items");
        assert_eq!(items.len(), 2);
        assert!(items[0]["id"].as_i64().unwrap() > items[1]["id"].as_i64().unwrap());
        assert!(body["nextCursor"].is_string());

        drop(app);
        let _ = fs::remove_dir_all(&temp_root);
        let _ = fs::remove_dir_all(&db_dir);
    }

    async fn response_json(response: axum::response::Response) -> serde_json::Value {
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read response body");
        serde_json::from_slice(&bytes).expect("parse json response")
    }

    async fn wait_for_task_status(
        app: &axum::Router,
        task_id: i64,
        expected_status: &str,
    ) -> serde_json::Value {
        let mut last_status = None;
        for _ in 0..250 {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method(Method::GET)
                        .uri("/api/tasks")
                        .body(Body::empty())
                        .expect("build request"),
                )
                .await
                .expect("list tasks");
            assert_eq!(response.status(), StatusCode::OK);
            let body = response_json(response).await;
            let task = body["items"]
                .as_array()
                .expect("task items")
                .iter()
                .find(|task| task["id"] == task_id)
                .cloned();
            let status = task
                .as_ref()
                .and_then(|task| task["status"].as_str())
                .map(str::to_string);
            if status.as_deref() == Some(expected_status) {
                return task.expect("task exists");
            }
            last_status = status;
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        panic!(
            "task {task_id} did not reach status {expected_status}; last status was {:?}",
            last_status
        );
    }

    async fn wait_for_media_count(app: &axum::Router, root_id: i64, expected_count: usize) {
        let mut last_count = None;
        for _ in 0..250 {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method(Method::GET)
                        .uri(format!("/api/media?rootId={root_id}&sort=name_asc"))
                        .body(Body::empty())
                        .expect("build request"),
                )
                .await
                .expect("list media");
            assert_eq!(response.status(), StatusCode::OK);
            let body = response_json(response).await;
            let count = body["items"].as_array().expect("media items").len();
            if count == expected_count {
                return;
            }
            last_count = Some(count);
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        panic!(
            "root {root_id} did not reach media count {expected_count}; last count was {:?}",
            last_count
        );
    }

    fn test_database() -> Database {
        let database = Database::open_in_memory().expect("open database");
        database.apply_migrations().expect("apply migrations");
        database
    }

    fn test_database_pair(path: PathBuf) -> (Database, Database) {
        let database = Database::open(&path).expect("open database");
        database.apply_migrations().expect("apply migrations");
        let worker_database = Database::open(&path).expect("open worker database");
        (database, worker_database)
    }

    fn seed_media_file(database: &Database) -> i64 {
        seed_media_file_named(database, "image.jpg")
    }

    fn seed_media_file_named(database: &Database, name: &str) -> i64 {
        let root_id = database
            .add_root(crate::db::NewRoot {
                path: format!("D:/Pictures/{name}"),
                display_name: format!("Pictures {name}"),
            })
            .expect("add root");
        let folder_id = database
            .upsert_folder(crate::db::FolderUpsert {
                root_id,
                parent_id: None,
                name: String::new(),
                path_hash: format!("root-hash-{name}"),
                mtime: Some(1),
            })
            .expect("insert root folder");
        let file_id = database
            .upsert_file(crate::db::FileUpsert {
                root_id,
                folder_id,
                name: name.to_string(),
                ext: ".jpg".to_string(),
                size: 1000,
                mtime: 2,
                ctime: None,
                file_key: None,
            })
            .expect("insert file");
        database
            .upsert_media_kind(file_id, "image")
            .expect("insert media kind");
        file_id
    }

    fn unique_temp_dir() -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

        std::env::temp_dir().join(format!(
            "megle_api_test_{}_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time")
                .as_nanos(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ))
    }

    #[tokio::test]
    async fn plugin_routes_basic_lifecycle() {
        let database = test_database();
        let state = AppState::new(database);
        let app = router(state);

        // GET /api/plugins -> empty list (no rows persisted).
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/plugins")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("list plugins");
        assert_eq!(response.status(), StatusCode::OK);
        let body = response_json(response).await;
        assert!(body["items"].as_array().expect("items").is_empty());

        // POST /api/plugins/{id}/enable -> 404 with code plugin_not_found.
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/plugins/com.example.missing/enable")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("enable missing plugin");
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let body = response_json(response).await;
        assert_eq!(body["code"], "plugin_not_found");

        // DELETE /api/plugins/{id} -> 404 with code plugin_not_found.
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::DELETE)
                    .uri("/api/plugins/com.example.missing")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("delete missing plugin");
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let body = response_json(response).await;
        assert_eq!(body["code"], "plugin_not_found");
    }

    #[tokio::test]
    async fn plugin_discover_route_returns_zero_for_missing_directory() {
        // Confirm the discover handler reports zero/zero when the configured
        // plugins folder does not exist on disk. We exercise the discovery
        // function directly to avoid mutating process-wide environment
        // variables, which would race with tests that share the runtime.
        let database = test_database();
        let plugins_dir = unique_temp_dir();
        let report =
            crate::plugins::discover_and_persist(&database, &plugins_dir).expect("discover");
        assert_eq!(report.discovered, 0);
        assert!(report.errors.is_empty());
    }

    #[tokio::test]
    async fn serve_web_disabled_does_not_intercept_api_routes() {
        // With `web_dir` unset (the desktop default), the API router still
        // owns the namespace and unknown paths return 404 instead of being
        // rewritten to `index.html`.
        let app = router_with_config(test_database(), ApiConfig::default());

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/health")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("health request");
        assert_eq!(response.status(), StatusCode::OK);

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("root request");
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn serve_web_enabled_falls_back_to_index_html_for_unknown_paths() {
        // Stand up a tiny `dist/` so ServeDir + ServeFile fallback can route
        // an unknown SPA path back to `index.html`.
        let web_dir = unique_temp_dir();
        fs::create_dir_all(&web_dir).expect("create web dir");
        fs::write(
            web_dir.join("index.html"),
            b"<!doctype html><title>spa</title>",
        )
        .expect("write index.html");
        fs::create_dir_all(web_dir.join("assets")).expect("create assets dir");
        fs::write(
            web_dir.join("assets").join("app.abc123.js"),
            b"console.log('hashed asset');",
        )
        .expect("write hashed asset");

        let app = router_with_config(
            test_database(),
            ApiConfig {
                web_dir: Some(web_dir.clone()),
                ..ApiConfig::default()
            },
        );

        // API routes still 404 for unknown API paths instead of falling back
        // to index.html.
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/does-not-exist")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("unknown api path");
        assert_eq!(response.status(), StatusCode::NOT_FOUND);

        // SPA route falls back to index.html.
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/library/some/deep/route")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("spa fallback");
        assert_eq!(response.status(), StatusCode::OK);
        let cache = response
            .headers()
            .get(header::CACHE_CONTROL)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_string();
        assert_eq!(cache, "no-cache");
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read fallback body");
        let body = String::from_utf8_lossy(&bytes).into_owned();
        assert!(
            body.contains("<title>spa</title>"),
            "expected index.html fallback body, got: {body}"
        );

        // Hashed assets get the long-lived immutable cache header.
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/assets/app.abc123.js")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("hashed asset");
        assert_eq!(response.status(), StatusCode::OK);
        let cache = response
            .headers()
            .get(header::CACHE_CONTROL)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_string();
        assert_eq!(cache, "public, max-age=31536000, immutable");

        let _ = fs::remove_dir_all(web_dir);
    }

    #[tokio::test]
    async fn basic_auth_protects_routes_except_health() {
        let credentials = BasicAuthCredentials::parse("alice:s3cret").expect("parse credentials");
        let app = router_with_config(
            test_database(),
            ApiConfig {
                basic_auth: Some(credentials),
                ..ApiConfig::default()
            },
        );

        // No credentials => 401 with WWW-Authenticate.
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/roots")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("missing creds");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        let challenge = response
            .headers()
            .get(header::WWW_AUTHENTICATE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_string();
        assert!(
            challenge.contains("Basic"),
            "expected Basic challenge, got: {challenge}"
        );

        // Correct credentials => API request goes through.
        let token = base64::engine::general_purpose::STANDARD.encode(b"alice:s3cret");
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/roots")
                    .header(header::AUTHORIZATION, format!("Basic {token}"))
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("good creds");
        assert_eq!(response.status(), StatusCode::OK);

        // /api/health is always reachable without credentials so Docker
        // healthchecks keep working.
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/health")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("health no creds");
        assert_eq!(response.status(), StatusCode::OK);
    }
}
