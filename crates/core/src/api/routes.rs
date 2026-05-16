use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::api::AppState;
use crate::db::{FolderRecord, MediaPageQuery, MediaRecord, NewRoot, RootRecord, TaskRecord};
use crate::scan::ScanSummary;

#[allow(dead_code)]
pub const MEDIA_SORT_VALUES: &[&str] = &["mtime_desc", "mtime_asc", "name_asc", "name_desc"];
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
    "/api/media/{fileId}/thumbnail/{profile}",
    "/api/media/{fileId}/preview",
    "/api/tasks",
    "/api/tasks/scan",
    "/api/file-ops/rename",
    "/api/file-ops/move",
    "/api/file-ops/delete",
    "/api/plugins",
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
struct PluginState {
    id: String,
    enabled: bool,
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

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: String,
}

struct CoreError {
    status: StatusCode,
    message: String,
}

impl From<anyhow::Error> for CoreError {
    fn from(error: anyhow::Error) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: error.to_string(),
        }
    }
}

impl IntoResponse for CoreError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ErrorResponse {
                error: self.message,
            }),
        )
            .into_response()
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
        .route("/api/media/:file_id/thumbnail/:profile", get(get_thumbnail))
        .route("/api/media/:file_id/preview", get(get_preview))
        .route("/api/tasks", get(list_tasks))
        .route("/api/tasks/scan", post(enqueue_scan))
        .route("/api/file-ops/rename", post(rename_file))
        .route("/api/file-ops/move", post(move_files))
        .route("/api/file-ops/delete", post(delete_files))
        .route("/api/plugins", get(list_plugins))
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
    let display_name = payload
        .display_name
        .unwrap_or_else(|| fallback_display_name(&payload.path));
    let (root_id, task_id) = {
        let database = state.database.lock().expect("database mutex poisoned");
        let root_id = database.add_root(NewRoot {
            path: payload.path,
            display_name,
        })?;
        let task_id = database.create_root_scan_task(root_id)?;
        (root_id, task_id)
    };
    enqueue_task(&state, task_id).await?;
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

async fn remove_root(Path(_root_id): Path<i64>) -> (StatusCode, Json<AcceptedResponse>) {
    (StatusCode::ACCEPTED, Json(accepted()))
}

async fn list_folder_children(
    State(state): State<AppState>,
    Path(folder_id): Path<i64>,
) -> ApiResult<Json<ListResponse<FolderRecord>>> {
    let database = state.database.lock().expect("database mutex poisoned");
    if !database.folder_exists(folder_id)? {
        return Err(CoreError::not_found(format!(
            "folder not found: {folder_id}"
        )));
    }
    let items = database.list_folder_children(folder_id)?;
    Ok(Json(ListResponse {
        items,
        next_cursor: None,
    }))
}

async fn list_media(
    State(state): State<AppState>,
    Query(query): Query<ListMediaQuery>,
) -> ApiResult<Json<ListResponse<MediaRecord>>> {
    let database = state.database.lock().expect("database mutex poisoned");
    let items = database.list_media_page(MediaPageQuery {
        root_id: query.root_id,
        folder_id: query.folder_id,
        limit: query.limit.unwrap_or(200),
        cursor: query.cursor,
        sort: query.sort.unwrap_or_else(|| "mtime_desc".to_string()),
        kind: query.kind,
    })?;
    Ok(Json(ListResponse {
        items,
        next_cursor: None,
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
    Path((_file_id, _profile)): Path<(i64, String)>,
) -> (StatusCode, Json<AcceptedResponse>) {
    (StatusCode::ACCEPTED, Json(accepted()))
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
    let task_id = {
        let database = state.database.lock().expect("database mutex poisoned");
        if database.get_root(payload.root_id)?.is_none() {
            return Err(CoreError::not_found(format!(
                "root not found: {}",
                payload.root_id
            )));
        }
        database.create_root_scan_task(payload.root_id)?
    };
    enqueue_task(&state, task_id).await?;
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

async fn rename_file() -> (StatusCode, Json<AcceptedResponse>) {
    (StatusCode::ACCEPTED, Json(accepted()))
}

async fn move_files() -> (StatusCode, Json<AcceptedResponse>) {
    (StatusCode::ACCEPTED, Json(accepted()))
}

async fn delete_files() -> (StatusCode, Json<AcceptedResponse>) {
    (StatusCode::ACCEPTED, Json(accepted()))
}

async fn list_plugins() -> Json<ListResponse<PluginState>> {
    Json(empty_list())
}

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

async fn enqueue_task(state: &AppState, task_id: i64) -> ApiResult<()> {
    if let Err(error) = state.task_queue.send(task_id).await {
        let error = anyhow::anyhow!("background task queue is closed: {error}");
        let database = state.database.lock().expect("database mutex poisoned");
        database.mark_task_failed(task_id, &error.to_string())?;
        return Err(error.into());
    }
    Ok(())
}

impl CoreError {
    fn not_found(message: String) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message,
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
    use tower::ServiceExt;

    use super::{fallback_display_name, router};
    use crate::api::{router_with_config, ApiConfig, AppState};
    use crate::db::Database;

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

        fs::remove_dir_all(temp_root).expect("cleanup temp root");
        drop(app);
        drop(state);
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        let _ = fs::remove_dir_all(db_dir);
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
        fs::remove_dir_all(temp_root).expect("cleanup temp root");
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
        fs::remove_dir_all(temp_root).expect("cleanup temp root");
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
            .mark_task_running(task_id)
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
    async fn configured_session_token_is_required_for_api_routes() {
        let app = router_with_config(
            test_database(),
            ApiConfig {
                session_token: Some("test-session".to_string()),
                allowed_origin: None,
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

    #[tokio::test]
    async fn configured_cors_allows_only_the_exact_development_origin() {
        let app = router_with_config(
            test_database(),
            ApiConfig {
                session_token: Some("test-session".to_string()),
                allowed_origin: Some("http://127.0.0.1:5173".parse().expect("origin")),
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
        for _ in 0..50 {
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
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        panic!("task {task_id} did not reach status {expected_status}");
    }

    async fn wait_for_media_count(app: &axum::Router, root_id: i64, expected_count: usize) {
        for _ in 0..50 {
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
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        panic!("root {root_id} did not reach media count {expected_count}");
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

    fn unique_temp_dir() -> PathBuf {
        std::env::temp_dir().join(format!(
            "megle_api_test_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time")
                .as_nanos()
        ))
    }
}
