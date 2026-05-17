import type { PluginRecord } from "@megle/core-client";
import { Loader2 } from "lucide-react";
import { StatusPill } from "./StatusPill";

interface PluginCardProps {
  plugin: PluginRecord;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onToggleEnabled: () => void;
}

export function PluginCard({
  plugin,
  selected,
  busy,
  onSelect,
  onToggleEnabled
}: PluginCardProps) {
  const toggleDisabled = busy || plugin.status === "invalid";
  const toggleLabel = plugin.enabled ? "Disable" : "Enable";
  const errorTooltip = plugin.lastError ?? undefined;

  return (
    <article
      className={`plugin-card${selected ? " selected" : ""}`}
      role="listitem"
      aria-label={`${plugin.name} plugin`}
    >
      <button
        className="plugin-card-body"
        onClick={onSelect}
        type="button"
        aria-pressed={selected}
      >
        <div className="plugin-card-heading">
          <span className="plugin-card-name">{plugin.name}</span>
          <span className="plugin-card-version">v{plugin.version}</span>
        </div>
        {plugin.description ? (
          <div className="plugin-card-description">{plugin.description}</div>
        ) : null}
        <div className="plugin-card-meta">
          <StatusPill status={plugin.status} title={errorTooltip} />
          {plugin.lastError ? (
            <span className="plugin-card-error" title={plugin.lastError}>
              {plugin.lastError}
            </span>
          ) : null}
        </div>
      </button>
      <div className="plugin-card-actions">
        <label
          className={`plugin-toggle${plugin.enabled ? " on" : ""}${
            toggleDisabled ? " disabled" : ""
          }`}
          title={
            plugin.status === "invalid"
              ? plugin.lastError ?? "Invalid manifest; cannot enable"
              : toggleLabel
          }
        >
          <input
            type="checkbox"
            checked={plugin.enabled}
            disabled={toggleDisabled}
            onChange={(event) => {
              event.stopPropagation();
              onToggleEnabled();
            }}
            aria-label={toggleLabel}
          />
          <span className="plugin-toggle-track" aria-hidden="true">
            <span className="plugin-toggle-thumb" />
          </span>
          <span className="plugin-toggle-label">
            {busy ? <Loader2 className="spin" size={12} /> : toggleLabel}
          </span>
        </label>
      </div>
    </article>
  );
}
