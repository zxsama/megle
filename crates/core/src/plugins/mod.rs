pub mod manifest;

use std::fs;
use std::path::{Path, PathBuf};

#[allow(unused_imports)]
pub use manifest::{parse_manifest, ManifestError, ManifestRecord};

use crate::db::{Database, PluginUpsert};

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

impl PluginCapability {
    pub fn as_str(self) -> &'static str {
        match self {
            PluginCapability::Decoder => "decoder",
            PluginCapability::Metadata => "metadata",
            PluginCapability::Action => "action",
            PluginCapability::ImportProvider => "import-provider",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "decoder" => Some(PluginCapability::Decoder),
            "metadata" => Some(PluginCapability::Metadata),
            "action" => Some(PluginCapability::Action),
            "import-provider" => Some(PluginCapability::ImportProvider),
            _ => None,
        }
    }
}

/// Failure entry returned from [`discover`] for a manifest that could not be parsed.
#[derive(Debug, Clone)]
pub struct DiscoveryErrorEntry {
    pub manifest_path: PathBuf,
    pub message: String,
}

/// Walk the first-level subfolders of `plugins_dir`, parsing each
/// `plugin.json` it finds. Returns successful manifests and per-manifest errors.
///
/// If `plugins_dir` itself is missing, this returns empty vectors. Other I/O
/// failures during the directory walk are surfaced as discovery errors with
/// `manifest_path` pointing at the offending entry.
pub fn discover(plugins_dir: &Path) -> (Vec<ManifestRecord>, Vec<DiscoveryErrorEntry>) {
    let mut records = Vec::new();
    let mut errors = Vec::new();

    let entries = match fs::read_dir(plugins_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return (records, errors);
        }
        Err(error) => {
            errors.push(DiscoveryErrorEntry {
                manifest_path: plugins_dir.to_path_buf(),
                message: format!("failed to read plugins directory: {error}"),
            });
            return (records, errors);
        }
    };

    let mut entries: Vec<_> = entries
        .filter_map(|entry| match entry {
            Ok(entry) => Some(entry),
            Err(error) => {
                errors.push(DiscoveryErrorEntry {
                    manifest_path: plugins_dir.to_path_buf(),
                    message: format!("failed to read plugin entry: {error}"),
                });
                None
            }
        })
        .collect();
    entries.sort_by_key(|entry| entry.path());

    for entry in entries {
        let path = entry.path();
        match entry.file_type() {
            Ok(file_type) if file_type.is_dir() => {}
            Ok(_) => continue,
            Err(error) => {
                errors.push(DiscoveryErrorEntry {
                    manifest_path: path,
                    message: format!("failed to inspect plugin entry: {error}"),
                });
                continue;
            }
        }

        let manifest_path = path.join("plugin.json");
        if !manifest_path.exists() {
            continue;
        }

        match parse_manifest(&manifest_path) {
            Ok(record) => records.push(record),
            Err(error) => errors.push(DiscoveryErrorEntry {
                manifest_path,
                message: error.to_string(),
            }),
        }
    }

    (records, errors)
}

/// Report returned from [`discover_and_persist`].
#[derive(Debug, Clone, Default)]
pub struct DiscoveryReport {
    pub discovered: usize,
    pub errors: Vec<DiscoveryErrorEntry>,
}

/// Run a discovery pass against `plugins_dir` and persist results into
/// `database`. Successful manifests are upserted with status `registered`
/// (preserving the existing enabled flag); failed manifests bump any existing
/// row to `invalid` and record the error message.
pub fn discover_and_persist(
    database: &Database,
    plugins_dir: &Path,
) -> anyhow::Result<DiscoveryReport> {
    let (records, errors) = discover(plugins_dir);

    for record in &records {
        let upsert = PluginUpsert {
            id: record.id.clone(),
            name: record.name.clone(),
            version: record.version.clone(),
            description: record.description.clone(),
            status: "registered".to_string(),
            capabilities: record
                .capabilities
                .iter()
                .map(|cap| cap.as_str().to_string())
                .collect(),
            permissions: record.permissions.clone(),
            manifest_path: record.manifest_path.to_string_lossy().into_owned(),
            last_error: None,
        };
        database.upsert_plugin(upsert)?;
    }

    for error in &errors {
        // If a row already exists keyed by the failing manifest_path, mark it
        // invalid + record the error. Phase 8 cannot recover the plugin id
        // from a manifest that didn't parse, so we match by manifest_path.
        if let Some(existing) = find_plugin_by_manifest_path(database, &error.manifest_path)? {
            database.set_plugin_status(&existing, "invalid", Some(&error.message))?;
        }
    }

    Ok(DiscoveryReport {
        discovered: records.len(),
        errors,
    })
}

