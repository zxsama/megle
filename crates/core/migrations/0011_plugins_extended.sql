ALTER TABLE plugins ADD COLUMN description TEXT;
ALTER TABLE plugins ADD COLUMN status TEXT NOT NULL DEFAULT 'registered';
ALTER TABLE plugins ADD COLUMN capabilities_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE plugins ADD COLUMN permissions_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE plugins ADD COLUMN last_error TEXT;

CREATE INDEX IF NOT EXISTS idx_plugins_status ON plugins(status, updated_at);

INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
VALUES (11, 'plugins_extended', unixepoch());
