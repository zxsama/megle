-- The original media_fts virtual table was created as a vanilla contentless
-- FTS5 table (`content=''`). Contentless FTS5 tables forbid DELETE/UPDATE
-- statements, so we cannot keep the index in sync as user_metadata or
-- file_tags rows change. Recreate the table with `contentless_delete=1`,
-- which records a small per-rowid bookkeeping table so DELETE and UPDATE
-- against an explicit rowid succeed.

BEGIN IMMEDIATE;

DROP TABLE IF EXISTS media_fts;

CREATE VIRTUAL TABLE media_fts USING fts5(
  name,
  note,
  tags,
  content='',
  contentless_delete=1
);

INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
VALUES (10, 'media_fts_contentless_delete', unixepoch());

COMMIT;
