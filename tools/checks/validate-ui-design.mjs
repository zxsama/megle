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
  "LiquidGlassLayer",
  "LiquidGlassSurface",
  "LiquidGlassButton",
  "data-liquid-glass",
  "liquid-glass-backdrop",
  "liquid-glass-lens",
  "sharp child content layer"
]) {
  if (!liquidGlassSurface.includes(value) && !liquidGlassIndex.includes(value)) {
    fail(`liquid glass primitive source missing ${value}`);
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
  "data-glass-pressed"
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
