import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";
import { inspectNativeBrowserWindowOptions } from "./native-browser-window-options.mjs";

const root = process.cwd();

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) {
    fail(`required UI design file missing ${relativePath}`);
    return "";
  }
  return readFileSync(absolutePath, "utf8");
}

function readOptional(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) {
    return null;
  }
  return readFileSync(absolutePath, "utf8");
}

const desktopMain = read("apps/desktop/src/main.ts");
const preload = read("apps/desktop/src/preload.cjs");
const styles = read("apps/web/src/styles.css");
const stylesForChecks = stripCssComments(styles);
const app = read("apps/web/src/app/App.tsx");
const appShell = read("apps/web/src/app-shell/AppShell.tsx");
const shellTitlebar = read("apps/web/src/app-shell/ShellTopBar.tsx");
const shellOverlayHost = readOptional("apps/web/src/app-shell/ShellOverlayHost.tsx");
const taskOverlay = readOptional("apps/web/src/features/tasks/TaskOverlay.tsx");
const webIndex = read("apps/web/index.html");
const webFaviconSvg = readOptional("apps/web/public/favicon.svg");
const windowChrome = read("apps/web/src/features/window-chrome/WindowChrome.tsx");
const liquidGlassSurface = read("apps/web/src/design/liquid-glass/LiquidGlassSurface.tsx");
const liquidGlassIndex = read("apps/web/src/design/liquid-glass/index.ts");
const sortMenu = read("apps/web/src/features/library/SortMenu.tsx");
const inspectorMetadata = read("apps/web/src/features/preview/InspectorMetadata.tsx");
const renameDialog = read("apps/web/src/features/file-ops/RenameDialog.tsx");
const moveDialog = read("apps/web/src/features/file-ops/MoveDialog.tsx");
const deleteConfirm = read("apps/web/src/features/file-ops/DeleteConfirm.tsx");
const onboardingHero = read("apps/web/src/features/onboarding/OnboardingHero.tsx");
const libraryView = read("apps/web/src/features/library/LibraryView.tsx");
const pluginsView = read("apps/web/src/features/plugins/PluginsView.tsx");
const filterMenu = readOptional("apps/web/src/features/library/FilterMenu.tsx");
const mediaGrid = read("apps/web/src/features/media-grid/MediaGrid.tsx");
const previewPanel = read("apps/web/src/features/preview/PreviewPanel.tsx");
const mediaPreview = read("apps/web/src/features/preview/MediaPreview.tsx");
const centralPreviewStage = readOptional("apps/web/src/features/preview/CentralPreviewStage.tsx");
const shortcutBindings = readOptional("apps/web/src/features/shortcuts/shortcutBindings.ts");
const useShortcuts = read("apps/web/src/features/shortcuts/useShortcuts.ts");
const settingsView = read("apps/web/src/features/settings/SettingsView.tsx");
const interfaceStyle = read("apps/web/src/features/settings/interfaceStyle.ts");
const taskPanel = read("apps/web/src/features/tasks/TaskPanel.tsx");
const contextMenu = read("apps/web/src/features/file-ops/ContextMenu.tsx");
const desktopBridge = read("apps/web/src/core/desktop.ts");
const libraryFilterSources = libraryView + "\n" + (filterMenu ?? "");
const desktopMainAst = ts.createSourceFile(
  "apps/desktop/src/main.ts",
  desktopMain,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS
);

const nativeMaterial = inspectNativeBrowserWindowOptions(desktopMain);
if (!nativeMaterial.browserWindowOptionsFound) {
  fail("desktop window must construct BrowserWindow with an inline options object");
}

for (const [condition, value] of [
  [/backgroundMaterial:\s*"none"/.test(desktopMain), 'backgroundMaterial: "none"'],
  [nativeMaterial.transparent, "transparent: true"],
  [nativeMaterial.transparentBackgroundColor, 'backgroundColor: "#00000000"'],
  [nativeMaterial.frameFalse, "frame: false"]
]) {
  if (!condition) {
    fail(`desktop window must keep a frameless transparent shell with an explicit transparent root material: missing ${value}`);
  }
}

if (nativeMaterial.unsafeTopLevelSpreads.length > 0) {
  fail("desktop BrowserWindow options must not use top-level spreads that can override acrylic transparency settings");
}

if (!/show:\s*false\b/.test(desktopMain)) {
  fail("desktop window must stay hidden until the desktop shell is ready so startup never flashes a gray rectangular backing plate");
}

if (!/ready-to-show/.test(desktopMain)) {
  fail("desktop window must wait for ready-to-show before becoming visible");
}

for (const value of [
  "SHELL_READY_FAILURE_TIMEOUT_MS",
  "armShellReadyFailureFallback",
  "revealMainWindowForLaunchFailure",
  '"did-fail-load"',
  '"render-process-gone"'
]) {
  if (!desktopMain.includes(value)) {
    fail(`desktop startup must surface renderer bootstrap failures instead of staying permanently invisible: missing ${value}`);
  }
}

for (const [source, value, message] of [
  [desktopMain, 'ipcMain.handle("megle:shell-ready"', "desktop main must expose a megle:shell-ready IPC handshake before the window can become visible"],
  [preload, "notifyShellReady", "desktop preload must own the notifyShellReady bridge surface"],
  [desktopBridge, "notifyDesktopShellReady", "desktop bridge helper must expose notifyDesktopShellReady so renderer code stays off window.megleDesktop"],
  [app, "notifyDesktopShellReady", "App must notify desktop shell readiness after the shell mounts"]
]) {
  if (!source.includes(value)) {
    fail(message);
  }
}

assertDesktopRevealOrderingContract();
assertDesktopRevealOrderingRegressionProbe();

if (!/Content-Security-Policy/.test(webIndex) || /unsafe-eval/.test(webIndex)) {
  fail("web index must declare a CSP without unsafe-eval so Electron startup does not emit CSP security warnings");
}

if (!/html,\s*body,\s*#root\s*\{[\s\S]*?background:\s*transparent/.test(webIndex)) {
  fail("web index must inline transparent html/body/#root styles to avoid a gray first-paint backing plate");
}

for (const value of [
  "--glass-canvas",
  "--glass-panel",
  "--glass-control",
  "--glass-elevated",
  "--glass-border",
  "--glass-blur",
  "--interactive-hover",
  "--interactive-active",
  "--glass-readable-surface"
]) {
  if (!stylesForChecks.includes(value)) {
    fail(`liquid glass token missing ${value}`);
  }
}

for (const [token, maxAlpha] of [
  ["--glass-canvas", 0.01],
  ["--glass-workbench", 0.01],
  ["--glass-panel", 0.01],
  ["--glass-elevated", 0.01],
  ["--surface-1", 0.08]
]) {
  const value = cssCustomPropertyValue(stylesForChecks, token);
  const alpha = cssRgbaAlpha(value);
  if (alpha === null || alpha > maxAlpha) {
    fail(`${token} must not create a gray backing plate over the desktop acrylic backdrop`);
  }
}

const readableSurfaceAlpha = cssRgbaAlpha(cssCustomPropertyValue(stylesForChecks, "--glass-readable-surface"));
if (
  readableSurfaceAlpha === null ||
  readableSurfaceAlpha < 0.18 ||
  readableSurfaceAlpha > 0.55
) {
  fail("--glass-readable-surface must be a minimal local translucent tint, not a transparent text washout or opaque backing plate");
}

for (const selector of [
  ".plugins-detail-pane",
  ".settings-section",
  ".task-card",
  ".plugin-card",
  ".grid-empty-search",
  ".grid-empty-folder",
  ".recent-op-row",
  ".move-tree"
]) {
  const blocks = cssBlocksForExactSelector(stylesForChecks, selector);
  if (!blocks.some((block) => declarationValueIncludes(block, "var(--glass-readable-surface)"))) {
    fail(`${selector} must use the local readable glass tint instead of relying on a full-window backing plate`);
  }
}

for (const [selector, maxAlpha] of [
  [".liquid-glass-tone-chrome", 0.01],
  [".liquid-glass-tone-panel", 0.01],
  [".liquid-glass.shell-titlebar", 0.01],
  [".liquid-glass.context-menu", 0.01]
]) {
  const blocks = cssBlocksForExactSelector(stylesForChecks, selector);
  if (!blocks.some((block) => cssRgbaAlpha(latestDeclarationValue(block, "--glass-fill")) <= maxAlpha)) {
    fail(`${selector} must not add a renderer gray fill over the native desktop backdrop`);
  }
}

for (const selector of [".plugins-body", ".settings-body", ".task-center", ".onboarding-hero"]) {
  const blocks = cssBlocksForExactSelector(stylesForChecks, selector);
  if (blocks.some((block) => hasNonTransparentBackground(block))) {
    fail(`${selector} must not paint a bottom-layer gray background over native desktop acrylic`);
  }
}

for (const value of [
  ":where(button, [role=\"button\"], input, select, textarea)",
  ":where(button, [role=\"button\"]):hover:not(:disabled)",
  ":where(button, [role=\"button\"]):active:not(:disabled)",
  ":where(button, [role=\"button\"], input, select, textarea):focus-visible"
]) {
  if (!stylesForChecks.includes(value)) {
    fail(`global interactive control state missing ${value}`);
  }
}

for (const value of [
  ".shell-titlebar,",
  ".library-sidebar,",
  ".task-panel,",
  ".toolbar,",
  ".inspector-panel",
  "background: transparent",
  "box-shadow: var(--glass-shadow)"
]) {
  if (!stylesForChecks.includes(value)) {
    fail(`glass control layer styling missing ${value}`);
  }
}

for (const selector of [
  ".shell-titlebar",
  ".library-sidebar",
  ".task-panel",
  ".toolbar",
  ".inspector-panel"
]) {
  const blocks = cssBlocksForExactSelector(stylesForChecks, selector);
  if (
    !blocks.some(
      (block) =>
        /background:\s*transparent/.test(block) &&
        /box-shadow:\s*var\(--glass-shadow\)/.test(block)
    )
  ) {
    fail(`glass control layer ${selector} must stay transparent and keep its shadow without a root background plate`);
  }
  if (
    blocks.some(
      (block) =>
        hasNonNoneDeclaration(block, "backdrop-filter") ||
        hasNonNoneDeclaration(block, "-webkit-backdrop-filter")
    )
  ) {
    fail(`glass control layer ${selector} must not apply backdrop-filter on the outer container`);
  }
}

for (const value of [
  ".context-menu",
  ".dialog-panel",
  ".recent-ops-drawer",
  "backdrop-filter: blur(var(--glass-elevated-blur)) saturate(1.5)"
]) {
  if (!stylesForChecks.includes(value)) {
    fail(`floating glass layer styling missing ${value}`);
  }
}

if (!stylesForChecks.includes("-webkit-app-region: drag") || !stylesForChecks.includes("-webkit-app-region: no-drag")) {
  fail("frameless window chrome must define drag and no-drag regions");
}

assertExactSelectorHelperContracts();
assertCssCommentStrippingContracts();

const shellDragBlocks = cssBlocksForExactSelector(stylesForChecks, ".shell-drag");
if (
  !shellDragBlocks.some(
    (block) => latestDeclarationValue(block, "-webkit-app-region") === "drag"
  )
) {
  fail("integrated titlebar must define draggable blank regions");
}

const noDragBlocks = cssBlocksForExactSelector(stylesForChecks, ".no-drag");
if (
  !noDragBlocks.some(
    (block) => latestDeclarationValue(block, "-webkit-app-region") === "no-drag"
  )
) {
  fail("interactive titlebar controls must define no-drag regions");
}

for (const selector of [
  ".titlebar-workspace-toolbar",
  ".shell-titlebar-placeholder",
  ".shell-titlebar-summary"
]) {
  if (
    cssBlocksForExactSelector(stylesForChecks, selector).some(
      (block) => latestDeclarationValue(block, "-webkit-app-region") === "no-drag"
    )
  ) {
    fail(`${selector} must stay draggable; only titlebar controls should be no-drag`);
  }
}

for (const value of ["data-no-drag", "WindowChrome", "ShellRightActions", "ShellPrimaryNav"]) {
  if (!shellTitlebar.includes(value) && !windowChrome.includes(value) && !liquidGlassSurface.includes(value)) {
    fail(`integrated titlebar no-drag/control contract missing ${value}`);
  }
}

if (!windowChrome.includes("window-chrome-button-close")) {
  fail("web chrome controls must render a distinct close target");
}

if (!shellTitlebar.includes("WindowChrome")) {
  fail("integrated titlebar must render custom window chrome controls");
}

for (const value of [
  "taskDrawerOpen",
  "task-drawer-toggle",
  "task-drawer-panel",
  "Open tasks palette",
  "Close tasks palette"
]) {
  if (!app.includes(value) && !taskPanel.includes(value) && !shellTitlebar.includes(value)) {
    fail(`tasks must be a floating accessible drawer/palette, missing ${value}`);
  }
}

if (stylesForChecks.includes('"sidebar workspace tasks"') || stylesForChecks.includes("grid-area: tasks")) {
  fail("tasks must not occupy a fixed app-shell grid column");
}

if (!/--shell-left-width:\s*minmax\(260px,\s*292px\)/.test(stylesForChecks) || !/--shell-right-width:\s*270px/.test(stylesForChecks)) {
  fail("app shell must define stable left and right column widths for the integrated titlebar layout");
}

const appShellBlocks = cssBlocksForSelector(stylesForChecks, ".app-shell");
const baseAppShellBlock = appShellBlocks[0] ?? "";
if (
  !/width:\s*100vw/.test(baseAppShellBlock) ||
  !/height:\s*100vh/.test(baseAppShellBlock) ||
  !/margin:\s*0/.test(baseAppShellBlock) ||
  !/border:\s*0/.test(baseAppShellBlock) ||
  !/border-radius:\s*var\(--radius-window\)/.test(baseAppShellBlock) ||
  !/background:\s*transparent/.test(baseAppShellBlock) ||
  !/box-shadow:\s*none/.test(baseAppShellBlock) ||
  !/overflow:\s*hidden/.test(baseAppShellBlock)
) {
  fail("app shell must fill the transparent Electron window and clip child surfaces at the window radius");
}

if (
  !/grid-template-areas:\s*"titlebar-left titlebar-center titlebar-right"\s*"sidebar workspace workspace"/.test(baseAppShellBlock) ||
  !/grid-template-columns:\s*var\(--shell-left-width\)\s+minmax\(0,\s*1fr\)\s+var\(--shell-right-width\)/.test(baseAppShellBlock) ||
  !/grid-template-rows:\s*var\(--shell-titlebar-height\)\s+minmax\(0,\s*1fr\)/.test(baseAppShellBlock)
) {
  fail("app shell must define integrated three-column titlebar grid");
}

for (const value of [
  "titlebarLeft",
  "titlebarCenter",
  "titlebarRight"
]) {
  if (!appShell.includes(value)) {
    fail(`integrated titlebar AppShell render contract missing ${value}`);
  }
}

for (const value of [
  "shell-titlebar-left",
  "shell-titlebar-center",
  "shell-titlebar-right"
]) {
  if (!appShell.includes(value)) {
    fail(`integrated titlebar AppShell render contract missing ${value}`);
  }
}

