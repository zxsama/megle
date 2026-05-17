BEGIN IMMEDIATE;

ALTER TABLE tasks ADD COLUMN attempt_generation INTEGER NOT NULL DEFAULT 0;

INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
VALUES (8, 'task_attempt_generation', unixepoch());

COMMIT;
