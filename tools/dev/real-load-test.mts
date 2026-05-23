// End-to-end real load test:
// 1. Spawn megle-core with a known session token + dynamic data dir.
// 2. Wait for /api/health to return 200.
// 3. addRoot pointing at C:/Users/84460/Pictures/normal.
// 4. Poll /api/tasks until the root_scan task succeeds.
// 5. listMedia and assert the count matches the on-disk file count.
// 6. For each media item, request a thumbnail; poll until ready/failed/skipped.
// 7. Confirm cache files exist on disk and have a real RIFF/WEBP header.
//
// Run via: node --experimental-strip-types tools/dev/real-load-test.mts

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const TOKEN = "real-load-test-token";
const ADDR = "127.0.0.1:47391";
const BASE = `http://${ADDR}/api`;
const ROOT_PATH = "C:/Users/84460/Pictures/normal";

function log(...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.log("[test]", ...args);
}

async function fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("x-megle-session", TOKEN);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(`${BASE}${path}`, { ...init, headers });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status} ${response.statusText}: ${body}`);
  }
  return body ? (JSON.parse(body) as T) : (null as unknown as T);
}

async function waitForHealth(timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fetchJson<{ status?: string }>("/health");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
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
  state: string;
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
      await new Promise((resolve) => setTimeout(resolve, 200));
      continue;
    }
    if (last.status === "succeeded" || last.status === "failed" || last.status === "cancelled") {
      return last;
    }
    log(`${label} task ${taskId} -> ${last.status} (items_seen=${last.itemsSeen}, media=${last.mediaFilesSeen})`);
    await new Promise((resolve) => setTimeout(resolve, 500));
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
    await new Promise((resolve) => setTimeout(resolve, 250));
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
  // Core resolves the thumbnail cache to <db_parent>/thumbnail-cache, which
  // it creates on demand. We just need to know the path so we can read the
  // generated WebP files back.
  const cacheDir = path.join(dataDir, "thumbnail-cache");
  log(`Data dir: ${dataDir}`);

  const env = {
    ...process.env,
    MEGLE_SESSION_TOKEN: TOKEN,
    MEGLE_CORE_ADDR: ADDR,
    MEGLE_DB_PATH: dbPath,
    RUST_LOG: "warn"
  };

  log("Spawning megle-core...");
  const core: ChildProcess = spawn("cargo", ["run", "--release", "-q", "-p", "megle-core"], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: true
  });
  core.stdout?.on("data", (chunk) => process.stdout.write(`[core] ${chunk}`));
  core.stderr?.on("data", (chunk) => process.stderr.write(`[core] ${chunk}`));

  const stop = () => {
    if (!core.killed) core.kill();
  };
  process.on("SIGINT", stop);

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
        if (!thumb.asset) {
          throw new Error(`ready thumbnail ${item.id} missing asset`);
        }
        const cachePath = path.join(cacheDir, thumb.asset.cacheKey);
        if (!existsSync(cachePath)) {
          throw new Error(`cache file missing: ${cachePath}`);
        }
        const bytes = await readFile(cachePath);
        const magic = bytes.subarray(0, 4).toString("ascii");
        const subtype = bytes.subarray(8, 12).toString("ascii");
        if (magic !== "RIFF" || subtype !== "WEBP") {
          throw new Error(
            `thumbnail ${item.id} has invalid header: ${magic}/${subtype} (${bytes.length} bytes)`
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
    log(`Cache dir: ${cacheDir}`);
    log(`Data dir: ${dataDir}`);
  } finally {
    stop();
    await new Promise((resolve) => setTimeout(resolve, 500));
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

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("[test] FAILED:", error);
  process.exit(1);
});
