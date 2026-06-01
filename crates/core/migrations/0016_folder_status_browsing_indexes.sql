CREATE INDEX IF NOT EXISTS idx_files_folder_status_name_id ON files(folder_id, status, name ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_files_folder_status_name_id_desc ON files(folder_id, status, name DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_files_folder_status_mtime_id ON files(folder_id, status, mtime DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_files_folder_status_mtime_id_asc ON files(folder_id, status, mtime ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_folders_parent_status_id ON folders(parent_id, status, id);

INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
VALUES (16, 'folder_status_browsing_indexes', unixepoch());
