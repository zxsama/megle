use std::sync::{Arc, Mutex};

use axum::extract::Request;
use axum::http::{header, HeaderName, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::Router;
use tower_http::cors::CorsLayer;

use crate::db::Database;
use crate::tasks::{start_worker, TaskSender};

pub mod routes;

#[allow(dead_code)]
pub const API_PREFIX: &str = "/api";
pub const SESSION_HEADER: &str = "X-Megle-Session";

#[derive(Clone)]
pub struct AppState {
    pub database: Arc<Mutex<Database>>,
    pub task_queue: TaskSender,
}

impl AppState {
    pub fn new(database: Database) -> Self {
        if let Some(worker_database) = database.reopen().expect("reopen worker database") {
            return Self::new_with_worker(database, worker_database);
        }

        let (task_queue, receiver) = tokio::sync::mpsc::channel(1);
        drop(receiver);
        Self {
            database: Arc::new(Mutex::new(database)),
            task_queue,
        }
    }

    pub fn new_with_worker(database: Database, worker_database: Database) -> Self {
        let database = Arc::new(Mutex::new(database));
        let task_queue = start_worker(worker_database);
        Self {
            database,
            task_queue,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct ApiConfig {
    pub session_token: Option<String>,
    pub allowed_origin: Option<HeaderValue>,
}

#[allow(dead_code)]
pub fn router(database: Database) -> Router {
    router_with_config(database, ApiConfig::default())
}

pub fn router_with_config(database: Database, config: ApiConfig) -> Router {
    let router = routes::router(AppState::new(database)).layer(middleware::from_fn_with_state(
        config.clone(),
        require_session_token,
    ));

    match config.allowed_origin {
        Some(origin) => router.layer(cors_layer(origin)),
        None => router,
    }
}

fn cors_layer(origin: HeaderValue) -> CorsLayer {
    CorsLayer::new()
        .allow_origin(origin)
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        .allow_headers([
            header::CONTENT_TYPE,
            HeaderName::from_static("x-megle-session"),
        ])
}

async fn require_session_token(
    axum::extract::State(config): axum::extract::State<ApiConfig>,
    request: Request,
    next: Next,
) -> Response {
    if request.method() == Method::OPTIONS {
        return next.run(request).await;
    }

    if let Some(expected) = config.session_token.as_deref() {
        let actual = request
            .headers()
            .get(SESSION_HEADER)
            .and_then(|value| value.to_str().ok());

        if actual != Some(expected) {
            return StatusCode::UNAUTHORIZED.into_response();
        }
    }

    next.run(request).await
}
