import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

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

const desktopMain = read("apps/desktop/src/main.ts");
const styles = read("apps/web/src/styles.css");
const app = read("apps/web/src/app/App.tsx");
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
const mediaGrid = read("apps/web/src/features/media-grid/MediaGrid.tsx");
const previewPanel = read("apps/web/src/features/preview/PreviewPanel.tsx");
const taskPanel = read("apps/web/src/features/tasks/TaskPanel.tsx");
const contextMenu = read("apps/web/src/features/file-ops/ContextMenu.tsx");
const desktopBridge = read("apps/web/src/core/desktop.ts");

for (const value of [
  "frame: false",
  'backgroundMaterial: "acrylic"',
  "transparent: true",
  'backgroundColor: "#00000000"'
]) {
  if (!desktopMain.includes(value)) {
    fail(`desktop window must enable Windows acrylic glass: missing ${value}`);
  }
}

for (const value of [
  "--glass-canvas",
  "--glass-panel",
  "--glass-control",
  "--glass-elevated",
  "--glass-border",
  "--glass-blur",
  "--interactive-hover",
  "--interactive-active"
]) {
  if (!styles.includes(value)) {
    fail(`liquid glass token missing ${value}`);
  }
}

for (const value of [
  ":where(button, [role=\"button\"], input, select, textarea)",
  ":where(button, [role=\"button\"]):hover:not(:disabled)",
  ":where(button, [role=\"button\"]):active:not(:disabled)",
  ":where(button, [role=\"button\"], input, select, textarea):focus-visible"
]) {
  if (!styles.includes(value)) {
    fail(`global interactive control state missing ${value}`);
  }
}

for (const value of [
  ".topbar,",
  ".library-sidebar,",
  ".task-panel,",
  ".toolbar,",
  ".inspector-panel",
  "backdrop-filter: blur(var(--glass-blur)) saturate(1.45)",
  "box-shadow: var(--glass-shadow)"
]) {
  if (!styles.includes(value)) {
    fail(`glass control layer styling missing ${value}`);
  }
}

for (const value of [
  ".context-menu",
  ".dialog-panel",
  ".recent-ops-drawer",
  "backdrop-filter: blur(var(--glass-elevated-blur)) saturate(1.5)"
]) {
  if (!styles.includes(value)) {
    fail(`floating glass layer styling missing ${value}`);
  }
}

if (!styles.includes("-webkit-app-region: drag") || !styles.includes("-webkit-app-region: no-drag")) {
  fail("frameless window chrome must define drag and no-drag regions");
}

if (!windowChrome.includes("window-chrome-button-close")) {
  fail("web chrome controls must render a distinct close target");
}

if (!app.includes("WindowChrome")) {
  fail("app shell must render custom window chrome controls");
}

for (const value of [
  "taskDrawerOpen",
  "task-drawer-toggle",
  "task-drawer-backdrop",
  "task-drawer-panel",
  'aria-label="Open tasks palette"',
  'aria-label="Close tasks palette"'
]) {
  if (!app.includes(value) && !taskPanel.includes(value)) {
    fail(`tasks must be a floating accessible drawer/palette, missing ${value}`);
  }
}

if (styles.includes('"sidebar workspace tasks"') || styles.includes("grid-area: tasks")) {
  fail("tasks must not occupy a fixed app-shell grid column");
}

if (!/grid-template-columns:\s*minmax\(260px,\s*292px\)\s+minmax\(0,\s*1fr\)/.test(styles)) {
  fail("app shell must reserve width for sidebar + workspace only after floating task drawer migration");
}

for (const value of [
  "top-tab-icon",
  "top-tab-caption",
  "aria-label={tab.label}",
  "title={tab.label}",
  'role="tablist"',
  'role="tab"'
]) {
  if (!app.includes(value)) {
    fail(`top navigation must be product-grade icon tabs with accessible labels: missing ${value}`);
  }
}

if (app.includes("<span>{tab.label}</span>")) {
  fail("top navigation must not render plain text tab buttons as the primary affordance");
}

for (const value of [
  "PreviewDialog",
  "previewOpen",
  "onOpenPreview",
  "handleOpenPreview",
  'aria-label={`Open preview for ${item.name}`',
  "onDoubleClick",
  'event.key === "Enter"',
  'event.key === " "'
]) {
  if (!libraryView.includes(value) && !mediaGrid.includes(value) && !previewPanel.includes(value)) {
    fail(`media grid click/keyboard preview flow missing ${value}`);
  }
}

for (const value of [
  "LiquidGlassSurface",
  "preview-dialog-backdrop",
  "preview-dialog-panel",
  "preview-dialog-stage",
  'role="dialog"',
  "useFocusTrap",
  "Escape",
  "onClose"
]) {
  if (!previewPanel.includes(value)) {
    fail(`image preview dialog must use accessible Liquid Glass dialog primitives: missing ${value}`);
  }
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
  if (!styles.includes(value) && !liquidGlassSurface.includes(value)) {
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
  if (!styles.includes(value)) {
    fail(`liquid glass CSS must include accessibility and interaction fallback: missing ${value}`);
  }
}

if (styles.includes("animation-duration: 1ms")) {
  fail("reduced motion must disable nonessential animations instead of shortening them to 1ms");
}

for (const value of [
  "animation: none !important",
  "transition: none !important",
  "transform: none !important",
  ".spin",
  ".task-progress-bar.indeterminate .task-progress-fill"
]) {
  if (!styles.includes(value)) {
    fail(`reduced motion must prevent shimmer/spin/liquid flicker: missing ${value}`);
  }
}

for (const token of ["--glass-refraction-scale", "--glass-chromatic-aberration"]) {
  if (styles.includes(token)) {
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
  ".grid-surface",
  ".virtual-grid",
  ".media-tile",
  ".tile-thumb",
  ".preview-stage"
]) {
  const blocks = cssBlocksForSelector(styles, selector);
  if (blocks.length === 0) {
    fail(`content-layer selector missing ${selector}`);
    continue;
  }
  for (const block of blocks) {
    if (block.includes("backdrop-filter")) {
      fail(`${selector} must not use persistent backdrop-filter; keep media content sharp`);
    }
    if (block.includes("liquid-glass-backdrop") || block.includes("data-liquid-glass")) {
      fail(`${selector} must not become a glass surface; glass belongs to controls/navigation`);
    }
  }
}

if (!process.exitCode) {
  console.log("PASS: UI liquid glass design boundaries");
}

function cssBlocksForSelector(source, selector) {
  const blocks = [];
  let searchIndex = 0;
  while (searchIndex < source.length) {
    const selectorIndex = source.indexOf(selector, searchIndex);
    if (selectorIndex === -1) break;
    const blockStart = source.indexOf("{", selectorIndex);
    if (blockStart === -1) break;
    const previousClose = source.lastIndexOf("}", selectorIndex);
    const previousOpen = source.lastIndexOf("{", selectorIndex);
    if (previousOpen > previousClose) {
      searchIndex = selectorIndex + selector.length;
      continue;
    }
    let depth = 0;
    for (let index = blockStart; index < source.length; index += 1) {
      const char = source[index];
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      if (depth === 0) {
        blocks.push(source.slice(blockStart + 1, index));
        searchIndex = index + 1;
        break;
      }
    }
  }
  return blocks;
}
