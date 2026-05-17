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

const desktopMain = read("apps/desktop/src/main.ts");
const styles = read("apps/web/src/styles.css");
const app = read("apps/web/src/app/App.tsx");
const windowChrome = read("apps/web/src/features/window-chrome/WindowChrome.tsx");

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

if (!process.exitCode) {
  console.log("PASS: UI liquid glass design boundaries");
}
