import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

const openApi = read("contracts/core-api/openapi.yaml");
const routesRs = read("crates/core/src/api/routes.rs");
const apiModRs = read("crates/core/src/api/mod.rs");
const dbModRs = read("crates/core/src/db/mod.rs");
const tasksRs = read("crates/core/src/tasks.rs");
const dbMigrationsRs = read("crates/core/src/db/migrations.rs");
const mainRs = read("crates/core/src/main.rs");
const migrationSql = read("crates/core/migrations/0001_initial.sql");
const thumbnailsRs = read("crates/core/src/thumbnails/mod.rs");
const pluginsRs = read("crates/core/src/plugins/mod.rs");
const fsopsRs = read("crates/core/src/fsops/mod.rs");
const pluginManifest = read("contracts/plugins/manifest.schema.json");

const openApiPaths = new Set(
  [...openApi.matchAll(/^  (\/[^:\n]+):/gm)].map((match) => `/api${match[1]}`)
);

const rustPathsBlock = routesRs.match(/PHASE1_API_PATHS:\s*&\[&str\]\s*=\s*&\[(?<body>[\s\S]*?)\];/);
if (!rustPathsBlock?.groups?.body) {
  fail("PHASE1_API_PATHS constant is missing in routes.rs");
}

const rustContractPaths = new Set(
  [...(rustPathsBlock?.groups?.body ?? "").matchAll(/"([^"]+)"/g)].map((match) => match[1])
);

for (const openApiPath of openApiPaths) {
  if (!rustContractPaths.has(openApiPath)) {
    fail(`OpenAPI path missing from PHASE1_API_PATHS: ${openApiPath}`);
  }
}
for (const rustPath of rustContractPaths) {
  if (!openApiPaths.has(rustPath)) {
    fail(`PHASE1_API_PATHS path missing from OpenAPI: ${rustPath}`);
  }
}

