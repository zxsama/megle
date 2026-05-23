import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const webSrc = path.join(root, "apps", "web", "src");

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const fullPath = path.join(directory, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(fullPath);
    }
  }
  return files;
}

const useLibraryData = read("apps/web/src/core/useLibraryData.ts");
const mediaResourcesPath = "apps/web/src/core/mediaResources.ts";
const mediaResources = existsSync(path.join(root, mediaResourcesPath))
  ? read(mediaResourcesPath)
  : "";
const mediaGrid = read("apps/web/src/features/media-grid/MediaGrid.tsx");
const libraryView = read("apps/web/src/features/library/LibraryView.tsx");
const librarySidebar = read("apps/web/src/features/library/LibrarySidebar.tsx");
const previewPanelPath = "apps/web/src/features/preview/PreviewPanel.tsx";
const previewPanel = existsSync(path.join(root, previewPanelPath))
  ? read(previewPanelPath)
  : "";
const mediaPreviewPath = "apps/web/src/features/preview/MediaPreview.tsx";
const mediaPreview = existsSync(path.join(root, mediaPreviewPath))
  ? read(mediaPreviewPath)
  : "";
const centralPreviewStagePath = "apps/web/src/features/preview/CentralPreviewStage.tsx";
const centralPreviewStage = existsSync(path.join(root, centralPreviewStagePath))
  ? read(centralPreviewStagePath)
  : "";
const desktopAdapterPath = "apps/web/src/core/desktop.ts";
const desktopAdapter = read(desktopAdapterPath);
const packageJson = readJson("package.json");
const webPackageJson = readJson("apps/web/package.json");
const coreClientPackagePath = "packages/core-client/package.json";
const coreClient = read("packages/core-client/src/client.ts");
const coreClientContract = read("packages/core-client/src/generated-contract.ts");
const duplicateCoreContractNames = [
  "Page",
  "RootRecord",
  "FolderRecord",
  "MediaRecord",
  "AcceptedRootResponse",
  "ScanSummary",
  "TaskRecord",
  "ListMediaParams",
  "CoreClientConfig",
  "CoreApiError"
];

if (!existsSync(path.join(root, coreClientPackagePath))) {
  fail("packages/core-client must be a real workspace package");
} else {
  const coreClientPackageJson = readJson(coreClientPackagePath);
  if (coreClientPackageJson.name !== "@megle/core-client") {
    fail("packages/core-client package name must be @megle/core-client");
  }
  if (!coreClientPackageJson.scripts?.check) {
    fail("@megle/core-client must expose a package boundary check");
  }
}

if (!packageJson.workspaces?.includes("packages/core-client")) {
  fail("root workspaces must include packages/core-client");
}

if (webPackageJson.dependencies?.["@megle/core-client"] !== "*") {
  fail("apps/web must depend on @megle/core-client through the root workspace");
}

