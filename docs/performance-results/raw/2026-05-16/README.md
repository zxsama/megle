# Raw Performance Results

Date: 2026-05-16

This directory keeps the small raw JSON reports from Phase 0 benchmarks.

The large generated artifacts were intentionally deleted after documentation:

- SQLite databases under `bench-results/`
- generated filesystem trees under `tools/bench/fs-scan/results/`
- generated thumbnail samples and outputs under `tools/bench/thumbnail/results/`
- virtual grid and preview-switch result directories
- benchmark `node_modules/` directories
- preview-switch copied WebP assets under `tools/bench/preview-switch/public/thumbs/`

Those artifacts are reproducible from scripts under `tools/bench/`.

Archived groups:

- `sqlite/`: SQLite 1M/5M metadata, read/write concurrency, and paged API reports.
- `filesystem/`: filesystem scan and file operation consistency reports.
- `thumbnail/`: image thumbnail, thumbnail format, and video poster reports.
- `virtual-grid/`: TanStack Virtual grid reports.
- `preview-switch/`: cached WebP preview switching reports.

Note: some JSON files contain absolute paths to generated benchmark files that have now been deleted. The measured values and report payloads are preserved; the referenced generated media/database files are not.
