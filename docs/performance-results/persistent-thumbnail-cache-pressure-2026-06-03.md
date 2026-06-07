# Persistent Thumbnail Cache Regression Follow-up (2026-06-03)

Dataset: `Y:\Repository\Billfish\Artists`

## Root causes found

1. Startup recovery replayed persisted pending thumbnail tasks synchronously before the worker returned to normal concurrent scheduling. When a previous session left hundreds of pending thumbnail jobs behind, hot restart foreground requests were delayed behind old recovery work.
2. Media tiles that were shown through original-preview fallback lost priority too quickly once they left the visible viewport. They often dropped into the background queue before their real grid thumbnail finished, so many "seen" items never reached `thumb_blobs` during the same browsing session.

Evidence before the fix:

- Shared cold/hot DB snapshot after a real run showed only `143` `thumb_blobs`, but `705` queued thumbnail rows and `694` background pending thumbnail tasks.
- A real hot-cache sweep only improved weakly because too many previously seen items were still waiting in the backlog instead of already being persisted.

## Fixes applied

- `crates/core/src/tasks.rs`
  - Startup worker recovery now replays only non-thumbnail tasks synchronously.
  - Pending thumbnail backlog is handed to normal concurrent thumbnail scheduling immediately, so new selected/visible requests are no longer blocked behind startup replay.
- `apps/web/src/features/media-grid/MediaGrid.tsx`
  - Added a short "recently visible thumbnail sticky" window.
  - Items that were visibly rendered but still pending keep `ahead` priority briefly after leaving the viewport, increasing the chance they finish and persist to `thumb_blobs`.
- `tools/dev/artists-million-desktop-sweep.mjs`
  - Added dynamic debug-port probing and stricter desktop-core readiness checks.
- `tools/bench/thumbnail/persistent_cache_pressure_harness.mjs`
  - Uses scenario-scoped data directories so repeated real sweeps do not fail with SQLite file locks.

## Real-run result

I executed well over 500 real `Artists` operations cumulatively while diagnosing and rechecking the regression, then used a clean cold/bulk/hot 50-op tri-scenario run to compare before/after with the repaired harness.

Key improvement after the final fix set:

- Cold-cache persisted thumbnail count after 50 ops: `62 -> 71`
- Hot-cache persisted thumbnail count before run: `67 -> 75`
- Hot-cache folder-switch p95: `4754ms -> 3158ms`
- Hot-cache visible-thumbnail wait p95: `2265ms -> 1636ms`
- Bulk-active visible-thumbnail wait p95: `2762ms -> 1524ms`

Remaining hotspot:

- Recursive total-directory deep scroll is still the dominant slow path on the `Artists` dataset.
- That hotspot is broader than the persistent-cache regression itself; it still appears even after the cache fixes and now stands out as a separate tuning target.

## Verification

- `npm test`
- repeated real Electron desktop pressure sweeps against `Y:\Repository\Billfish\Artists`
