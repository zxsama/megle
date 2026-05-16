# Contract Tests

Future contract tests should validate:

- `contracts/core-api/openapi.yaml` matches Core routes and generated TypeScript client.
- `contracts/plugins/manifest.schema.json` accepts valid internal manifests and rejects invalid permissions/capabilities.
- SQLite migrations preserve existing data across versions.

Rust-specific gates are skipped until the Rust toolchain is installed.