for (const [selector, gridArea] of [
  [".shell-titlebar-left", "titlebar-left"],
  [".shell-titlebar-center", "titlebar-center"],
  [".shell-titlebar-right", "titlebar-right"]
]) {
  const blocks = cssBlocksForSelector(stylesForChecks, selector);
  if (blocks.length === 0) {
    fail(`integrated titlebar selector missing ${selector}`);
  } else if (!blocks.some((block) => latestDeclarationValue(block, "grid-area") === gridArea)) {
    fail(`integrated titlebar selector ${selector} must map to grid-area ${gridArea}`);
  }
}

if (app.includes("<ShellTopBar")) {
  fail("old full-width ShellTopBar JSX must not be rendered");
}

if (/className=["'][^"']*\btopbar\b/.test(app) || /className=["'][^"']*\btopbar\b/.test(shellTitlebar)) {
  fail("old full-width topbar class must not be used");
}

if (!/html,\s*body,\s*#root/.test(stylesForChecks)) {
  fail("web root transparency contract must include #root so no gray page halo can leak around the shell");
}

for (const selector of ["html", "body", "#root"]) {
  const blocks = cssBlocksForExactSelector(stylesForChecks, selector);
  if (
    !blocks.some(
      (block) =>
        latestBackgroundValue(block) === "transparent" &&
        latestDeclarationValue(block, "width") === "100%" &&
        latestDeclarationValue(block, "height") === "100%"
    )
  ) {
    fail("web root transparency contract must set html/body/#root to transparent full-height surfaces");
  }
}

for (const selector of ["html", "body", "#root", ".app-shell"]) {
  assertSelectorNeverPaintsFullWindow(selector, {
    backgroundMessage: `${selector} must not paint a full-window non-transparent background`,
    backdropMessage: `${selector} must not apply backdrop-filter over the transparent Electron window`
  });
}

if (!taskOverlay) {
  fail("task overlay component must exist for floating task drawer and center surfaces");
} else {
  if (!/useEffect\(\(\) => \{\s*if \(!open\) return;[\s\S]*?event\.key !== "Escape"[\s\S]*?onClose\(\)/.test(taskOverlay)) {
    fail("compact task drawer must share the Escape close listener with center task overlay");
  }
  if (/if \(!modalOpen\) return;[\s\S]*?event\.key !== "Escape"/.test(taskOverlay)) {
    fail("task overlay Escape handling must not be gated to the modal-only center state");
  }
  if (!/role=\{mode === "center" \? "dialog" : "complementary"\}/.test(taskOverlay)) {
    fail("compact task drawer must stay complementary instead of becoming modal");
  }
  if (!/aria-modal=\{mode === "center" \? "true" : undefined\}/.test(taskOverlay)) {
    fail("only task center should expose aria-modal");
  }
}

if (!/rel="icon"/.test(webIndex) || !/href="\/favicon\.svg"/.test(webIndex)) {
  fail("web index must declare a static favicon to prevent browser /favicon.ico 404 noise");
}

if (!webFaviconSvg || !/<svg\b/.test(webFaviconSvg)) {
  fail("web public favicon.svg must exist and contain SVG icon markup");
}

const narrowShellRules = extractAtRuleBodies(stylesForChecks, "@media (max-width: 720px)");
const narrowShellRule = narrowShellRules[narrowShellRules.length - 1];
const narrowShell = narrowShellRule?.body ?? "";
if (!narrowShell) {
  fail("narrow viewport shell contract missing @media (max-width: 720px)");
} else {
  const narrowAppShellBlocks = cssBlocksForSelector(narrowShell, ".app-shell");
  if (
    !narrowAppShellBlocks.some(
      (block) =>
        /grid-template-areas:\s*"titlebar-left titlebar-center titlebar-right"\s*"workspace workspace workspace"/.test(block) &&
        /grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/.test(block)
    )
  ) {
    fail("narrow viewport shell must preserve integrated titlebar columns above a full-width workspace");
  }

  const narrowSidebarBlocks = cssBlocksForSelector(narrowShell, ".library-sidebar");
  if (!narrowSidebarBlocks.some((block) => /display:\s*none/.test(block))) {
    fail("narrow viewport shell must hide the persistent library sidebar");
  }

  const narrowWorkspaceBlocks = cssBlocksForSelector(narrowShell, ".workspace");
  if (
    !narrowWorkspaceBlocks.some(
      (block) =>
        /grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(block) &&
        /grid-template-rows:\s*auto\s+(?:auto\s+)?minmax\(0,\s*1fr\)/.test(block)
    )
  ) {
    fail("narrow viewport workspace must own full width without inspector/sidebar columns");
  }

  const narrowCenterTitlebarBlocks = cssBlocksForSelector(narrowShell, ".shell-titlebar-center");
  if (!narrowCenterTitlebarBlocks.some((block) => /overflow-x:\s*auto/.test(block))) {
    fail("narrow viewport titlebar center controls must be horizontally scrollable instead of overlapping");
  }

  const narrowTopActionLabelBlocks = cssBlocksForSelector(narrowShell, ".top-action-label");
  if (!narrowTopActionLabelBlocks.some((block) => /display:\s*none/.test(block))) {
    fail("narrow viewport titlebar actions must compress labels to icon controls");
  }

  for (const [selector, property, message] of [
    [".toolbar-library", "flex-wrap", "narrow viewport library toolbar nowrap rule must not be overridden later"],
    [".toolbar-controls", "flex-wrap", "narrow viewport toolbar controls nowrap rule must not be overridden later"],
    [".search-bar", "min-width", "narrow viewport search bar min-width rule must not be overridden later"]
  ]) {
    if (hasLaterDeclaration(stylesForChecks, narrowShellRule.end, selector, property)) {
      fail(message);
    }
  }
}

for (const value of [
  "ShellPrimaryNav",
  "ShellRightActions",
  "LibraryTitlebarToolbar",
  "PreviewTitlebarToolbar",
  "shell-nav-caption",
  "aria-label={tab.label}",
  "title={tab.label}",
  'role="tablist"',
  'role="tab"',
  "task-drawer-toggle",
  "Open tasks palette",
  "Close tasks palette",
  "WindowChrome"
]) {
  if (!shellTitlebar.includes(value)) {
    fail(`integrated titlebar pieces must expose accessible navigation and chrome controls: missing ${value}`);
  }
}

if (shellTitlebar.includes("<span>{tab.label}</span>")) {
  fail("primary navigation must use the current caption/icon path instead of plain text-only tab labels");
}

for (const value of ["chrome-title", "chrome-subtitle", "Local media workbench"]) {
  if (shellTitlebar.includes(value) || app.includes(value)) {
    fail(`active integrated titlebar path must not render old brand text/block: found ${value}`);
  }
}

if (app.includes('activeView === "tasks"')) {
  fail("tasks must not render as a permanent workspace view");
}

if (libraryView.includes("<PreviewDialog") || previewPanel.includes("preview-dialog-backdrop")) {
  fail("library preview must be inline, not a modal dialog/backdrop");
}

const mediaGridOnClickBodies = extractJsxAttributeBodies(mediaGrid, "onClick");
if (mediaGridOnClickBodies.some((body) => body.includes("onOpenPreview("))) {
  fail("media tile single click must select only; preview opens on double click or keyboard");
}

const mediaGridOnKeyDownBodies = extractJsxAttributeBodies(mediaGrid, "onKeyDown");
const mediaGridHandleKeyDownBody = extractFunctionBody(mediaGrid, "handleKeyDown");

if (
  !mediaGridOnKeyDownBodies.some((body) => handlerSupportsKeyboardPreview(body)) &&
  !handlerSupportsKeyboardPreview(mediaGridHandleKeyDownBody)
) {
  fail("media grid keyboard preview accessibility must open preview from keyboard interaction");
}

if (!mediaGrid.includes("onDoubleClick")) {
  fail("global shell/overlay contract missing onDoubleClick in MediaGrid");
}

if (!app.includes("ShellOverlayHost")) {
  fail("global shell/overlay contract missing ShellOverlayHost in App");
}

if (!shellOverlayHost) {
  fail("global shell/overlay contract missing ShellOverlayHost file");
} else if (!shellOverlayHost.includes("TaskOverlay")) {
  fail("global shell/overlay contract missing TaskOverlay reference in ShellOverlayHost");
}

for (const value of ["onPreviewPrevious", "onPreviewNext"]) {
  if (!libraryView.includes(value) && !previewPanel.includes(value) && !(centralPreviewStage?.includes(value))) {
    fail(`global shell/overlay contract missing ${value} in LibraryView, PreviewPanel, or CentralPreviewStage`);
  }
}

if (previewPanel.includes("preview-panel-inline")) {
  fail("PreviewPanel must not own the large inline preview; double-click preview belongs in the center grid area");
}

if (!previewPanel.includes("showPreviewImage") || !libraryView.includes("showPreviewImage={!previewOpen}")) {
  fail("right inspector must hide its preview image while the central preview is open");
}

if (!previewPanel.includes('source="original"')) {
  fail("right inspector selected preview must render from original/preview bytes so portrait media is not cropped by grid thumbnails");
}

if (!mediaPreview.includes("getPreviewBlob") || !mediaPreview.includes("getThumbnailBlob")) {
  fail("MediaPreview must separate central original preview loading from thumbnail preview loading");
}

if (
  !mediaPreview.includes('source?: "thumbnail" | "original"') ||
  !mediaPreview.includes('source = "thumbnail"')
) {
  fail("MediaPreview must make thumbnail rendering the default and require explicit original preview mode");
}

if (!centralPreviewStage) {
  fail("central preview stage component missing for middle-area double-click preview");
} else {
  for (const value of [
    "onPreviewWheel",
    "closeOrReturn",
    "central-preview",
    "central-preview-stage",
    "onPreviewPrevious",
    "onPreviewNext",
    "onClosePreview"
  ]) {
    if (!centralPreviewStage.includes(value)) {
      fail(`central preview stage contract missing ${value}`);
    }
  }

  for (const value of [
    "central-preview-header",
    "central-preview-title",
    "central-preview-actions",
    "ChevronLeft",
    "ChevronRight",
    "central-preview-control",
    "lucide-react"
  ]) {
    if (centralPreviewStage.includes(value)) {
      fail(`central preview must not render title/nav/close controls inside the stage: found ${value}`);
    }
  }

  for (const value of [
    "event.ctrlKey",
    "onDoubleClick",
    "onPointerDown",
    "onPointerMove",
    "onPointerUp",
    "setPointerCapture",
    "translate(",
    "scale(",
    "fit-long-edge",
    "fitLongEdgeScale",
    "actualSizeScale",
    "ResizeObserver"
  ]) {
    if (!centralPreviewStage.includes(value)) {
      fail(`central preview interaction contract missing ${value}`);
    }
  }

  if (!centralPreviewStage.includes('source="original"')) {
    fail("central preview must request original media bytes instead of displaying the generated thumbnail");
  }

  if (!centralPreviewStage.includes("onViewStateChange") || !centralPreviewStage.includes("onCommandChange")) {
    fail("central preview must expose state and commands for the integrated center titlebar");
  }

  if (/MediaPreview[\s\S]{0,120}thumbnail=/.test(centralPreviewStage)) {
    fail("central preview must not pass thumbnail state into the displayed MediaPreview");
  }

  if (!centralPreviewStage.includes("translate(-50%, -50%)")) {
    fail("central preview transform must center intrinsic media before applying fit/actual zoom");
  }
}

for (const value of [
  "CentralPreviewStage",
  "previewOpen && selectedMedia",
  "grid-surface-preview"
]) {
  if (!libraryView.includes(value)) {
    fail(`LibraryView must render center preview in the media grid area: missing ${value}`);
  }
}

if (libraryView.includes("<FilterChips")) {
  fail("library filters must be collapsed into one toolbar filter menu button, not a permanent chip row");
}

for (const [label, source] of [
  ["LibraryView", libraryView],
  ["PluginsView", pluginsView],
  ["SettingsView", settingsView]
]) {
  if (/<LiquidGlassSurface[\s\S]{0,220}as="header"[\s\S]{0,220}className="[^"]*\btoolbar\b/.test(source)) {
    fail(`${label} must not render a separate per-view toolbar/header row`);
  }
}

if (libraryView.includes("library-content-toolbar")) {
  fail("LibraryView must not keep the old content toolbar after controls move into the integrated titlebar");
}

if (!pluginsView.includes("plugins-body-actions")) {
  fail("PluginsView actions must live in the page body instead of a header toolbar");
}

for (const value of ["toolbar-titles", "toolbar-title"]) {
  if (libraryView.includes(value)) {
    fail(`library toolbar must not render a standalone title/header block: found ${value}`);
  }
}

for (const value of [
  "ArrowLeft",
  "SearchBar",
  "SortMenu",
  "RefreshCw",
  "library-toolbar-back",
  "titlebar-library-summary",
  "PreviewTitlebarToolbar",
  "LibraryTitlebarToolbar"
]) {
  if (!shellTitlebar.includes(value)) {
    fail(`integrated center titlebar toolbar contract missing ${value}`);
  }
}

const titlebarToolButtons = extractJsxElements(shellTitlebar, "LiquidGlassButton").filter((element) =>
  /className=\{?["'`][^"'`]*(?:titlebar-icon-button|titlebar-tool-button)/.test(element)
);
if (titlebarToolButtons.length === 0) {
  fail("middle titlebar must render icon-only tool buttons");
}

for (const button of titlebarToolButtons) {
  if (!/\baria-label=/.test(button)) {
    fail("middle titlebar tool buttons must expose accessible labels with aria-label");
  }
  if (!/\btitle=/.test(button)) {
    fail("middle titlebar tool buttons must expose tooltip text with title");
  }
  if (/<span\b/.test(button) || /top-action-label|shell-nav-caption/.test(button)) {
    fail("middle titlebar tool buttons must stay icon-only with no visible text label inside the button");
  }
}

for (const [label, source] of [
  ["filter titlebar button", filterMenu ?? ""],
  ["sort titlebar button", sortMenu]
]) {
  if (!/\baria-label=/.test(source) || !/\btitle=/.test(source)) {
    fail(`${label} must expose aria-label and title instead of a visible middle-titlebar label`);
  }
}

if (!sortMenu.includes("{iconOnly ? null : <span>{selectedLabel}</span>}")) {
  fail("sort titlebar button must suppress its visible label when rendered icon-only in the middle titlebar");
}

const middleTitlebarToolSelectors = [
  ".shell-titlebar-center .titlebar-tool-button",
  ".shell-titlebar-center .titlebar-icon-button",
  ".shell-titlebar-center .filter-menu-trigger",
  ".shell-titlebar-center .sort-menu-trigger"
];

const middleTitlebarToolClassSelectors = [
  ".titlebar-tool-button",
  ".titlebar-icon-button",
  ".filter-menu-trigger",
  ".sort-menu-trigger",
  ".sort-menu-trigger-open"
];

assertMiddleTitlebarToolSelectorContracts();

for (const selector of middleTitlebarToolSelectors) {
  const blocks = cssBlocksForExactSelector(stylesForChecks, selector);
  if (blocks.length === 0) {
    fail(`middle titlebar transparent tool style missing ${selector}`);
  }
  if (
    !blocks.some(
      (block) =>
        latestBackgroundValue(block) === "transparent" &&
        latestDeclarationValue(block, "border") === "0" &&
        latestDeclarationValue(block, "box-shadow") === "none"
    )
  ) {
    fail(`${selector} must declare background: transparent, border: 0, and box-shadow: none`);
  }
}

const middleTitlebarToolRootBlocks = cssRuleBlocksForMatchingSelectors(stylesForChecks, (selector) =>
  isMiddleTitlebarToolRootSelector(selector)
);
assertMiddleTitlebarToolRulesDoNotFrame(middleTitlebarToolRootBlocks, "middle titlebar tool state");
assertMiddleTitlebarGlassLayersRemainAvailable();
assertMiddleTitlebarToolStatesActivateGlassLayers();
assertMiddleTitlebarToolStateBackdropsKeepRefraction();
assertMiddleTitlebarFocusUsesInsetOutline();

const middleTitlebarToolGuardEnd = Math.max(
  0,
  ...middleTitlebarToolRootBlocks.map(({ end }) => end ?? 0)
);
const laterMiddleTitlebarToolRootBlocks = cssRuleBlocksForMatchingSelectors(
  stylesForChecks.slice(middleTitlebarToolGuardEnd),
  (selector) => isMiddleTitlebarToolRootSelector(selector, { includeUnscoped: true })
);
assertMiddleTitlebarToolRulesDoNotFrame(
  laterMiddleTitlebarToolRootBlocks,
  "later middle titlebar tool state"
);

const titlebarSearchBlocks = cssBlocksForExactSelector(stylesForChecks, ".titlebar-library-search");
if (!titlebarSearchBlocks.some((block) => latestDeclarationValue(block, "margin-left") === "auto")) {
  fail("middle titlebar search must stay right-aligned with margin-left: auto");
}

if (!libraryFilterSources.includes("SlidersHorizontal")) {
  fail("compact library toolbar contract missing SlidersHorizontal filter icon");
}

if (!filterMenu) {
  fail("collapsed library filter menu component missing");
} else {
  for (const value of [
    "SlidersHorizontal",
    "filter-menu-popover",
    "Kind",
    "Rating",
    "Favorite",
    "Tags",
    "Clear filters"
  ]) {
    if (!filterMenu.includes(value)) {
      fail(`filter menu must expose collapsed filter sub-items: missing ${value}`);
    }
  }
}

for (const value of [
  'type CompactPopover = "tasks" | "recent" | "filter" | "sort" | null',
  "activeCompactPopover",
  "Escape",
  "pointerdown",
  "data-compact-popover-root",
  "filterMenuOpen",
  "sortMenuOpen"
]) {
  if (!app.includes(value)) {
    fail(`compact popover coordination contract missing ${value}`);
  }
}

for (const [label, source, values] of [
  [
    "filter menu",
    filterMenu ?? "",
    ["data-compact-popover-root", "filter-menu-popover", "floating-popover", "LiquidGlassSurface", 'tone="elevated"']
  ],
  [
    "sort menu",
    sortMenu,
    ["data-compact-popover-root", "sort-menu-popover", "floating-popover", "LiquidGlassSurface", 'tone="elevated"']
  ],
  [
    "task drawer",
    taskOverlay ?? "",
    ["data-compact-popover-root", "floating-popover"]
  ],
  [
    "recent operations drawer",
    shellOverlayHost ?? "",
    ["data-compact-popover-root", "floating-popover"]
  ]
]) {
  for (const value of values) {
    if (!source.includes(value)) {
      fail(`${label} compact popover contract missing ${value}`);
    }
  }
}

for (const selector of [".floating-popover", ".filter-menu-popover", ".sort-menu-popover"]) {
  const blocks = cssBlocksForExactSelector(stylesForChecks, selector);
  if (blocks.length === 0) {
    fail(`compact popover material selector missing ${selector}`);
  }
}

const floatingPopoverBlocks = cssBlocksForExactSelector(stylesForChecks, ".floating-popover");
if (
  !floatingPopoverBlocks.some(
    (block) =>
      /--glass-fill:\s*var\(--glass-elevated\)/.test(block) &&
      /--glass-blur-current:\s*var\(--glass-elevated-blur\)/.test(block) &&
      hasNonNoneDeclaration(block, "box-shadow")
  )
) {
  fail("floating popovers must use elevated glass material instead of flat content styling");
}

for (const value of [
  "megle.interfaceStyle",
  "DEFAULT_INTERFACE_STYLE",
  "glassBlur",
  "pointerGlowBrightness",
  "edgeHighlightBrightness",
  "applyInterfaceStyleVariables",
  "useInterfaceStyle"
]) {
  if (!interfaceStyle.includes(value)) {
    fail(`interface style preference contract missing ${value}`);
  }
}

for (const value of [
  "--glass-pointer-glow-brightness",
  "--glass-edge-highlight-brightness",
  "--glass-blur",
  "--glass-elevated-blur",
  "--glass-control-blur"
]) {
  if (!stylesForChecks.includes(value) && !interfaceStyle.includes(value)) {
    fail(`interface style CSS variable contract missing ${value}`);
  }
}

const defaultInterfaceStyleBody = extractObjectBody(interfaceStyle, "DEFAULT_INTERFACE_STYLE");
if (!/pointerGlowBrightness:\s*(?:1\.[3-9]\d*|[2-9](?:\.\d+)?)\b/.test(defaultInterfaceStyleBody)) {
  fail("default pointer glow brightness must be visibly stronger than the old 1x baseline");
}

if (!/edgeHighlightBrightness:\s*(?:6|7|8)(?:\.\d+)?\b/.test(defaultInterfaceStyleBody)) {
  fail("default edge highlight brightness must be visibly stronger than the old 5x baseline");
}

if (!settingsView.includes("Interface style") || !settingsView.includes("Reset interface style")) {
  fail("settings must expose Interface style controls and reset");
}

if (!app.includes("useInterfaceStyle") || !app.includes("interfaceStyle={interfaceStyle}")) {
  fail("App must wire local Interface style settings into the renderer and Settings view");
}

if (!shortcutBindings) {
  fail("editable shortcut binding model missing");
} else {
  for (const value of [
    "megle.shortcutBindings.v1",
    "focusSearch",
    "renameSelected",
    "recycleDelete",
    "permanentDelete",
    "closeOrReturn",
    "previewNext",
    "previewPrevious",
    "zoomIn",
    "zoomOut",
    "defaultBinding",
    "normalizeShortcutEvent",
    "matchShortcut",
    "resetShortcutBindings"
  ]) {
    if (!shortcutBindings.includes(value)) {
      fail(`editable shortcut binding model missing ${value}`);
    }
  }
}

for (const value of [
  "ShortcutBindingsEditor",
  "useShortcutBindings",
  "onReset",
  "shortcut-binding-capture",
  "Reset shortcuts"
]) {
  if (!settingsView.includes(value)) {
    fail(`settings must include editable shortcut bindings: missing ${value}`);
  }
}

for (const value of [
  "useShortcutBindings",
  "matchShortcut",
  "focusSearch",
  "renameSelected",
  "recycleDelete",
  "permanentDelete",
  "closeOrReturn",
  "previewNext",
  "previewPrevious",
  "zoomIn",
  "zoomOut"
]) {
  if (!useShortcuts.includes(value)) {
    fail(`global shortcuts must read editable bindings: missing ${value}`);
  }
}

for (const value of [
  "--radius-window",
  "--radius-overlay",
  "--radius-panel",
  "--radius-control"
]) {
  if (!stylesForChecks.includes(value)) {
    fail(`global shell/overlay contract missing ${value} in styles.css`);
  }
}

if (!liquidGlassSurface.includes("--glass-pointer-opacity")) {
  fail("global shell/overlay contract missing --glass-pointer-opacity in LiquidGlassSurface");
}

if (!stylesForChecks.includes("--glass-pointer-opacity")) {
  fail("global shell/overlay contract missing --glass-pointer-opacity in styles.css");
}

for (const [token, minValue] of [
  ["--glass-pointer-fill-opacity", 0.024],
  ["--glass-pointer-illumination-opacity", 0.1],
  ["--glass-border-highlight-opacity", 0.24]
]) {
  const value = cssVariableNumber(stylesForChecks, token);
  if (value === null || value < minValue) {
    fail(`${token} must be high enough for visible desktop-through-window liquid-glass pointer highlights`);
  }
}

for (const value of [
  "--glass-pointer-glow-size",
  "--glass-pointer-lens-size",
  "--glass-pointer-aura-size",
  "--glass-pointer-fill-opacity",
  "--glass-pointer-illumination-opacity",
  "--glass-border-highlight-size",
  "--glass-border-highlight-opacity",
  "liquid-glass-edge",
  "mask-composite: exclude"
]) {
  if (!stylesForChecks.includes(value) && !liquidGlassSurface.includes(value)) {
    fail(`liquid glass pointer highlight must use shared global/local-border tokens: missing ${value}`);
  }
}

const glassBackdropBlocks = cssBlocksForExactSelector(stylesForChecks, ".liquid-glass-backdrop");
if (
  !glassBackdropBlocks.some(
    (block) =>
      /filter:\s*url\("#megle-liquid-glass-refraction"\)/.test(block) &&
      hasNonNoneDeclaration(block, "backdrop-filter")
  )
) {
  fail("liquid glass surfaces must keep CSS backdrop blur plus SVG refraction active in the renderer");
}

const glassLensBlocks = cssBlocksForExactSelector(stylesForChecks, ".liquid-glass-lens");
if (!glassLensBlocks.some((block) => /filter:\s*url\("#megle-liquid-glass-edge"\)/.test(block))) {
  fail("liquid glass lens layer must keep SVG edge/refraction filter active");
}

for (const value of [
  'id="megle-liquid-glass-refraction"',
  'id="megle-liquid-glass-edge"',
  "feDisplacementMap"
]) {
  if (!liquidGlassSurface.includes(value)) {
    fail(`liquid glass SVG refraction definitions missing ${value}`);
  }
}

const pointerHideBody = extractFirstRequiredFunctionBody(
  liquidGlassSurface,
  ["hideGlassPointer", "resetPointer"],
  "liquid glass pointer hide/reset"
);
if (pointerHideBody.includes("--glass-pointer-x") || pointerHideBody.includes("--glass-pointer-y")) {
  fail("liquid glass pointer leave must hide opacity without resetting x/y to a visible center drift");
}

for (const value of [
  "useEffect",
  "window.addEventListener(\"pointermove\"",
  "querySelectorAll<HTMLElement>(\"[data-liquid-glass]\"",
  "GLASS_POINTER_EDGE_PROXIMITY_PX",
  "updateLiquidGlassPointer",
  "hideLiquidGlassPointers"
]) {
  if (!liquidGlassSurface.includes(value)) {
    fail(`liquid glass pointer highlight must be global/proximity-based: missing ${value}`);
  }
}

if (/onPointerMove\(event:[\s\S]*?activatePointer/.test(liquidGlassSurface)) {
  fail("liquid glass pointer tracking must not depend on per-surface pointer move handlers");
}

if (/onPointerLeave\(event:[\s\S]*?resetPointer/.test(liquidGlassSurface)) {
  fail("liquid glass pointer leave must not hide nearby surface highlights independently of global proximity");
}

if (/liquid-glass-tone-(primary|danger)[\s\S]*?--glass-pointer-light/.test(stylesForChecks)) {
  fail("liquid glass pointer highlight color/intensity must stay global instead of per-tone");
}

for (const value of [
  "ExternalLink",
  "Eye",
  "Pencil",
  "FolderInput",
  "Trash2",
  "RefreshCw",
  "Copy",
  "FolderOpen",
  "context-menu-separator",
  "Preview",
  "Rename",
  "Move to",
  "Move to recycle bin",
  "Delete permanently",
  "Refresh folder",
  "Copy path",
  "Reveal in Explorer"
]) {
  if (!app.includes(value) && !contextMenu.includes(value)) {
    fail(`context menu must expose Explorer-style management coverage: missing ${value}`);
  }
}

for (const value of ["copyText", "revealPath", "openPath", "DesktopShellActions"]) {
  if (!desktopBridge.includes(value)) {
    fail(`desktop bridge must expose safe shell action boundaries where available: missing ${value}`);
  }
}

for (const value of [
  "LiquidGlassLayer",
  "LiquidGlassSurface",
  "LiquidGlassButton",
  "scrollable?: boolean",
  "pressable?: boolean",
  "data-liquid-glass",
  "liquid-glass-backdrop",
  "liquid-glass-lens",
  "liquid-glass-content",
  "sharp child content layer"
]) {
  if (!liquidGlassSurface.includes(value) && !liquidGlassIndex.includes(value)) {
    fail(`liquid glass primitive source missing ${value}`);
  }
}

for (const value of [
  "liquid-glass-scrollable",
  ".liquid-glass.liquid-glass-scrollable",
  "overflow: hidden",
  ".liquid-glass.liquid-glass-scrollable > .liquid-glass-content",
  "overflow: auto"
]) {
  if (!stylesForChecks.includes(value) && !liquidGlassSurface.includes(value)) {
    fail(`scrollable liquid glass surfaces must keep chrome fixed and scroll inner content: missing ${value}`);
  }
}

for (const value of [
  "<filter",
  "feDisplacementMap",
  "feTurbulence",
  "feColorMatrix",
  "megle-liquid-glass-refraction"
]) {
  if (!liquidGlassSurface.includes(value)) {
    fail(`liquid glass primitive must define SVG refraction/displacement filter: missing ${value}`);
  }
}

for (const value of [
  "onPointerMove",
  "onPointerDown",
  "onPointerUp",
  "onPointerLeave",
  "--glass-pointer-x",
  "--glass-pointer-y",
  "data-glass-pressed",
  "target === currentTarget",
  "pressable"
]) {
  if (!liquidGlassSurface.includes(value)) {
    fail(`liquid glass primitive must handle pointer-driven illumination/refraction: missing ${value}`);
  }
}

for (const value of [
  'variant?: "regular" | "clear"',
  "liquid-glass-dim",
  'data-glass-variant="clear"',
  'tone?: "chrome" | "panel" | "elevated" | "control" | "primary" | "danger"'
]) {
  if (!liquidGlassSurface.includes(value)) {
    fail(`liquid glass primitive must encode regular/clear variants and selective tone usage: missing ${value}`);
  }
}

for (const value of [
  "prefers-reduced-transparency: reduce",
  "prefers-reduced-motion: reduce",
  "prefers-contrast: more",
  "forced-colors: active",
  ".liquid-glass-backdrop",
  ".liquid-glass[data-glass-interactive=\"true\"]"
]) {
  if (!stylesForChecks.includes(value)) {
    fail(`liquid glass CSS must include accessibility and interaction fallback: missing ${value}`);
  }
}

if (stylesForChecks.includes("animation-duration: 1ms")) {
  fail("reduced motion must disable nonessential animations instead of shortening them to 1ms");
}

for (const value of [
  "animation: none !important",
  "transition: none !important",
  "transform: none !important",
  ".spin",
  ".task-progress-bar.indeterminate .task-progress-fill"
]) {
  if (!stylesForChecks.includes(value)) {
    fail(`reduced motion must prevent shimmer/spin/liquid flicker: missing ${value}`);
  }
}

for (const token of ["--glass-refraction-scale", "--glass-chromatic-aberration"]) {
  if (stylesForChecks.includes(token)) {
    fail(`unused liquid glass SVG token must be wired or removed: ${token}`);
  }
}

for (const value of [
  'from "../design/liquid-glass"',
  'from "../../design/liquid-glass"'
]) {
  if (
    !app.includes(value) &&
    !windowChrome.includes(value) &&
    !read("apps/web/src/features/library/LibraryView.tsx").includes(value) &&
    !read("apps/web/src/features/library/LibrarySidebar.tsx").includes(value)
  ) {
    fail(`app surfaces must consume liquid-glass primitives: missing import ${value}`);
  }
}

if (sortMenu.includes('LiquidGlassSurface') && sortMenu.includes('as="ul"')) {
  fail('LiquidGlassSurface must not render as ul because injected material layers are invalid list children');
}

for (const value of [
  "LiquidGlassSurface",
  'className="inspector-tag-suggestions"',
  'role="listbox"',
  'role="option"'
]) {
  if (!inspectorMetadata.includes(value)) {
    fail(`tag suggestions popup must use LiquidGlassSurface and preserve listbox semantics: missing ${value}`);
  }
}

const ctaFiles = [
  ["RenameDialog", renameDialog, ["primary"]],
  ["MoveDialog", moveDialog, ["primary"]],
  ["DeleteConfirm", deleteConfirm, ["primary", "danger"]],
  ["OnboardingHero", onboardingHero, ["primary"]],
  ["LibraryView", libraryView, ["primary"]]
];

for (const [label, source, tones] of ctaFiles) {
  if (!source.includes("LiquidGlassButton")) {
    fail(`${label} primary/danger CTAs must use LiquidGlassButton`);
  }
  for (const tone of tones) {
    if (!source.includes(`tone="${tone}"`) && !source.includes(`"${tone}"`)) {
      fail(`${label} CTA must set LiquidGlassButton tone ${tone}`);
    }
  }
  const rawButtonTags = source.match(/<button\b[^>]*>/gs) ?? [];
  if (rawButtonTags.some((tag) => /(dialog-button-primary|dialog-button-danger|onboarding-hero-cta|grid-empty-action)/.test(tag))) {
    fail(`${label} must not render primary/danger CTA classes on raw button elements`);
  }
}

for (const selector of [
  ".app-shell",
  ".workspace",
  ".virtual-grid",
  ".media-tile",
  ".tile-thumb",
  ".preview-stage",
  ".central-preview-stage"
]) {
  const blocks = cssBlocksForSelector(stylesForChecks, selector);
  if (blocks.length === 0) {
    fail(`content-layer selector missing ${selector}`);
    continue;
  }
  for (const block of blocks) {
    if (block.includes("backdrop-filter")) {
      fail(`${selector} must not use persistent backdrop-filter; keep media content sharp`);
    }
    if (
      [".app-shell", ".workspace", ".virtual-grid", ".central-preview-stage"].includes(selector) &&
      hasNonTransparentBackground(block)
    ) {
      fail(`${selector} must not paint a global gray backing plate`);
    }
    if (block.includes("liquid-glass-backdrop") || block.includes("data-liquid-glass")) {
      fail(`${selector} must not become a glass surface; glass belongs to controls/navigation`);
    }
  }
}

const gridSurfaceBlocks = cssBlocksForExactSelector(stylesForChecks, ".grid-surface");
if (gridSurfaceBlocks.length === 0) {
  fail("content-layer selector missing .grid-surface");
}

if (
  !gridSurfaceBlocks.some(
    (block) =>
      /background:\s*transparent/.test(block) &&
      /border-radius:\s*0/.test(block)
  )
) {
  fail("middle grid/workspace surface must not paint a full-window gray bottom plate");
}

if (gridSurfaceBlocks.some((block) => hasNonTransparentBackground(block))) {
  fail("middle grid/workspace surface must keep its global container transparent");
}

if (gridSurfaceBlocks.some((block) => /backdrop-filter\s*:/.test(block))) {
  fail("middle grid/workspace root must not use persistent backdrop-filter; material blur belongs on the LiquidGlass backdrop layer");
}

if (
  !libraryView.includes("LiquidGlassSurface") ||
  !libraryView.includes('className={previewMedia ? "grid-surface grid-surface-preview" : "grid-surface"}')
) {
  fail("LibraryView center content column must render .grid-surface as a LiquidGlassSurface so it shares the titlebar material plane");
}

const gridSurfaceGlassBlocks = cssBlocksForExactSelector(stylesForChecks, ".liquid-glass.grid-surface");
if (
  !gridSurfaceGlassBlocks.some(
    (block) =>
      /--glass-fill:\s*(?:transparent|var\(--glass-panel\))/.test(block) &&
      /--glass-blur-current:\s*var\(--glass-blur\)/.test(block)
  )
) {
  fail("center content LiquidGlass surface must keep the shared transparent workbench material plane");
}

for (const [selector, property, label] of [
  [".shell-titlebar-left", "border-bottom-color", "left titlebar lower edge"],
  [".library-sidebar", "border-top-color", "left sidebar upper edge"],
  [".shell-titlebar-center", "border-bottom-color", "center titlebar lower edge"],
  [".shell-titlebar-right", "border-bottom-color", "right titlebar lower edge"],
  [".inspector-panel", "border-top-color", "right inspector upper edge"]
]) {
  if (
    !cssBlocksForSelector(stylesForChecks, selector).some((block) =>
      new RegExp(`${escapeRegExp(property)}\\s*:\\s*transparent`).test(block)
    )
  ) {
    fail(`left, center, and right titlebar/content material regions must be visually fused: missing ${label} suppression`);
  }
}

if (!gridSurfaceBlocks.some((block) => /border-top:\s*0/.test(block))) {
  fail("left, center, and right titlebar/content material regions must be visually fused: missing center content upper edge suppression");
}

const gridSurfaceAfterBlocks = cssBlocksForExactSelector(stylesForChecks, ".grid-surface::after");
if (
  !gridSurfaceAfterBlocks.some(
    (block) =>
      /border-top-color:\s*transparent/.test(block) &&
      /border-left-color:\s*transparent/.test(block) &&
      /border-right-color:\s*transparent/.test(block)
  )
) {
  fail("center content LiquidGlass surface must suppress upper and side pseudo-borders so only the outer bottom outline and adjacent column separators remain");
}

const centerTitlebarBlocks = cssBlocksForSelector(stylesForChecks, ".shell-titlebar-center");
if (
  !centerTitlebarBlocks.some(
    (block) =>
      /border-bottom-color:\s*transparent/.test(block) &&
      /box-shadow:\s*none/.test(block)
  )
) {
  fail("center titlebar/content join must suppress the titlebar lower edge and shadow");
}

if (
  centerTitlebarBlocks.some(
    (block) =>
      hasVisibleBorderDeclaration(block, "border-bottom") ||
      hasVisibleBorderDeclaration(block, "border-bottom-color")
  ) ||
  gridSurfaceBlocks.some(
    (block) =>
      hasVisibleBorderDeclaration(block, "border-top") ||
      hasVisibleBorderDeclaration(block, "border-top-color") ||
      hasNonNoneDeclaration(block, "box-shadow")
  )
) {
  fail("center titlebar and center content must not each draw an internal seam or double border at their join");
}

const flatLibraryToolbarBlocks = cssBlocksForSelector(stylesForChecks, ".toolbar.toolbar-library");
if (!flatLibraryToolbarBlocks.some((block) => /border-radius:\s*0/.test(block))) {
  fail("compact library toolbar must stay flat instead of a rounded inner title bar");
}

const workspaceBlocks = cssBlocksForSelector(stylesForChecks, ".workspace");
if (workspaceBlocks.some((block) => /grid-template-rows:\s*56px/.test(block))) {
  fail("workspace layout must not reserve a horizontal per-view toolbar row");
}
if (
  workspaceBlocks.some(
    (block) => hasNonTransparentBackground(block) || hasNonNoneDeclaration(block, "box-shadow")
  )
) {
  fail("workspace layout must not paint a full-window gray backing plate");
}

const simpleWorkspaceBlocks = cssBlocksForSelector(stylesForChecks, ".simple-workspace");
if (simpleWorkspaceBlocks.some((block) => /grid-template-rows:\s*56px/.test(block))) {
  fail("simple workspace layout must not reserve a horizontal per-view toolbar row");
}
if (
  simpleWorkspaceBlocks.some(
    (block) => hasNonTransparentBackground(block) || hasNonNoneDeclaration(block, "box-shadow")
  )
) {
  fail("simple workspace layout must not paint a full-window gray backing plate");
}

const inspectorBlocks = cssBlocksForSelector(stylesForChecks, ".inspector-panel");
if (!inspectorBlocks.some((block) => /grid-row:\s*1\s*\/\s*-1/.test(block))) {
  fail("right inspector panel must extend top-to-bottom in the workspace column");
}

const previewStageBlocks = cssBlocksForSelector(stylesForChecks, ".preview-stage");
if (
  !previewStageBlocks.some(
    (block) =>
      /background:\s*transparent/.test(block) &&
      /border:\s*0/.test(block) &&
      /border-radius:\s*0/.test(block) &&
      /height:\s*260px/.test(block) &&
      /aspect-ratio:\s*1\s*\/\s*1/.test(block) &&
      /place-items:\s*center/.test(block) &&
      /overflow:\s*hidden/.test(block) &&
      /padding:\s*0/.test(block)
  )
) {
  fail("right inspector preview stage must stay fixed-height, centered, transparent, borderless, and padding-free");
}

if (previewStageBlocks.some((block) => hasNonNoneDeclaration(block, "box-shadow"))) {
  fail("right inspector preview stage must not draw a visible box-shadow or frame");
}

if (
  previewStageBlocks.some((block) => {
    const borderRadius = latestDeclarationValue(block, "border-radius");
    return borderRadius !== null && borderRadius !== "0";
  })
) {
  fail("right inspector preview stage must not receive any nonzero border radius that can clip matching-aspect media");
}

if (!previewStageStyleDerivesFromMediaDimensions(previewPanel)) {
  fail("right inspector preview stage must derive aspect-ratio from original media dimensions");
}

if (/\.tile-thumb,\s*\.preview-stage\s*{[\s\S]*?background:/.test(stylesForChecks)) {
  fail("right inspector preview stage must not share the opaque tile thumbnail background");
}

const inspectorReadyPreviewBlocks = cssBlocksForSelector(stylesForChecks, ".preview-stage .preview-placeholder.ready");
if (!inspectorReadyPreviewBlocks.some((block) => /background:\s*transparent/.test(block))) {
  fail("right inspector ready preview must leave letterbox areas transparent");
}

if (!shellTitlebar.includes("titlebar-preview-title")) {
  fail("center preview titlebar must render the selected media name in titlebar-preview-title");
}

const centralPreviewStageBlocks = cssBlocksForSelector(stylesForChecks, ".central-preview-stage");
if (
  !centralPreviewStageBlocks.some(
    (block) =>
      /background:\s*transparent/.test(block) &&
      /border:\s*0/.test(block) &&
      /min-height:\s*0/.test(block) &&
      /place-items:\s*center/.test(block) &&
      /padding:\s*0/.test(block)
  )
) {
  fail("center preview stage must be a fixed transparent, centered, padding-free containment area with no black letterbox or border");
}

const centralPreviewStageFocusBlocks = cssBlocksForSelector(stylesForChecks, ".central-preview-stage:focus-visible");
if (
  centralPreviewStageFocusBlocks.some(
    (block) =>
      hasNonNoneDeclaration(block, "box-shadow") ||
      hasNonNoneDeclaration(block, "outline")
  )
) {
  fail("center preview stage focus must not draw a border-like inset ring over the image area");
}

const centralPreviewImageBlocks = cssBlocksForSelector(stylesForChecks, ".central-preview-stage .preview-image");
if (
  !centralPreviewImageBlocks.some(
    (block) =>
      /width:\s*auto/.test(block) &&
      /height:\s*auto/.test(block) &&
      /max-width:\s*none/.test(block) &&
      /max-height:\s*none/.test(block) &&
      /object-fit:\s*contain/.test(block)
  )
) {
  fail("center preview image must render at natural CSS size so transforms can switch accurately between 100% and fit-long-edge");
}

const centralPreviewTransformBlocks = cssBlocksForSelector(stylesForChecks, ".central-preview-transform");
if (centralPreviewTransformBlocks.length === 0) {
  fail("center preview transform wrapper must exist");
} else {
  if (centralPreviewTransformBlocks.some((block) => /(?:^|;)\s*width:\s*100%/.test(block) || /(?:^|;)\s*height:\s*100%/.test(block))) {
    fail("center preview transform wrapper must not use 100% stage dimensions; it must size to the media");
  }
  if (
    !centralPreviewTransformBlocks.some(
      (block) =>
        /position:\s*absolute/.test(block) &&
        /top:\s*50%/.test(block) &&
        /left:\s*50%/.test(block) &&
        /width:\s*(?:max-content|fit-content|auto)/.test(block) &&
        /height:\s*(?:max-content|fit-content|auto)/.test(block) &&
        /transform-origin:\s*top\s+left/.test(block)
    )
  ) {
    fail("center preview transform wrapper must be intrinsic-sized and explicitly anchored at the stage center");
  }
}

const centralReadyPreviewBlocks = cssBlocksForSelector(stylesForChecks, ".central-preview-stage .preview-placeholder.ready");
if (
  centralReadyPreviewBlocks.some((block) => /(?:^|;)\s*width:\s*100%/.test(block) || /(?:^|;)\s*height:\s*100%/.test(block))
) {
  fail("center ready preview wrapper must not stretch to 100% of the stage before transform");
}

const previewPanelImageBlocks = cssBlocksForSelector(stylesForChecks, ".preview-panel .preview-image");
const previewPanelStageImageBlocks = cssBlocksForSelector(
  stylesForChecks,
  ".preview-panel .preview-stage .preview-placeholder.ready > .preview-image"
);
if (
  !(
    previewPanelImageBlocks.some(
      (block) =>
        /width:\s*auto/.test(block) &&
        /height:\s*auto/.test(block) &&
        /max-width:\s*100%/.test(block) &&
        /max-height:\s*100%/.test(block) &&
        /object-fit:\s*contain/.test(block) &&
        hasNonzeroBorderRadius(block)
    ) ||
    (
      previewPanelImageBlocks.some(
        (block) => /object-fit:\s*contain/.test(block) && hasNonzeroBorderRadius(block)
      ) &&
      previewPanelStageImageBlocks.some(
        (block) =>
          /position:\s*absolute/.test(block) &&
          /inset:\s*0/.test(block) &&
          /width:\s*100%/.test(block) &&
          /height:\s*100%/.test(block) &&
          /object-fit:\s*contain/.test(block)
      )
    )
  )
) {
  fail("right inspector preview media must contain fully with rounded media corners and no opaque letterbox fill");
}

if (!liquidGlassSurface.includes("GLASS_POINTER_EDGE_PROXIMITY_PX")) {
  fail("liquid glass pointer proximity must be based on nearby edges, not whole-surface distance");
}

for (const value of ["nearestPointOnGlassEdge", "distanceToGlassEdge"]) {
  if (!liquidGlassSurface.includes(value)) {
    fail(`liquid glass local edge highlight missing ${value}`);
  }
}

const glassPointerActiveBlocks = cssBlocksForSelector(stylesForChecks, '.liquid-glass[data-glass-pointer="active"]');
if (glassPointerActiveBlocks.some((block) => /--glass-border-current/.test(block))) {
  fail("liquid glass pointer hover must not switch the entire surface border to the strong color");
}

if (!process.exitCode) {
  console.log("PASS: UI liquid glass design boundaries");
}

function cssBlocksForSelector(source, selector) {
  const cssSource = stripCssComments(source);
  const blocks = [];
  let searchIndex = 0;
  while (searchIndex < cssSource.length) {
    const selectorIndex = cssSource.indexOf(selector, searchIndex);
    if (selectorIndex === -1) break;
    const blockStart = cssSource.indexOf("{", selectorIndex);
    if (blockStart === -1) break;
    const previousClose = cssSource.lastIndexOf("}", selectorIndex);
    const previousOpen = cssSource.lastIndexOf("{", selectorIndex);
    if (previousOpen > previousClose) {
      searchIndex = selectorIndex + selector.length;
      continue;
    }
    let depth = 0;
    for (let index = blockStart; index < cssSource.length; index += 1) {
      const char = cssSource[index];
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      if (depth === 0) {
        blocks.push(cssSource.slice(blockStart + 1, index));
        searchIndex = index + 1;
        break;
      }
    }
  }
  return blocks;
}

function cssBlocksForExactSelector(source, selector) {
  const cssSource = stripCssComments(source);
  const blocks = [];
  let searchIndex = 0;

  while (searchIndex < cssSource.length) {
    const blockStart = cssSource.indexOf("{", searchIndex);
    if (blockStart === -1) break;

    const blockEnd = findMatchingBraceIndex(cssSource, blockStart);
    if (blockEnd === -1) break;

    const selectorList = cssSource.slice(searchIndex, blockStart).trim();
    const blockBody = cssSource.slice(blockStart + 1, blockEnd);
    if (selectorList) {
      if (selectorList.startsWith("@")) {
        blocks.push(...cssBlocksForExactSelector(blockBody, selector));
      } else if (selectorListIncludesExactSelector(selectorList, selector)) {
        blocks.push(blockBody);
      }
    }

    searchIndex = blockEnd + 1;
  }

  return blocks;
}

function cssRuleBlocksForMatchingSelectors(source, predicate) {
  const cssSource = stripCssComments(source);
  const blocks = [];
  let searchIndex = 0;

  while (searchIndex < cssSource.length) {
    const blockStart = cssSource.indexOf("{", searchIndex);
    if (blockStart === -1) break;

    const blockEnd = findMatchingBraceIndex(cssSource, blockStart);
    if (blockEnd === -1) break;

    const selectorList = cssSource.slice(searchIndex, blockStart).trim();
    const blockBody = cssSource.slice(blockStart + 1, blockEnd);
    if (selectorList) {
      if (selectorList.startsWith("@")) {
        blocks.push(...cssRuleBlocksForMatchingSelectors(blockBody, predicate));
      } else if (splitCssSelectorList(selectorList).some((selector) => predicate(selector.trim()))) {
        blocks.push({ block: blockBody, selectorList, start: searchIndex, end: blockEnd + 1 });
      }
    }

    searchIndex = blockEnd + 1;
  }

  return blocks;
}

function assertSelectorNeverPaintsFullWindow(selector, { backgroundMessage, backdropMessage }) {
  const blocks = cssBlocksForExactSelector(stylesForChecks, selector);

  if (blocks.some((block) => hasNonTransparentBackground(block))) {
    fail(backgroundMessage);
  }

  if (
    blocks.some(
      (block) =>
        hasNonNoneDeclaration(block, "backdrop-filter") ||
        hasNonNoneDeclaration(block, "-webkit-backdrop-filter")
    )
  ) {
    fail(backdropMessage);
  }
}

function selectorListIncludesExactSelector(selectorList, selector) {
  return splitCssSelectorList(selectorList).some((candidate) => candidate.trim() === selector);
}

function assertMiddleTitlebarToolRulesDoNotFrame(blocks, messagePrefix) {
  for (const { block, selectorList } of blocks) {
    if (hasNonTransparentBackground(block)) {
      fail(`${messagePrefix} must not paint a background: ${selectorList}`);
    }
    if (hasNonzeroBorderDeclaration(block, "border")) {
      fail(`${messagePrefix} must use border: 0 instead of transparent borders: ${selectorList}`);
    }
    if (
      hasVisibleBorderDeclaration(block, "border-color") ||
      hasVisibleBorderDeclaration(block, "border-top") ||
      hasVisibleBorderDeclaration(block, "border-right") ||
      hasVisibleBorderDeclaration(block, "border-bottom") ||
      hasVisibleBorderDeclaration(block, "border-left")
    ) {
      fail(`${messagePrefix} must not draw a border: ${selectorList}`);
    }
    if (hasNonNoneDeclaration(block, "box-shadow")) {
      fail(`${messagePrefix} must not draw a box-shadow: ${selectorList}`);
    }
  }
}

function assertMiddleTitlebarFocusUsesInsetOutline() {
  for (const selector of [
    ".shell-titlebar-center .titlebar-tool-button:focus-visible",
    ".shell-titlebar-center .titlebar-icon-button:focus-visible",
    ".shell-titlebar-center .filter-menu-trigger:focus-visible",
    ".shell-titlebar-center .sort-menu-trigger:focus-visible"
  ]) {
    const blocks = cssBlocksForExactSelector(stylesForChecks, selector);
    if (blocks.length === 0) {
      fail(`middle titlebar focus outline style missing ${selector}`);
    }

    const hasInsetOutline = blocks.some((block) => {
      const outlineOffset = latestDeclarationValue(block, "outline-offset");
      return outlineOffset !== null && Number.parseFloat(outlineOffset) < 0;
    });

    if (!hasInsetOutline) {
      fail(`${selector} must use a negative outline-offset so focus is not clipped by the titlebar toolbar`);
    }
  }
}

function assertMiddleTitlebarGlassLayersRemainAvailable() {
  const layerSelectorPattern =
    /\.shell-titlebar-center\s+\.(?:titlebar-tool-button|titlebar-icon-button|filter-menu-trigger|sort-menu-trigger)\s*>\s*\.(?:liquid-glass-lens|liquid-glass-edge)/;
  const layerRules = cssRuleBlocksForMatchingSelectors(stylesForChecks, (selector) =>
    layerSelectorPattern.test(selector)
  );

  if (layerRules.length === 0) {
    fail("middle titlebar tool buttons must keep lens/edge layer rules available for hover and pointer highlights");
  }

  for (const { block, selectorList } of layerRules) {
    if (latestDeclarationValue(block, "display") === "none") {
      fail(`middle titlebar tool buttons must not display:none liquid glass lens/edge layers: ${selectorList}`);
    }
    if (latestDeclarationValue(block, "visibility") === "hidden") {
      fail(`middle titlebar tool buttons must not hide liquid glass lens/edge layers: ${selectorList}`);
    }
    if (latestDeclarationValue(block, "opacity") === "0") {
      fail(`middle titlebar tool buttons must not force liquid glass lens/edge opacity to 0: ${selectorList}`);
    }
  }

  if (!/\.shell-titlebar-center\s+\.(?:titlebar-tool-button|titlebar-icon-button|filter-menu-trigger|sort-menu-trigger):(?:hover|focus-visible|\[data-glass-active="true"\]|not\()/.test(stylesForChecks)) {
    fail("middle titlebar tool buttons must keep state selectors for hover, focus, or active glass highlights");
  }
}

function assertMiddleTitlebarToolStatesActivateGlassLayers() {
  for (const selector of [
    ".shell-titlebar-center .titlebar-tool-button:hover:not(:disabled)",
    ".shell-titlebar-center .titlebar-icon-button:hover:not(:disabled)",
    ".shell-titlebar-center .filter-menu-trigger:hover:not(:disabled)",
    ".shell-titlebar-center .sort-menu-trigger:hover:not(:disabled)",
    ".shell-titlebar-center .titlebar-tool-button:focus-visible",
    ".shell-titlebar-center .titlebar-icon-button:focus-visible",
    ".shell-titlebar-center .filter-menu-trigger:focus-visible",
    ".shell-titlebar-center .sort-menu-trigger:focus-visible"
  ]) {
    const blocks = cssBlocksForExactSelector(stylesForChecks, selector);
    if (blocks.length === 0) {
      fail(`middle titlebar glass state selector missing ${selector}`);
      continue;
    }
    if (
      !blocks.some(
        (block) =>
          positiveCssNumber(latestDeclarationValue(block, "--glass-pointer-opacity")) &&
          positiveCssNumber(latestDeclarationValue(block, "--glass-lens-opacity")) &&
          positiveCssNumber(latestDeclarationValue(block, "--glass-illumination"))
      )
    ) {
      fail(`${selector} must activate liquid-glass pointer/lens illumination without adding a persistent frame`);
    }
  }
}

function assertMiddleTitlebarToolStateBackdropsKeepRefraction() {
  for (const selector of [
    ".shell-titlebar-center .titlebar-tool-button:hover:not(:disabled) > .liquid-glass-backdrop",
    ".shell-titlebar-center .titlebar-icon-button:hover:not(:disabled) > .liquid-glass-backdrop",
    ".shell-titlebar-center .filter-menu-trigger:hover:not(:disabled) > .liquid-glass-backdrop",
    ".shell-titlebar-center .sort-menu-trigger:hover:not(:disabled) > .liquid-glass-backdrop",
    ".shell-titlebar-center .titlebar-tool-button:focus-visible > .liquid-glass-backdrop",
    ".shell-titlebar-center .titlebar-icon-button:focus-visible > .liquid-glass-backdrop",
    ".shell-titlebar-center .filter-menu-trigger:focus-visible > .liquid-glass-backdrop",
    ".shell-titlebar-center .sort-menu-trigger:focus-visible > .liquid-glass-backdrop"
  ]) {
    const blocks = cssBlocksForExactSelector(stylesForChecks, selector);
    if (
      !blocks.some(
        (block) =>
          latestDeclarationValue(block, "opacity") === "1" &&
          hasNonNoneDeclaration(block, "backdrop-filter") &&
          /filter:\s*url\("#megle-liquid-glass-refraction"\)/.test(block)
      )
    ) {
      fail(`${selector} must restore renderer refraction/backdrop filtering for active titlebar tool glass`);
    }
  }
}

function isMiddleTitlebarToolRootSelector(selector, { includeUnscoped = false } = {}) {
  const trimmedSelector = selector.trim();
  if (!includeUnscoped && !cssSelectorContainsClass(trimmedSelector, ".shell-titlebar-center")) {
    return false;
  }

  const rootCompound = lastCssSelectorCompound(trimmedSelector);
  return middleTitlebarToolClassSelectors.some((classSelector) =>
    cssSelectorContainsClass(rootCompound, classSelector)
  );
}

function stripCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function lastCssSelectorCompound(selector) {
  let compoundStart = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let quote = null;

  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index];
    const previous = selector[index - 1];

    if (quote) {
      if (char === quote && previous !== "\\") {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === "[") bracketDepth += 1;
    if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth = Math.max(0, parenDepth - 1);

    if (bracketDepth === 0 && parenDepth === 0 && (/\s/.test(char) || char === ">" || char === "+" || char === "~")) {
      compoundStart = index + 1;
    }
  }

  return selector.slice(compoundStart).trim();
}

function cssSelectorContainsClass(selector, classSelector) {
  const pattern = new RegExp(`${escapeRegExp(classSelector)}(?=$|[^_a-zA-Z0-9-])`);
  return pattern.test(selector);
}

function splitCssSelectorList(selectorList) {
  const selectors = [];
  let current = "";
  let bracketDepth = 0;
  let parenDepth = 0;
  let quote = null;

  for (let index = 0; index < selectorList.length; index += 1) {
    const char = selectorList[index];
    const previous = selectorList[index - 1];

    if (quote) {
      current += char;
      if (char === quote && previous !== "\\") {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === "[") bracketDepth += 1;
    if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth = Math.max(0, parenDepth - 1);

    if (char === "," && bracketDepth === 0 && parenDepth === 0) {
      selectors.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  selectors.push(current);
  return selectors;
}

function assertExactSelectorHelperContracts() {
  const probe = `
    .shell-drag * { -webkit-app-region: drag; }
    .shell-drag:hover { -webkit-app-region: drag; }
    .shell-drag .child { -webkit-app-region: drag; }
    .no-drag * { -webkit-app-region: no-drag; }
    .no-drag, [data-no-drag="true"] { -webkit-app-region: no-drag; }
  `;

  if (
    cssBlocksForExactSelector(probe, ".shell-drag").some(
      (block) => latestDeclarationValue(block, "-webkit-app-region") === "drag"
    )
  ) {
    fail("exact selector helper must not accept descendant or pseudo-class .shell-drag rules");
  }

  if (
    !cssBlocksForExactSelector(probe, ".no-drag").some(
      (block) => latestDeclarationValue(block, "-webkit-app-region") === "no-drag"
    )
  ) {
    fail("exact selector helper must accept .no-drag as a standalone selector in a selector list");
  }
}

function assertCssCommentStrippingContracts() {
  const probe = `
    /*
      --glass-readable-surface: rgb(255 255 255 / 0.3);
      --glass-pointer-fill-opacity: 0.2;
    */
    .comment-only-tint {
      /* background: var(--glass-readable-surface); */
      color: currentColor;
    }
    .comment-only-declarations {
      /* ignored; background: rgb(0 0 0 / 0.6); backdrop-filter: blur(16px); */
      color: currentColor;
    }
  `;

  if (cssCustomPropertyValue(probe, "--glass-readable-surface") !== null) {
    fail("CSS custom property helper must ignore comment-only token declarations");
  }

  if (cssVariableNumber(probe, "--glass-pointer-fill-opacity") !== null) {
    fail("CSS numeric variable helper must ignore comment-only token declarations");
  }

  if (
    cssBlocksForExactSelector(probe, ".comment-only-tint").some((block) =>
      declarationValueIncludes(block, "var(--glass-readable-surface)")
    )
  ) {
    fail("CSS block helpers must not return comment-only local tint evidence");
  }

  const declarationBlocks = cssBlocksForExactSelector(probe, ".comment-only-declarations");
  if (declarationBlocks.some((block) => latestBackgroundValue(block) !== null)) {
    fail("CSS declaration helpers must ignore commented background declarations");
  }

  if (declarationBlocks.some((block) => hasNonNoneDeclaration(block, "backdrop-filter"))) {
    fail("CSS declaration helpers must ignore commented backdrop-filter declarations");
  }
}

function assertMiddleTitlebarToolSelectorContracts() {
  for (const selector of [
    ".titlebar-tool-button:focus-visible",
    ".titlebar-icon-button[data-glass-active=\"true\"]",
    ".filter-menu-trigger:hover:not(:disabled)",
    ".titlebar-library-controls .sort-menu-trigger:hover",
    ".sort-menu-trigger:hover",
    ".sort-menu-trigger-open"
  ]) {
    if (!isMiddleTitlebarToolRootSelector(selector, { includeUnscoped: true })) {
      fail(`middle titlebar tool selector helper must catch unscoped matching selector ${selector}`);
    }
  }
}

function cssVariableNumber(source, variableName) {
  const cssSource = stripCssComments(source);
  const pattern = new RegExp(`${escapeRegExp(variableName)}:\\s*([0-9.]+)`);
  const match = cssSource.match(pattern);
  return match ? Number(match[1]) : null;
}

function cssCustomPropertyValue(source, variableName) {
  const cssSource = stripCssComments(source);
  const pattern = new RegExp(`${escapeRegExp(variableName)}:\\s*([^;]+)`);
  const match = cssSource.match(pattern);
  return match ? normalizeDeclarationValue(match[1]) : null;
}

function cssRgbaAlpha(value) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "transparent" || normalized === "none") return 0;
  const commaMatch = normalized.match(/rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/);
  if (commaMatch) return Number(commaMatch[1]);
  const slashMatch = normalized.match(/rgb(?:a)?\([^)]*\/\s*([\d.]+%?)\s*\)/);
  if (slashMatch) {
    const raw = slashMatch[1];
    return raw.endsWith("%") ? Number(raw.slice(0, -1)) / 100 : Number(raw);
  }
  return null;
}

function positiveCssNumber(value) {
  return value !== null && Number.parseFloat(value) > 0;
}

function extractObjectBody(source, objectName) {
  const objectIndex = source.indexOf(objectName);
  if (objectIndex === -1) {
    return "";
  }

  const bodyStart = source.indexOf("{", objectIndex);
  if (bodyStart === -1) {
    return "";
  }

  const bodyEnd = findMatchingBraceIndex(source, bodyStart);
  if (bodyEnd === -1) {
    return "";
  }

  return source.slice(bodyStart + 1, bodyEnd);
}

function extractAtRuleBody(source, atRulePrefix) {
  const bodies = extractAtRuleBodies(source, atRulePrefix);
  return bodies[0]?.body ?? "";
}

function extractAtRuleBodies(source, atRulePrefix) {
  const bodies = [];
  let searchIndex = 0;

  while (searchIndex < source.length) {
    const start = source.indexOf(atRulePrefix, searchIndex);
    if (start === -1) {
      break;
    }

    const openBrace = source.indexOf("{", start);
    if (openBrace === -1) {
      break;
    }

    let depth = 0;
    for (let index = openBrace; index < source.length; index += 1) {
      const char = source[index];
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      if (depth === 0) {
        bodies.push({
          body: source.slice(openBrace + 1, index),
          start,
          end: index + 1
        });
        searchIndex = index + 1;
        break;
      }
    }

    if (searchIndex <= start) {
      break;
    }
  }

  return bodies;
}

function hasLaterDeclaration(source, startIndex, selector, property) {
  const laterSource = stripCssComments(source).slice(startIndex);
  return cssBlocksForSelector(laterSource, selector).some((block) =>
    propertyDeclarationPattern(property).test(block)
  );
}

function propertyDeclarationPattern(property) {
  return new RegExp(`(?:^|;)\\s*${escapeRegExp(property)}\\s*:`);
}

function hasNonTransparentBackground(block) {
  const value = latestBackgroundValue(block);
  if (value === null) {
    return false;
  }
  return !isTransparentBackgroundValue(value);
}

function latestBackgroundValue(block) {
  const body = stripCssComments(block);
  let latestValue = null;
  const pattern = /(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/gi;
  let match;

  while ((match = pattern.exec(body)) !== null) {
    latestValue = normalizeDeclarationValue(match[1]);
  }

  return latestValue;
}

function latestDeclarationValue(block, property) {
  const body = stripCssComments(block);
  let latestValue = null;
  const pattern = new RegExp(`(?:^|;)\\s*${escapeRegExp(property)}\\s*:\\s*([^;]+)`, "gi");
  let match;

  while ((match = pattern.exec(body)) !== null) {
    latestValue = normalizeDeclarationValue(match[1]);
  }

  return latestValue;
}

function declarationValueIncludes(block, expectedValue) {
  const body = stripCssComments(block);
  const pattern = /(?:^|;)\s*[-_a-zA-Z0-9]+\s*:\s*([^;]+)/gi;
  let match;

  while ((match = pattern.exec(body)) !== null) {
    if (normalizeDeclarationValue(match[1]).includes(expectedValue)) {
      return true;
    }
  }

  return false;
}

function normalizeDeclarationValue(value) {
  return value.trim().replace(/\s*!important$/i, "");
}

function isTransparentBackgroundValue(value) {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "transparent" ||
    normalized === "none" ||
    normalized === "rgba(0, 0, 0, 0)" ||
    normalized === "rgb(0 0 0 / 0)" ||
    normalized === "#0000" ||
    normalized === "#00000000"
  );
}

function hasNonNoneDeclaration(block, property) {
  const value = latestDeclarationValue(block, property);
  if (value === null) {
    return false;
  }
  return value !== "none";
}

function hasNonzeroBorderDeclaration(block, property) {
  const value = latestDeclarationValue(block, property);
  if (value === null) {
    return false;
  }
  return !isZeroBorderValue(value) && value !== "none";
}

function isZeroBorderValue(value) {
  return /^0(?:\s|$)/.test(value.trim().toLowerCase());
}

function hasVisibleBorderDeclaration(block, property) {
  const body = stripCssComments(block);
  const pattern = new RegExp(`(?:^|;)\\s*${escapeRegExp(property)}\\s*:\\s*([^;]+)`, "i");
  const match = body.match(pattern);
  if (!match) {
    return false;
  }

  const value = normalizeDeclarationValue(match[1]).toLowerCase();
  return (
    !/^0(?:\s|$)/.test(value) &&
    value !== "none" &&
    !value.includes("transparent") &&
    !value.includes("#0000") &&
    !value.includes("#00000000") &&
    !/rgba\([^)]*,\s*0\s*\)/.test(value) &&
    !/rgb\([^)]*\/\s*0\s*\)/.test(value)
  );
}

function hasNonzeroBorderRadius(block) {
  const value = latestDeclarationValue(block, "border-radius");
  if (value === null) {
    return false;
  }
  return value !== "0";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractJsxAttributeBodies(source, attributeName) {
  const bodies = [];
  const pattern = `${attributeName}={`;
  let searchIndex = 0;

  while (searchIndex < source.length) {
    const attributeIndex = source.indexOf(pattern, searchIndex);
    if (attributeIndex === -1) break;

    const bodyStart = attributeIndex + pattern.length;
    const bodyEnd = findMatchingBraceIndex(source, bodyStart - 1);
    if (bodyEnd === -1) break;

    bodies.push(source.slice(bodyStart, bodyEnd));
    searchIndex = bodyEnd + 1;
  }

  return bodies;
}

function extractJsxElements(source, componentName) {
  const elements = [];
  const openPattern = `<${componentName}`;
  const closePattern = `</${componentName}>`;
  let searchIndex = 0;

  while (searchIndex < source.length) {
    const start = source.indexOf(openPattern, searchIndex);
    if (start === -1) break;

    const openTagEnd = source.indexOf(">", start);
    if (openTagEnd === -1) break;

    const openTag = source.slice(start, openTagEnd + 1);
    if (/\/>\s*$/.test(openTag)) {
      elements.push(openTag);
      searchIndex = openTagEnd + 1;
      continue;
    }

    const end = source.indexOf(closePattern, openTagEnd + 1);
    if (end === -1) break;

    elements.push(source.slice(start, end + closePattern.length));
    searchIndex = end + closePattern.length;
  }

  return elements;
}

function extractFunctionBody(source, functionName) {
  const functionIndex = source.indexOf(`function ${functionName}`);
  if (functionIndex === -1) {
    return "";
  }

  const bodyStart = source.indexOf("{", functionIndex);
  if (bodyStart === -1) {
    return "";
  }

  const bodyEnd = findMatchingBraceIndex(source, bodyStart);
  if (bodyEnd === -1) {
    return "";
  }

  return source.slice(bodyStart + 1, bodyEnd);
}

function assertDesktopRevealOrderingContract() {
  for (const message of collectDesktopRevealOrderingFailures(desktopMainAst)) {
    fail(message);
  }
}

function assertDesktopRevealOrderingRegressionProbe() {
  const wrapperFallbackProbe = createSourceFileForDesktopRevealProbe(`
    async function createWindow() {
      const window = createMockWindow();
      const armFallback = () => armShellReadyFailureFallback(window);
      armFallback();
      window.once("ready-to-show", () => {
        const rearmFallback = () => armShellReadyFailureFallback(window);
        rearmFallback();
      });
      window.webContents.on("did-fail-load", () => {
        revealMainWindowForLaunchFailure(window);
      });
      window.webContents.on("render-process-gone", () => {
        revealMainWindowForLaunchFailure(window);
      });
      await window.loadURL("http://127.0.0.1:5173");
    }
    function armShellReadyFailureFallback(window) {
      return window;
    }
    function revealMainWindowForLaunchFailure(window) {
      window.show();
    }
  `);
  const wrapperFallbackFailures = collectDesktopRevealOrderingFailures(wrapperFallbackProbe);
  if (wrapperFallbackFailures.length > 0) {
    fail("desktop reveal-order validator must treat const/arrow fallback wrappers as valid reachability paths");
  }

  const wrapperRevealProbe = createSourceFileForDesktopRevealProbe(`
    async function createWindow() {
      const window = createMockWindow();
      armShellReadyFailureFallback(window);
      window.once("ready-to-show", () => {
        const revealLater = () => window.show();
        revealLater();
      });
      window.webContents.on("did-fail-load", () => {
        revealMainWindowForLaunchFailure(window);
      });
      window.webContents.on("render-process-gone", () => {
        revealMainWindowForLaunchFailure(window);
      });
      await window.loadURL("http://127.0.0.1:5173");
    }
    function armShellReadyFailureFallback(window) {
      return window;
    }
    function revealMainWindowForLaunchFailure(window) {
      window.show();
    }
  `);
  const wrapperRevealFailures = collectDesktopRevealOrderingFailures(wrapperRevealProbe);
  if (
    !wrapperRevealFailures.includes(
      "ready-to-show handlers must not reveal the desktop window directly or through a helper"
    )
  ) {
    fail("desktop reveal-order validator must catch const/arrow reveal wrappers inside ready-to-show");
  }

  const objectWrapperFallbackProbe = createSourceFileForDesktopRevealProbe(`
    async function createWindow() {
      const window = createMockWindow();
      const helpers = { armFallback: () => armShellReadyFailureFallback(window) };
      helpers.armFallback();
      window.once("ready-to-show", () => {
        const readyHelpers = {
          rearmFallback() {
            armShellReadyFailureFallback(window);
          }
        };
        readyHelpers.rearmFallback();
      });
      window.webContents.on("did-fail-load", () => {
        revealMainWindowForLaunchFailure(window);
      });
      window.webContents.on("render-process-gone", () => {
        revealMainWindowForLaunchFailure(window);
      });
      await window.loadURL("http://127.0.0.1:5173");
    }
    function armShellReadyFailureFallback(window) {
      return window;
    }
    function revealMainWindowForLaunchFailure(window) {
      window.show();
    }
  `);
  const objectWrapperFallbackFailures = collectDesktopRevealOrderingFailures(objectWrapperFallbackProbe);
  if (objectWrapperFallbackFailures.length > 0) {
    fail("desktop reveal-order validator must treat object-member fallback wrappers as valid reachability paths");
  }

  const objectPropertyRevealProbe = createSourceFileForDesktopRevealProbe(`
    async function createWindow() {
      const window = createMockWindow();
      armShellReadyFailureFallback(window);
      window.once("ready-to-show", () => {
        const helpers = { revealLater: () => window.show() };
        helpers.revealLater();
      });
      window.webContents.on("did-fail-load", () => {
        revealMainWindowForLaunchFailure(window);
      });
      window.webContents.on("render-process-gone", () => {
        revealMainWindowForLaunchFailure(window);
      });
      await window.loadURL("http://127.0.0.1:5173");
    }
    function armShellReadyFailureFallback(window) {
      return window;
    }
    function revealMainWindowForLaunchFailure(window) {
      window.show();
    }
  `);
  const objectPropertyRevealFailures = collectDesktopRevealOrderingFailures(objectPropertyRevealProbe);
  if (
    !objectPropertyRevealFailures.includes(
      "ready-to-show handlers must not reveal the desktop window directly or through a helper"
    )
  ) {
    fail("desktop reveal-order validator must catch object-property reveal wrappers inside ready-to-show");
  }

  const objectMethodRevealProbe = createSourceFileForDesktopRevealProbe(`
    async function createWindow() {
      const window = createMockWindow();
      armShellReadyFailureFallback(window);
      window.once("ready-to-show", () => {
        const helpers = {
          revealLater() {
            window.show();
          }
        };
        helpers.revealLater();
      });
      window.webContents.on("did-fail-load", () => {
        revealMainWindowForLaunchFailure(window);
      });
      window.webContents.on("render-process-gone", () => {
        revealMainWindowForLaunchFailure(window);
      });
      await window.loadURL("http://127.0.0.1:5173");
    }
    function armShellReadyFailureFallback(window) {
      return window;
    }
    function revealMainWindowForLaunchFailure(window) {
      window.show();
    }
  `);
  const objectMethodRevealFailures = collectDesktopRevealOrderingFailures(objectMethodRevealProbe);
  if (
    !objectMethodRevealFailures.includes(
      "ready-to-show handlers must not reveal the desktop window directly or through a helper"
    )
  ) {
    fail("desktop reveal-order validator must catch object-method reveal wrappers inside ready-to-show");
  }

  const iifeRevealProbe = createSourceFileForDesktopRevealProbe(`
    async function createWindow() {
      const window = createMockWindow();
      armShellReadyFailureFallback(window);
      window.once("ready-to-show", () => {
        (() => window.show())();
      });
      window.webContents.on("did-fail-load", () => {
        revealMainWindowForLaunchFailure(window);
      });
      window.webContents.on("render-process-gone", () => {
        revealMainWindowForLaunchFailure(window);
      });
      await window.loadURL("http://127.0.0.1:5173");
    }
    function armShellReadyFailureFallback(window) {
      return window;
    }
    function revealMainWindowForLaunchFailure(window) {
      window.show();
    }
  `);
  const iifeRevealFailures = collectDesktopRevealOrderingFailures(iifeRevealProbe);
  if (
    !iifeRevealFailures.includes(
      "ready-to-show handlers must not reveal the desktop window directly or through a helper"
    )
  ) {
    fail("desktop reveal-order validator must catch inline IIFE reveal wrappers inside ready-to-show");
  }

  const functionIifeRevealProbe = createSourceFileForDesktopRevealProbe(`
    async function createWindow() {
      const window = createMockWindow();
      armShellReadyFailureFallback(window);
      window.once("ready-to-show", () => {
        (function () {
          window.show();
        })();
      });
      window.webContents.on("did-fail-load", () => {
        revealMainWindowForLaunchFailure(window);
      });
      window.webContents.on("render-process-gone", () => {
        revealMainWindowForLaunchFailure(window);
      });
      await window.loadURL("http://127.0.0.1:5173");
    }
    function armShellReadyFailureFallback(window) {
      return window;
    }
    function revealMainWindowForLaunchFailure(window) {
      window.show();
    }
  `);
  const functionIifeRevealFailures = collectDesktopRevealOrderingFailures(functionIifeRevealProbe);
  if (
    !functionIifeRevealFailures.includes(
      "ready-to-show handlers must not reveal the desktop window directly or through a helper"
    )
  ) {
    fail("desktop reveal-order validator must catch function IIFE reveal wrappers inside ready-to-show");
  }

  const deadNestedHandlerProbe = createSourceFileForDesktopRevealProbe(`
    async function createWindow() {
      const window = createMockWindow();
      const fakeReadyToShow = () => {
        window.once("ready-to-show", () => {
          armShellReadyFailureFallback(window);
        });
      };
      const fakeFailures = () => {
        window.webContents.on("did-fail-load", () => {
          revealMainWindowForLaunchFailure(window);
        });
        window.webContents.on("render-process-gone", () => {
          revealMainWindowForLaunchFailure(window);
        });
      };
      void fakeReadyToShow;
      void fakeFailures;
      armShellReadyFailureFallback(window);
      await window.loadURL("http://127.0.0.1:5173");
    }
    function armShellReadyFailureFallback(window) {
      return window;
    }
    function revealMainWindowForLaunchFailure(window) {
      window.show();
    }
  `);
  const deadNestedHandlerFailures = collectDesktopRevealOrderingFailures(deadNestedHandlerProbe);
  if (
    !deadNestedHandlerFailures.includes(
      "desktop startup must re-arm a bounded shell-ready failure fallback from the ready-to-show path"
    ) ||
    !deadNestedHandlerFailures.includes(
      "desktop startup failure handlers must reveal the window on did-fail-load"
    ) ||
    !deadNestedHandlerFailures.includes(
      "desktop startup failure handlers must reveal the window on render-process-gone"
    )
  ) {
    fail("desktop reveal-order validator must ignore dead nested handler registrations");
  }

  const bracketRevealProbe = createSourceFileForDesktopRevealProbe(`
    async function createWindow() {
      const window = createMockWindow();
      armShellReadyFailureFallback(window);
      window.once("ready-to-show", () => {
        const reveal = { later: () => window.show() };
        reveal["later"]();
      });
      window.webContents.on("did-fail-load", () => {
        revealMainWindowForLaunchFailure(window);
      });
      window.webContents.on("render-process-gone", () => {
        revealMainWindowForLaunchFailure(window);
      });
      await window.loadURL("http://127.0.0.1:5173");
    }
    function armShellReadyFailureFallback(window) {
      return window;
    }
    function revealMainWindowForLaunchFailure(window) {
      window.show();
    }
  `);
  const bracketRevealFailures = collectDesktopRevealOrderingFailures(bracketRevealProbe);
  if (
    !bracketRevealFailures.includes(
      "ready-to-show handlers must not reveal the desktop window directly or through a helper"
    )
  ) {
    fail("desktop reveal-order validator must catch bracket-notation object-member reveal wrappers inside ready-to-show");
  }

  const plainAliasFallbackProbe = createSourceFileForDesktopRevealProbe(`
    async function createWindow() {
      const window = createMockWindow();
      const armLater = armShellReadyFailureFallback;
      armLater(window);
      window.once("ready-to-show", () => {
        const rearmLater = armShellReadyFailureFallback;
        rearmLater(window);
      });
      window.webContents.on("did-fail-load", () => {
        revealMainWindowForLaunchFailure(window);
      });
      window.webContents.on("render-process-gone", () => {
        revealMainWindowForLaunchFailure(window);
      });
      await window.loadURL("http://127.0.0.1:5173");
    }
    function armShellReadyFailureFallback(window) {
      return window;
    }
    function revealMainWindowForLaunchFailure(window) {
      window.show();
    }
  `);
  const plainAliasFallbackFailures = collectDesktopRevealOrderingFailures(plainAliasFallbackProbe);
  if (plainAliasFallbackFailures.length > 0) {
    fail("desktop reveal-order validator must treat plain const fallback aliases as valid reachability paths");
  }

  const plainAliasRevealProbe = createSourceFileForDesktopRevealProbe(`
    async function createWindow() {
      const window = createMockWindow();
      armShellReadyFailureFallback(window);
      window.once("ready-to-show", () => {
        const revealLater = revealMainWindow;
        revealLater(window);
      });
      window.webContents.on("did-fail-load", () => {
        revealMainWindowForLaunchFailure(window);
      });
      window.webContents.on("render-process-gone", () => {
        revealMainWindowForLaunchFailure(window);
      });
      await window.loadURL("http://127.0.0.1:5173");
    }
    function armShellReadyFailureFallback(window) {
      return window;
    }
    function revealMainWindow(window) {
      window.show();
    }
    function revealMainWindowForLaunchFailure(window) {
      window.show();
    }
  `);
  const plainAliasRevealFailures = collectDesktopRevealOrderingFailures(plainAliasRevealProbe);
  if (
    !plainAliasRevealFailures.includes(
      "ready-to-show handlers must not reveal the desktop window directly or through a helper"
    )
  ) {
    fail("desktop reveal-order validator must catch plain const reveal aliases inside ready-to-show");
  }

  const indirectHandlerRegistrationProbe = createSourceFileForDesktopRevealProbe(`
    async function createWindow() {
      const window = createMockWindow();
      const registerHandlers = () => {
        window.once("ready-to-show", () => {
          armShellReadyFailureFallback(window);
        });
        window.webContents.on("did-fail-load", () => {
          revealMainWindowForLaunchFailure(window);
        });
        window.webContents.on("render-process-gone", () => {
          revealMainWindowForLaunchFailure(window);
        });
      };
      armShellReadyFailureFallback(window);
      registerHandlers();
      await window.loadURL("http://127.0.0.1:5173");
    }
    function armShellReadyFailureFallback(window) {
      return window;
    }
    function revealMainWindowForLaunchFailure(window) {
      window.show();
    }
  `);
  const indirectHandlerRegistrationFailures = collectDesktopRevealOrderingFailures(
    indirectHandlerRegistrationProbe
  );
  if (indirectHandlerRegistrationFailures.length > 0) {
    fail("desktop reveal-order validator must count handlers registered through called local helpers");
  }

  const lexicalShadowingProbe = createSourceFileForDesktopRevealProbe(`
    function revealMainWindow(window) {
      window.show();
    }
    async function createWindow() {
      const window = createMockWindow();
      armShellReadyFailureFallback(window);
      window.once("ready-to-show", () => {
        armShellReadyFailureFallback(window);
        {
          const revealMainWindow = () => {
            return window;
          };
          revealMainWindow(window);
        }
      });
      window.webContents.on("did-fail-load", () => {
        revealMainWindowForLaunchFailure(window);
      });
      window.webContents.on("render-process-gone", () => {
        revealMainWindowForLaunchFailure(window);
      });
      await window.loadURL("http://127.0.0.1:5173");
    }
    function armShellReadyFailureFallback(window) {
      return window;
    }
    function revealMainWindowForLaunchFailure(window) {
      window.show();
    }
  `);
  const lexicalShadowingFailures = collectDesktopRevealOrderingFailures(lexicalShadowingProbe);
  if (lexicalShadowingFailures.length > 0) {
    fail("desktop reveal-order validator must resolve same-name local shadowing lexically");
  }
}

function createSourceFileForDesktopRevealProbe(source) {
  return ts.createSourceFile(
    "desktop-reveal-probe.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
}

function collectDesktopRevealOrderingFailures(sourceFile) {
  const analysis = buildStartupValidatorAnalysis(sourceFile);
  if (!analysis.createWindowBinding) {
    return ["desktop startup contract missing createWindow"];
  }

  const failures = [];
  const { createWindowBinding, fallbackArmBinding, launchFailureBinding } = analysis;
  const parentMap = buildParentMap(createWindowBinding.node);
  const createWindowExecution = collectReachableExecutionData(
    createWindowBinding.body,
    createWindowBinding.closureScope,
    "createWindow",
    [],
    analysis
  );
  const loadUrlCalls = createWindowExecution.callRecords.filter(({ call }) =>
    isPropertyAccessCall(call, "loadURL")
  );
  const readyToShowHandlers = createWindowExecution.eventHandlers.filter(
    (handler) => handler.eventName === "ready-to-show"
  );
  const didFailLoadHandlers = createWindowExecution.eventHandlers.filter(
    (handler) => handler.eventName === "did-fail-load"
  );
  const renderProcessGoneHandlers = createWindowExecution.eventHandlers.filter(
    (handler) => handler.eventName === "render-process-gone"
  );

  if (loadUrlCalls.length === 0) {
    return ["desktop startup contract missing loadURL inside createWindow"];
  }

  if (
    createWindowExecution.callRecords.some(
      (record) =>
        record.isShow &&
        !(
          launchFailureBinding &&
          record.context === "catch" &&
          record.bindingStack.includes(launchFailureBinding.id)
        )
    )
  ) {
    failures.push("desktop window show timing must not run directly inside createWindow or its nested handlers");
  }

  const firstLoadUrlCall = loadUrlCalls[0].call;
  const absoluteFallbackCall = createWindowExecution.callRecords.find(
    (record) =>
      fallbackArmBinding &&
      record.resolvedBinding?.id === fallbackArmBinding.id &&
      getCreateWindowCallContext(record.call, parentMap) === "createWindow" &&
      record.call.getStart(sourceFile) < firstLoadUrlCall.getStart(sourceFile)
  );
  if (!absoluteFallbackCall) {
    failures.push("desktop startup must arm an absolute shell-ready failure fallback before loadURL begins navigation");
  }

  if (
    !readyToShowHandlers.some((handler) => {
      const handlerExecution = collectReachableExecutionData(
        handler.callback.body,
        handler.scope,
        "event:ready-to-show",
        [],
        analysis
      );
      return (
        fallbackArmBinding &&
        handlerExecution.callRecords.some(
          (record) => record.resolvedBinding?.id === fallbackArmBinding.id
        )
      );
    })
  ) {
    failures.push("desktop startup must re-arm a bounded shell-ready failure fallback from the ready-to-show path");
  }

  if (
    readyToShowHandlers.some((handler) =>
      collectReachableExecutionData(
        handler.callback.body,
        handler.scope,
        "event:ready-to-show",
        [],
        analysis
      ).callRecords.some((record) => record.isShow)
    )
  ) {
    failures.push("ready-to-show handlers must not reveal the desktop window directly or through a helper");
  }

  if (
    !didFailLoadHandlers.some((handler) => {
      const handlerExecution = collectReachableExecutionData(
        handler.callback.body,
        handler.scope,
        "event:did-fail-load",
        [],
        analysis
      );
      return (
        launchFailureBinding &&
        handlerExecution.callRecords.some(
          (record) => record.resolvedBinding?.id === launchFailureBinding.id
        )
      );
    })
  ) {
    failures.push("desktop startup failure handlers must reveal the window on did-fail-load");
  }

  if (
    !renderProcessGoneHandlers.some((handler) => {
      const handlerExecution = collectReachableExecutionData(
        handler.callback.body,
        handler.scope,
        "event:render-process-gone",
        [],
        analysis
      );
      return (
        launchFailureBinding &&
        handlerExecution.callRecords.some(
          (record) => record.resolvedBinding?.id === launchFailureBinding.id
        )
      );
    })
  ) {
    failures.push("desktop startup failure handlers must reveal the window on render-process-gone");
  }

  const unexpectedRevealCalls = createWindowExecution.callRecords.filter(
    (record) =>
      record.isShow &&
      !(
        launchFailureBinding &&
        record.context === "catch" &&
        record.bindingStack.includes(launchFailureBinding.id)
      )
  );
  if (unexpectedRevealCalls.length > 0) {
    failures.push("desktop window reveal helpers must stay confined to shell-ready and explicit launch-failure paths");
  }

  return failures;
}

function buildStartupValidatorAnalysis(sourceFile) {
  const rootScope = createRuntimeScope(null);
  hoistFunctionDeclarationsIntoScope(sourceFile, rootScope);
  registerRuntimeVariableBindings(sourceFile, rootScope);

  return {
    rootScope,
    createWindowBinding: lookupScopeBinding(rootScope, "createWindow"),
    fallbackArmBinding: lookupScopeBinding(rootScope, "armShellReadyFailureFallback"),
    launchFailureBinding: lookupScopeBinding(rootScope, "revealMainWindowForLaunchFailure")
  };
}

function createRuntimeScope(parent) {
  return {
    parent,
    bindings: new Map()
  };
}

function createCallableBinding(name, node, body, closureScope) {
  return {
    id: `${name}:${node.pos}:${node.end}`,
    kind: "callable",
    name,
    node,
    body,
    closureScope
  };
}

function createNamespaceBinding(name) {
  return {
    id: `namespace:${name}`,
    kind: "namespace",
    name,
    members: new Map()
  };
}

function bindScopeBinding(scope, name, binding) {
  scope.bindings.set(name, binding);
}

function lookupScopeBinding(scope, name) {
  let current = scope;
  while (current) {
    if (current.bindings.has(name)) {
      return current.bindings.get(name);
    }
    current = current.parent;
  }
  return null;
}

function hoistFunctionDeclarationsIntoScope(container, scope) {
  for (const statement of directContainerStatements(container)) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text) {
      bindScopeBinding(
        scope,
        statement.name.text,
        createCallableBinding(statement.name.text, statement, statement.body, scope)
      );
    }
  }
}

function registerRuntimeVariableBindings(container, scope) {
  for (const statement of directContainerStatements(container)) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        registerVariableCallableBinding(declaration, scope);
      }
    }
  }
}

function directContainerStatements(container) {
  if (ts.isSourceFile(container) || ts.isBlock(container)) {
    return container.statements;
  }
  return [];
}

function registerVariableCallableBinding(declaration, scope) {
  if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
    return;
  }

  const bindingName = declaration.name.text;
  const initializer = declaration.initializer;

  if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
    bindScopeBinding(
      scope,
      bindingName,
      createCallableBinding(bindingName, initializer, initializer.body, scope)
    );
    return;
  }

  if (ts.isObjectLiteralExpression(initializer)) {
    bindScopeBinding(scope, bindingName, createObjectLiteralNamespaceBinding(bindingName, initializer, scope));
    return;
  }

  const aliasTarget = resolveBindingFromExpression(scope, initializer);
  if (aliasTarget) {
    bindScopeBinding(scope, bindingName, aliasTarget);
  }
}

