import sqlite3
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "crates" / "core" / "migrations" / "0001_initial.sql"

REQUIRED_TABLES = {
    "schema_migrations",
    "roots",
    "folders",
    "files",
    "media",
    "user_metadata",
    "tags",
    "file_tags",
    "thumbs",
    "tasks",
    "file_operations",
    "plugins",
    "media_fts",
}

REQUIRED_INDEXES = {
    "idx_folders_root_parent_name",
    "idx_files_folder_name",
    "idx_files_folder_mtime_id",
    "idx_files_root_mtime_id",
    "idx_files_ext",
    "idx_media_kind_file",
    "idx_user_metadata_rating",
    "idx_user_metadata_favorite",
    "idx_file_tags_tag_file",
    "idx_thumbs_profile_state",
    "idx_tasks_status_priority",
    "idx_file_operations_status_created",
}


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    if not MIGRATION.exists():
        fail(f"missing migration: {MIGRATION}")

    with tempfile.TemporaryDirectory(prefix="megle_schema_") as temp_dir:
        db_path = Path(temp_dir) / "schema.sqlite"
        conn = sqlite3.connect(db_path)
        try:
            conn.executescript(MIGRATION.read_text(encoding="utf-8"))
            conn.execute("PRAGMA foreign_keys = ON")

            tables = {
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_schema WHERE type IN ('table', 'virtual')"
                )
            }
            missing_tables = REQUIRED_TABLES - tables
            if missing_tables:
                fail(f"missing tables: {sorted(missing_tables)}")

            indexes = {
                row[0]
                for row in conn.execute("SELECT name FROM sqlite_schema WHERE type = 'index'")
                if row[0] is not None
            }
            missing_indexes = REQUIRED_INDEXES - indexes
            if missing_indexes:
                fail(f"missing indexes: {sorted(missing_indexes)}")

            version = conn.execute(
                "SELECT version FROM schema_migrations WHERE version = 1"
            ).fetchone()
            if version is None:
                fail("migration version 1 was not recorded")

            conn.execute(
                """
                INSERT INTO roots(path, display_name, enabled, created_at)
                VALUES (?, ?, 1, 1)
                """,
                ("D:/Pictures", "Pictures"),
            )
            root_id = conn.execute("SELECT id FROM roots").fetchone()[0]
            conn.execute(
                """
                INSERT INTO folders(root_id, parent_id, name, path_hash, mtime)
                VALUES (?, NULL, ?, ?, 1)
                """,
                (root_id, "", "root-hash"),
            )
            folder_id = conn.execute("SELECT id FROM folders").fetchone()[0]
            conn.execute(
                """
                INSERT INTO files(root_id, folder_id, name, ext, size, mtime)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (root_id, folder_id, "image.jpg", ".jpg", 1000, 10),
            )
            file_id = conn.execute("SELECT id FROM files").fetchone()[0]
            conn.execute(
                """
                INSERT INTO media(file_id, kind, width, height, metadata_status)
                VALUES (?, 'image', 640, 480, 'ready')
                """,
                (file_id,),
            )
            conn.execute(
                """
                INSERT INTO thumbs(file_id, profile, cache_key, width, height, byte_size, state, updated_at)
                VALUES (?, 'grid', 'aa/bb/key.webp', 427, 320, 4096, 'ready', 11)
                """,
                (file_id,),
            )
            page = conn.execute(
                """
                SELECT files.id, files.name
                FROM files
                JOIN media ON media.file_id = files.id
                WHERE files.folder_id = ? AND files.status = 'active'
                ORDER BY files.mtime DESC, files.id DESC
                LIMIT 200
                """,
                (folder_id,),
            ).fetchall()
            if page != [(file_id, "image.jpg")]:
                fail("paged media smoke query returned unexpected rows")
        finally:
            conn.close()

    print("PASS: sqlite schema")


if __name__ == "__main__":
    main()
