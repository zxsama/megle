# Apps

- `desktop`: Electron shell and Windows desktop adapter.
- `web`: React UI shared by desktop and future Web/Docker.

Apps call the Core API contract. They do not own indexing, thumbnails, database writes, or real file operations.