fn find_plugin_by_manifest_path(
    database: &Database,
    manifest_path: &Path,
) -> anyhow::Result<Option<String>> {
    let needle = manifest_path.to_string_lossy().to_string();
    for plugin in database.list_plugins()? {
        if plugin.manifest_path == needle {
            return Ok(Some(plugin.id));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_temp_dir() -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

        std::env::temp_dir().join(format!(
            "megle_plugin_test_{}_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time")
                .as_nanos(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ))
    }

    fn write_manifest(dir: &Path, contents: &str) -> PathBuf {
        fs::create_dir_all(dir).expect("create plugin dir");
        let path = dir.join("plugin.json");
        fs::write(&path, contents).expect("write plugin manifest");
        path
    }

    #[test]
    fn parse_manifest_valid_returns_record() {
        let dir = unique_temp_dir();
        let manifest_path = write_manifest(
            &dir,
            r#"{
                "id": "com.example.sample",
                "name": "Sample",
                "version": "1.2.3",
                "description": "Demo plugin",
                "engine": "process",
                "entry": "main.exe",
                "capabilities": ["decoder", "metadata"],
                "permissions": ["read-media-file"]
            }"#,
        );

        let record = parse_manifest(&manifest_path).expect("parse valid manifest");
        assert_eq!(record.id, "com.example.sample");
        assert_eq!(record.name, "Sample");
        assert_eq!(record.version, "1.2.3");
        assert_eq!(record.description.as_deref(), Some("Demo plugin"));
        assert_eq!(
            record.capabilities,
            vec![PluginCapability::Decoder, PluginCapability::Metadata]
        );
        assert_eq!(record.permissions, vec!["read-media-file".to_string()]);
        assert_eq!(record.manifest_path, manifest_path);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn parse_manifest_rejects_missing_id_and_invalid_capability() {
        let dir = unique_temp_dir();
        let missing_id_path = write_manifest(
            &dir,
            r#"{
                "name": "Sample",
                "version": "1.0.0",
                "engine": "process",
                "entry": "main.exe",
                "capabilities": ["decoder"]
            }"#,
        );
        let error = parse_manifest(&missing_id_path).expect_err("missing id should fail");
        assert!(
            matches!(error, ManifestError::MissingField(ref field) if field == "id"),
            "expected MissingField(id), got {error}"
        );

        let invalid_capability_dir = unique_temp_dir();
        let invalid_capability_path = write_manifest(
            &invalid_capability_dir,
            r#"{
                "id": "com.example.bad",
                "name": "Bad",
                "version": "1.0.0",
                "engine": "process",
                "entry": "main.exe",
                "capabilities": ["bogus"]
            }"#,
        );
        let error =
            parse_manifest(&invalid_capability_path).expect_err("invalid capability should fail");
        assert!(
            matches!(error, ManifestError::InvalidCapability(ref value) if value == "bogus"),
            "expected InvalidCapability(bogus), got {error}"
        );

        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&invalid_capability_dir).ok();
    }

    #[test]
    fn discover_returns_records_and_errors_for_mixed_folder() {
        let plugins_dir = unique_temp_dir();
        fs::create_dir_all(&plugins_dir).expect("create plugins dir");

        let valid_dir = plugins_dir.join("valid-plugin");
        write_manifest(
            &valid_dir,
            r#"{
                "id": "com.example.valid",
                "name": "Valid",
                "version": "0.1.0",
                "engine": "process",
                "entry": "main.exe",
                "capabilities": ["action"],
                "permissions": []
            }"#,
        );

        let invalid_dir = plugins_dir.join("invalid-plugin");
        write_manifest(&invalid_dir, "{ this is not json");

        // A directory with no manifest should be silently ignored.
        fs::create_dir_all(plugins_dir.join("empty-plugin")).expect("create empty dir");

        let (records, errors) = discover(&plugins_dir);
        assert_eq!(records.len(), 1, "expected one valid record");
        assert_eq!(records[0].id, "com.example.valid");
        assert_eq!(errors.len(), 1, "expected one parse error");
        assert_eq!(
            errors[0].manifest_path,
            invalid_dir.join("plugin.json"),
            "error should point at invalid manifest path"
        );

        fs::remove_dir_all(&plugins_dir).ok();
    }

    #[test]
    fn discover_returns_empty_when_directory_missing() {
        let plugins_dir = unique_temp_dir();
        let (records, errors) = discover(&plugins_dir);
        assert!(records.is_empty());
        assert!(errors.is_empty());
    }
}
