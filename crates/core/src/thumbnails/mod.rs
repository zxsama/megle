#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThumbnailProfile {
    Grid320,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThumbnailStatus {
    Pending,
    Queued,
    Ready,
    Failed,
    SkippedSmall,
}

pub const GRID_320_PROFILE: &str = "grid_320";
pub const GRID_320_SHORT_SIDE_PX: i64 = 320;
pub const GENERATED_FORMAT: &str = "image/webp";
#[allow(dead_code)]
pub const THUMBNAIL_PROFILE_VALUES: &[&str] = &[GRID_320_PROFILE];
#[allow(dead_code)]
pub const THUMBNAIL_STATUS_VALUES: &[&str] =
    &["pending", "queued", "ready", "failed", "skipped_small"];

pub fn normalize_profile(profile: Option<&str>) -> Option<&'static str> {
    match profile.unwrap_or(GRID_320_PROFILE) {
        GRID_320_PROFILE => Some(GRID_320_PROFILE),
        _ => None,
    }
}

pub fn is_pending_status(state: &str) -> bool {
    matches!(state, "pending" | "queued")
}
