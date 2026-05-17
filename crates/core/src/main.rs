mod api;
mod db;
mod fsops;
mod plugins;
mod roots;
mod scan;
mod tasks;
mod thumbnails;
mod watch;

use std::net::SocketAddr;
use std::path::PathBuf;

use axum::http::HeaderValue;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let db_path = std::env::var_os("MEGLE_DB_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("megle.sqlite"));
    let bind_addr: SocketAddr = std::env::var("MEGLE_CORE_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:47321".to_string())
        .parse()?;
    let session_token = std::env::var("MEGLE_SESSION_TOKEN").map_err(|_| {
        anyhow::anyhow!("MEGLE_SESSION_TOKEN must be set before starting Megle Core")
    })?;
    let allowed_origin = std::env::var("MEGLE_ALLOWED_ORIGIN")
        .ok()
        .map(|origin| origin.parse::<HeaderValue>())
        .transpose()?;

    let database = db::Database::open(&db_path)?;
    database.apply_migrations()?;

    let plugins_dir = resolve_plugins_dir(&db_path);
    if let Err(error) = plugins::discover_and_persist(&database, &plugins_dir) {
        tracing::warn!(
            "plugin discovery failed at startup ({}): {}",
            plugins_dir.display(),
            error
        );
    }

    let listener = tokio::net::TcpListener::bind(bind_addr).await?;
    axum::serve(
        listener,
        api::router_with_config(
            database,
            api::ApiConfig {
                session_token: Some(session_token),
                allowed_origin,
            },
        ),
    )
    .await?;
    Ok(())
}

fn resolve_plugins_dir(db_path: &std::path::Path) -> PathBuf {
    if let Some(value) = std::env::var_os("MEGLE_PLUGINS_DIR") {
        return PathBuf::from(value);
    }
    if let Some(parent) = db_path.parent() {
        if !parent.as_os_str().is_empty() {
            return parent.join("plugins");
        }
    }
    PathBuf::from("./plugins")
}
