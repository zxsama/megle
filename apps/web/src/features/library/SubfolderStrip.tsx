import { Folder, FolderOpen, Images, PanelTopClose, PanelTopOpen } from "lucide-react";
import { useMemo } from "react";
import type { FolderRecord, MediaRecord } from "@megle/core-client";
import { LiquidGlassButton } from "../../design/liquid-glass";
import { previewPlaceholderDataUrl } from "../../core/mediaResources";

interface SubfolderStripProps {
  collapsed: boolean;
  coverMediaByFolderId: Map<number, MediaRecord | null>;
  folders: FolderRecord[];
  loading: boolean;
  showChildContents: boolean;
  selectedFolderId: number | null;
  onToggleCollapsed: () => void;
  onSelectFolder: (folder: FolderRecord) => void;
  onToggleShowChildContents: () => void;
}

export function SubfolderStrip({
  collapsed,
  coverMediaByFolderId,
  folders,
  loading,
  showChildContents,
  onToggleCollapsed,
  onSelectFolder,
  onToggleShowChildContents,
  selectedFolderId
}: SubfolderStripProps) {
  const subtitle = useMemo(() => {
    if (loading && folders.length === 0) {
      return "Loading child folders";
    }
    if (folders.length === 0) {
      return "No child folders";
    }
    return `${folders.length} child folder${folders.length === 1 ? "" : "s"}`;
  }, [folders.length, loading]);

  return (
    <section
      className={`subfolder-strip${collapsed ? " is-collapsed" : ""}`}
      aria-label="Child folders"
    >
      <header className="subfolder-strip-header">
        <div className="subfolder-strip-copy">
          <div className="subfolder-strip-title">Subfolders</div>
          <div className="subfolder-strip-subtitle">{subtitle}</div>
        </div>
        <div className="subfolder-strip-actions">
          <LiquidGlassButton
            aria-label={showChildContents ? "Hide child folder contents" : "Show child folder contents"}
            aria-pressed={showChildContents}
            active={showChildContents}
            className="subfolder-strip-toggle"
            onClick={onToggleShowChildContents}
            title={showChildContents ? "Hide child folder contents" : "Show child folder contents"}
            tone="control"
            type="button"
          >
            <Images aria-hidden="true" size={15} />
            <span>Show child folder contents</span>
          </LiquidGlassButton>
          <LiquidGlassButton
            aria-label={collapsed ? "Expand child folders" : "Collapse child folders"}
            aria-pressed={!collapsed}
            active={!collapsed}
            className="subfolder-strip-icon-toggle"
            onClick={onToggleCollapsed}
            title={collapsed ? "Expand child folders" : "Collapse child folders"}
            tone="control"
            type="button"
          >
            {collapsed ? (
              <PanelTopOpen aria-hidden="true" size={15} />
            ) : (
              <PanelTopClose aria-hidden="true" size={15} />
            )}
          </LiquidGlassButton>
        </div>
      </header>
      {!collapsed ? (
        <div className="subfolder-strip-scroller" role="list">
          {folders.length > 0 ? (
            folders.map((folder) => {
              const selected = folder.id === selectedFolderId;
              const coverMedia = coverMediaByFolderId.get(folder.id) ?? null;
              const coverUrl = coverMedia ? previewPlaceholderDataUrl(coverMedia) : null;
              return (
                <button
                  aria-pressed={selected}
                  className={selected ? "subfolder-card selected" : "subfolder-card"}
                  key={folder.id}
                  onClick={() => onSelectFolder(folder)}
                  role="listitem"
                  type="button"
                >
                  <span className="subfolder-card-thumb" aria-hidden="true">
                    {coverUrl ? (
                      <img alt="" className="subfolder-card-thumb-image" src={coverUrl} />
                    ) : selected ? (
                      <FolderOpen size={18} />
                    ) : (
                      <Folder size={18} />
                    )}
                  </span>
                  <span className="subfolder-card-copy">
                    <span className="subfolder-card-name" title={folder.name}>
                      {folder.name}
                    </span>
                  </span>
                </button>
              );
            })
          ) : (
            <div className="subfolder-strip-empty">
              {loading ? "Loading child folders…" : "No child folders"}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
