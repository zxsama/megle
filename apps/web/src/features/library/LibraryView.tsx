import { RefreshCw } from "lucide-react";
import type { LibraryState } from "../../core/useLibraryData";
import { MediaGrid } from "../media-grid/MediaGrid";
import { PreviewPanel } from "../preview/PreviewPanel";

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
          onRequestThumbnailStates={library.requestThumbnailStates}
          onSelect={library.setSelectedMediaId}
          selectedMediaId={library.selectedMediaId}
          thumbnailStatesByMediaId={library.thumbnailStatesByMediaId}
        />
      </div>

      <PreviewPanel
        selectedMedia={library.selectedMedia}
        thumbnail={
          library.selectedMedia ? library.thumbnailStatesByMediaId[library.selectedMedia.id] : undefined
        }
      />
    </section>
  );
}
