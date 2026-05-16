import { RefreshCw } from "lucide-react";
import type { LibraryState } from "../../core/useLibraryData";
import { MediaGrid } from "../media-grid/MediaGrid";

interface LibraryViewProps {
  library: LibraryState;
}

export function LibraryView({ library }: LibraryViewProps) {
  const selectedRoot = library.roots.find((root) => root.id === library.selectedRootId) ?? null;
  const selectedFolder = library.folders.find((folder) => folder.id === library.selectedFolderId);

  return (
    <section className="workspace" aria-label="Library workbench">
      <header className="toolbar">
        <div>
          <div className="toolbar-title">{selectedFolder?.name ?? selectedRoot?.displayName ?? "Library"}</div>
          <div className="toolbar-meta">
            {library.media.length} media items
            {library.scanActive ? " / scanning" : ""}
          </div>
        </div>
        <button
          className="icon-button"
          onClick={() => void library.refresh()}
          title="Refresh"
          type="button"
          aria-label="Refresh library"
        >
          <RefreshCw size={16} />
        </button>
      </header>

      {library.error ? <div className="error-strip">{library.error}</div> : null}
      <div className="grid-surface">
        <MediaGrid
          hasMore={library.mediaHasMore}
          items={library.media}
          loading={library.loading}
          loadingMore={library.loadingMoreMedia}
          onRequestMore={library.loadMoreMedia}
          onSelect={library.setSelectedMediaId}
          selectedMediaId={library.selectedMediaId}
        />
      </div>

      <section className="inspector-panel" aria-label="Metadata">
        <div className="panel-title">Metadata</div>
        {library.selectedMedia ? (
          <dl className="metadata-list">
            <dt>Name</dt>
            <dd>{library.selectedMedia.name}</dd>
            <dt>Kind</dt>
            <dd>{library.selectedMedia.kind ?? "unknown"}</dd>
            <dt>Size</dt>
            <dd>{formatBytes(library.selectedMedia.size)}</dd>
            <dt>Thumbnail</dt>
            <dd>{library.selectedMedia.thumbnailState ?? "pending"}</dd>
          </dl>
        ) : (
          <div className="empty-panel">No selection</div>
        )}
      </section>
    </section>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
