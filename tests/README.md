# Tests

This directory is reserved for correctness tests that should evolve with product code.

Current Phase 1 runnable checks live under `tools/checks` because they validate contracts and migrations before Rust and frontend dependencies are installed:

```text
npm test
```

Upcoming test areas:

- API contract compatibility
- SQLite query behavior
- root scan small-sample correctness
- thumbnail policy correctness
- file operation consistency
- segmented grid and preview state behavior
