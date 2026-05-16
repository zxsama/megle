# Thumbnail Pipeline Benchmark

Date: 2026-05-16

## Purpose

Validate the first image/video thumbnail pipeline:

- image thumbnails through `sharp/libvips`
- video poster frames through `ffmpeg`
- `grid` thumbnail target shortest side: `320px`
- skip standalone thumbnail generation when source shortest side is below `320px`
- generated thumbnail cache format: `WebP`

This benchmark uses synthetic images/videos. It measures pipeline direction and queue behavior, not final production throughput.

## Sample Set

Images:

- Total: `152`
- Source size: `116.04 MB`
- Groups:
  - `24` small JPG: `240x180`
  - `16` exact-ish JPG: `480x320`
  - `48` medium JPG: `1920x1080`
  - `24` large JPG: `4000x3000`
  - `24` portrait JPG: `1080x1920`
  - `16` PNG: `1200x900`

Videos:

- Total: `12`
- Source size: `9.19 MB`
- Groups:
  - `8` x 720p MP4
  - `4` x 1080p MP4

## Image Thumbnail Policy

Rule:

```text
if min(width, height) < 320:
  skip generated grid thumbnail
else:
  resize with shortest side = 320
  output WebP quality 78
```

The resize mode is equivalent to `fit=outside`, preserving aspect ratio and ensuring the shortest side is at least `320px`.

## Thumbnail Format Decision

Use WebP as the unified generated thumbnail cache format:

```text
*.webp
MIME: image/webp
```

Applies to:

- image `grid` thumbnails
- future `tiny`, `retina`, and `preview` cache profiles
- video poster thumbnails
- decoder plugin thumbnail outputs

Exception:

- If the source short side is below `320px` and the source format is directly displayable by the UI, mark thumbnail state as `skipped_small` and use the source file.
- If the source format is not directly displayable, still generate a WebP thumbnail even if the image is small.

Format benchmark on the 128 eligible images:

| Format | Output MB | Avg KB | Images/sec | p50 | p95 | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| JPEG | `1.744` | `13.949` | `281.654/s` | `14.111 ms` | `20.773 ms` | Fast, but no alpha and 2.86x WebP size |
| WebP | `0.610` | `4.879` | `221.199/s` | `16.490 ms` | `25.842 ms` | Best balance; supports alpha |
| AVIF | `0.368` | `2.948` | `99.784/s` | `36.528 ms` | `64.897 ms` | Smaller, but much slower to encode |
| PNG | `52.261` | `418.088` | `284.143/s` | `12.614 ms` | `21.761 ms` | Unacceptable size for photo thumbnails |

Decision:

- Use WebP lossy quality around `78` for generated thumbnails.
- Keep AVIF as a possible future cold-cache option only if disk pressure becomes more important than encode latency.
- Do not use PNG for general thumbnails.
- Do not use JPEG as the default because transparent design assets are common and JPEG would require flattening.

## Image Results

| Concurrency | Total | Generated | Skipped | Total Time | Generated/sec | Generated p50 | Generated p95 | Generated p99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `4` | `152` | `128` | `24` | `685.294 ms` | `186.781/s` | `19.511 ms` | `28.280 ms` | `29.007 ms` |
| `8` | `152` | `128` | `24` | `614.490 ms` | `208.303/s` | `38.800 ms` | `62.372 ms` | `74.932 ms` |
| `16` | `152` | `128` | `24` | `706.718 ms` | `181.119/s` | `82.058 ms` | `140.421 ms` | `169.922 ms` |

Small-image skip at concurrency 8:

| Metric | Value |
| --- | ---: |
| Skipped small images | `24` |
| Skip p50 | `1.468 ms` |
| Skip p95 | `2.684 ms` |
| Skip p99 | `3.167 ms` |

Concurrency 8 group latency:

