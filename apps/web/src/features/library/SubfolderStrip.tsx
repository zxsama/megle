import { Folder, FolderOpen, Images } from "lucide-react";
import { useMemo } from "react";
import type { FolderRecord } from "@megle/core-client";
import { LiquidGlassButton } from "../../design/liquid-glass";

interface SubfolderStripProps {
  folders: FolderRecord[];
  loading: boolean;
  showChildContents: boolean;
  selectedFolderId: number | null;
  onSelectFolder: (folder: FolderRecord) => void;
  onToggleShowChildContents: () => void;
}

export function SubfolderStrip({
  folders,
  loading,
  showChildContents,
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
    <section className="subfolder-strip" aria-label="Child folders">
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
        </div>
      </header>
      <div className="subfolder-strip-scroller" role="list">
        {folders.length > 0 ? (
          folders.map((folder) => {
            const selected = folder.id === selectedFolderId;
            return (
              <button
                aria-pressed={selected}
                className={selected ? "subfolder-card selected" : "subfolder-card"}
                key={folder.id}
                onClick={() => onSelectFolder(folder)}
                role="listitem"
                type="button"
              >
                <span className="subfolder-card-icon" aria-hidden="true">
                  {selected ? <FolderOpen size={18} /> : <Folder size={18} />}
                </span>
                <span className="subfolder-card-copy">
                  <span className="subfolder-card-name" title={folder.name}>
                    {folder.name}
                  </span>
                  <span className="subfolder-card-status">{folder.status}</span>
                </span>
              </button>
            );
          })
        ) : (
          <div className="subfolder-strip-empty">{loading ? "Loading child folders…" : "No child folders"}</div>
        )}
      </div>
    </section>
  );
}
