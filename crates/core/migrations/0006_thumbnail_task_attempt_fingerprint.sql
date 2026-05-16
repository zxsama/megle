ALTER TABLE tasks ADD COLUMN thumbnail_source_fingerprint TEXT;

INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
VALUES (6, 'thumbnail_task_attempt_fingerprint', unixepoch());