function createObjectLiteralNamespaceBinding(name, objectLiteral, scope) {
  const namespaceBinding = createNamespaceBinding(name);

  for (const property of objectLiteral.properties) {
    const propertyName = objectLiteralPropertyName(property.name);
    if (!propertyName) {
      continue;
    }

    let memberBinding = null;
    if (
      ts.isPropertyAssignment(property) &&
      (ts.isArrowFunction(property.initializer) || ts.isFunctionExpression(property.initializer))
    ) {
      memberBinding = createCallableBinding(
        `${name}.${propertyName}`,
        property.initializer,
        property.initializer.body,
        scope
      );
    } else if (ts.isMethodDeclaration(property)) {
      memberBinding = createCallableBinding(
        `${name}.${propertyName}`,
        property,
        property.body,
        scope
      );
    } else if (ts.isPropertyAssignment(property) && ts.isObjectLiteralExpression(property.initializer)) {
      memberBinding = createObjectLiteralNamespaceBinding(
        `${name}.${propertyName}`,
        property.initializer,
        scope
      );
    } else if (ts.isPropertyAssignment(property)) {
      memberBinding = resolveBindingFromExpression(scope, property.initializer);
    }

    if (memberBinding) {
      namespaceBinding.members.set(propertyName, memberBinding);
    }
  }

  return namespaceBinding;
}

