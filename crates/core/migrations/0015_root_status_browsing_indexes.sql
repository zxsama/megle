CREATE INDEX IF NOT EXISTS idx_files_root_status_name_id ON files(root_id, status, name ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_files_root_status_name_id_desc ON files(root_id, status, name DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_files_root_status_mtime_id ON files(root_id, status, mtime DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_files_root_status_mtime_id_asc ON files(root_id, status, mtime ASC, id ASC);

INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
VALUES (15, 'root_status_browsing_indexes', unixepoch());
