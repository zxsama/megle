PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS tasks_new;

BEGIN IMMEDIATE;

CREATE TABLE tasks_new (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('root_scan', 'thumbnail')),
  priority INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  root_id INTEGER REFERENCES roots(id) ON DELETE SET NULL,
  file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  items_seen INTEGER NOT NULL DEFAULT 0,
  items_total INTEGER,
  folders_seen INTEGER NOT NULL DEFAULT 0,
  media_files_seen INTEGER NOT NULL DEFAULT 0,
  skipped_files INTEGER NOT NULL DEFAULT 0,
  thumbnail_source_fingerprint TEXT,
  error TEXT
);

INSERT INTO tasks_new(
  id,
  kind,
  priority,
  status,
  root_id,
  file_id,
  created_at,
  updated_at,
  items_seen,
  items_total,
  folders_seen,
  media_files_seen,
  skipped_files,
  thumbnail_source_fingerprint,
  error
)
SELECT
  id,
  CASE
    WHEN kind IN ('root_scan', 'thumbnail') THEN kind
    ELSE 'root_scan'
  END,
  priority,
  CASE
    WHEN status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled') THEN status
    ELSE 'failed'
  END,
  root_id,
  file_id,
  created_at,
  updated_at,
  items_seen,
  items_total,
  folders_seen,
  media_files_seen,
  skipped_files,
  thumbnail_source_fingerprint,
  error
FROM tasks;

DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;

CREATE INDEX IF NOT EXISTS idx_tasks_status_priority ON tasks(status, priority, created_at);

CREATE TEMP TABLE task_status_contract_fk_check(count INTEGER CHECK(count = 0));
INSERT INTO task_status_contract_fk_check
SELECT COUNT(*) FROM pragma_foreign_key_check;
DROP TABLE task_status_contract_fk_check;

INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
VALUES (7, 'task_status_contract', unixepoch());

COMMIT;

PRAGMA foreign_keys = ON;