function resolveBindingFromExpression(scope, expression) {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }

  if (ts.isIdentifier(current)) {
    return lookupScopeBinding(scope, current.text);
  }

  if (ts.isPropertyAccessExpression(current)) {
    const target = resolveBindingFromExpression(scope, current.expression);
    return target?.kind === "namespace" ? target.members.get(current.name.text) ?? null : null;
  }

  if (ts.isElementAccessExpression(current)) {
    const target = resolveBindingFromExpression(scope, current.expression);
    const staticKey = staticElementAccessKey(current.argumentExpression);
    return target?.kind === "namespace" && staticKey !== null
      ? target.members.get(staticKey) ?? null
      : null;
  }

  return null;
}

function collectReachableExecutionData(container, parentScope, context, activeBindings, analysis) {
  const scope = createRuntimeScope(parentScope);
  hoistFunctionDeclarationsIntoScope(container, scope);

  const execution = {
    callRecords: [],
    eventHandlers: []
  };

  if (ts.isSourceFile(container) || ts.isBlock(container)) {
    for (const statement of container.statements) {
      visitExecutedNode(statement, scope, context, activeBindings, analysis, execution);
    }
  } else {
    visitExecutedNode(container, scope, context, activeBindings, analysis, execution, true);
  }

  return execution;
}

