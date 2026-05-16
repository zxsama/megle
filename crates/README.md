# Crates

Phase 1 keeps Rust implementation in `crates/core` with internal modules:

- `api`
- `db`
- `roots`
- `scan`
- `thumbnails`
- `fsops`
- `plugins`

Do not split these into separate crates until the app has an integrated scan/browse/thumbnail path and the boundaries are backed by tests.
