import { Folder, FolderOpen } from "lucide-react";
import type { FolderRecord } from "@megle/core-client";

interface SubfolderContentGalleryProps {
  folders: FolderRecord[];
  selectedFolderId: number | null;
  onSelectFolder: (folder: FolderRecord) => void;
}

export function SubfolderContentGallery({
  folders,
  onSelectFolder,
  selectedFolderId
}: SubfolderContentGalleryProps) {
  if (folders.length === 0) {
    return null;
  }

  return (
    <section className="subfolder-content-gallery" aria-label="Child folder contents">
      <header className="subfolder-content-gallery-header">
        <div className="subfolder-content-gallery-title">Child folder contents</div>
        <div className="subfolder-content-gallery-subtitle">
          {folders.length} folder{folders.length === 1 ? "" : "s"}
        </div>
      </header>
      <div className="subfolder-content-gallery-grid" role="list">
        {folders.map((folder) => {
          const selected = folder.id === selectedFolderId;
          return (
            <button
              aria-pressed={selected}
              className={selected ? "subfolder-content-card selected" : "subfolder-content-card"}
              key={folder.id}
              onClick={() => onSelectFolder(folder)}
              role="listitem"
              type="button"
            >
              <div className="subfolder-content-card-thumb" aria-hidden="true">
                {selected ? <FolderOpen size={28} /> : <Folder size={28} />}
              </div>
              <div className="subfolder-content-card-copy">
                <div className="subfolder-content-card-name" title={folder.name}>
                  {folder.name}
                </div>
                <div className="subfolder-content-card-status">{folder.status}</div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
