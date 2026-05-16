PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS thumbs_source_fingerprint_new;

BEGIN IMMEDIATE;

CREATE TABLE thumbs_source_fingerprint_new (
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  profile TEXT NOT NULL CHECK(profile IN ('grid_320')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending', 'queued', 'ready', 'failed', 'skipped_small')),
  cache_key TEXT,
  width INTEGER,
  height INTEGER,
  byte_size INTEGER,
  short_side_px INTEGER NOT NULL DEFAULT 320 CHECK(short_side_px = 320),
  output_format TEXT NOT NULL DEFAULT 'image/webp' CHECK(output_format = 'image/webp'),
  source_fingerprint TEXT,
  error TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(file_id, profile)
);

-- Existing terminal rows predate source fingerprinting and may point at invalid placeholder bytes
-- or stale metadata decisions.
INSERT INTO thumbs_source_fingerprint_new(
  file_id,
  profile,
  state,
  cache_key,
  width,
  height,
  byte_size,
  short_side_px,
  output_format,
  source_fingerprint,
  error,
  updated_at
)
SELECT
  file_id,
  profile,
  CASE WHEN state IN ('ready', 'skipped_small') THEN 'pending' ELSE state END,
  CASE WHEN state IN ('ready', 'skipped_small') THEN NULL ELSE cache_key END,
  CASE WHEN state IN ('ready', 'skipped_small') THEN NULL ELSE width END,
  CASE WHEN state IN ('ready', 'skipped_small') THEN NULL ELSE height END,
  CASE WHEN state IN ('ready', 'skipped_small') THEN NULL ELSE byte_size END,
  short_side_px,
  output_format,
  NULL,
  CASE WHEN state IN ('ready', 'skipped_small') THEN NULL ELSE error END,
  updated_at
FROM thumbs;

DROP TABLE thumbs;
ALTER TABLE thumbs_source_fingerprint_new RENAME TO thumbs;

CREATE INDEX IF NOT EXISTS idx_thumbs_profile_state ON thumbs(profile, state);
CREATE INDEX IF NOT EXISTS idx_thumbs_state_updated ON thumbs(state, updated_at);

CREATE TEMP TABLE thumbnail_source_fingerprint_fk_check(count INTEGER CHECK(count = 0));
INSERT INTO thumbnail_source_fingerprint_fk_check
SELECT COUNT(*) FROM pragma_foreign_key_check;
DROP TABLE thumbnail_source_fingerprint_fk_check;

INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
VALUES (5, 'thumbnail_source_fingerprint', unixepoch());

COMMIT;

PRAGMA foreign_keys = ON;