const axumRoutes = new Set(
  [...routesRs.matchAll(/\.route\(\s*"([^"]+)"/g)].map((match) => match[1])
);

const expectedAxumRoutes = [
  "/api/health",
  "/api/roots",
  "/api/roots/:root_id",
  "/api/folders/:folder_id/children",
  "/api/media",
  "/api/media/:file_id",
  "/api/media/:file_id/thumbnail/:profile",
  "/api/media/:file_id/preview",
  "/api/tasks",
  "/api/tasks/scan",
  "/api/file-ops/rename",
  "/api/file-ops/move",
  "/api/file-ops/delete",
  "/api/plugins"
];

for (const route of expectedAxumRoutes) {
  if (!axumRoutes.has(route)) {
    fail(`Axum router missing route: ${route}`);
  }
}

for (const routeGroup of [
  "Health",
  "Roots",
  "Folders",
  "Media",
  "Thumbnails",
  "Preview",
  "Tasks",
  "FileOps",
  "Plugins"
]) {
  if (!routesRs.includes(`RouteGroup::${routeGroup}`)) {
    fail(`RouteGroup missing ${routeGroup}`);
  }
}

if (!apiModRs.includes('pub const API_PREFIX: &str = "/api"')) {
  fail('API_PREFIX must remain "/api"');
}
if (!apiModRs.includes("pub fn router(database: Database) -> Router")) {
  fail("api::router() is missing");
}
if (!apiModRs.includes("pub struct ApiConfig")) {
  fail("api::ApiConfig is missing");
}
if (!apiModRs.includes("router_with_config")) {
  fail("api::router_with_config() is missing");
}
if (!dbMigrationsRs.includes('include_str!("../../migrations/0001_initial.sql")')) {
  fail("db migration include path changed or missing");
}
if (!dbMigrationsRs.includes('include_str!("../../migrations/0002_task_progress.sql")')) {
  fail("db task progress migration include path changed or missing");
}
if (!dbModRs.includes("pub fn apply_migrations")) {
  fail("Database::apply_migrations is missing");
}
if (!mainRs.includes("database.apply_migrations()?")) {
  fail("main.rs must apply migrations before serving");
}
if (!mainRs.includes("axum::serve")) {
  fail("main.rs must start the Axum server");
}

if (!openApi.includes("name: X-Megle-Session")) {
  fail("OpenAPI must keep X-Megle-Session header security");
}
if (!mainRs.includes("MEGLE_SESSION_TOKEN")) {
  fail("main.rs must read MEGLE_SESSION_TOKEN");
}
if (!mainRs.includes("MEGLE_ALLOWED_ORIGIN")) {
  fail("main.rs must read MEGLE_ALLOWED_ORIGIN for dev CORS");
}
for (const value of ["X-Megle-Session", "tower_http::cors", "CorsLayer", "allow_headers"]) {
  if (!apiModRs.includes(value)) {
    fail(`Core API auth/CORS wiring missing ${value}`);
  }
}
if (apiModRs.includes("AllowOrigin::any") || apiModRs.includes("Any")) {
  fail("Core API CORS must not use wildcard origins");
}

for (const value of ["mtime_desc", "mtime_asc", "name_asc", "name_desc"]) {
  if (!openApi.includes(value) || !routesRs.includes(value)) {
    fail(`media sort value is not aligned: ${value}`);
  }
}

for (const value of ["image", "video", "other"]) {
  if (!openApi.includes(value) || !routesRs.includes(value)) {
    fail(`media kind value is not aligned: ${value}`);
  }
}

for (const value of ["tiny", "grid", "retina", "preview"]) {
  if (!openApi.includes(value) || !thumbnailsRs.includes(value)) {
    fail(`thumbnail profile value is not aligned: ${value}`);
  }
}

for (const value of [
  "AcceptedRootResponse",
  "ScanSummary",
  "RootRecord",
  "FolderRecord",
  "MediaRecord",
  "ErrorResponse",
  "rootFolderId",
  "lastScanAt",
  "foldersSeen",
  "mediaFilesSeen",
  "skippedFiles",
  "nextCursor"
]) {
  if (!openApi.includes(value)) {
    fail(`OpenAPI response schema missing ${value}`);
  }
}

for (const value of ["root_folder_id", "last_scan_at"]) {
  if (!dbModRs.includes(value)) {
    fail(`DB root response field missing ${value}`);
  }
}

for (const value of [
  "MediaRecord",
  "FolderRecord",
  "TaskRecord",
  "create_root_scan_task",
  "list_tasks",
  "get_task",
  "mark_task_running",
  "mark_task_succeeded",
  "mark_task_failed",
  "folder_exists",
  "mark_root_scanned"
]) {
  if (!dbModRs.includes(value)) {
    fail(`DB API missing ${value}`);
  }
}

if (!routesRs.includes("StatusCode::NOT_FOUND")) {
  fail("routes must expose NOT_FOUND for missing folder/media");
}

for (const value of ["decoder", "metadata", "action", "import-provider"]) {
  if (!pluginManifest.includes(value) || !pluginsRs.includes(value)) {
    fail(`plugin capability value is not aligned: ${value}`);
  }
}

for (const value of ["rename", "move", "delete_to_recycle_bin"]) {
  if (!fsopsRs.includes(value)) {
    fail(`file operation value is missing: ${value}`);
  }
}

if (!dbModRs.includes('pub const WAL_MODE: &str = "WAL"')) {
  fail('WAL_MODE must remain "WAL"');
}
if (!migrationSql.includes("PRAGMA journal_mode = WAL")) {
  fail("initial migration must enable WAL journal mode");
}

function functionBody(name) {
  const match = routesRs.match(new RegExp(`async fn ${name}[^]*?\\n}\\n`, "m"));
  return match?.[0] ?? "";
}

function operationBlock(pathName, methodName) {
  const pathIndex = openApi.indexOf(`  ${pathName}:`);
  if (pathIndex === -1) {
    fail(`OpenAPI path missing ${pathName}`);
    return "";
  }
  const nextPathIndex = openApi.slice(pathIndex + 1).search(/\n  \/[^:\n]+:/);
  const pathBlock =
    nextPathIndex === -1
      ? openApi.slice(pathIndex)
      : openApi.slice(pathIndex, pathIndex + 1 + nextPathIndex);
  const methodIndex = pathBlock.indexOf(`    ${methodName}:`);
  if (methodIndex === -1) {
    fail(`OpenAPI operation missing ${methodName.toUpperCase()} ${pathName}`);
    return "";
  }
  const nextMethodIndex = pathBlock.slice(methodIndex + 1).search(/\n    [a-z]+:/);
  return nextMethodIndex === -1
    ? pathBlock.slice(methodIndex)
    : pathBlock.slice(methodIndex, methodIndex + 1 + nextMethodIndex);
}

for (const name of [
  "remove_root",
  "get_thumbnail",
  "get_preview",
  "enqueue_scan",
  "rename_file",
  "move_files",
  "delete_files"
]) {
  if (!functionBody(name).includes("StatusCode::ACCEPTED")) {
    fail(`${name} must return StatusCode::ACCEPTED while it is queued/placeholder work`);
  }
}

const addRootBody = functionBody("add_root");
if (addRootBody.includes("scan_root")) {
  fail("POST /api/roots must enqueue root scans instead of scanning inline");
}
for (const value of ["create_root_scan_task", "enqueue_task", "task_id: Some", "scan: None"]) {
  if (!addRootBody.includes(value)) {
    fail(`POST /api/roots queued response missing ${value}`);
  }
}
const addRootOperation = operationBlock("/roots", "post");
if (!addRootOperation.includes('"400"') || !addRootOperation.includes("ErrorResponse")) {
  fail("OpenAPI POST /roots must document bad-root-path 400 ErrorResponse");
}

for (const value of [
  "TaskRecord",
  "TaskListResponse",
  "ScanTaskRequest",
  "itemsSeen",
  "itemsTotal",
  "foldersSeen",
  "mediaFilesSeen",
  "skippedFiles",
  "$ref: \"#/components/schemas/ScanTaskRequest\"",
  "$ref: \"#/components/schemas/TaskListResponse\""
]) {
  if (!openApi.includes(value)) {
    fail(`OpenAPI task contract missing ${value}`);
  }
}
if (openApi.includes("scans inline")) {
  fail("OpenAPI must not describe root creation as inline scanning");
}

const enqueueScanBody = functionBody("enqueue_scan");
for (const value of ["Json(payload): Json<ScanTaskRequest>", "get_root", "create_root_scan_task", "enqueue_task"]) {
  if (!enqueueScanBody.includes(value)) {
    fail(`POST /api/tasks/scan implementation missing ${value}`);
  }
}
const enqueueScanOperation = operationBlock("/tasks/scan", "post");
if (!enqueueScanOperation.includes('"409"') || !enqueueScanOperation.includes("ErrorResponse")) {
  fail("OpenAPI POST /tasks/scan must document disabled-root 409 ErrorResponse");
}
const mediaOperation = operationBlock("/media", "get");
if (!mediaOperation.includes('"400"') || !mediaOperation.includes("ErrorResponse")) {
  fail("OpenAPI GET /media must document invalid query/cursor 400 ErrorResponse");
}
const folderChildrenOperation = operationBlock("/folders/{folderId}/children", "get");
if (!folderChildrenOperation.includes('"400"') || !folderChildrenOperation.includes("ErrorResponse")) {
  fail("OpenAPI GET /folders/{folderId}/children must document invalid cursor 400 ErrorResponse");
}
if (!functionBody("list_tasks").includes("database.list_tasks")) {
  fail("GET /api/tasks must return persisted task rows");
}
if (dbModRs.includes("OFFSET")) {
  fail("Core browsing pagination must use keyset cursors, not OFFSET");
}
for (const value of ["?2 IS NULL OR files.root_id", "?3 IS NULL OR files.folder_id", "?4 IS NULL OR media.kind"]) {
  if (dbModRs.includes(value)) {
    fail(`media browsing query must build dynamic predicates instead of optional OR predicate ${value}`);
  }
}
for (const value of ["next_cursor", "decode_media_cursor", "encode_media_cursor", "disable_root"]) {
  if (!dbModRs.includes(value)) {
    fail(`Core browsing hardening missing ${value}`);
  }
}
for (const value of ["canonicalize", "StatusCode::BAD_REQUEST", "StatusCode::CONFLICT", "parse_media_sort", "parse_media_kind"]) {
  if (!routesRs.includes(value)) {
    fail(`Core root validation/removal routes missing ${value}`);
  }
}
for (const value of ["cancel_root_scan_tasks", "root_enabled", "fail_pending_root_scan_tasks_for_disabled_roots"]) {
  if (!dbModRs.includes(value) && !tasksRs.includes(value)) {
    fail(`Core scan cancellation hardening missing ${value}`);
  }
}
if (tasksRs.includes("Arc<Mutex<Database>>")) {
  fail("background scan worker must not hold the API Arc<Mutex<Database>> during scans");
}
if (!tasksRs.includes("start_worker(worker_database: Database)")) {
  fail("background scan worker must own a separate Database handle");
}
if (!routesRs.includes("mark_task_failed(task_id, &error.to_string())")) {
  fail("enqueue failures must mark the created task failed before returning an API error");
}
for (const value of [
  "WHERE id = ?2 AND status = 'pending'",
  "WHERE id = ?2 AND status = 'running'",
  "update_task_scan_progress",
  "WHERE id = ?3 AND status IN ('pending', 'running')",
  'ensure_one_task_updated(task_id, updated, "pending or running")',
  "ensure_one_task_updated"
]) {
  if (!dbModRs.includes(value)) {
    fail(`DB task status transition guard missing ${value}`);
  }
}

if (!process.exitCode) {
  console.log("PASS: core api contract alignment");
}