function visitExecutedNode(
  node,
  scope,
  context,
  activeBindings,
  analysis,
  execution,
  allowRootFunctionLike = false
) {
  if (!allowRootFunctionLike && ts.isFunctionLike(node)) {
    return;
  }

  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      visitExecutedNode(declaration, scope, context, activeBindings, analysis, execution);
    }
    return;
  }

  if (ts.isVariableDeclaration(node)) {
    if (node.initializer) {
      visitExecutedNode(node.initializer, scope, context, activeBindings, analysis, execution);
    }
    registerVariableCallableBinding(node, scope);
    return;
  }

  if (ts.isTryStatement(node)) {
    visitExecutedNode(node.tryBlock, scope, context, activeBindings, analysis, execution, true);
    if (node.catchClause) {
      const catchScope = createRuntimeScope(scope);
      if (node.catchClause.variableDeclaration?.name && ts.isIdentifier(node.catchClause.variableDeclaration.name)) {
        bindScopeBinding(catchScope, node.catchClause.variableDeclaration.name.text, null);
      }
      visitExecutedNode(node.catchClause.block, catchScope, "catch", activeBindings, analysis, execution, true);
    }
    if (node.finallyBlock) {
      visitExecutedNode(node.finallyBlock, scope, context, activeBindings, analysis, execution, true);
    }
    return;
  }

  if (ts.isBlock(node)) {
    const blockScope = createRuntimeScope(scope);
    hoistFunctionDeclarationsIntoScope(node, blockScope);
    for (const statement of node.statements) {
      visitExecutedNode(statement, blockScope, context, activeBindings, analysis, execution);
    }
    return;
  }

  if (ts.isCallExpression(node)) {
    const resolvedBinding = resolveBindingFromExpression(scope, node.expression);
    const callRecord = {
      call: node,
      resolvedBinding,
      context,
      bindingStack: [...activeBindings],
      isShow: isPropertyAccessCall(node, "show")
    };
    execution.callRecords.push(callRecord);

    const registration = matchEventRegistration(node);
    if (registration) {
      execution.eventHandlers.push({
        eventName: registration.eventName,
        callback: registration.callback,
        scope
      });
    }

    const inlineIife = immediatelyInvokedFunctionExpression(node);
    if (inlineIife) {
      mergeExecutionData(
        execution,
        collectReachableExecutionData(
          inlineIife.body,
          scope,
          context,
          activeBindings,
          analysis
        )
      );
    }

    if (
      resolvedBinding?.kind === "callable" &&
      !activeBindings.includes(resolvedBinding.id)
    ) {
      mergeExecutionData(
        execution,
        collectReachableExecutionData(
          resolvedBinding.body,
          resolvedBinding.closureScope,
          context,
          [...activeBindings, resolvedBinding.id],
          analysis
        )
      );
    }

    ts.forEachChild(node, (child) => {
      if (!ts.isFunctionLike(child)) {
        visitExecutedNode(child, scope, context, activeBindings, analysis, execution);
      }
    });
    return;
  }

  if (ts.isNewExpression(node)) {
    const promiseExecutor = promiseExecutorFunctionExpression(node);
    if (promiseExecutor) {
      mergeExecutionData(
        execution,
        collectReachableExecutionData(
          promiseExecutor.body,
          scope,
          context,
          activeBindings,
          analysis
        )
      );
    }
  }

  ts.forEachChild(node, (child) =>
    visitExecutedNode(child, scope, context, activeBindings, analysis, execution)
  );
}

