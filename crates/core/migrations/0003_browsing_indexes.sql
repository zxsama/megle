CREATE INDEX IF NOT EXISTS idx_files_folder_mtime_id_asc ON files(folder_id, mtime ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_files_folder_name_id_desc ON files(folder_id, name DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_files_root_mtime_id_asc ON files(root_id, mtime ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_files_root_name_id ON files(root_id, name ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_files_root_name_id_desc ON files(root_id, name DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_files_global_mtime_id ON files(mtime DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_files_global_mtime_id_asc ON files(mtime ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_files_global_name_id ON files(name ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_files_global_name_id_desc ON files(name DESC, id DESC);

INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
VALUES (3, 'browsing_indexes', unixepoch());
