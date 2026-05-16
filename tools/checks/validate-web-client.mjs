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
const desktopAdapterPath = "apps/web/src/core/desktop.ts";
const packageJson = readJson("package.json");
const webPackageJson = readJson("apps/web/package.json");
const coreClientPackagePath = "packages/core-client/package.json";
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

if (!existsSync(path.join(root, desktopAdapterPath))) {
  fail("web desktop bridge access must be isolated in apps/web/src/core/desktop.ts");
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
if (!/MediaRecord/.test(mediaResources) || !/isFreshThumbnailForMediaRecord/.test(mediaResources)) {
  fail("mediaResources must validate cached thumbnail responses against the media record thumbnail summary");
}
if (!/thumbnailResourceCache\.delete/.test(mediaResources) || !/thumbnailCacheKey/.test(mediaResources)) {
  fail("mediaResources must drop stale cached terminal thumbnails when the media record has no matching ready cache key");
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
for (const state of ["pending", "queued", "ready", "failed", "skipped_small"]) {
  if (!mediaGrid.includes(`"${state}"`)) {
    fail(`MediaGrid must render a stable thumbnail state branch for ${state}`);
  }
}
if (!/thumbnailStatesByMediaId\[item\.id\]/.test(mediaGrid)) {
  fail("MediaGrid tiles must receive thumbnail state from the resource map by media id");
}
if (!previewPanel) {
  fail("PreviewPanel must provide a selected media preview foundation");
}
if (!/PreviewPanel/.test(libraryView) || !/selectedMedia/.test(previewPanel) || !/thumbnail/.test(previewPanel)) {
  fail("LibraryView must render a PreviewPanel with selected media and thumbnail state");
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
  if (contents.includes("thumbnailCacheKey") && !relative.startsWith("apps/web/src/core/")) {
    fail(`UI must not consume thumbnailCacheKey directly: ${relative}`);
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
