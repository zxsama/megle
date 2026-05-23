ALTER TABLE thumbs
ADD COLUMN served_by TEXT CHECK(served_by IS NULL OR served_by IN ('db_blob'));

INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
VALUES (13, 'preview_served_by', unixepoch());
