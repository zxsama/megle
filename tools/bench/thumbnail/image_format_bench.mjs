import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import os from "node:os";
import sharp from "sharp";

const root = process.cwd();
const sampleDir = path.join(root, "results", "thumbnail-samples", "images");
const reportPath = path.join(root, "results", "thumbnail_format_bench.json");
const targetMinSide = Number(process.env.TARGET_MIN_SIDE ?? "320");
const concurrency = Number(process.env.CONCURRENCY ?? Math.min(4, os.cpus().length));

sharp.concurrency(concurrency);
sharp.cache(false);

const formats = [
  {
    name: "jpeg",
    ext: "jpg",
    mime: "image/jpeg",
    configure: (pipeline) => pipeline.jpeg({ quality: 82, progressive: false })
  },
  {
    name: "webp",
    ext: "webp",
    mime: "image/webp",
    configure: (pipeline) => pipeline.webp({ quality: 78, effort: 4 })
  },
  {
    name: "avif",
    ext: "avif",
    mime: "image/avif",
    configure: (pipeline) => pipeline.avif({ quality: 50, effort: 4 })
  },
  {
    name: "png",
    ext: "png",
    mime: "image/png",
    configure: (pipeline) => pipeline.png({ compressionLevel: 6, adaptiveFiltering: false })
  }
];

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

async function listImages(dir) {
  const entries = await readdir(dir);
  return entries
    .filter((name) => /\.(jpe?g|png|webp)$/i.test(name))
    .map((name) => path.join(dir, name));
}

async function eligibleImages(files) {
  const items = [];
  const skipped = [];
  for (const file of files) {
    const metadata = await sharp(file, { limitInputPixels: false }).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    const minSide = Math.min(width, height);
    const source = await stat(file);
    const item = {
      file,
      width,
      height,
      minSide,
      hasAlpha: Boolean(metadata.hasAlpha),
      sourceBytes: source.size
    };
    if (minSide < targetMinSide) skipped.push(item);
    else items.push(item);
  }
  return { items, skipped };
}

async function encodeOne(item, format) {
  const started = performance.now();
  let pipeline = sharp(item.file, { limitInputPixels: false })
    .rotate()
    .resize(targetMinSide, targetMinSide, {
      fit: "outside",
      withoutEnlargement: true
    });

  if (format.name === "jpeg" && item.hasAlpha) {
    pipeline = pipeline.flatten({ background: "#ffffff" });
  }

  const buffer = await format.configure(pipeline).toBuffer();
  return {
    file: item.file,
    sourceBytes: item.sourceBytes,
    outputBytes: buffer.length,
    ms: performance.now() - started
  };
}

async function worker(queue, results, format) {
  while (queue.length) {
    const item = queue.shift();
    if (!item) return;
    results.push(await encodeOne(item, format));
  }
}

async function runFormat(items, format) {
  const queue = [...items];
  const results = [];
  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, () => worker(queue, results, format)));
  const totalMs = performance.now() - started;
  const outputBytes = results.reduce((sum, item) => sum + item.outputBytes, 0);
  return {
    format: format.name,
    ext: format.ext,
    mime: format.mime,
    count: results.length,
    totalMs: Math.round(totalMs * 1000) / 1000,
    imagesPerSecond: Math.round((results.length / totalMs) * 1000000) / 1000,
    outputMB: Math.round((outputBytes / 1024 / 1024) * 1000) / 1000,
    avgOutputKB: Math.round((outputBytes / results.length / 1024) * 1000) / 1000,
    latency: summarize(results.map((item) => item.ms)),
    samples: results.slice(0, 5)
  };
}

async function main() {
  await mkdir(path.dirname(reportPath), { recursive: true });
  const files = await listImages(sampleDir);
  const { items, skipped } = await eligibleImages(files);
  const reports = [];
  for (const format of formats) {
    reports.push(await runFormat(items, format));
  }
  const webp = reports.find((item) => item.format === "webp");
  const report = {
    targetMinSide,
    concurrency,
    totalImages: files.length,
    eligible: items.length,
    skippedSmall: skipped.length,
    sourceMB: Math.round((items.reduce((sum, item) => sum + item.sourceBytes, 0) / 1024 / 1024) * 1000) / 1000,
    formats: reports.map((item) => ({
      ...item,
      sizeVsWebp: webp ? Math.round((item.outputMB / webp.outputMB) * 1000) / 1000 : null,
      throughputVsWebp: webp ? Math.round((item.imagesPerSecond / webp.imagesPerSecond) * 1000) / 1000 : null
    }))
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