function mergeExecutionData(target, source) {
  target.callRecords.push(...source.callRecords);
  target.eventHandlers.push(...source.eventHandlers);
}

function collectNamedFunctionData(sourceFile) {
  const functions = new Map();

  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text) {
      functions.set(node.name.text, createNamedFunctionData(node.name.text, node, node.body));
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      functions.set(
        node.name.text,
        createNamedFunctionData(node.name.text, node.initializer, node.initializer.body)
      );
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      !ts.isObjectLiteralExpression(node.initializer)
    ) {
      const aliasTargetName = callableExpressionName(node.initializer);
      if (aliasTargetName) {
        functions.set(
          node.name.text,
          createAliasFunctionData(node.name.text, node, aliasTargetName)
        );
      }
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const property of node.initializer.properties) {
        const propertyName = objectLiteralPropertyName(property.name);
        if (!propertyName) {
          continue;
        }

        if (
          ts.isPropertyAssignment(property) &&
          (ts.isArrowFunction(property.initializer) ||
            ts.isFunctionExpression(property.initializer))
        ) {
          functions.set(
            `${node.name.text}.${propertyName}`,
            createNamedFunctionData(
              `${node.name.text}.${propertyName}`,
              property.initializer,
              property.initializer.body
            )
          );
        } else if (ts.isMethodDeclaration(property)) {
          functions.set(
            `${node.name.text}.${propertyName}`,
            createNamedFunctionData(
              `${node.name.text}.${propertyName}`,
              property,
              property.body
            )
          );
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return functions;
}

function createNamedFunctionData(name, node, body) {
  const execution = collectExecutionData(body);
  return {
    name,
    node,
    directCallees: execution.calledNames,
    callsShow: execution.callsShow
  };
}

function createAliasFunctionData(name, node, targetName) {
  return {
    name,
    node,
    directCallees: new Set([targetName]),
    callsShow: false
  };
}

function collectTransitiveHelperNames(namedFunctions, { seedNames = [], predicate } = {}) {
  const helperNames = new Set(seedNames);

  if (predicate) {
    for (const [name, data] of namedFunctions.entries()) {
      if (predicate(data)) {
        helperNames.add(name);
      }
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, data] of namedFunctions.entries()) {
      if (helperNames.has(name)) {
        continue;
      }
      if ([...data.directCallees].some((callee) => helperNames.has(callee))) {
        helperNames.add(name);
        changed = true;
      }
    }
  }

  return helperNames;
}

