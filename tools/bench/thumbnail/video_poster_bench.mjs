import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { performance } from "node:perf_hooks";
import os from "node:os";

const root = process.cwd();
const sampleDir = path.join(root, "results", "thumbnail-samples", "videos");
const outDir = path.join(root, "results", "thumbnail-output", "videos");
const targetMinSide = Number(process.env.TARGET_MIN_SIDE ?? "320");
const concurrency = Number(process.env.CONCURRENCY ?? Math.min(4, os.cpus().length));
const posterFormat = process.env.POSTER_FORMAT ?? "webp";
const reportPath = path.join(root, "results", `thumbnail_video_bench_${posterFormat}_c${concurrency}.json`);

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.round((sorted.length - 1) * p));
  return sorted[idx];
}

function summarize(values) {
  if (!values.length) return { count: 0 };
  return {
    count: values.length,
    minMs: Math.round(Math.min(...values) * 1000) / 1000,
    p50Ms: Math.round(percentile(values, 0.5) * 1000) / 1000,
    p95Ms: Math.round(percentile(values, 0.95) * 1000) / 1000,
    p99Ms: Math.round(percentile(values, 0.99) * 1000) / 1000,
    maxMs: Math.round(Math.max(...values) * 1000) / 1000
  };
}

async function listVideos(dir) {
  const entries = await readdir(dir);
  return entries
    .filter((name) => /\.(mp4|mov|mkv)$/i.test(name))
    .map((name) => path.join(dir, name));
}

function formatArgs(format) {
  if (format === "webp") {
    return ["-c:v", "libwebp", "-lossless", "0", "-quality", "78"];
  }
  if (format === "jpg" || format === "jpeg") {
    return ["-q:v", "3"];
  }
  if (format === "png") {
    return ["-compression_level", "6"];
  }
  throw new Error(`unsupported poster format: ${format}`);
}

function outputExt(format) {
  if (format === "jpeg") return "jpg";
  return format;
}

function runFfmpeg(input, output) {
  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      "00:00:00.500",
      "-i",
      input,
      "-frames:v",
      "1",
      "-vf",
      `scale='if(lt(iw,ih),${targetMinSide},-2)':'if(lt(iw,ih),-2,${targetMinSide})'`,
      ...formatArgs(posterFormat),
      output
    ];
    const child = spawn("ffmpeg", args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}`));
    });
  });
}

async function processVideo(file) {
  const started = performance.now();
  const output = path.join(outDir, path.basename(file).replace(/\.[^.]+$/, `.${outputExt(posterFormat)}`));
  await runFfmpeg(file, output);
  const source = await stat(file);
  const poster = await stat(output);
  return {
    file,
    sourceBytes: source.size,
    outputBytes: poster.size,
    ms: performance.now() - started
  };
}

async function worker(files, results) {
  while (files.length) {
    const file = files.shift();
    if (!file) return;
    results.push(await processVideo(file));
  }
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const files = await listVideos(sampleDir);
  const queue = [...files];
  const results = [];
  const start = performance.now();
  await Promise.all(Array.from({ length: concurrency }, () => worker(queue, results)));
  const totalMs = performance.now() - start;
  const report = {
    engine: "ffmpeg",
    posterFormat,
    targetMinSide,
    concurrency,
    totalVideos: results.length,
    totalMs: Math.round(totalMs * 1000) / 1000,
    videosPerSecond: results.length ? Math.round((results.length / totalMs) * 1000000) / 1000 : 0,
    sourceMB: Math.round((results.reduce((sum, item) => sum + item.sourceBytes, 0) / 1024 / 1024) * 100) / 100,
    outputMB: Math.round((results.reduce((sum, item) => sum + item.outputBytes, 0) / 1024 / 1024) * 100) / 100,
    latency: summarize(results.map((item) => item.ms)),
    samples: results.slice(0, 8)
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
