import { ChevronDown, ChevronUp, Folder } from "lucide-react";
import { useMemo } from "react";
import type { FolderRecord, MediaRecord } from "@megle/core-client";
import { previewPlaceholderDataUrl } from "../../core/mediaResources";

interface SubfolderStripProps {
  collapsed: boolean;
  coverMediaByFolderId: Map<number, MediaRecord[]>;
  folders: FolderRecord[];
  loading: boolean;
  selectedFolderId: number | null;
  onToggleCollapsed: () => void;
  onSelectFolder: (folder: FolderRecord) => void;
}

export function SubfolderStrip({
  collapsed,
  coverMediaByFolderId,
  folders,
  loading,
  onToggleCollapsed,
  onSelectFolder,
  selectedFolderId
}: SubfolderStripProps) {
  const title = useMemo(() => {
    if (loading && folders.length === 0) {
      return "Subfolders";
    }
    if (folders.length === 0) {
      return "Subfolders (0)";
    }
    return `Subfolders (${folders.length})`;
  }, [folders.length, loading]);

  return (
    <section
      className={`subfolder-strip${collapsed ? " is-collapsed" : ""}`}
      aria-label="Child folders"
    >
      <header className="subfolder-strip-header">
        <div className="subfolder-strip-copy">
          <div className="subfolder-strip-title">{title}</div>
        </div>
        <button
          aria-label={collapsed ? "Expand child folders" : "Collapse child folders"}
          className="subfolder-strip-icon-toggle"
          onClick={onToggleCollapsed}
          title={collapsed ? "Expand child folders" : "Collapse child folders"}
          type="button"
        >
          {collapsed ? <ChevronDown aria-hidden="true" size={15} /> : <ChevronUp aria-hidden="true" size={15} />}
        </button>
      </header>
      {!collapsed ? (
        <div className="subfolder-strip-scroller" role="list">
          {folders.length > 0 ? (
            folders.map((folder) => {
              const selected = folder.id === selectedFolderId;
              const coverMedia = coverMediaByFolderId.get(folder.id) ?? [];
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
                    <FolderCoverStack coverMedia={coverMedia} />
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

function FolderCoverStack({ coverMedia }: { coverMedia: MediaRecord[] }) {
  if (coverMedia.length === 0) {
    return (
      <span className="subfolder-card-thumb-fallback">
        <Folder size={18} />
      </span>
    );
  }

  return (
    <span className="subfolder-card-thumb-stack">
      {coverMedia.slice(0, 3).map((media, index) => {
        const coverUrl = previewPlaceholderDataUrl(media);
        return (
          <span
            className={`subfolder-card-thumb-layer subfolder-card-thumb-layer-${index + 1}`}
            key={media.id}
          >
            {coverUrl ? (
              <img alt="" className="subfolder-card-thumb-image" src={coverUrl} />
            ) : null}
          </span>
        );
      })}
    </span>
  );
}