| Group | Count | Generated | Source MB | Output MB | p50 | p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| small | `24` | `0` | `0.25` | `0.00` | `1.468 ms` | `2.684 ms` |
| exactish | `16` | `16` | `0.51` | `0.30` | `31.734 ms` | `46.908 ms` |
| medium | `48` | `48` | `18.87` | `0.15` | `32.352 ms` | `50.017 ms` |
| large | `24` | `24` | `53.01` | `0.05` | `52.153 ms` | `74.932 ms` |
| portrait | `24` | `24` | `9.43` | `0.07` | `29.711 ms` | `44.639 ms` |
| png | `16` | `16` | `33.96` | `0.04` | `42.859 ms` | `62.372 ms` |

## Image Decision

- `sharp/libvips` is viable for the image thumbnail path.
- `320px` shortest-side grid thumbnails are cheap enough for background generation.
- Skipping source images with short side below `320px` is worthwhile and very cheap to detect.
- Default background image worker concurrency should start around `4`.
- A higher concurrency such as `8` can be used for bulk background fill on strong machines, but it increases per-task latency.
- `16` concurrency is counterproductive in this test.

## Video Poster Results

FFmpeg extracts one poster frame at `00:00:00.500`, scales shortest side to `320px`, and outputs WebP by default.

JPEG vs WebP at concurrency 2:

| Format | Total Time | Videos/sec | Output MB | p50 | p95 | p99 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| WebP | `731.849 ms` | `16.397/s` | `0.09` | `111.032 ms` | `132.723 ms` | `141.482 ms` |
| JPEG | `730.219 ms` | `16.433/s` | `0.19` | `110.156 ms` | `132.589 ms` | `139.790 ms` |

WebP roughly halves poster size with no meaningful speed penalty on this sample.

Earlier JPEG poster concurrency comparison:

| Concurrency | Videos | Total Time | Videos/sec | p50 | p95 | p99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `1` | `12` | `1084.277 ms` | `11.067/s` | `89.763 ms` | `120.287 ms` | `135.718 ms` |
| `2` | `12` | `757.476 ms` | `15.842/s` | `118.143 ms` | `180.586 ms` | `183.088 ms` |
| `4` | `12` | `556.894 ms` | `21.548/s` | `153.629 ms` | `200.863 ms` | `245.293 ms` |
| `8` | `12` | `438.435 ms` | `27.370/s` | `222.785 ms` | `276.911 ms` | `285.480 ms` |

## Video Decision

- FFmpeg poster extraction is viable but much heavier than image thumbnailing.
- Interactive video poster generation should use concurrency `1` or `2`.
- Bulk background video poster generation can use higher concurrency, but must be lower priority than visible image thumbnails.
- Video jobs must have timeouts and cancellation.

## Queue Rules

Recommended first implementation:

1. Current preview item.
2. Current viewport image thumbnails.
3. Selected item neighbors.
4. Current viewport video posters.
5. Opened folder background image fill.
6. Background video poster fill.
7. Whole-library low-priority fill.

Concurrency defaults:

- Interactive image thumbnails: `2-4`
- Background image thumbnails: `4`, optionally adaptive up to `8`
- Interactive video posters: `1`
- Background video posters: `1-2`, optionally adaptive up to `4`

## Caveats

- Synthetic media is not a replacement for real camera/photo/video samples.
- This uses `sharp` as the libvips benchmark path in Node. Final Core may use Rust bindings or a sidecar, but the libvips behavior is the relevant signal.
- Output cache was plain files; thumbnail-pack storage was not tested.
- HEIC, RAW, PSD, AVIF, GIF animation, and corrupt-file behavior were not tested yet.

## Artifacts

- Sample generator: `tools/bench/thumbnail/generate_samples.py`
- Image benchmark: `tools/bench/thumbnail/image_thumb_bench.mjs`
- Video benchmark: `tools/bench/thumbnail/video_poster_bench.mjs`
- Archived raw results: `docs/performance-results/raw/2026-05-16/thumbnail/`
- Generated media samples, thumbnail outputs, and `node_modules/` were deleted after documentation.

## Sources

- MDN image format guide: https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Image_types
- Sharp output format docs: https://sharp.pixelplumbing.com/api-output/
- FFmpeg documentation: https://ffmpeg.org/documentation.html
