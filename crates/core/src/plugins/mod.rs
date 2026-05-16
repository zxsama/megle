#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PluginCapability {
    Decoder,
    Metadata,
    Action,
    ImportProvider,
}

#[allow(dead_code)]
pub const PLUGIN_CAPABILITY_VALUES: &[&str] = &["decoder", "metadata", "action", "import-provider"];
