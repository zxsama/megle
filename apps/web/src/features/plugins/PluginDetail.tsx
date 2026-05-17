import { useEffect, useState } from "react";
import { Check, Copy, Cpu, Database, Tag, Trash2, Workflow } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { PluginCapability, PluginRecord } from "@megle/core-client";
import { StatusPill } from "./StatusPill";

interface PluginDetailProps {
  plugin: PluginRecord;
  busy: boolean;
  onRemove: () => void;
}

const CAPABILITY_LABEL: Record<PluginCapability, string> = {
  decoder: "Decoder",
  metadata: "Metadata",
  action: "Action",
  "import-provider": "Import provider"
};

const CAPABILITY_ICON: Record<PluginCapability, LucideIcon> = {
  decoder: Cpu,
  metadata: Tag,
  action: Workflow,
  "import-provider": Database
};

export function PluginDetail({ plugin, busy, onRemove }: PluginDetailProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const handle = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(handle);
  }, [copied]);

  async function copyManifestPath() {
    try {
      await navigator.clipboard.writeText(plugin.manifestPath);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="plugin-detail" aria-label={`${plugin.name} details`}>
      <header className="plugin-detail-header">
        <div className="plugin-detail-heading">
          <div className="plugin-detail-titles">
            <div className="plugin-detail-title">{plugin.name}</div>
            <div className="plugin-detail-subtitle">
              <span>v{plugin.version}</span>
              <span className="plugin-detail-id" title={plugin.id}>
                {plugin.id}
              </span>
            </div>
          </div>
          <StatusPill status={plugin.status} title={plugin.lastError ?? undefined} />
        </div>
        {plugin.description ? (
          <p className="plugin-detail-description">{plugin.description}</p>
        ) : null}
      </header>

      <div className="plugin-detail-section">
        <div className="plugin-detail-section-title">Capabilities</div>
        {plugin.capabilities.length === 0 ? (
          <div className="plugin-detail-empty">None declared.</div>
        ) : (
          <div className="plugin-capability-chips">
            {plugin.capabilities.map((capability) => {
              const Icon = CAPABILITY_ICON[capability];
              return (
                <span className="plugin-capability-chip" key={capability}>
                  <Icon size={12} aria-hidden="true" />
                  <span>{CAPABILITY_LABEL[capability]}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>

      <div className="plugin-detail-section">
        <div className="plugin-detail-section-title">Permissions</div>
        {plugin.permissions.length === 0 ? (
          <div className="plugin-detail-empty">No permissions requested.</div>
        ) : (
          <ul className="plugin-permission-list">
            {plugin.permissions.map((permission) => (
              <li key={permission}>{permission}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="plugin-detail-section">
        <div className="plugin-detail-section-title">Manifest</div>
        <div className="plugin-manifest-row">
          <code className="plugin-manifest-path" title={plugin.manifestPath}>
            {plugin.manifestPath}
          </code>
          <button
            className="plugin-manifest-copy"
            onClick={() => void copyManifestPath()}
            type="button"
            aria-label="Copy manifest path"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            <span>{copied ? "Copied!" : "Copy"}</span>
          </button>
        </div>
        <dl className="plugin-detail-meta">
          <div>
            <dt>Installed</dt>
            <dd>{formatTime(plugin.installedAt)}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{formatTime(plugin.updatedAt)}</dd>
          </div>
        </dl>
      </div>

      {plugin.lastError ? (
        <div className="plugin-detail-section">
          <div className="plugin-detail-section-title">Last error</div>
          <pre className="plugin-detail-error">{plugin.lastError}</pre>
        </div>
      ) : null}

      <div className="plugin-detail-actions">
        <button
          className="plugin-delete-button"
          onClick={onRemove}
          type="button"
          disabled={busy}
        >
          <Trash2 size={14} />
          <span>Remove from registry</span>
        </button>
        <p className="plugin-delete-hint">
          Removes the registry entry only. The plugin folder on disk is left untouched.
        </p>
      </div>
    </section>
  );
}

function formatTime(epochSeconds: number): string {
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return "—";
  const date = new Date(epochSeconds * 1000);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}
