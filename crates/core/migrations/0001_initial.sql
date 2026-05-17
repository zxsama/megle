PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS roots (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_scan_at INTEGER,
  active_scan_generation INTEGER
);

CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY,
  root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  path_hash TEXT NOT NULL,
  mtime INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  scan_seen_at INTEGER,
  UNIQUE(root_id, parent_id, name)
);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY,
  root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
  folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ext TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  ctime INTEGER,
  file_key TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  scan_seen_at INTEGER,
  UNIQUE(folder_id, name)
);

CREATE TABLE IF NOT EXISTS media (
  file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  codec TEXT,
  orientation INTEGER,
  has_alpha INTEGER,
  dominant_color TEXT,
  phash TEXT,
  metadata_status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS user_metadata (
  file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  rating INTEGER,
  favorite INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT
);

CREATE TABLE IF NOT EXISTS file_tags (
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY(file_id, tag_id)
);

CREATE TABLE IF NOT EXISTS thumbs (
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

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('root_scan', 'thumbnail')),
  priority INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  root_id INTEGER REFERENCES roots(id) ON DELETE SET NULL,
  file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  error TEXT
);

CREATE TABLE IF NOT EXISTS file_operations (
  id INTEGER PRIMARY KEY,
  operation TEXT NOT NULL,
  source_path TEXT NOT NULL,
  target_path TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  finished_at INTEGER,
  error TEXT
);

CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  manifest_path TEXT NOT NULL,
  installed_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_folders_root_parent_name ON folders(root_id, parent_id, name);
CREATE INDEX IF NOT EXISTS idx_files_folder_name ON files(folder_id, name);
CREATE INDEX IF NOT EXISTS idx_files_folder_mtime_id ON files(folder_id, mtime DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_files_folder_mtime_id_asc ON files(folder_id, mtime ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_files_folder_name_id_desc ON files(folder_id, name DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_files_root_mtime_id ON files(root_id, mtime DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_files_root_mtime_id_asc ON files(root_id, mtime ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_files_root_name_id ON files(root_id, name ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_files_root_name_id_desc ON files(root_id, name DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_files_global_mtime_id ON files(mtime DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_files_global_mtime_id_asc ON files(mtime ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_files_global_name_id ON files(name ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_files_global_name_id_desc ON files(name DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_files_ext ON files(ext);
CREATE INDEX IF NOT EXISTS idx_media_kind_file ON media(kind, file_id);
CREATE INDEX IF NOT EXISTS idx_user_metadata_rating ON user_metadata(rating, file_id);
CREATE INDEX IF NOT EXISTS idx_user_metadata_favorite ON user_metadata(favorite, file_id);
CREATE INDEX IF NOT EXISTS idx_file_tags_tag_file ON file_tags(tag_id, file_id);
CREATE INDEX IF NOT EXISTS idx_thumbs_profile_state ON thumbs(profile, state);
CREATE INDEX IF NOT EXISTS idx_thumbs_state_updated ON thumbs(state, updated_at);
CREATE INDEX IF NOT EXISTS idx_tasks_status_priority ON tasks(status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_file_operations_status_created ON file_operations(status, created_at);

CREATE VIRTUAL TABLE IF NOT EXISTS media_fts USING fts5(
  name,
  note,
  tags,
  content='',
  contentless_delete=1
);

INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
VALUES (1, 'initial', unixepoch());
