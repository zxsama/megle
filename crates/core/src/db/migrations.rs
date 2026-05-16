pub const INITIAL_MIGRATION: &str = include_str!("../../migrations/0001_initial.sql");
pub const TASK_PROGRESS_MIGRATION: &str = include_str!("../../migrations/0002_task_progress.sql");
pub const BROWSING_INDEXES_MIGRATION: &str =
    include_str!("../../migrations/0003_browsing_indexes.sql");
pub const THUMBNAIL_STATE_MIGRATION: &str =
    include_str!("../../migrations/0004_thumbnail_state.sql");
pub const THUMBNAIL_SOURCE_FINGERPRINT_MIGRATION: &str =
    include_str!("../../migrations/0005_thumbnail_source_fingerprint.sql");
pub const THUMBNAIL_TASK_ATTEMPT_FINGERPRINT_MIGRATION: &str =
    include_str!("../../migrations/0006_thumbnail_task_attempt_fingerprint.sql");
