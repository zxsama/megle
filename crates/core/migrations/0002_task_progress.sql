ALTER TABLE tasks ADD COLUMN items_seen INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN items_total INTEGER;
ALTER TABLE tasks ADD COLUMN folders_seen INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN media_files_seen INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN skipped_files INTEGER NOT NULL DEFAULT 0;

INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
VALUES (2, 'task_progress', unixepoch());