function collectExecutionData(body) {
  const calledNames = new Set();
  const callExpressions = [];
  let callsShow = false;

  if (!body) {
    return { calledNames, callExpressions, callsShow };
  }

  function visit(current) {
    if (ts.isCallExpression(current)) {
      callExpressions.push(current);
      const calleeName = calledFunctionName(current);
      if (calleeName) {
        calledNames.add(calleeName);
      }
      if (isPropertyAccessCall(current, "show")) {
        callsShow = true;
      }
      const inlineIife = immediatelyInvokedFunctionExpression(current);
      if (inlineIife) {
        visit(inlineIife.body);
      }
    } else if (ts.isNewExpression(current)) {
      const promiseExecutor = promiseExecutorFunctionExpression(current);
      if (promiseExecutor) {
        visit(promiseExecutor.body);
      }
    }
    if (ts.isFunctionLike(current)) {
      return;
    }
    ts.forEachChild(current, visit);
  }

  visit(body);
  return { calledNames, callExpressions, callsShow };
}

function collectReachableHelperCalls(body, helperNames) {
  return collectExecutionData(body).callExpressions.filter((call) =>
    callsAnyHelper(call, helperNames)
  );
}

function callsAnyHelper(call, helperNames) {
  const calleeName = calledFunctionName(call);
  return Boolean(calleeName && helperNames.has(calleeName));
}

