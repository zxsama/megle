import { CheckCircle2, Database, FolderCog, Trash2, XCircle } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import type { LibraryState } from "../../core/useLibraryData";
import { LiquidGlassSurface, type InterfaceStyleController } from "../../design/liquid-glass";
import {
  normalizeShortcutEvent,
  useShortcutBindings,
  type ShortcutActionId
} from "../shortcuts/shortcutBindings";

interface SettingsViewProps {
  interfaceStyle: InterfaceStyleController;
  library: LibraryState;
}

export function SettingsView({ interfaceStyle, library }: SettingsViewProps) {
  const diagnostics = library.diagnostics;
  const probed = library.diagnosticsProbed;
  const ffmpegAvailable = diagnostics?.ffmpegAvailable;
  const dbPath = diagnostics?.dbPath ?? null;
  const pluginsDir = diagnostics?.pluginsDir ?? null;

  return (
    <section className="workspace simple-workspace" aria-label="Settings workbench">
      <div className="settings-body">
        <LiquidGlassSurface
          as="section"
          className="settings-section"
          aria-labelledby="settings-diagnostics-title"
          interactive
          scrollable
          tone="panel"
        >
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
        </LiquidGlassSurface>

        <InterfaceStyleSection interfaceStyle={interfaceStyle} />

        <LiquidGlassSurface
          as="section"
          className="settings-section"
          aria-labelledby="settings-cache-title"
          interactive
          scrollable
          tone="panel"
        >
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
        </LiquidGlassSurface>

        <ShortcutBindingsEditor />
      </div>
    </section>
  );
}

function InterfaceStyleSection({ interfaceStyle }: { interfaceStyle: InterfaceStyleController }) {
  const { limits, value, resetInterfaceStyle, setInterfaceStyle } = interfaceStyle;
  return (
    <LiquidGlassSurface
      as="section"
      className="settings-section settings-interface-style"
      aria-labelledby="settings-interface-style-title"
      interactive
      scrollable
      tone="panel"
    >
      <div className="settings-section-heading">
        <h2 className="settings-section-title" id="settings-interface-style-title">
          Interface style
        </h2>
        <button className="settings-action no-drag" onClick={resetInterfaceStyle} type="button">
          Reset interface style
        </button>
      </div>
      <StyleSlider
        id="glass-blur"
        label="Glass blur"
        max={limits.glassBlur.max}
        min={limits.glassBlur.min}
        onChange={(glassBlur) => setInterfaceStyle({ glassBlur })}
        step={limits.glassBlur.step}
        value={value.glassBlur}
      />
      <StyleSlider
        id="pointer-glow-brightness"
        label="Pointer glow brightness"
        max={limits.pointerGlowBrightness.max}
        min={limits.pointerGlowBrightness.min}
        onChange={(pointerGlowBrightness) => setInterfaceStyle({ pointerGlowBrightness })}
        step={limits.pointerGlowBrightness.step}
        value={value.pointerGlowBrightness}
      />
      <StyleSlider
        id="edge-highlight-brightness"
        label="Edge highlight brightness"
        max={limits.edgeHighlightBrightness.max}
        min={limits.edgeHighlightBrightness.min}
        onChange={(edgeHighlightBrightness) => setInterfaceStyle({ edgeHighlightBrightness })}
        step={limits.edgeHighlightBrightness.step}
        value={value.edgeHighlightBrightness}
      />
    </LiquidGlassSurface>
  );
}

function StyleSlider({
  id,
  label,
  max,
  min,
  onChange,
  step,
  value
}: {
  id: string;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  value: number;
}) {
  return (
    <label className="settings-style-slider no-drag" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        step={step}
        type="range"
        value={value}
      />
      <output htmlFor={id}>{formatStyleValue(value)}</output>
    </label>
  );
}

function formatStyleValue(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function ShortcutBindingsEditor() {
  const { actions, bindings, conflicts, onReset, setBinding } = useShortcutBindings();
  const [capturing, setCapturing] = useState<ShortcutActionId | null>(null);
  const labelsById = new Map(actions.map((action) => [action.id, action.label]));

  function handleCaptureKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    actionId: ShortcutActionId
  ) {
    if (capturing !== actionId) return;
    event.preventDefault();
    event.stopPropagation();
    const nextBinding = normalizeShortcutEvent(event);
    if (!nextBinding) return;
    setBinding(actionId, nextBinding);
    setCapturing(null);
  }

  return (
    <LiquidGlassSurface
      as="section"
      aria-labelledby="settings-shortcuts-title"
      className="settings-section settings-shortcuts"
      interactive
      scrollable
      tone="panel"
    >
      <div className="settings-section-heading">
        <h2 className="settings-section-title" id="settings-shortcuts-title">
          Shortcuts
        </h2>
        <button className="settings-action" onClick={onReset} type="button">
          Reset shortcuts
        </button>
      </div>
      <div className="shortcut-bindings-list">
        {actions.map((action) => {
          const actionConflicts = conflicts[action.id] ?? [];
          return (
            <div className="shortcut-binding-row" key={action.id}>
              <div className="shortcut-binding-label">{action.label}</div>
              <button
                className={
                  capturing === action.id
                    ? "shortcut-binding-capture active"
                    : "shortcut-binding-capture"
                }
                data-shortcut-capture="true"
                onBlur={() => {
                  if (capturing === action.id) setCapturing(null);
                }}
                onClick={() => setCapturing(action.id)}
                onKeyDown={(event) => handleCaptureKeyDown(event, action.id)}
                type="button"
              >
                {capturing === action.id ? "Press shortcut" : bindings[action.id]}
              </button>
              {actionConflicts.length > 0 ? (
                <div className="shortcut-binding-conflict">
                  Conflicts with {actionConflicts.map((id) => labelsById.get(id) ?? id).join(", ")}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </LiquidGlassSurface>
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
