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

function functionBody(source, signature) {
  const start = source.indexOf(signature);
  if (start === -1) {
    return null;
  }

  const openBrace = source.indexOf("{", start);
  if (openBrace === -1) {
    return null;
  }

  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openBrace + 1, index);
      }
    }
  }

  return null;
}

const main = read("apps/desktop/src/main.ts");
const session = read("apps/desktop/src/core-session.ts");
const processFile = read("apps/desktop/src/core-process.ts");
const preload = read("apps/desktop/src/preload.cjs");
const desktopPackage = read("apps/desktop/package.json");
const rootPackage = read("package.json");
const devRunner = read("tools/dev/run-dev.mjs");

for (const value of [
  "startCoreProcess",
  "waitForCoreHealth",
  "createCoreSession",
  "additionalArguments",
  "--megle-core-url=",
  "--megle-session-token=",
  "before-quit"
]) {
  if (!main.includes(value)) {
    fail(`desktop main missing ${value}`);
  }
}

for (const value of ["baseUrl", "bindAddress", "dbPath", "sessionToken", "MEGLE_CORE_ADDR"]) {
  if (!session.includes(value)) {
    fail(`core session missing ${value}`);
  }
}
if (session.includes("47321")) {
  fail("desktop core session must not default Electron-owned Core to fixed 127.0.0.1:47321");
}
for (const value of [
  "MEGLE_CORE_EXTERNAL",
  "MEGLE_CORE_URL is required when MEGLE_CORE_EXTERNAL=1",
  "MEGLE_SESSION_TOKEN is required when MEGLE_CORE_EXTERNAL=1",
  "normalizeLoopbackHost",
  "Unsupported Core host",
  "MEGLE_CORE_ADDR and MEGLE_CORE_URL must point to the same host/port",
  "isLoopbackOrIpLiteral"
]) {
  if (!session.includes(value)) {
    fail(`core session missing local/external endpoint guardrail: ${value}`);
  }
}

for (const value of [
  "MEGLE_CORE_EXTERNAL",
  "cargo",
  "MEGLE_DB_PATH",
  "MEGLE_CORE_ADDR",
  "MEGLE_SESSION_TOKEN",
  "MEGLE_ALLOWED_ORIGIN",
  "health",
  "x-megle-session",
  "windowsHide",
  "repoRoot"
]) {
  if (!processFile.includes(value)) {
    fail(`core process orchestration missing ${value}`);
  }
}
for (const value of ["taskkill", "/T", "/F", "stopCoreProcessTree"]) {
  if (!processFile.includes(value)) {
    fail(`core process cleanup missing ${value}`);
  }
}

for (const value of ["contextBridge", "coreUrl", "sessionToken", "notifyShellReady", 'ipcRenderer.invoke("megle:shell-ready")']) {
  if (!preload.includes(value)) {
    fail(`preload bridge missing ${value}`);
  }
}

if (!desktopPackage.includes('"typecheck"')) {
  fail("desktop package missing typecheck script");
}
if (desktopPackage.includes("vite --host")) {
  fail("desktop package dev script must not start Vite directly; use root dev runner");
}
if (!rootPackage.includes('"check:desktop"')) {
  fail("root package missing check:desktop script");
}
if (!rootPackage.includes('"dev"')) {
  fail("root package missing dev script");
}

for (const value of ["@megle/web", "@megle/desktop", "MEGLE_WEB_URL", "MEGLE_DB_PATH", "electron"]) {
  if (!devRunner.includes(value)) {
    fail(`dev runner missing ${value}`);
  }
}
for (const value of ["--port", "5173", "--strictPort"]) {
  if (!devRunner.includes(value)) {
    fail(`dev runner must start Vite with explicit ${value}`);
  }
}

const startCoreCalls = [...main.matchAll(/\bstartCoreProcess\(/g)].length;
if (startCoreCalls !== 1) {
  fail(`desktop main must start Core exactly once per app lifecycle; found ${startCoreCalls} calls`);
}
if (!main.includes("ensureCoreReady")) {
  fail("desktop main must centralize Core startup outside createWindow");
}
if (!main.includes("coreReadyPromise")) {
  fail("desktop main must coalesce concurrent Core startup with coreReadyPromise");
}
if (!main.includes("pendingCoreProcess")) {
  fail("desktop main must track pending Core process for app quit cleanup");
}
if (!main.includes("waitForCoreHealth(session.baseUrl, session.sessionToken")) {
  fail("desktop main must pass session token to health wait");
}
const ensureCoreReadyBody = functionBody(main, "async function ensureCoreReady(): Promise<CoreSession>");
const startCoreSessionBody = functionBody(main, "async function startCoreSession(): Promise<CoreSession>");
if (!ensureCoreReadyBody) {
  fail("desktop main must keep ensureCoreReady as an async CoreSession function");
} else {
  if (!ensureCoreReadyBody.includes("return coreReadyPromise")) {
    fail("desktop main must return shared Core startup promise to concurrent callers");
  }
}
if (!startCoreSessionBody) {
  fail("desktop main must isolate Core startup in startCoreSession");
} else {
  if (startCoreSessionBody.includes("coreSession = await createCoreSession")) {
    fail("desktop main must not cache coreSession before Core health succeeds");
  }
  const healthIndex = startCoreSessionBody.indexOf("await waitForCoreHealth");
  const sessionPublishIndex = startCoreSessionBody.indexOf("coreSession = session");
  if (healthIndex === -1 || sessionPublishIndex === -1 || sessionPublishIndex < healthIndex) {
    fail("desktop main must publish coreSession only after Core health succeeds");
  }
  const processPublishIndex = startCoreSessionBody.indexOf("coreProcess = pendingProcess");
  if (healthIndex === -1 || processPublishIndex === -1 || processPublishIndex < healthIndex) {
    fail("desktop main must publish coreProcess only after Core health succeeds");
  }
  if (!startCoreSessionBody.includes("catch") || !startCoreSessionBody.includes("coreReadyPromise = null")) {
    fail("desktop main must clear pending Core startup state on failure");
  }
  if (!startCoreSessionBody.includes("pendingProcess?.stop()")) {
    fail("desktop main must stop spawned Core process on startup failure");
  }
  if (!startCoreSessionBody.includes("pendingCoreProcess = pendingProcess")) {
    fail("desktop main must publish pending Core process for quit cleanup during startup");
  }
  if (!startCoreSessionBody.includes("pendingCoreProcess = null")) {
    fail("desktop main must clear pending Core process after startup settles");
  }
}
const beforeQuitBody = functionBody(main, 'app.on("before-quit", (event) =>');
if (!beforeQuitBody) {
  fail("desktop main must handle before-quit cleanup");
} else if (!beforeQuitBody.includes("pendingCoreProcess?.stop()")) {
  fail("desktop main must stop pending Core process on before-quit");
}

if (!process.exitCode) {
  console.log("PASS: desktop core orchestration boundaries");
}
