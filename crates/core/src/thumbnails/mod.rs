#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThumbnailProfile {
    Tiny,
    Grid,
    Retina,
    Preview,
}

#[allow(dead_code)]
pub const GRID_SHORT_SIDE_PX: u32 = 320;
#[allow(dead_code)]
pub const GENERATED_FORMAT: &str = "image/webp";
#[allow(dead_code)]
pub const THUMBNAIL_PROFILE_VALUES: &[&str] = &["tiny", "grid", "retina", "preview"];
