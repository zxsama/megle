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

function sourceMatch(source, pattern) {
  return source.match(pattern)?.[0] ?? "";
}

const useLibraryData = read("apps/web/src/core/useLibraryData.ts");
const refreshCurrentScanViewBlock = sourceMatch(
  useLibraryData,
  /const\s+refreshCurrentScanView\s*=\s*useCallback\([\s\S]*?\n\s*\]\);\n\n\s*const\s+loadLibrary/
);
const loadLibraryBlock = sourceMatch(
  useLibraryData,
  /const\s+loadLibrary\s*=\s*useCallback\([\s\S]*?\n\s*\]\);/
);
const loadLibraryDependenciesBlock =
  useLibraryData.match(/const\s+loadLibrary\s*=\s*useCallback\([\s\S]*?\},\s*(\[[^\]]*\])\);/)?.[1] ??
  "";
const scanRefreshEffectBlock = sourceMatch(
  useLibraryData,
  /useEffect\(\(\)\s*=>\s*\{\s*if\s*\(\s*!scanActiveRootTask[\s\S]*?\},\s*\[refreshCurrentScanView,\s*scanActiveRootTask,\s*(?:taskPollFailures|scanRefreshFailures)\]\);/
);
const selectedRootHandlerBlock = sourceMatch(
  useLibraryData,
  /setSelectedRootId:\s*\(rootId:\s*number\)\s*=>\s*\{[\s\S]*?\n\s*\},\n\s*setSelectedFolder:/
);
const selectedFolderHandlerBlock = sourceMatch(
  useLibraryData,
  /setSelectedFolder:\s*\(folder:\s*FolderRecord\)\s*=>\s*\{[\s\S]*?\n\s*\},\n\s*setSelectedMediaId:/
);
const initialLoadEffectBlock = sourceMatch(
  useLibraryData,
  /useEffect\(\(\)\s*=>\s*\{\s*void\s+loadLibrary\(\);\s*\},\s*\[loadLibrary\]\);/
);
const mediaResourcesPath = "apps/web/src/core/mediaResources.ts";
const mediaResources = existsSync(path.join(root, mediaResourcesPath))
  ? read(mediaResourcesPath)
  : "";
const mediaGrid = read("apps/web/src/features/media-grid/MediaGrid.tsx");
const main = read("apps/web/src/main.tsx");
const app = read("apps/web/src/app/App.tsx");
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

if (
  !/getThumbnail:\s*\(\s*fileId:\s*number,\s*target:\s*"grid_320"\s*=\s*"grid_320",\s*priority:\s*ThumbnailPriority/.test(
    coreClient
  )
) {
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

if (!/import\s+\{\s*notifyDesktopShellReady\s*\}\s+from\s+"\.\/core\/desktop";/.test(main)) {
  fail("web entrypoint must import notifyDesktopShellReady for the earliest desktop shell-ready handshake");
}

if (!/void\s+notifyDesktopShellReady\(\);\s*[\s\S]*?ReactDOM\.createRoot/.test(main)) {
  fail("web entrypoint must notify desktop shell readiness before mounting React");
}

if (/import\s+\{\s*App\s*\}\s+from\s+"\.\/app\/App";/.test(main)) {
  fail("web entrypoint must not statically import App before the desktop shell-ready handshake");
}

if (!/void\s+notifyDesktopShellReady\(\);\s*[\s\S]*?import\("\.\/app\/App"\)[\s\S]*?ReactDOM\.createRoot/.test(main)) {
  fail("web entrypoint must load App only after the early desktop shell-ready handshake has been queued");
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
if (
  !/onRequestThumbnailStates\(visible(?:Priority)?MediaIds,\s*"visible"\)/.test(mediaGrid) ||
  !/onRequestThumbnailStates\(ahead(?:Priority)?MediaIds,\s*"ahead"\)/.test(mediaGrid)
) {
  fail("MediaGrid must request visible and ahead thumbnail scopes separately");
}
if (
  !/const\s+AHEAD_THUMBNAIL_(?:ROW|VIEWPORT)_COUNT\s*=/.test(mediaGrid) &&
  !/ahead(?:Row|Viewport)Count/.test(mediaGrid)
) {
  fail("MediaGrid must keep ahead-of-viewport thumbnail scope configurable");
}
if (!/const\s+visibleMedia\s*=\s*useMemo/.test(mediaGrid) || !/const\s+aheadMedia\s*=\s*useMemo/.test(mediaGrid)) {
  fail("MediaGrid must derive distinct visible and ahead media scopes");
}
if (
  !/VISIBLE_THUMBNAIL_REPOLL_MS|FOREGROUND_THUMBNAIL_REPOLL_MS/.test(mediaGrid) ||
  /1500/.test(mediaGrid)
) {
  fail("MediaGrid foreground thumbnail repoll must be explicit and much faster than 1500ms");
}

for (const value of ["listRoots", "listFolderChildren", "listMedia", "addRoot", "listTasks", "enqueueScan"]) {
  if (!useLibraryData.includes(value)) {
    fail(`useLibraryData must call ${value}`);
  }
}
if (!/setSelectedFolder:\s*\(folder:\s*FolderRecord\)\s*=>\s*void/.test(useLibraryData)) {
  fail("useLibraryData must select folders by FolderRecord so rootId and folderId stay in sync");
}
if (!/enqueueInteractiveFolderScan/.test(useLibraryData)) {
  fail("useLibraryData must call enqueueInteractiveFolderScan for the active folder");
}
if (!/syncThumbnailPriorityScope/.test(coreClient) || !/syncThumbnailPriorityScope/.test(useLibraryData)) {
  fail("thumbnail scope sync must be exposed by core-client and used from useLibraryData");
}
if (
  !/requestThumbnailStates:\s*\(mediaIds:\s*number\[\],\s*priority:\s*ThumbnailRequestPriority\)\s*=>\s*void/.test(
    useLibraryData
  )
) {
  fail("useLibraryData must expose explicit thumbnail priority when requesting states");
}
if (
  !/thumbnailPriorityScopeRef/.test(useLibraryData) ||
  !/scheduleThumbnailPriorityScopeSync/.test(useLibraryData) ||
  !/requestThumbnailStates[\s\S]*scheduleThumbnailPriorityScopeSync\(\s*priority,\s*mediaIds\s*\)/.test(
    useLibraryData
  )
) {
  fail("useLibraryData requestThumbnailStates must coalesce current selected/visible/ahead scope into a thumbnail scope sync call");
}
if (!/requestThumbnailStates\(\[selectedMedia\.id\],\s*"selected"\)/.test(useLibraryData)) {
  fail("useLibraryData must request selected media thumbnails through the selected priority path");
}
if (
  !/useEffect\(\(\)\s*=>\s*\{[\s\S]*?selectedFolderId[\s\S]*?enqueueInteractiveFolderScan\(\s*selectedFolderId\s*\)/.test(
    useLibraryData
  )
) {
  fail("useLibraryData must enqueue interactive folder scan when the current folder becomes active");
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
if (!/const\s+loadLibrary\s*=\s*useCallback\(async\s*\(scope\?:\s*LibrarySelectionScope\)\s*=>\s*\{\s*const requestGeneration = \+\+mediaPageGeneration\.current;[\s\S]*?await loadRoots\(scope\)/.test(useLibraryData)) {
  fail("loadLibrary must invalidate media page generation before awaited reload work starts");
}
if (
  !/const\s+loadRoots\s*=\s*useCallback\(async\s*\(scope\?:\s*LibrarySelectionScope\)\s*=>/.test(
    useLibraryData
  ) ||
  !/selectedRootIdRef\.current/.test(useLibraryData) ||
  !/selectedFolderIdRef\.current/.test(useLibraryData)
) {
  fail("useLibraryData loadRoots must resolve selection through explicit scope or selection refs, not captured navigation state");
}
if (
  !/const\s+loadLibrary\s*=\s*useCallback\(async\s*\(scope\?:\s*LibrarySelectionScope\)\s*=>/.test(
    useLibraryData
  ) ||
  !loadLibraryBlock ||
  !loadLibraryDependenciesBlock ||
  /\bselectedRootId\b/.test(loadLibraryDependenciesBlock) ||
  /\bselectedFolderId\b/.test(loadLibraryDependenciesBlock)
) {
  fail("useLibraryData loadLibrary must not capture selectedRootId/selectedFolderId and re-run the full load chain on navigation");
}
if (
  !initialLoadEffectBlock ||
  /selectedRootId/.test(initialLoadEffectBlock) ||
  /selectedFolderId/.test(initialLoadEffectBlock)
) {
  fail("useLibraryData initial load effect must stay isolated from root/folder navigation changes");
}
if (!/SCAN_REFRESH_INTERVAL_MS/.test(useLibraryData)) {
  fail("useLibraryData must define a scan-time current-view refresh interval");
}
if (!/scanActiveRootTask/.test(useLibraryData) || !/loadTasks/.test(useLibraryData)) {
  fail("useLibraryData must track active root scans for the selected root");
}
if (
  !/reloadCurrentMedia\s*=\s*useCallback/.test(useLibraryData) ||
  !/selectedFolderId/.test(useLibraryData) ||
  !/listMedia/.test(useLibraryData)
) {
  fail("useLibraryData must reload current folder media while scanning");
}
if (
  !/refreshCurrentScanView\s*=\s*useCallback[\s\S]*?await\s+loadTasks\(\)[\s\S]*?(?:selectedFolderId|selectionToken\.folderId)[\s\S]*?loadFolderChildren\((?:selectedFolderId|selectionToken\.folderId)\)[\s\S]*?reloadCurrentMedia\(\{[\s\S]*?folderId:\s*(?:selectedFolderId|selectionToken\.folderId)/.test(
    useLibraryData
  )
) {
  fail("useLibraryData must incrementally refresh current folder media and children during scan");
}
if (!refreshCurrentScanViewBlock) {
  fail("useLibraryData must keep refreshCurrentScanView as an inspectable useCallback");
}
if (!scanRefreshEffectBlock) {
  fail("useLibraryData must keep the root-scan refresh effect inspectable");
}
if (!selectedRootHandlerBlock || !selectedFolderHandlerBlock) {
  fail("useLibraryData must keep root and folder navigation handlers inspectable");
}
if (
  !/const\s+\[scanRefreshFailures,\s*setScanRefreshFailures\]\s*=\s*useState\(0\)/.test(useLibraryData) ||
  !/scanRefreshFailures\s*>=\s*3/.test(scanRefreshEffectBlock) ||
  /taskPollFailures\s*>=\s*3/.test(scanRefreshEffectBlock) ||
  !/setScanRefreshFailures\(\(failures\)\s*=>\s*failures\s*\+\s*1\)/.test(scanRefreshEffectBlock)
) {
  fail("useLibraryData scan refresh must keep separate failure accounting so loadTasks success cannot reset refresh backoff");
}
if (
  !/scanRefreshInFlightRef\s*=\s*useRef\(false\)/.test(useLibraryData) ||
  !/if\s*\(\s*scanRefreshInFlightRef\.current\s*\)\s*\{\s*return;?\s*\}/.test(scanRefreshEffectBlock) ||
  !/scanRefreshInFlightRef\.current\s*=\s*true/.test(scanRefreshEffectBlock) ||
  !/finally\s*\(\(\)\s*=>\s*\{[\s\S]*?scanRefreshInFlightRef\.current\s*=\s*false/.test(scanRefreshEffectBlock)
) {
  fail("useLibraryData scan refresh loop must prevent overlapping refreshes with an in-flight guard");
}
if (/expandedFolderIds/.test(refreshCurrentScanViewBlock)) {
  fail("useLibraryData scan refresh must not fan out across expanded folders");
}
if (
  !/reloadCurrentMedia\s*=\s*useCallback[\s\S]*?catch\s*\(\s*cause\s*\)\s*\{[\s\S]*?setError\(errorMessage\(cause\)\);[\s\S]*?throw\s+cause;[\s\S]*?\}/.test(
    useLibraryData
  )
) {
  fail("reloadCurrentMedia must rethrow reload failures so scan refresh backoff can trip");
}
if (
  !/reloadCurrentMedia\(\{[\s\S]*?\}\)\s*\.catch\(\(cause\)\s*=>\s*\{[\s\S]*?setError\(errorMessage\(cause\)\)/.test(
    selectedRootHandlerBlock
  ) ||
  !/reloadCurrentMedia\(\{[\s\S]*?\}\)\s*\.catch\(\(cause\)\s*=>\s*\{[\s\S]*?setError\(errorMessage\(cause\)\)/.test(
    selectedFolderHandlerBlock
  )
) {
  fail("useLibraryData navigation-triggered media reloads must catch rethrown failures");
}
if (
  !/const\s+prepareNavigationMediaReload\s*=\s*useCallback\(\(\)\s*=>\s*\{[\s\S]*?scanRefreshSelectionVersionRef\.current\s*\+=\s*1[\s\S]*?setScanRefreshFailures\(0\)/.test(
    useLibraryData
  ) ||
  !/setLoadingMoreMedia\(false\)/.test(useLibraryData) ||
  !/flushThumbnailPriorityScopeSync\(\)/.test(useLibraryData) ||
  !/prepareNavigationMediaReload\(\)/.test(selectedRootHandlerBlock) ||
  !/prepareNavigationMediaReload\(\)/.test(selectedFolderHandlerBlock)
) {
  fail("useLibraryData navigation changes must clear load-more state, flush thumbnail scope sync, and reset scan refresh failures");
}
if (
  !/scanRefreshActiveRootIdRef\s*=\s*useRef<number\s*\|\s*null>\(null\)/.test(useLibraryData) ||
  !/useEffect\(\(\)\s*=>\s*\{[\s\S]*?if\s*\(\s*!scanActiveRootTask\s*\)\s*\{[\s\S]*?scanRefreshActiveRootIdRef\.current\s*=\s*null[\s\S]*?return;?[\s\S]*?\}[\s\S]*?if\s*\(\s*scanRefreshActiveRootIdRef\.current\s*!==\s*selectedRootId\s*\)\s*\{[\s\S]*?scanRefreshActiveRootIdRef\.current\s*=\s*selectedRootId[\s\S]*?setScanRefreshFailures\(0\)[\s\S]*?\}[\s\S]*?\},\s*\[scanActiveRootTask,\s*selectedRootId\]\);/.test(
    useLibraryData
  )
) {
  fail("useLibraryData must reset scan refresh failures when a new selected-root scan context begins");
}
if (!/setInterval[\s\S]*?refreshCurrentScanView\(\)[\s\S]*?\.catch/.test(scanRefreshEffectBlock)) {
  fail("useLibraryData must run the current-view refresh loop while a root scan is active");
}
if (
  !/type\s+ScanRefreshSelectionToken\s*=/.test(useLibraryData) ||
  !/scanRefreshSelectionVersionRef\s*=\s*useRef\(0\)/.test(useLibraryData) ||
  !/createScanRefreshSelectionToken\s*=\s*useCallback\(\(\)\s*:\s*ScanRefreshSelectionToken\s*\|\s*null/.test(useLibraryData) ||
  !/isCurrentScanRefreshSelection\s*=\s*useCallback\(\s*\(\s*token:\s*ScanRefreshSelectionToken\s*\)/.test(useLibraryData) ||
  !/scanRefreshSelectionToken\?:\s*ScanRefreshSelectionToken/.test(useLibraryData) ||
  !/if\s*\(\s*scanRefreshSelectionToken\s*&&\s*!isCurrentScanRefreshSelection\(scanRefreshSelectionToken\)\s*\)\s*\{\s*return;?\s*\}/.test(useLibraryData) ||
  !/if\s*\(\s*requestGeneration\s*!==\s*mediaPageGeneration\.current\s*\|\|\s*\(\s*scanRefreshSelectionToken\s*&&\s*!isCurrentScanRefreshSelection\(scanRefreshSelectionToken\)\s*\)\s*\)/.test(useLibraryData) ||
  !/const\s+selectionToken\s*=\s*createScanRefreshSelectionToken\(\)/.test(refreshCurrentScanViewBlock) ||
  !/if\s*\(\s*!selectionToken\s*\|\|\s*!isCurrentScanRefreshSelection\(selectionToken\)\s*\)\s*\{\s*return;?\s*\}/.test(refreshCurrentScanViewBlock) ||
  !/reloadCurrentMedia\(\{[\s\S]*?scanRefreshSelectionToken:\s*selectionToken/.test(refreshCurrentScanViewBlock) ||
  !/scanRefreshSelectionVersionRef\.current\s*\+=\s*1[\s\S]*?selectRoot\(rootId\)/.test(useLibraryData) ||
  !/scanRefreshSelectionVersionRef\.current\s*\+=\s*1[\s\S]*?selectRoot\(folder\.rootId\)/.test(useLibraryData)
) {
  fail("useLibraryData scan refresh must use a selection/version token to discard stale media after root or folder navigation");
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
  !/requestThumbnailStates\(\[selectedMedia\.id\],\s*"selected"\)/.test(useLibraryData)
) {
  fail("useLibraryData selected thumbnail requests must be keyed by selected media signature");
}
if (
  !/task\.kind === "root_scan"/.test(useLibraryData) ||
  !(
    /interactiveRefreshScope/.test(useLibraryData) &&
    /task\.kind === "interactive_folder_scan"/.test(useLibraryData) &&
    /reloadCurrentMedia\(\{[\s\S]*?folderId:\s*interactiveRefreshScope\.folderId/.test(useLibraryData)
  )
) {
  fail("useLibraryData task success handling must avoid full reload churn for thumbnail success and keep interactive refresh scoped");
}
if (!/MediaRecord/.test(mediaResources) || !/isFreshThumbnailForMediaRecord/.test(mediaResources)) {
  fail("mediaResources must validate cached thumbnail responses against the media record thumbnail summary");
}
if (
  !/explicitMediaThumbnailState/.test(mediaResources) ||
  !/const\s+mediaState\s*=\s*explicitMediaThumbnailState\(mediaRecord\.thumbnailState\);/.test(mediaResources)
) {
  fail("mediaResources must evaluate media-row thumbnail state when deciding whether local thumbnail state is still fresh");
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
if (
  !/const\s+mediaState\s*=\s*explicitMediaThumbnailState\(mediaRecord\.thumbnailState\);[\s\S]*?if\s*\(\s*mediaState\s*===\s*"ready"\s*&&\s*thumbnail\.state\s*!==\s*"ready"\s*\)\s*\{\s*return\s+false;?\s*\}/.test(
    mediaResources
  )
) {
  fail("mediaResources must drop stale local non-ready thumbnail state once the media row itself is already ready");
}
if (
  !/thumbnailRequestKey\(mediaRecord,\s*priority\)/.test(mediaResources) ||
  !/inFlightThumbnailRequests\.get\(requestKey\)/.test(mediaResources)
) {
  fail("mediaResources must key in-flight thumbnail coalescing by media id plus thumbnail summary");
}
if (
  /failedThumbnailState\(mediaRecord\.id,\s*cause\)/.test(useLibraryData) ||
  /state === "failed"\s*\|\|/.test(mediaResources)
) {
  fail("transient thumbnail request failures must not synthesize a local failed state that blocks retry");
}
if (
  !/requestThumbnailStates:\s*\(mediaIds:\s*number\[\],\s*priority:\s*ThumbnailRequestPriority\)\s*=>\s*void/.test(
    useLibraryData
  )
) {
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
if (
  !/selectedMediaId/.test(mediaGrid) ||
  !/excludeMediaId:\s*selectedMediaId/.test(mediaGrid) ||
  !(
    /priority === "selected"[\s\S]*selectedMediaIdRef\.current/.test(useLibraryData) ||
    /normalizeThumbnailScopeMediaIds[\s\S]*priority === "selected"[\s\S]*selectedMediaId/.test(
      useLibraryData
    )
  )
) {
  fail("selected media must be deduped out of visible/ahead thumbnail polling paths");
}
if (!/visible(?:Priority)?Media(?:Id)?Key/.test(mediaGrid)) {
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
if (!mediaResources.includes("getPreviewBlob") || !mediaPreview.includes("requestThumbnailBlob")) {
  fail("MediaPreview must load central previews from original media while keeping inspector previews on shared thumbnail blobs");
}
if (!/requestOriginalPreviewBlob/.test(mediaResources) || !/originalPreviewBlobCache/.test(mediaResources)) {
  fail("mediaResources must cache original preview blobs for center preview reuse");
}
if (!/prefetchOriginalPreview/.test(mediaResources) || !/inFlightOriginalPreviewRequests/.test(mediaResources)) {
  fail("mediaResources must expose neighbor original preview prefetch with in-flight coalescing");
}
if (!/requestOriginalPreviewBlob/.test(mediaPreview) || /getPreviewBlob/.test(mediaPreview)) {
  fail("MediaPreview must load central original media through the shared original preview resource cache");
}
if (!/mediaContentSignature\(media\)/.test(mediaPreview) || !/source="original"[\s\S]*?versionKey=\{originalVersionKey\}/.test(mediaPreview)) {
  fail("MediaPreview original preview must pass a media signature version key");
}
if (!/version:\s*mediaContentSignature\(mediaRecord\)/.test(mediaResources)) {
  fail("mediaResources original preview cache must load Core preview blobs with media signatures");
}
if (/getPreviewBlob\(mediaRecord\.id,\s*\{[\s\S]{0,120}signal:/.test(mediaResources)) {
  fail("mediaResources original preview cache must not let one consumer AbortSignal cancel the shared in-flight fetch");
}
if (!/withAbortSignal\(\s*request,\s*options\.signal\s*\)/.test(mediaResources)) {
  fail("mediaResources original preview cache must apply AbortSignal only to the individual consumer promise");
}
if (!/hasLiveReadyThumbnail/.test(mediaPreview) || /thumbnail\?\.state\s*===\s*"ready"\s*\?\s*thumbnail\.fileId/.test(mediaPreview)) {
  fail("MediaPreview must not request thumbnail blobs without live ready metadata and updatedAt");
}
if (!/AbortController/.test(mediaPreview) || !/requestOriginalPreviewBlob\(\s*media,\s*\{\s*signal:\s*controller\.signal/.test(mediaPreview)) {
  fail("MediaPreview original-media requests must use an abortable shared cache request when central preview switches");
}
if (/\},\s*\[media,\s*source,\s*versionKey\]\);/.test(mediaPreview)) {
  fail("MediaPreview original-media effect must not reset shared-preview loading for unchanged media object identity churn");
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
if (
  !/preferOriginalWhilePending\??:\s*boolean/.test(mediaPreview) ||
  !/preferOriginalWhilePending\s*=\s*false/.test(mediaPreview)
) {
  fail("MediaPreview must expose an opt-in preferOriginalWhilePending flag for inspector fallback only");
}
if (
  !/source\s*===\s*"thumbnail"[\s\S]*preferOriginalWhilePending[\s\S]*media\.kind\s*===\s*"image"[\s\S]*thumbnail\?\.state\s*!==\s*"failed"[\s\S]*thumbnail\?\.state\s*!==\s*"skipped_small"/.test(
    mediaPreview
  ) ||
  !/source="original"[\s\S]*versionKey=\{originalVersionKey\}/.test(mediaPreview)
) {
  fail("MediaPreview thumbnail mode must only use original-preview fallback for pending image inspector previews");
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
if (!/MediaPreview[\s\S]{0,220}source="thumbnail"[\s\S]{0,220}preferOriginalWhilePending/.test(previewPanel)) {
  fail("PreviewPanel must opt into the inspector-only original fallback while thumbnail state is pending");
}
if (
  !/prefetchOriginalPreview/.test(app) ||
  !/previewOpen[\s\S]*selectedMediaIndex[\s\S]*CENTER_PREVIEW_PREFETCH_RADIUS[\s\S]*library\.media\[selectedMediaIndex \+ offset\][\s\S]*prefetchOriginalPreview/.test(app)
) {
  fail("App must prefetch previous and next original previews when center preview is open");
}
if (
  !/CENTER_PREVIEW_PREFETCH_RADIUS\s*=\s*1/.test(app) ||
  !/for\s*\([\s\S]*?offset[\s\S]*?CENTER_PREVIEW_PREFETCH_RADIUS/.test(app) ||
  !/selectedMediaIndex\s*\+\s*offset/.test(app)
) {
  fail("App must keep center original preview prefetch explicitly bounded to previous/next neighbors");
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