function collectEventHandlers(node, eventName) {
  return collectCallExpressions(
    node,
    (call) => matchEventRegistration(call)?.eventName === eventName
  ).flatMap((call) => {
    const registration = matchEventRegistration(call);
    return registration ? [{ call, callback: registration.callback }] : [];
  });
}

function collectReachableEventHandlers(body, eventName) {
  return collectExecutionData(body).callExpressions.flatMap((call) => {
    const registration = matchEventRegistration(call);
    return registration?.eventName === eventName ? [{ call, callback: registration.callback }] : [];
  });
}

function callbackContainsHelperCall(callback, helperNames) {
  return (
    collectReachableHelperCalls(callback.body, helperNames).length > 0 ||
    collectExecutionData(callback.body).callsShow
  );
}

function collectCallExpressions(node, predicate) {
  const matches = [];

  function visit(current, isRoot = false) {
    if (!isRoot && ts.isFunctionLike(current)) {
      return;
    }
    if (ts.isCallExpression(current) && predicate(current)) {
      matches.push(current);
    }
    ts.forEachChild(current, (child) => visit(child, false));
  }

  visit(node, true);
  return matches;
}

function buildParentMap(node) {
  const parentMap = new Map();

  function visit(current) {
    ts.forEachChild(current, (child) => {
      parentMap.set(child, current);
      visit(child);
    });
  }

  visit(node);
  return parentMap;
}

function getCreateWindowCallContext(call, parentMap) {
  let current = call;

  while (current) {
    if (ts.isCatchClause(current)) {
      return "catch";
    }

    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      const parent = parentMap.get(current);
      if (parent && ts.isCallExpression(parent)) {
        const registration = matchEventRegistration(parent);
        if (registration?.callback === current) {
          return `event:${registration.eventName}`;
        }
      }
    }

    current = parentMap.get(current);
  }

  return "createWindow";
}

function matchEventRegistration(call) {
  if (
    !ts.isPropertyAccessExpression(call.expression) ||
    (call.expression.name.text !== "on" && call.expression.name.text !== "once")
  ) {
    return null;
  }

  const [eventArg, callbackArg] = call.arguments;
  if (!eventArg || !ts.isStringLiteral(eventArg)) {
    return null;
  }
  if (
    !callbackArg ||
    (!ts.isArrowFunction(callbackArg) && !ts.isFunctionExpression(callbackArg))
  ) {
    return null;
  }

  return {
    eventName: eventArg.text,
    callback: callbackArg
  };
}

function calledFunctionName(call) {
  return callableExpressionName(call.expression);
}

function isPropertyAccessCall(call, propertyName) {
  return ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === propertyName;
}

function immediatelyInvokedFunctionExpression(call) {
  let expression = call.expression;

  while (ts.isParenthesizedExpression(expression)) {
    expression = expression.expression;
  }

  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    return expression;
  }

  return null;
}

function objectLiteralPropertyName(name) {
  if (!name) {
    return null;
  }
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function promiseExecutorFunctionExpression(expression) {
  if (
    !ts.isIdentifier(expression.expression) ||
    expression.expression.text !== "Promise"
  ) {
    return null;
  }
  const [executor] = expression.arguments;
  if (
    executor &&
    (ts.isArrowFunction(executor) || ts.isFunctionExpression(executor))
  ) {
    return executor;
  }
  return null;
}

function propertyAccessExpressionRoot(expression) {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const parentRoot = propertyAccessExpressionRoot(expression.expression);
    if (!parentRoot) {
      return null;
    }
    return `${parentRoot}.${expression.name.text}`;
  }
  if (ts.isElementAccessExpression(expression)) {
    const parentRoot = propertyAccessExpressionRoot(expression.expression);
    const staticKey = staticElementAccessKey(expression.argumentExpression);
    if (!parentRoot || staticKey === null) {
      return null;
    }
    return `${parentRoot}.${staticKey}`;
  }
  return null;
}

function staticElementAccessKey(argumentExpression) {
  if (!argumentExpression) {
    return null;
  }
  if (ts.isStringLiteral(argumentExpression) || ts.isNumericLiteral(argumentExpression)) {
    return argumentExpression.text;
  }
  if (ts.isNoSubstitutionTemplateLiteral(argumentExpression)) {
    return argumentExpression.text;
  }
  return null;
}

function callableExpressionName(expression) {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }

  if (ts.isIdentifier(current)) {
    return current.text;
  }
  if (ts.isPropertyAccessExpression(current)) {
    const expressionRoot = propertyAccessExpressionRoot(current.expression);
    if (expressionRoot) {
      return `${expressionRoot}.${current.name.text}`;
    }
    return current.name.text;
  }
  if (ts.isElementAccessExpression(current)) {
    const expressionRoot = propertyAccessExpressionRoot(current.expression);
    const staticKey = staticElementAccessKey(current.argumentExpression);
    if (expressionRoot && staticKey !== null) {
      return `${expressionRoot}.${staticKey}`;
    }
  }
  return null;
}

function extractFirstRequiredFunctionBody(source, functionNames, contractName) {
  for (const functionName of functionNames) {
    const body = extractFunctionBody(source, functionName);
    if (body) {
      return body;
    }
  }

  fail(`${contractName} function missing; expected one of ${functionNames.join(", ")}`);
  return "";
}

function handlerSupportsKeyboardPreview(body) {
  return body.includes("onOpenPreview(") && hasEnterKeyCheck(body) && hasSpaceKeyCheck(body);
}

function previewStageStyleDerivesFromMediaDimensions(source) {
  const body = extractFunctionBody(source, "previewStageStyle");
  if (!body) {
    return false;
  }

  const returnIndex = body.indexOf("return");
  const returnObjectStart = returnIndex === -1 ? -1 : body.indexOf("{", returnIndex);
  const returnObjectEnd = returnObjectStart === -1 ? -1 : findMatchingBraceIndex(body, returnObjectStart);
  const returnObjectBody =
    returnObjectStart === -1 || returnObjectEnd === -1
      ? ""
      : body.slice(returnObjectStart + 1, returnObjectEnd);
  const aspectRatioMatch = returnObjectBody.match(/\baspectRatio\s*:\s*([^,\n]+)/);
  if (!aspectRatioMatch) {
    return false;
  }

  const aspectRatioExpression = aspectRatioMatch[1];
  return /\bmedia\.width\b/.test(aspectRatioExpression) && /\bmedia\.height\b/.test(aspectRatioExpression);
}

function hasEnterKeyCheck(body) {
  return /["']Enter["']/.test(body);
}

function hasSpaceKeyCheck(body) {
  return /["'] ["']|["']Space["']|["']Spacebar["']/.test(body);
}

function findMatchingBraceIndex(source, openBraceIndex) {
  let depth = 0;

  for (let index = openBraceIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      return index;
    }
  }

  return -1;
}
