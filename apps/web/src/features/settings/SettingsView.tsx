import { CheckCircle2, Database, FolderCog, Trash2, XCircle } from "lucide-react";
import type { LibraryState } from "../../core/useLibraryData";

interface SettingsViewProps {
  library: LibraryState;
}

export function SettingsView({ library }: SettingsViewProps) {
  const diagnostics = library.diagnostics;
  const probed = library.diagnosticsProbed;
  const ffmpegAvailable = diagnostics?.ffmpegAvailable;
  const dbPath = diagnostics?.dbPath ?? null;
  const pluginsDir = diagnostics?.pluginsDir ?? null;

  return (
    <section className="workspace simple-workspace" aria-label="Settings workbench">
      <header className="toolbar">
        <div>
          <div className="toolbar-title">Settings</div>
          <div className="toolbar-meta">Local library settings and diagnostics</div>
        </div>
      </header>
      <div className="settings-body">
        <section className="settings-section" aria-labelledby="settings-diagnostics-title">
          <h2 className="settings-section-title" id="settings-diagnostics-title">
            Diagnostics
          </h2>
          <dl className="settings-grid">
            <div className="settings-row">
              <dt className="settings-row-label">
                <span className="settings-row-icon" aria-hidden="true">
                  {ffmpegAvailable ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                </span>
                FFmpeg
              </dt>
              <dd className="settings-row-value">
                <FfmpegBadge probed={probed} available={ffmpegAvailable} />
              </dd>
            </div>
            <div className="settings-row">
              <dt className="settings-row-label">
                <span className="settings-row-icon" aria-hidden="true">
                  <Database size={16} />
                </span>
                Database
              </dt>
              <dd className="settings-row-value">
                <PathDisplay value={dbPath} probed={probed} />
              </dd>
            </div>
            <div className="settings-row">
              <dt className="settings-row-label">
                <span className="settings-row-icon" aria-hidden="true">
                  <FolderCog size={16} />
                </span>
                Plugins folder
              </dt>
              <dd className="settings-row-value">
                <PathDisplay value={pluginsDir} probed={probed} />
              </dd>
            </div>
          </dl>
        </section>

        <section className="settings-section" aria-labelledby="settings-cache-title">
          <h2 className="settings-section-title" id="settings-cache-title">
            Thumbnail cache
          </h2>
          <p className="settings-section-copy">
            The thumbnail cache holds generated WebP files used for the grid and preview.
          </p>
          <button
            className="settings-action"
            disabled
            title="Available in a future release"
            type="button"
          >
            <Trash2 aria-hidden="true" size={14} />
            <span>Clear thumbnail cache</span>
          </button>
        </section>
      </div>
    </section>
  );
}

function FfmpegBadge({ probed, available }: { probed: boolean; available: boolean | undefined }) {
  if (!probed) {
    return <span className="settings-badge settings-badge-pending">Detecting…</span>;
  }
  if (available) {
    return <span className="settings-badge settings-badge-ok">Available</span>;
  }
  return (
    <span className="settings-badge settings-badge-missing" title="ffmpeg not on PATH">
      Missing
    </span>
  );
}

function PathDisplay({ value, probed }: { value: string | null; probed: boolean }) {
  if (!probed) {
    return <span className="settings-path-pending">Detecting…</span>;
  }
  if (!value) {
    return <span className="settings-path-pending">Run inside the desktop app to view</span>;
  }
  return (
    <code className="settings-path" title={value}>
      {value}
    </code>
  );
}
