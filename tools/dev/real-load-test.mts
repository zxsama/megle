// End-to-end real load test:
// 1. Spawn megle-core with a known session token + dynamic data dir.
// 2. Wait for /api/health to return 200.
// 3. addRoot pointing at C:/Users/84460/Pictures/normal.
// 4. Poll /api/tasks until the root_scan task succeeds.
// 5. listMedia and assert the count matches the on-disk file count.
// 6. For each media item, request a thumbnail; poll until ready/failed/skipped.
// 7. Confirm thumbnail state points at db_blob and blob endpoint returns WebP bytes.
//
// Run via: node --experimental-strip-types tools/dev/real-load-test.mts

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const TOKEN = "real-load-test-token";
const ADDR = "127.0.0.1:47391";
const BASE = `http://${ADDR}/api`;
const ROOT_PATH = "C:/Users/84460/Pictures/normal";
const closedChildren = new WeakSet<ChildProcess>();

function log(...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.log("[test]", ...args);
}

function isExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForClose(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (closedChildren.has(child)) {
    return true;
  }
  return new Promise<boolean>((resolve) => {
    const onClose = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    const timeout = setTimeout(() => {
      child.off("close", onClose);
      resolve(false);
    }, timeoutMs);
    child.once("close", onClose);
  });
}

async function runTaskkill(pid: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true
    });
    killer.once("error", () => resolve());
    killer.once("close", () => resolve());
  });
}

async function terminateProcessTree(child: ChildProcess, timeoutMs = 10_000): Promise<void> {
  if (isExited(child)) {
    await waitForClose(child, timeoutMs);
    return;
  }

  if (process.platform === "win32" && child.pid) {
    await runTaskkill(child.pid);
  } else if (child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  } else {
    child.kill("SIGTERM");
  }

  if (await waitForClose(child, timeoutMs)) {
    return;
  }

  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
    if (await waitForClose(child, timeoutMs)) {
      return;
    }
  }

  throw new Error(`process ${child.pid ?? "<unknown>"} did not exit after termination request`);
}

function spawnManaged(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): ChildProcess {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32"
  });
  child.once("close", () => {
    closedChildren.add(child);
  });
  return child;
}

async function runLifecycleSelfTest(): Promise<void> {
  const parentScript = [
    "const { spawn } = require('node:child_process');",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });",
    "console.log(`[lifecycle-parent] ${process.pid} child ${child.pid}`);",
    "setInterval(() => {}, 1000);"
  ].join(" ");
  const child = spawnManaged(process.execPath, ["-e", parentScript], {
    cwd: process.cwd(),
    env: process.env
  });
  child.stdout?.on("data", (chunk) => process.stdout.write(`[self-test] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[self-test] ${chunk}`));
  await delay(500);
  const startedAt = Date.now();
  await terminateProcessTree(child, 5_000);
  log(`Lifecycle self-test stopped process tree in ${Date.now() - startedAt}ms`);
}

async function fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetchResponse(path, init);
  const body = await response.text();
  return body ? (JSON.parse(body) as T) : (null as unknown as T);
}

