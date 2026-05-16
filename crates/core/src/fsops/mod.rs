#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileOperationKind {
    Rename,
    Move,
    DeleteToRecycleBin,
}

#[allow(dead_code)]
pub const FILE_OPERATION_VALUES: &[&str] = &["rename", "move", "delete_to_recycle_bin"];
