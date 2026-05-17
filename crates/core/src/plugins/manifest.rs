use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::PluginCapability;

/// Maximum length of a plugin id, in bytes. Phase 8 plugin ids are short
/// reverse-domain-style identifiers and we never expect them to exceed this
/// many characters in practice.
pub const MAX_PLUGIN_ID_LEN: usize = 128;

/// Parsed and validated plugin manifest, plus the raw JSON for downstream use.
#[derive(Debug, Clone)]
pub struct ManifestRecord {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub capabilities: Vec<PluginCapability>,
    pub permissions: Vec<String>,
    pub manifest_path: PathBuf,
    #[allow(dead_code)]
    pub raw: Value,
}

/// Errors produced while reading or validating a plugin manifest.
#[derive(Debug)]
pub enum ManifestError {
    Io(std::io::Error),
    Json(serde_json::Error),
    MissingField(String),
    InvalidId,
    InvalidCapability(String),
}

impl fmt::Display for ManifestError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ManifestError::Io(error) => write!(f, "failed to read plugin manifest: {error}"),
            ManifestError::Json(error) => write!(f, "plugin manifest is not valid JSON: {error}"),
            ManifestError::MissingField(field) => {
                write!(f, "plugin manifest is missing required field '{field}'")
            }
            ManifestError::InvalidId => write!(
                f,
                "plugin manifest 'id' must be a non-empty ASCII identifier with no path separators"
            ),
            ManifestError::InvalidCapability(value) => {
                write!(f, "plugin manifest contains invalid capability '{value}'")
            }
        }
    }
}

impl std::error::Error for ManifestError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            ManifestError::Io(error) => Some(error),
            ManifestError::Json(error) => Some(error),
            _ => None,
        }
    }
}

impl From<std::io::Error> for ManifestError {
    fn from(error: std::io::Error) -> Self {
        ManifestError::Io(error)
    }
}

impl From<serde_json::Error> for ManifestError {
    fn from(error: serde_json::Error) -> Self {
        ManifestError::Json(error)
    }
}

/// Parse a `plugin.json` file at the given path, validating the Phase 8
/// subset of `contracts/plugins/manifest.schema.json`.
pub fn parse_manifest(path: &Path) -> Result<ManifestRecord, ManifestError> {
    let bytes = fs::read(path)?;
    let raw: Value = serde_json::from_slice(&bytes)?;

    let id = required_string(&raw, "id")?;
    if !is_valid_plugin_id(&id) {
        return Err(ManifestError::InvalidId);
    }

    let name = required_string(&raw, "name")?;
    if name.is_empty() {
        return Err(ManifestError::MissingField("name".to_string()));
    }

    let version = required_string(&raw, "version")?;
    if version.is_empty() {
        return Err(ManifestError::MissingField("version".to_string()));
    }

    let description = optional_string(&raw, "description");

    let capabilities_value = raw
        .get("capabilities")
        .ok_or_else(|| ManifestError::MissingField("capabilities".to_string()))?;
    let capabilities_array = capabilities_value
        .as_array()
        .ok_or_else(|| ManifestError::MissingField("capabilities".to_string()))?;
    let mut capabilities = Vec::with_capacity(capabilities_array.len());
    for entry in capabilities_array {
        let value = entry
            .as_str()
            .ok_or_else(|| ManifestError::InvalidCapability(entry.to_string()))?;
        let capability = PluginCapability::from_str(value)
            .ok_or_else(|| ManifestError::InvalidCapability(value.to_string()))?;
        capabilities.push(capability);
    }

    let permissions = match raw.get("permissions") {
        None => Vec::new(),
        Some(value) => {
            let array = value
                .as_array()
                .ok_or_else(|| ManifestError::MissingField("permissions".to_string()))?;
            let mut permissions = Vec::with_capacity(array.len());
            for entry in array {
                let value = entry
                    .as_str()
                    .ok_or_else(|| ManifestError::MissingField("permissions".to_string()))?;
                permissions.push(value.to_string());
            }
            permissions
        }
    };

    Ok(ManifestRecord {
        id,
        name,
        version,
        description,
        capabilities,
        permissions,
        manifest_path: path.to_path_buf(),
        raw,
    })
}

fn required_string(value: &Value, field: &str) -> Result<String, ManifestError> {
    let entry = value
        .get(field)
        .ok_or_else(|| ManifestError::MissingField(field.to_string()))?;
    let text = entry
        .as_str()
        .ok_or_else(|| ManifestError::MissingField(field.to_string()))?;
    Ok(text.to_string())
}

fn optional_string(value: &Value, field: &str) -> Option<String> {
    match value.get(field) {
        Some(Value::String(text)) => Some(text.clone()),
        _ => None,
    }
}

fn is_valid_plugin_id(value: &str) -> bool {
    if value.is_empty() || value.len() > MAX_PLUGIN_ID_LEN {
        return false;
    }
    if value.contains("..") {
        return false;
    }
    for byte in value.bytes() {
        match byte {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'.' | b'-' | b'_' => {}
            _ => return false,
        }
    }
    // Reject leading/trailing separators that would also break filesystem paths.
    let first = value.as_bytes()[0];
    let last = value.as_bytes()[value.len() - 1];
    if matches!(first, b'.' | b'-' | b'_') || matches!(last, b'.' | b'-' | b'_') {
        return false;
    }
    true
}