async function fetchResponse(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("x-megle-session", TOKEN);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${path} -> ${response.status} ${response.statusText}: ${body}`);
  }
  return response;
}

async function fetchThumbnailBlob(fileId: number): Promise<{ bytes: Uint8Array; contentType: string | null; servedBy: string | null }> {
  const response = await fetchResponse(`/media/${fileId}/thumbnail/blob?target=grid_320`);
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get("content-type"),
    servedBy: response.headers.get("x-megle-served-by")
  };
}

async function waitForHealth(timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fetchJson<{ status?: string }>("/health");
      return;
    } catch {
      await delay(250);
    }
  }
  throw new Error("Core did not become healthy in time");
}

interface AcceptedRoot {
  accepted: boolean;
  taskId: number | null;
  rootId: number | null;
}

interface TaskRecord {
  id: number;
  kind: string;
  status: string;
  rootId: number | null;
  fileId: number | null;
  itemsSeen: number;
  mediaFilesSeen: number;
  error: string | null;
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

interface MediaRecord {
  id: number;
  name: string;
  ext: string;
  width: number | null;
  height: number | null;
  thumbnailState: string | null;
}

interface ThumbnailResponse {
  fileId: number;
  target: string;
  state: string;
  width: number | null;
  height: number | null;
  byteSize: number | null;
  servedBy: string | null;
  asset: { cacheKey: string; width: number; height: number; byteSize: number } | null;
  error: string | null;
}

async function pollTask(taskId: number, label: string, timeoutMs = 60_000): Promise<TaskRecord> {
  const start = Date.now();
  let last: TaskRecord | null = null;
  while (Date.now() - start < timeoutMs) {
    const tasks = await fetchJson<Page<TaskRecord>>("/tasks");
    last = tasks.items.find((task) => task.id === taskId) ?? null;
    if (!last) {
      await delay(200);
      continue;
    }
    if (last.status === "succeeded" || last.status === "failed" || last.status === "cancelled") {
      return last;
    }
    log(`${label} task ${taskId} -> ${last.status} (items_seen=${last.itemsSeen}, media=${last.mediaFilesSeen})`);
    await delay(500);
  }
  if (!last) {
    throw new Error(`task ${taskId} never appeared`);
  }
  throw new Error(`${label} task ${taskId} timed out in status ${last.status}`);
}

async function pollThumbnail(fileId: number, timeoutMs = 30_000): Promise<ThumbnailResponse> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const response = await fetchJson<ThumbnailResponse>(`/media/${fileId}/thumbnail?target=grid_320`);
    if (response.state === "ready" || response.state === "failed" || response.state === "skipped_small") {
      return response;
    }
    await delay(250);
  }
  throw new Error(`thumbnail ${fileId} never settled`);
}

async function main() {
  if (!existsSync(ROOT_PATH)) {
    throw new Error(`Test directory does not exist: ${ROOT_PATH}`);
  }
  const expectedFiles = (await readdir(ROOT_PATH)).filter((name) =>
    /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i.test(name)
  );
  log(`Source dir: ${ROOT_PATH} (${expectedFiles.length} image files)`);

  const dataDir = await mkdtemp(path.join(tmpdir(), "megle-real-load-"));
  const dbPath = path.join(dataDir, "megle.sqlite");
  log(`Data dir: ${dataDir}`);

  const env = {
    ...process.env,
    MEGLE_SESSION_TOKEN: TOKEN,
    MEGLE_CORE_ADDR: ADDR,
    MEGLE_DB_PATH: dbPath,
    RUST_LOG: "warn"
  };

  log("Spawning megle-core...");
  const core = spawnManaged("cargo", ["run", "--release", "-q", "-p", "megle-core"], {
    cwd: process.cwd(),
    env
  });
  core.stdout?.on("data", (chunk) => process.stdout.write(`[core] ${chunk}`));
  core.stderr?.on("data", (chunk) => process.stderr.write(`[core] ${chunk}`));

  let stopPromise: Promise<void> | null = null;
  const stop = () => {
    stopPromise ??= terminateProcessTree(core);
    return stopPromise;
  };
  const handleStopSignal = (signal: NodeJS.Signals) => {
    stop()
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error("[test] FAILED TO STOP CORE:", error);
      })
      .finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
  };
  process.once("SIGINT", handleStopSignal);
  process.once("SIGTERM", handleStopSignal);

  try {
    await waitForHealth();
    log("Core is healthy");

    log(`addRoot ${ROOT_PATH}`);
    const root = await fetchJson<AcceptedRoot>("/roots", {
      method: "POST",
      body: JSON.stringify({ path: ROOT_PATH })
    });
    if (!root.accepted || !root.taskId || !root.rootId) {
      throw new Error(`addRoot did not produce a scan task: ${JSON.stringify(root)}`);
    }
    log(`scan task ${root.taskId} queued for root ${root.rootId}`);

    const scanTask = await pollTask(root.taskId, "scan", 120_000);
    log(`scan finished: status=${scanTask.status} media=${scanTask.mediaFilesSeen} error=${scanTask.error ?? "none"}`);
    if (scanTask.status !== "succeeded") {
      throw new Error(`scan failed: ${scanTask.error}`);
    }

    log("listMedia");
    const media: MediaRecord[] = [];
    let cursor: string | undefined;
    do {
      const page: Page<MediaRecord> = await fetchJson(
        `/media?rootId=${root.rootId}&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`
      );
      media.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    log(`listMedia returned ${media.length} items`);

    if (media.length !== expectedFiles.length) {
      log(`WARN: expected ${expectedFiles.length} files, got ${media.length}`);
    }

    log("Requesting thumbnails for each media item...");
    let ready = 0;
    let skipped = 0;
    let failed = 0;
    for (const item of media) {
      const thumb = await pollThumbnail(item.id);
      if (thumb.state === "ready") {
        ready++;
        if (thumb.target !== "grid_320") {
          throw new Error(`ready thumbnail ${item.id} returned unexpected target: ${thumb.target}`);
        }
        if (thumb.servedBy !== "db_blob") {
          throw new Error(`ready thumbnail ${item.id} servedBy=${thumb.servedBy ?? "null"}`);
        }
        if (!thumb.width || !thumb.height || !thumb.byteSize) {
          throw new Error(`ready thumbnail ${item.id} missing dimensions or byte size`);
        }
        const blob = await fetchThumbnailBlob(item.id);
        if (blob.servedBy !== "db_blob") {
          throw new Error(`thumbnail blob ${item.id} servedBy=${blob.servedBy ?? "null"}`);
        }
        if (blob.contentType !== "image/webp") {
          throw new Error(`thumbnail blob ${item.id} content-type=${blob.contentType ?? "null"}`);
        }
        if (blob.bytes.length !== thumb.byteSize) {
          throw new Error(`thumbnail ${item.id} byte size mismatch: state=${thumb.byteSize} blob=${blob.bytes.length}`);
        }
        const magic = Buffer.from(blob.bytes.subarray(0, 4)).toString("ascii");
        const subtype = Buffer.from(blob.bytes.subarray(8, 12)).toString("ascii");
        if (magic !== "RIFF" || subtype !== "WEBP") {
          throw new Error(
            `thumbnail ${item.id} has invalid header: ${magic}/${subtype} (${blob.bytes.length} bytes)`
          );
        }
      } else if (thumb.state === "skipped_small") {
        skipped++;
      } else {
        failed++;
        log(`  ${item.name} -> failed: ${thumb.error}`);
      }
    }
    log(`Thumbnails: ready=${ready} skipped=${skipped} failed=${failed} of ${media.length}`);

    log("");
    log("=== SUCCESS ===");
    log(`Root scanned: ${ROOT_PATH}`);
    log(`Media indexed: ${media.length} (expected ${expectedFiles.length})`);
    log(`WebP thumbnails generated: ${ready}`);
    log(`Data dir: ${dataDir}`);
  } finally {
    process.off("SIGINT", handleStopSignal);
    process.off("SIGTERM", handleStopSignal);
    await stop();
    if (process.env.MEGLE_KEEP_DATA !== "1") {
      try {
        await rm(dataDir, { recursive: true, force: true });
        log(`Cleaned ${dataDir}`);
      } catch {
        // ignore
      }
    } else {
      log(`MEGLE_KEEP_DATA=1, keeping ${dataDir}`);
    }
  }
}

const entrypoint =
  process.env.MEGLE_REAL_LOAD_TEST_LIFECYCLE_SELF_TEST === "1" ? runLifecycleSelfTest : main;

entrypoint().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("[test] FAILED:", error);
  process.exit(1);
});