if (!/getThumbnail:\s*\(fileId:\s*number,\s*target:\s*"grid_320"/.test(coreClient)) {
  fail("core-client getThumbnail must expose the target query vocabulary");
}
if (!/getThumbnailBlob:\s*async\s*\([\s\S]*?fileId:\s*number,[\s\S]*?target:\s*"grid_320"/.test(coreClient)) {
  fail("core-client getThumbnailBlob must expose the target query vocabulary");
}
if (!/interface\s+BlobRequestOptions[\s\S]*?signal\?:\s*AbortSignal/.test(coreClient)) {
  fail("core-client blob helpers must expose AbortSignal request options");
}
if (!/interface\s+BlobRequestOptions[\s\S]*?version\?:\s*number\s*\|\s*string\s*\|\s*null/.test(coreClient)) {
  fail("core-client thumbnail blob helper must expose a version cache-buster option");
}
if (!/getThumbnailBlob[\s\S]*?query\(\{\s*target,\s*v:\s*options\.version/.test(coreClient)) {
  fail("core-client getThumbnailBlob must put the version cache-buster in the HTTP request URL");
}
if (!/getPreviewBlob[\s\S]*?query\(\{\s*v:\s*options\.version/.test(coreClient)) {
  fail("core-client getPreviewBlob must put the version cache-buster in the HTTP request URL");
}
if (/thumbnail\$\{query\(\{\s*profile/.test(coreClient) || /thumbnail\/blob\$\{query\(\{\s*profile/.test(coreClient)) {
  fail("core-client thumbnail helpers must not serialize the retired profile query");
}
for (const value of ["previewPlaceholder", "previewPlaceholderFormat", "servedBy", "db_blob"]) {
  if (!coreClientContract.includes(value)) {
    fail(`core-client generated contract missing ${value}`);
  }
}

if (!existsSync(path.join(root, desktopAdapterPath))) {
  fail("web desktop bridge access must be isolated in apps/web/src/core/desktop.ts");
}

for (const value of ["notifyShellReady", "notifyDesktopShellReady"]) {
  if (!desktopAdapter.includes(value)) {
    fail(`web desktop bridge helper missing ${value}`);
  }
}

if (
  !/const\s+didNotify\s*=\s*await\s+notifyShellReady\(\)[\s\S]*?if\s*\(!didNotify\)\s*\{\s*desktopShellReadyNotified\s*=\s*false;?\s*\}[\s\S]*?return\s+didNotify/.test(
    desktopAdapter
  )
) {
  fail("notifyDesktopShellReady must reset its latch when notifyShellReady resolves false so later calls can retry");
}

if (!mediaGrid.includes("@tanstack/react-virtual") || !mediaGrid.includes("useVirtualizer")) {
  fail("MediaGrid must use @tanstack/react-virtual for scalable media layout");
}

if (/Loading library/.test(mediaGrid)) {
  fail("MediaGrid tiles must keep stable dimensions without loading text layout shifts");
}
if (!mediaGrid.includes("scrollToIndex")) {
  fail("MediaGrid keyboard navigation must scroll the selected row into view");
}
if (!mediaGrid.includes('role="row"')) {
  fail("MediaGrid role=grid must expose row roles around grid cells");
}

for (const value of ["listRoots", "listFolderChildren", "listMedia", "addRoot", "listTasks", "enqueueScan"]) {
  if (!useLibraryData.includes(value)) {
    fail(`useLibraryData must call ${value}`);
  }
}
if (!/setSelectedFolder:\s*\(folder:\s*FolderRecord\)\s*=>\s*void/.test(useLibraryData)) {
  fail("useLibraryData must select folders by FolderRecord so rootId and folderId stay in sync");
}
if (!/setSelectedFolder\(folder\)/.test(librarySidebar)) {
  fail("LibrarySidebar must pass the full FolderRecord when selecting folders");
}
if (/loadAllPages/.test(useLibraryData)) {
  fail("useLibraryData must not exhaust all cursor pages into React state");
}
for (const value of [
  "mediaNextCursor",
  "mediaHasMore",
  "mediaPageGeneration",
  "requestGeneration",
  "loadingMoreMedia",
  "loadMoreMedia",
  "folderChildNextCursorByParent",
  "loadMoreFolderChildren"
]) {
  if (!useLibraryData.includes(value)) {
    fail(`useLibraryData must keep bounded pagination state/action ${value}`);
  }
}
if (!/cursor:\s*cursor\s*\?\?\s*undefined/.test(useLibraryData)) {
  fail("useLibraryData must request one cursor page at a time");
}
if (!/requestGeneration\s*!==\s*mediaPageGeneration\.current/.test(useLibraryData)) {
  fail("loadMoreMedia must discard stale page responses after media context changes");
}
if (!/const loadLibrary = useCallback\(async \(\) => \{\s*const requestGeneration = \+\+mediaPageGeneration\.current;[\s\S]*?await loadRoots/.test(useLibraryData)) {
  fail("loadLibrary must invalidate media page generation before awaited reload work starts");
}
if (!mediaGrid.includes("onRequestMore") || !mediaGrid.includes("hasMore")) {
  fail("MediaGrid must request incremental media pages near the loaded tail");
}
if (!existsSync(path.join(root, mediaResourcesPath))) {
  fail("web thumbnail resource helper must live behind apps/web/src/core/mediaResources.ts");
}
if (!/import\s+type\s+{[\s\S]*ThumbnailResponse[\s\S]*}\s+from\s+"@megle\/core-client"/.test(mediaResources)) {
  fail("mediaResources must use the @megle/core-client ThumbnailResponse contract");
}
if (!/createCoreClient\(\)[\s\S]*?getThumbnail\(/.test(mediaResources)) {
  fail("mediaResources must request thumbnail state through @megle/core-client getThumbnail");
}
if (!/inFlightThumbnailRequests/.test(mediaResources) || !/thumbnailResourceCache/.test(mediaResources)) {
  fail("mediaResources must coalesce in-flight thumbnail requests and cache state by media id");
}
if (
  !/type\s+CachedThumbnailEntry/.test(mediaResources) ||
  !/export\s+function\s+mediaContentSignature/.test(mediaResources) ||
  !/mediaRecord\.mtime/.test(mediaResources) ||
  !/mediaRecord\.size/.test(mediaResources) ||
  !/entry\.mediaSignature\s*!==\s*mediaContentSignature\(mediaRecord\)/.test(mediaResources)
) {
  fail("mediaResources cached thumbnails must be tied to a media content signature");
}
if (
  !/thumbnailStateSignaturesByMediaIdRef/.test(useLibraryData) ||
  !/mediaContentSignature\(mediaRecord\)/.test(useLibraryData) ||
  !/requestedMediaSignature/.test(useLibraryData) ||
  !/currentMediaSignature\s*!==\s*requestedMediaSignature/.test(useLibraryData) ||
  !/filterFreshThumbnailStates\([\s\S]*?thumbnailStateSignaturesByMediaIdRef\.current/.test(useLibraryData)
) {
  fail("useLibraryData must carry media signatures through React thumbnail state");
}
if (
  !/selectedMediaThumbnailRequestKey/.test(useLibraryData) ||
  !/mediaContentSignature\(selectedMedia\)/.test(useLibraryData) ||
  !/requestThumbnailStates\(\[selectedMedia\.id\]\)/.test(useLibraryData)
) {
  fail("useLibraryData selected thumbnail requests must be keyed by selected media signature");
}
if (!/MediaRecord/.test(mediaResources) || !/isFreshThumbnailForMediaRecord/.test(mediaResources)) {
  fail("mediaResources must validate cached thumbnail responses against the media record thumbnail summary");
}
if (!/explicitMediaThumbnailState/.test(mediaResources) || !/isTerminalThumbnailState/.test(mediaResources) || !/mediaState\s*!==\s*thumbnail\.state/.test(mediaResources)) {
  fail("mediaResources must invalidate cached terminal thumbnails when the current media row explicitly disagrees");
}
if (!/isFreshCachedThumbnailForMediaRecord/.test(mediaResources) || !/isLiveThumbnailResponseForMediaRecord/.test(mediaResources)) {
  fail("mediaResources must separate cached thumbnail freshness from live response acceptance");
}
if (!/isLiveThumbnailResponseForMediaRecord\(mediaRecord,\s*thumbnail\)[\s\S]*?thumbnailResourceCache\.set/.test(mediaResources)) {
  fail("mediaResources must accept a fresh live ready thumbnail response even when the media row still says pending");
}
if (/thumbnailCacheKey/.test(mediaResources)) {
  fail("mediaResources must not treat transitional thumbnailCacheKey as runtime truth");
}
if (!/thumbnailResourceCache\.delete/.test(mediaResources) || !/thumbnail\.target\s*!==\s*GRID_THUMBNAIL_TARGET/.test(mediaResources)) {
  fail("mediaResources must drop stale cached thumbnails that do not match target=grid_320");
}
if (!/readCachedThumbnailStates\(\s*mediaRecords:\s*MediaRecord\[\]\s*\)/.test(mediaResources)) {
  fail("mediaResources must read cached thumbnail state through media records, not bare media ids");
}
if (!/thumbnailRequestKey\(mediaRecord\)/.test(mediaResources) || !/inFlightThumbnailRequests\.get\(requestKey\)/.test(mediaResources)) {
  fail("mediaResources must key in-flight thumbnail coalescing by media id plus thumbnail summary");
}
if (!/requestThumbnailStates:\s*\(mediaIds:\s*number\[\]\)\s*=>\s*void/.test(useLibraryData)) {
  fail("useLibraryData must expose visible-range thumbnail state requests");
}
if (!/thumbnailStatesByMediaId:\s*Record<number,\s*ThumbnailResponse>/.test(useLibraryData)) {
  fail("useLibraryData must expose thumbnail state by media id without leaking cache paths");
}
if (!/inFlightMediaPageKeys/.test(useLibraryData) || !/mediaPageRequestKey/.test(useLibraryData)) {
  fail("loadMoreMedia must synchronously coalesce duplicate cursor page requests by root/folder/cursor");
}
if (!/inFlightFolderChildPageKeys/.test(useLibraryData) || !/folderChildPageRequestKey/.test(useLibraryData)) {
  fail("loadMoreFolderChildren must synchronously coalesce duplicate cursor page requests by folder/cursor");
}
if (!/onRequestThumbnailStates/.test(mediaGrid) || !/visibleMediaIds/.test(mediaGrid)) {
  fail("MediaGrid must report visible/near-visible media ids for incremental thumbnail requests");
}
if (!/visibleMedia(?:Id)?Key/.test(mediaGrid)) {
  fail("MediaGrid immediate thumbnail requests must be keyed by the stable visible media id set");
}
if (!/mediaContentSignature/.test(mediaGrid) || !/visibleMediaSignatureKey/.test(mediaGrid)) {
  fail("MediaGrid immediate thumbnail requests must include visible media content signatures");
}
for (const state of ["pending", "queued", "ready", "failed", "skipped_small"]) {
  if (!mediaGrid.includes(`"${state}"`)) {
    fail(`MediaGrid must render a stable thumbnail state branch for ${state}`);
  }
}
if (!/thumbnailStatesByMediaId\[item\.id\]/.test(mediaGrid)) {
  fail("MediaGrid tiles must receive thumbnail state from the resource map by media id");
}
if (!/previewPlaceholder/.test(mediaGrid) || !/previewPlaceholderUrl/.test(mediaGrid)) {
  fail("MediaGrid must render MediaRecord.previewPlaceholder before grid_320 bytes are ready");
}
if (!/previewPlaceholderDataUrl\(item\)/.test(mediaGrid) || /usePreviewPlaceholderUrl/.test(mediaGrid)) {
  fail("MediaGrid previewPlaceholder must be derived synchronously during render, not in an effect");
}
if (!/requestThumbnailBlob\(fileId/.test(mediaGrid) || /createCoreClient/.test(mediaGrid)) {
  fail("MediaGrid must load grid_320 bytes through the shared media resource helper");
}
if (/thumbnailUpdatedAt=\{thumbnail\?\.updatedAt\s*\?\?\s*null\}/.test(mediaGrid) || !/hasLiveReadyThumbnail/.test(mediaGrid)) {
  fail("MediaGrid must not request thumbnail blobs from media-row ready state without a live updatedAt");
}
if (!/hasLiveThumbnailMetadata/.test(mediaGrid) || !/rowState\s*===\s*"ready"/.test(mediaGrid)) {
  fail("MediaGrid must keep requesting state for pending, queued, or ready rows without live thumbnail metadata");
}
if (!/data-preview-placeholder/.test(mediaGrid) || !/data-preview-placeholder/.test(mediaPreview)) {
  fail("Grid and preview placeholder rendering must include data-preview-placeholder markers for smoke tests");
}
if (!previewPanel) {
  fail("PreviewPanel must provide a selected media preview foundation");
}
if (!/PreviewPanel/.test(libraryView) || !/selectedMedia/.test(previewPanel) || !/thumbnail/.test(previewPanel)) {
  fail("LibraryView must render a PreviewPanel with selected media and thumbnail state");
}
if (!mediaPreview.includes("getPreviewBlob") || !mediaPreview.includes("requestThumbnailBlob")) {
  fail("MediaPreview must load central previews from original media while keeping inspector previews on shared thumbnail blobs");
}
if (!/mediaContentSignature\(media\)/.test(mediaPreview) || !/source="original"[\s\S]*?versionKey=\{originalVersionKey\}/.test(mediaPreview)) {
  fail("MediaPreview original preview must pass a media signature version key");
}
if (!/hasLiveReadyThumbnail/.test(mediaPreview) || /thumbnail\?\.state\s*===\s*"ready"\s*\?\s*thumbnail\.fileId/.test(mediaPreview)) {
  fail("MediaPreview must not request thumbnail blobs without live ready metadata and updatedAt");
}
if (!/AbortController/.test(mediaPreview) || !/getPreviewBlob\(fileId,\s*\{\s*signal:\s*controller\.signal,\s*version:\s*versionKey\s*\?\?\s*null\s*\}\)/.test(mediaPreview)) {
  fail("MediaPreview original-media requests must be aborted when central preview switches");
}
if (/useThumbnailFallbackUrl\(\s*thumbnail\?\.state\s*===\s*"ready"/.test(mediaPreview)) {
  fail("MediaPreview must not start the thumbnail fallback hook for thumbnail-primary rendering");
}
if (!/previewPlaceholderUrl/.test(mediaPreview) || !/fallbackThumbnail/.test(mediaPreview)) {
  fail("MediaPreview must show previewPlaceholder and thumbnail fallback while media bytes load");
}
if (!/previewPlaceholderDataUrl\(media\)/.test(mediaPreview) || /usePreviewPlaceholderUrl/.test(mediaPreview)) {
  fail("MediaPreview previewPlaceholder must be available on first render without an effect");
}
if (!mediaPreview.includes('source = "thumbnail"') || !mediaPreview.includes('source === "original"')) {
  fail("MediaPreview must require explicit original-source mode for central preview rendering");
}
if (!centralPreviewStage.includes('source="original"')) {
  fail("CentralPreviewStage must request original media bytes through MediaPreview");
}
if (!/thumbnail=\{thumbnail\}/.test(centralPreviewStage)) {
  fail("CentralPreviewStage must pass thumbnail state only as fallback while original media loads");
}
if (!centralPreviewStage.includes("shouldSkipPreviewPan")) {
  fail("CentralPreviewStage must guard interactive media/control targets before starting preview pan");
}
for (const value of [
  "video",
  "audio",
  "button",
  "input",
  "select",
  "textarea",
  "[controls]",
  "[contenteditable]",
  "a",
  "[data-skip-preview-pan]"
]) {
  if (!centralPreviewStage.includes(value)) {
    fail(`CentralPreviewStage preview pan skip selector missing ${value}`);
  }
}
if (
  !/function handlePointerDown[\s\S]*?shouldSkipPreviewPan[\s\S]*?preventDefault[\s\S]*?setPointerCapture/.test(
    centralPreviewStage
  )
) {
  fail("CentralPreviewStage must skip interactive preview pan targets before preventDefault and pointer capture");
}
if (!/MediaPreview[\s\S]{0,140}thumbnail=\{thumbnail\}/.test(previewPanel)) {
  fail("PreviewPanel must keep using thumbnail state for the right inspector preview");
}
if (!/MediaPreview[\s\S]{0,180}source="thumbnail"[\s\S]{0,180}thumbnail=\{thumbnail\}/.test(previewPanel)) {
  fail("PreviewPanel must use the light thumbnail preview path, not original media");
}
if (!librarySidebar.includes("loadMoreFolderChildren") || !librarySidebar.includes("Load more")) {
  fail("LibrarySidebar must expose a load-more affordance for paginated folder children");
}
if (!/rescanRoot:\s*\(rootId:\s*number\)\s*=>\s*Promise<void>/.test(useLibraryData)) {
  fail("useLibraryData must expose a typed rescanRoot action");
}
if (!librarySidebar.includes("rescanRoot") || librarySidebar.includes("Rescan is not available from the current Core API")) {
  fail("LibrarySidebar must wire rescan to the supported Core enqueueScan capability");
}
for (const value of ["addingRoot", "scanActive"]) {
  if (!useLibraryData.includes(value)) {
    fail(`useLibraryData must keep separate ${value} state`);
  }
}
if (!/setInterval[\s\S]*?\.catch\(/.test(useLibraryData)) {
  fail("task polling interval must catch listTasks/load failures");
}

if (!packageJson.scripts?.["check:web"]) {
  fail("root package.json missing check:web");
}

for (const filePath of walk(webSrc)) {
  const relative = path.relative(root, filePath).replaceAll("\\", "/");
  const contents = readFileSync(filePath, "utf8");

  if (/\bfetch\s*\(/.test(contents)) {
    fail(`raw fetch is not allowed in web source; use @megle/core-client or document an explicit non-Core exception: ${relative}`);
  }
  if (contents.includes("node:fs") || contents.includes("electron")) {
    fail(`web source must not import filesystem/electron APIs: ${relative}`);
  }
  if (
    contents.includes("window.megleDesktop") &&
    relative !== desktopAdapterPath
  ) {
    fail(`desktop preload bridge access must stay in ${desktopAdapterPath}: ${relative}`);
  }
  if (contents.includes("thumbnailCacheKey")) {
    fail(`web must not consume retired thumbnailCacheKey runtime truth: ${relative}`);
  }

  for (const name of duplicateCoreContractNames) {
    const declarationPattern = new RegExp(`\\b(?:export\\s+)?(?:interface|type|class)\\s+${name}\\b`);
    if (declarationPattern.test(contents)) {
      fail(`web must not declare duplicate Core API contract ${name}: ${relative}`);
    }
  }
}

for (const value of ["@megle/core-client", "createCoreClient"]) {
  const found = walk(webSrc).some((filePath) => readFileSync(filePath, "utf8").includes(value));
  if (!found) {
    fail(`web core boundary must import ${value}`);
  }
}

if (!process.exitCode) {
  console.log("PASS: web client boundaries");
}
