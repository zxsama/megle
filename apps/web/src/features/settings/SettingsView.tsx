import { CheckCircle2, Database, FolderCog, Trash2, XCircle } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import type { LibraryState } from "../../core/useLibraryData";
import { LiquidGlassSurface, type InterfaceStyleController } from "../../design/liquid-glass";
import {
  LIBRARY_GRID_PREFERENCE_LIMITS,
  type LibraryGridPreferences
} from "../media-grid/gridPreferences";
import {
  PREVIEW_PREFERENCE_LIMITS,
  type PreviewPreferences
} from "../preview/previewPreferences";
import {
  normalizeShortcutEvent,
  useShortcutBindings,
  type ShortcutActionId
} from "../shortcuts/shortcutBindings";

interface SettingsViewProps {
  gridPreferences: LibraryGridPreferences;
  interfaceStyle: InterfaceStyleController;
  library: LibraryState;
  onGridPreferencesChange: (patch: Partial<LibraryGridPreferences>) => void;
  onPreviewPreferencesChange: (patch: Partial<PreviewPreferences>) => void;
  previewPreferences: PreviewPreferences;
}

export function SettingsView({
  gridPreferences,
  interfaceStyle,
  library,
  onGridPreferencesChange,
  onPreviewPreferencesChange,
  previewPreferences
}: SettingsViewProps) {
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

        <LibraryGridSection
          gridPreferences={gridPreferences}
          onGridPreferencesChange={onGridPreferencesChange}
        />

        <PreviewBrowsingSection
          onPreviewPreferencesChange={onPreviewPreferencesChange}
          previewPreferences={previewPreferences}
        />

        <LiquidGlassSurface
          as="section"
          className="settings-section"
          aria-labelledby="settings-cache-title"
          interactive
          scrollable
          tone="panel"
        >
          <h2 className="settings-section-title" id="settings-cache-title">
            Disk thumbnail cache
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

function LibraryGridSection({
  gridPreferences,
  onGridPreferencesChange
}: {
  gridPreferences: LibraryGridPreferences;
  onGridPreferencesChange: (patch: Partial<LibraryGridPreferences>) => void;
}) {
  return (
    <LiquidGlassSurface
      as="section"
      className="settings-section"
      aria-labelledby="settings-library-grid-title"
      interactive
      scrollable
      tone="panel"
    >
      <h2 className="settings-section-title" id="settings-library-grid-title">
        Library grid
      </h2>
      <p className="settings-section-copy">
        Adjust spacing between thumbnails and the vertical space reserved for media and folder names.
      </p>
      <div className="settings-style-group">
        <h3 className="settings-style-group-title">Content area</h3>
        <StyleSlider
          id="library-grid-gap"
          label="Thumbnail gap"
          max={LIBRARY_GRID_PREFERENCE_LIMITS.tileGap.max}
          min={LIBRARY_GRID_PREFERENCE_LIMITS.tileGap.min}
          onChange={(tileGap) => onGridPreferencesChange({ tileGap })}
          step={LIBRARY_GRID_PREFERENCE_LIMITS.tileGap.step}
          unit="px"
          value={gridPreferences.tileGap}
        />
        <StyleSlider
          id="library-grid-label-height"
          label="Name spacing"
          max={LIBRARY_GRID_PREFERENCE_LIMITS.tileLabelHeight.max}
          min={LIBRARY_GRID_PREFERENCE_LIMITS.tileLabelHeight.min}
          onChange={(tileLabelHeight) => onGridPreferencesChange({ tileLabelHeight })}
          step={LIBRARY_GRID_PREFERENCE_LIMITS.tileLabelHeight.step}
          unit="px"
          value={gridPreferences.tileLabelHeight}
        />
      </div>
      <div className="settings-style-group">
        <h3 className="settings-style-group-title">Folder area</h3>
        <StyleSlider
          id="library-folder-grid-gap"
          label="Folder thumbnail gap"
          max={LIBRARY_GRID_PREFERENCE_LIMITS.folderTileGap.max}
          min={LIBRARY_GRID_PREFERENCE_LIMITS.folderTileGap.min}
          onChange={(folderTileGap) => onGridPreferencesChange({ folderTileGap })}
          step={LIBRARY_GRID_PREFERENCE_LIMITS.folderTileGap.step}
          unit="px"
          value={gridPreferences.folderTileGap}
        />
        <StyleSlider
          id="library-folder-grid-label-height"
          label="Folder name spacing"
          max={LIBRARY_GRID_PREFERENCE_LIMITS.folderTileLabelHeight.max}
          min={LIBRARY_GRID_PREFERENCE_LIMITS.folderTileLabelHeight.min}
          onChange={(folderTileLabelHeight) =>
            onGridPreferencesChange({ folderTileLabelHeight })
          }
          step={LIBRARY_GRID_PREFERENCE_LIMITS.folderTileLabelHeight.step}
          unit="px"
          value={gridPreferences.folderTileLabelHeight}
        />
        <StyleSlider
          id="library-folder-edge-shadow-alpha"
          label="Folder edge shadow"
          max={LIBRARY_GRID_PREFERENCE_LIMITS.folderEdgeShadowAlpha.max}
          min={LIBRARY_GRID_PREFERENCE_LIMITS.folderEdgeShadowAlpha.min}
          onChange={(folderEdgeShadowAlpha) =>
            onGridPreferencesChange({ folderEdgeShadowAlpha })
          }
          step={LIBRARY_GRID_PREFERENCE_LIMITS.folderEdgeShadowAlpha.step}
          unit="%"
          value={gridPreferences.folderEdgeShadowAlpha}
        />
      </div>
    </LiquidGlassSurface>
  );
}

function PreviewBrowsingSection({
  onPreviewPreferencesChange,
  previewPreferences
}: {
  onPreviewPreferencesChange: (patch: Partial<PreviewPreferences>) => void;
  previewPreferences: PreviewPreferences;
}) {
  return (
    <LiquidGlassSurface
      as="section"
      className="settings-section"
      aria-labelledby="settings-preview-browsing-title"
      interactive
      scrollable
      tone="panel"
    >
      <h2 className="settings-section-title" id="settings-preview-browsing-title">
        Preview browsing
      </h2>
      <p className="settings-section-copy">
        Control how much original image data and grid thumbnail data Megle keeps in memory
        while browsing.
      </p>
      <div className="settings-style-group">
        <StyleSlider
          id="preview-buffer-limit"
          label="Preview buffer"
          max={PREVIEW_PREFERENCE_LIMITS.previewBufferLimitMb.max}
          min={PREVIEW_PREFERENCE_LIMITS.previewBufferLimitMb.min}
          onChange={(previewBufferLimitMb) =>
            onPreviewPreferencesChange({ previewBufferLimitMb })
          }
          step={PREVIEW_PREFERENCE_LIMITS.previewBufferLimitMb.step}
          unit="MB"
          value={previewPreferences.previewBufferLimitMb}
        />
        <StyleSlider
          id="thumbnail-cache-limit"
          label="Thumbnail cache"
          max={PREVIEW_PREFERENCE_LIMITS.thumbnailCacheLimitMb.max}
          min={PREVIEW_PREFERENCE_LIMITS.thumbnailCacheLimitMb.min}
          onChange={(thumbnailCacheLimitMb) =>
            onPreviewPreferencesChange({ thumbnailCacheLimitMb })
          }
          step={PREVIEW_PREFERENCE_LIMITS.thumbnailCacheLimitMb.step}
          unit="MB"
          value={previewPreferences.thumbnailCacheLimitMb}
        />
      </div>
    </LiquidGlassSurface>
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
      <div className="settings-style-group">
        <h3 className="settings-style-group-title">Shared shape</h3>
        <StyleSlider
          id="window-corner-radius"
          disabled
          label="Window corner radius"
          max={limits.windowCornerRadius.max}
          min={limits.windowCornerRadius.min}
          onChange={(windowCornerRadius) => setInterfaceStyle({ windowCornerRadius })}
          step={limits.windowCornerRadius.step}
          unit="px"
          value={value.windowCornerRadius}
        />
        <StyleSlider
          id="surface-corner-radius"
          label="Surface corner radius"
          max={limits.surfaceCornerRadius.max}
          min={limits.surfaceCornerRadius.min}
          onChange={(surfaceCornerRadius) => setInterfaceStyle({ surfaceCornerRadius })}
          step={limits.surfaceCornerRadius.step}
          unit="px"
          value={value.surfaceCornerRadius}
        />
        <StyleSlider
          id="control-corner-radius"
          label="Control corner radius"
          max={limits.controlCornerRadius.max}
          min={limits.controlCornerRadius.min}
          onChange={(controlCornerRadius) => setInterfaceStyle({ controlCornerRadius })}
          step={limits.controlCornerRadius.step}
          unit="px"
          value={value.controlCornerRadius}
        />
        <StyleSlider
          id="content-corner-radius"
          label="Content corner radius"
          max={limits.contentCornerRadius.max}
          min={limits.contentCornerRadius.min}
          onChange={(contentCornerRadius) => setInterfaceStyle({ contentCornerRadius })}
          step={limits.contentCornerRadius.step}
          unit="px"
          value={value.contentCornerRadius}
        />
      </div>
      <div className="settings-style-group">
        <h3 className="settings-style-group-title">Side shell material</h3>
        <StyleSlider
          id="side-blur"
          label="Blur"
          max={limits.sideBlur.max}
          min={limits.sideBlur.min}
          onChange={(sideBlur) => setInterfaceStyle({ sideBlur })}
          step={limits.sideBlur.step}
          unit="x"
          value={value.sideBlur}
        />
        <StyleSlider
          id="side-opacity"
          label="Opacity"
          max={limits.sideOpacity.max}
          min={limits.sideOpacity.min}
          onChange={(sideOpacity) => setInterfaceStyle({ sideOpacity })}
          step={limits.sideOpacity.step}
          unit="x"
          value={value.sideOpacity}
        />
        <StyleSlider
          id="side-overlay-strength"
          label="Overlay strength"
          max={limits.sideOverlayStrength.max}
          min={limits.sideOverlayStrength.min}
          onChange={(sideOverlayStrength) => setInterfaceStyle({ sideOverlayStrength })}
          step={limits.sideOverlayStrength.step}
          unit="x"
          value={value.sideOverlayStrength}
        />
        <ColorField
          id="side-overlay-color"
          label="Overlay color"
          onChange={(sideOverlayColor) => setInterfaceStyle({ sideOverlayColor })}
          value={value.sideOverlayColor}
        />
        <StyleSlider
          id="side-saturation"
          label="Saturation"
          max={limits.sideSaturation.max}
          min={limits.sideSaturation.min}
          onChange={(sideSaturation) => setInterfaceStyle({ sideSaturation })}
          step={limits.sideSaturation.step}
          unit="x"
          value={value.sideSaturation}
        />
        <StyleSlider
          id="side-stroke-opacity"
          label="Stroke opacity"
          max={limits.sideStrokeOpacity.max}
          min={limits.sideStrokeOpacity.min}
          onChange={(sideStrokeOpacity) => setInterfaceStyle({ sideStrokeOpacity })}
          step={limits.sideStrokeOpacity.step}
          unit="x"
          value={value.sideStrokeOpacity}
        />
      </div>
      <div className="settings-style-group">
        <h3 className="settings-style-group-title">Center workbench material</h3>
        <StyleSlider
          id="center-blur"
          label="Blur"
          max={limits.centerBlur.max}
          min={limits.centerBlur.min}
          onChange={(centerBlur) => setInterfaceStyle({ centerBlur })}
          step={limits.centerBlur.step}
          unit="x"
          value={value.centerBlur}
        />
        <StyleSlider
          id="center-opacity"
          label="Opacity"
          max={limits.centerOpacity.max}
          min={limits.centerOpacity.min}
          onChange={(centerOpacity) => setInterfaceStyle({ centerOpacity })}
          step={limits.centerOpacity.step}
          unit="x"
          value={value.centerOpacity}
        />
        <StyleSlider
          id="center-overlay-strength"
          label="Overlay strength"
          max={limits.centerOverlayStrength.max}
          min={limits.centerOverlayStrength.min}
          onChange={(centerOverlayStrength) => setInterfaceStyle({ centerOverlayStrength })}
          step={limits.centerOverlayStrength.step}
          unit="x"
          value={value.centerOverlayStrength}
        />
        <ColorField
          id="center-overlay-color"
          label="Overlay color"
          onChange={(centerOverlayColor) => setInterfaceStyle({ centerOverlayColor })}
          value={value.centerOverlayColor}
        />
        <StyleSlider
          id="center-saturation"
          label="Saturation"
          max={limits.centerSaturation.max}
          min={limits.centerSaturation.min}
          onChange={(centerSaturation) => setInterfaceStyle({ centerSaturation })}
          step={limits.centerSaturation.step}
          unit="x"
          value={value.centerSaturation}
        />
        <StyleSlider
          id="center-stroke-opacity"
          label="Stroke opacity"
          max={limits.centerStrokeOpacity.max}
          min={limits.centerStrokeOpacity.min}
          onChange={(centerStrokeOpacity) => setInterfaceStyle({ centerStrokeOpacity })}
          step={limits.centerStrokeOpacity.step}
          unit="x"
          value={value.centerStrokeOpacity}
        />
      </div>
      <div className="settings-style-group">
        <h3 className="settings-style-group-title">Glass smoothness</h3>
        <StyleSlider
          id="dither-opacity"
          label="Dither strength"
          max={limits.ditherOpacity.max}
          min={limits.ditherOpacity.min}
          onChange={(ditherOpacity) => setInterfaceStyle({ ditherOpacity })}
          step={limits.ditherOpacity.step}
          unit="x"
          value={value.ditherOpacity}
        />
        <StyleSlider
          id="backdrop-gradient-strength"
          label="Backdrop gradient strength"
          max={limits.backdropGradientStrength.max}
          min={limits.backdropGradientStrength.min}
          onChange={(backdropGradientStrength) => setInterfaceStyle({ backdropGradientStrength })}
          step={limits.backdropGradientStrength.step}
          unit="x"
          value={value.backdropGradientStrength}
        />
      </div>
      <div className="settings-style-group">
        <h3 className="settings-style-group-title">Shared liquid glass interaction</h3>
        <StyleSlider
          id="edge-highlight-brightness"
          label="Edge highlight brightness"
          max={limits.edgeHighlightBrightness.max}
          min={limits.edgeHighlightBrightness.min}
          onChange={(edgeHighlightBrightness) => setInterfaceStyle({ edgeHighlightBrightness })}
          step={limits.edgeHighlightBrightness.step}
          unit="x"
          value={value.edgeHighlightBrightness}
        />
        <StyleSlider
          id="edge-highlight-size"
          label="Edge highlight size"
          max={limits.edgeHighlightSize.max}
          min={limits.edgeHighlightSize.min}
          onChange={(edgeHighlightSize) => setInterfaceStyle({ edgeHighlightSize })}
          step={limits.edgeHighlightSize.step}
          unit="x"
          value={value.edgeHighlightSize}
        />
        <StyleSlider
          id="halo-brightness"
          label="Halo brightness"
          max={limits.haloBrightness.max}
          min={limits.haloBrightness.min}
          onChange={(haloBrightness) => setInterfaceStyle({ haloBrightness })}
          step={limits.haloBrightness.step}
          unit="x"
          value={value.haloBrightness}
        />
        <StyleSlider
          id="halo-falloff"
          label="Halo falloff"
          max={limits.haloFalloff.max}
          min={limits.haloFalloff.min}
          onChange={(haloFalloff) => setInterfaceStyle({ haloFalloff })}
          step={limits.haloFalloff.step}
          unit="x"
          value={value.haloFalloff}
        />
        <StyleSlider
          id="pointer-response-radius"
          label="Pointer response radius"
          max={limits.pointerResponseRadius.max}
          min={limits.pointerResponseRadius.min}
          onChange={(pointerResponseRadius) => setInterfaceStyle({ pointerResponseRadius })}
          step={limits.pointerResponseRadius.step}
          unit="x"
          value={value.pointerResponseRadius}
        />
        <StyleSlider
          id="refraction-strength"
          label="Refraction strength"
          max={limits.refractionStrength.max}
          min={limits.refractionStrength.min}
          onChange={(refractionStrength) => setInterfaceStyle({ refractionStrength })}
          step={limits.refractionStrength.step}
          unit="x"
          value={value.refractionStrength}
        />
      </div>
      <div className="settings-style-group">
        <h3 className="settings-style-group-title">Dialog material</h3>
        <StyleSlider
          id="dialog-blur"
          label="Dialog blur"
          max={limits.dialogBlur.max}
          min={limits.dialogBlur.min}
          onChange={(dialogBlur) => setInterfaceStyle({ dialogBlur })}
          step={limits.dialogBlur.step}
          unit="x"
          value={value.dialogBlur}
        />
        <StyleSlider
          id="dialog-opacity"
          label="Dialog opacity"
          max={limits.dialogOpacity.max}
          min={limits.dialogOpacity.min}
          onChange={(dialogOpacity) => setInterfaceStyle({ dialogOpacity })}
          step={limits.dialogOpacity.step}
          unit="x"
          value={value.dialogOpacity}
        />
        <StyleSlider
          id="dialog-overlay-strength"
          label="Dialog overlay strength"
          max={limits.dialogOverlayStrength.max}
          min={limits.dialogOverlayStrength.min}
          onChange={(dialogOverlayStrength) => setInterfaceStyle({ dialogOverlayStrength })}
          step={limits.dialogOverlayStrength.step}
          unit="x"
          value={value.dialogOverlayStrength}
        />
        <StyleSlider
          id="dialog-backdrop-dim"
          label="Dialog backdrop dim"
          max={limits.dialogBackdropDim.max}
          min={limits.dialogBackdropDim.min}
          onChange={(dialogBackdropDim) => setInterfaceStyle({ dialogBackdropDim })}
          step={limits.dialogBackdropDim.step}
          unit="x"
          value={value.dialogBackdropDim}
        />
      </div>
    </LiquidGlassSurface>
  );
}

function ColorField({
  id,
  label,
  onChange,
  value
}: {
  id: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="settings-style-slider settings-style-color no-drag" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        onChange={(event) => onChange(event.currentTarget.value)}
        type="color"
        value={value}
      />
      <output htmlFor={id}>{value.toUpperCase()}</output>
    </label>
  );
}

function StyleSlider({
  disabled = false,
  id,
  label,
  max,
  min,
  onChange,
  step,
  unit = "x",
  value
}: {
  disabled?: boolean;
  id: string;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  unit?: "%" | "MB" | "px" | "x";
  value: number;
}) {
  return (
    <label className="settings-style-slider no-drag" htmlFor={id}>
      <span>{label}</span>
      <span className="settings-style-slider-control" data-settings-slider-control={id}>
        <input
          id={id}
          disabled={disabled}
          max={max}
          min={min}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
          step={step}
          type="range"
          value={value}
        />
      </span>
      <output htmlFor={id}>{formatStyleValue(value, unit)}</output>
    </label>
  );
}

function formatStyleValue(value: number, unit: "%" | "MB" | "px" | "x") {
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (unit === "%") return `${rounded}%`;
  if (unit === "MB") return `${rounded} MB`;
  return unit === "px" ? `${rounded}px` : `${rounded}x`;
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
