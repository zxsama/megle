PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS thumbs_new;

BEGIN IMMEDIATE;

CREATE TABLE thumbs_new (
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  profile TEXT NOT NULL CHECK(profile IN ('grid_320')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending', 'queued', 'ready', 'failed', 'skipped_small')),
  cache_key TEXT,
  width INTEGER,
  height INTEGER,
  byte_size INTEGER,
  short_side_px INTEGER NOT NULL DEFAULT 320 CHECK(short_side_px = 320),
  output_format TEXT NOT NULL DEFAULT 'image/webp' CHECK(output_format = 'image/webp'),
  error TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(file_id, profile)
);

-- grid_320_explicit rows are inserted before remapped legacy grid rows.
INSERT OR IGNORE INTO thumbs_new(
  file_id,
  profile,
  state,
  cache_key,
  width,
  height,
  byte_size,
  short_side_px,
  output_format,
  error,
  updated_at
)
SELECT
  file_id,
  'grid_320',
  CASE
    WHEN state IN ('pending', 'queued', 'ready', 'failed', 'skipped_small') THEN state
    ELSE 'pending'
  END,
  CASE
    WHEN state = 'ready'
     AND cache_key IS NOT NULL
     AND cache_key NOT LIKE '/%'
     AND cache_key NOT LIKE '\%'
     AND cache_key NOT LIKE '%:%'
     AND cache_key NOT LIKE '%..%'
    THEN cache_key
    ELSE NULL
  END,
  CASE
    WHEN state = 'ready'
     AND cache_key IS NOT NULL
     AND cache_key NOT LIKE '/%'
     AND cache_key NOT LIKE '\%'
     AND cache_key NOT LIKE '%:%'
     AND cache_key NOT LIKE '%..%'
    THEN width
    ELSE NULL
  END,
  CASE
    WHEN state = 'ready'
     AND cache_key IS NOT NULL
     AND cache_key NOT LIKE '/%'
     AND cache_key NOT LIKE '\%'
     AND cache_key NOT LIKE '%:%'
     AND cache_key NOT LIKE '%..%'
    THEN height
    ELSE NULL
  END,
  CASE
    WHEN state = 'ready'
     AND cache_key IS NOT NULL
     AND cache_key NOT LIKE '/%'
     AND cache_key NOT LIKE '\%'
     AND cache_key NOT LIKE '%:%'
     AND cache_key NOT LIKE '%..%'
    THEN byte_size
    ELSE NULL
  END,
  320,
  'image/webp',
  NULL,
  updated_at
FROM thumbs
WHERE profile = 'grid_320';

INSERT OR IGNORE INTO thumbs_new(
  file_id,
  profile,
  state,
  cache_key,
  width,
  height,
  byte_size,
  short_side_px,
  output_format,
  error,
  updated_at
)
SELECT
  file_id,
  'grid_320',
  CASE
    WHEN state IN ('pending', 'queued', 'ready', 'failed', 'skipped_small') THEN state
    ELSE 'pending'
  END,
  CASE
    WHEN state = 'ready'
     AND cache_key IS NOT NULL
     AND cache_key NOT LIKE '/%'
     AND cache_key NOT LIKE '\%'
     AND cache_key NOT LIKE '%:%'
     AND cache_key NOT LIKE '%..%'
    THEN cache_key
    ELSE NULL
  END,
  CASE
    WHEN state = 'ready'
     AND cache_key IS NOT NULL
     AND cache_key NOT LIKE '/%'
     AND cache_key NOT LIKE '\%'
     AND cache_key NOT LIKE '%:%'
     AND cache_key NOT LIKE '%..%'
    THEN width
    ELSE NULL
  END,
  CASE
    WHEN state = 'ready'
     AND cache_key IS NOT NULL
     AND cache_key NOT LIKE '/%'
     AND cache_key NOT LIKE '\%'
     AND cache_key NOT LIKE '%:%'
     AND cache_key NOT LIKE '%..%'
    THEN height
    ELSE NULL
  END,
  CASE
    WHEN state = 'ready'
     AND cache_key IS NOT NULL
     AND cache_key NOT LIKE '/%'
     AND cache_key NOT LIKE '\%'
     AND cache_key NOT LIKE '%:%'
     AND cache_key NOT LIKE '%..%'
    THEN byte_size
    ELSE NULL
  END,
  320,
  'image/webp',
  NULL,
  updated_at
FROM thumbs
WHERE profile = 'grid';

DROP TABLE thumbs;
ALTER TABLE thumbs_new RENAME TO thumbs;

CREATE INDEX IF NOT EXISTS idx_thumbs_profile_state ON thumbs(profile, state);
CREATE INDEX IF NOT EXISTS idx_thumbs_state_updated ON thumbs(state, updated_at);

CREATE TEMP TABLE thumbnail_state_fk_check(count INTEGER CHECK(count = 0));
INSERT INTO thumbnail_state_fk_check
SELECT COUNT(*) FROM pragma_foreign_key_check;
DROP TABLE thumbnail_state_fk_check;

INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
VALUES (4, 'thumbnail_state', unixepoch());

COMMIT;

PRAGMA foreign_keys = ON;
