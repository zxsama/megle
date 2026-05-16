import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import os from "node:os";
import sharp from "sharp";

const root = process.cwd();
const sampleDir = path.join(root, "results", "thumbnail-samples", "images");
const outDir = path.join(root, "results", "thumbnail-output", "images");
const targetMinSide = Number(process.env.TARGET_MIN_SIDE ?? "320");
const concurrency = Number(process.env.CONCURRENCY ?? Math.min(8, os.cpus().length));
const reportPath = path.join(root, "results", `thumbnail_image_bench_c${concurrency}.json`);

sharp.concurrency(concurrency);
sharp.cache(false);

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

function groupName(file) {
  return path.basename(file).replace(/_\d+\.[^.]+$/, "");
}

async function listImages(dir) {
  const entries = await readdir(dir);
  return entries
    .filter((name) => /\.(jpe?g|png|webp)$/i.test(name))
    .map((name) => path.join(dir, name));
}

async function processImage(file) {
  const started = performance.now();
  const metadata = await sharp(file, { limitInputPixels: false }).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const minSide = Math.min(width, height);
  const source = await stat(file);

  if (minSide < targetMinSide) {
    return {
      file,
      skipped: true,
      reason: "short-side-below-target",
      width,
      height,
      sourceBytes: source.size,
      outputBytes: 0,
      ms: performance.now() - started
    };
  }

  const relative = path.basename(file).replace(/\.[^.]+$/, ".webp");
  const output = path.join(outDir, relative);
  const buffer = await sharp(file, { limitInputPixels: false })
    .rotate()
    .resize(targetMinSide, targetMinSide, {
      fit: "outside",
      withoutEnlargement: true
    })
    .webp({ quality: 78, effort: 4 })
    .toBuffer();
  await writeFile(output, buffer);

  return {
    file,
    skipped: false,
    width,
    height,
    sourceBytes: source.size,
    outputBytes: buffer.length,
    ms: performance.now() - started
  };
}

async function worker(files, results) {
  while (files.length) {
    const file = files.shift();
    if (!file) return;
    results.push(await processImage(file));
  }
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const files = await listImages(sampleDir);
  const queue = [...files];
  const results = [];
  const start = performance.now();
  await Promise.all(Array.from({ length: concurrency }, () => worker(queue, results)));
  const totalMs = performance.now() - start;

  const generated = results.filter((item) => !item.skipped);
  const skipped = results.filter((item) => item.skipped);
  const generatedBytes = generated.reduce((sum, item) => sum + item.outputBytes, 0);
  const sourceBytes = results.reduce((sum, item) => sum + item.sourceBytes, 0);
  const groups = {};
  for (const item of results) {
    const group = groupName(item.file);
    groups[group] ??= [];
    groups[group].push(item);
  }
  const report = {
    engine: "sharp/libvips",
    targetMinSide,
    resize: "fit=outside, withoutEnlargement=true, output=webp quality 78",
    concurrency,
    totalImages: results.length,
    generated: generated.length,
    skippedSmall: skipped.length,
    totalMs: Math.round(totalMs * 1000) / 1000,
    imagesPerSecond: Math.round((results.length / totalMs) * 1000000) / 1000,
    generatedPerSecond: Math.round((generated.length / totalMs) * 1000000) / 1000,
    sourceMB: Math.round((sourceBytes / 1024 / 1024) * 100) / 100,
    outputMB: Math.round((generatedBytes / 1024 / 1024) * 100) / 100,
    allLatency: summarize(results.map((item) => item.ms)),
    generatedLatency: summarize(generated.map((item) => item.ms)),
    skippedLatency: summarize(skipped.map((item) => item.ms)),
    groups: Object.fromEntries(
      Object.entries(groups).map(([group, items]) => [
        group,
        {
          total: items.length,
          generated: items.filter((item) => !item.skipped).length,
          skipped: items.filter((item) => item.skipped).length,
          sourceMB: Math.round((items.reduce((sum, item) => sum + item.sourceBytes, 0) / 1024 / 1024) * 100) / 100,
          outputMB: Math.round((items.reduce((sum, item) => sum + item.outputBytes, 0) / 1024 / 1024) * 100) / 100,
          latency: summarize(items.map((item) => item.ms))
        }
      ])
    ),
    samples: results.slice(0, 8)
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
