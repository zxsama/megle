import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const webUrl = process.env.MEGLE_WEB_URL ?? "http://127.0.0.1:5173";
const parsedWebUrl = new URL(webUrl);
const webHost = parsedWebUrl.hostname;
const webPort = parsedWebUrl.port || (parsedWebUrl.protocol === "https:" ? "443" : "80");
const dataDir = path.join(root, ".data");
const dbPath = process.env.MEGLE_DB_PATH ?? path.join(dataDir, "megle-dev.sqlite");

fs.mkdirSync(dataDir, { recursive: true });

const children = new Set();

function spawnChild(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: {
      ...process.env,
      MEGLE_WEB_URL: webUrl,
      MEGLE_DB_PATH: dbPath
    },
    stdio: "inherit",
    shell: process.platform === "win32",
    windowsHide: true,
    ...options
  });
  children.add(child);
  child.on("exit", () => {
    children.delete(child);
  });
  return child;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function electronCommand() {
  const command = process.platform === "win32" ? "electron.cmd" : "electron";
  return path.join(root, "node_modules", ".bin", command);
}

async function waitForUrl(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}: ${String(lastError)}`);
}

function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(130);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(143);
});
process.on("exit", shutdown);

const web = spawnChild("npm", [
  "--workspace",
  "@megle/web",
  "run",
  "dev",
  "--",
  "--host",
  webHost,
  "--port",
  webPort,
  "--strictPort"
]);
await waitForUrl(webUrl);

run("npm", ["--workspace", "@megle/desktop", "run", "build"]);

const electronArgs = ["apps/desktop/dist/main.js"];
if (process.env.MEGLE_REMOTE_DEBUG === "1") {
  electronArgs.unshift("--remote-debugging-port=9222");
}
const electron = spawnChild(electronCommand(), electronArgs);
electron.on("exit", (code) => {
  shutdown();
  process.exit(code ?? 0);
});
