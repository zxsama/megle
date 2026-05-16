# Virtual Grid Benchmark

Date: 2026-05-16

## Purpose

Validate whether a React + TanStack Virtual grid can render and scroll million-scale media lists without creating excessive DOM nodes.

This benchmark uses synthetic tiles and does not load real thumbnails. It tests the frontend virtualization layer, not image decoding or network delivery.

## Stack

- React
- Vite
- TanStack Virtual
- Playwright Chromium
- Viewport: `1440x900`
- Tile: `132x160`
- Row height estimate: `176px`
- Overscan: `8`

## 1M Items Result

| Metric | Value |
| --- | ---: |
| Items | `1,000,000` |
| Columns | `8` |
| Rows | `125,000` |
| Duration | `5,014 ms` |
| FPS | `60.0` |
| Frame p50 | `16.7 ms` |
| Frame p95 | `16.7 ms` |
| Frame p99 | `16.8 ms` |
| Rendered rows | `22` |
| Rendered tiles | `176` |
| DOM scrollHeight | `22,000,000 px` |
| Virtual total size | `22,000,000 px` |

Result:

- 1M item grid can scroll at 60fps in the synthetic benchmark.
- DOM node count stays bounded.
- TanStack Virtual is a viable first implementation for folder/query views up to this size and tile geometry.

## 5M Items Result

| Metric | Value |
| --- | ---: |
| Items | `5,000,000` |
| Columns | `8` |
| Rows | `625,000` |
| Duration | `5,010 ms` |
| FPS | `60.1` |
| Frame p50 | `16.7 ms` |
| Frame p95 | `16.8 ms` |
| Frame p99 | `16.8 ms` |
| Rendered rows | `22` |
| Rendered tiles | `176` |
| DOM scrollHeight | `33,554,428 px` |
| Virtual total size | `110,000,000 px` |

## Critical Finding

Chromium caps or clamps very large DOM scroll heights. In this run:

- TanStack Virtual expected `110,000,000 px`.
- The actual DOM `scrollHeight` was `33,554,428 px`.

This means a single massive scroll container cannot reliably represent a 5M-item all-library view with the current tile size. The grid can render smoothly, but the browser scroll coordinate space becomes the limiting factor.

Estimated safe range with the current geometry:

```text
33,554,428 px / 176 px per row * 8 columns ≈ 1.5M items
```

The exact threshold changes with tile height and column count, but the product cannot assume one global scroll surface for all 5M items.

## Decision

Use TanStack Virtual for normal folder/query views, but do not build a single unsegmented "all 5M items" scroll surface.

Required design adjustment:

- Query and folder views must be segmented.
- Very large result sets need page windows or virtual chunks.
- The UI should show a logical position in the result set, not depend on one huge DOM scroll height.
- The Core API should continue using keyset pagination and support jumping by cursor/window.

Possible approaches:

1. Folder-first browsing.
   - Most user interactions occur in a real folder subtree, not all files at once.

2. Segmented result windows.
   - Keep a moving window of rows around the current logical position.
   - Rebase scroll position when crossing chunk boundaries.

3. Search result paging.
   - Treat massive search results as paged/chunked collections.
   - Provide fast filters and sort controls rather than a single endless wall.

4. Smaller row height for dense modes.
   - This raises the browser limit threshold but does not remove the underlying cap.

## Result

The virtual grid gate passes for 1M synthetic items.

The 5M run exposes a browser coordinate-space constraint, not a TanStack rendering failure. The architecture must include segmented browsing for very large all-library views.

## Artifacts

- Benchmark app: `tools/bench/virtual-grid`
- Archived 1M raw result: `docs/performance-results/raw/2026-05-16/virtual-grid/virtual_grid_1000000.json`
- Archived 5M raw result: `docs/performance-results/raw/2026-05-16/virtual-grid/virtual_grid_5000000.json`
- Generated result directory and `node_modules/` were deleted after documentation.
