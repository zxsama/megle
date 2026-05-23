-- media preview_placeholder columns are added by the migration runner with
-- table_info guards because SQLite has no ALTER TABLE ADD COLUMN IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS thumb_blobs (
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  profile TEXT NOT NULL DEFAULT 'grid_320' CHECK(profile = 'grid_320'),
  data BLOB NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  byte_size INTEGER NOT NULL,
  output_format TEXT NOT NULL DEFAULT 'image/webp' CHECK(output_format = 'image/webp'),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(file_id, profile)
);

CREATE INDEX IF NOT EXISTS idx_thumb_blobs_profile_updated_at
ON thumb_blobs(profile, updated_at);

INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
VALUES (12, 'preview_pipeline_refactor', unixepoch());
