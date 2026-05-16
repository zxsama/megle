# Contracts

This directory contains contracts shared across the Web UI, Electron desktop shell, Rust Core, tests, and future Web/Docker deployment.

- `core-api/openapi.yaml`: Core HTTP API surface.
- `plugins/manifest.schema.json`: plugin manifest and permission model.

Keep implementation details out of this directory. Contracts should describe stable boundaries, not internal queue or database code.
