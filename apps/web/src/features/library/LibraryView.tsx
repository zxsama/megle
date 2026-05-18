import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import type { MediaRecord, RootRecord } from "@megle/core-client";
import type { LibraryState } from "../../core/useLibraryData";
import { LiquidGlassButton, LiquidGlassSurface } from "../../design/liquid-glass";
import { MediaGrid } from "../media-grid/MediaGrid";
import { InspectorMetadata } from "../preview/InspectorMetadata";
import { PreviewDialog, PreviewPanel } from "../preview/PreviewPanel";
import { FilterChips } from "./FilterChips";
import { SearchBar } from "./SearchBar";
import { SortMenu } from "./SortMenu";

interface LibraryViewProps {
  library: LibraryState;
  previewOpen: boolean;
  onOpenPreview: (mediaId: number) => void;
  onClosePreview: () => void;
  onMediaContextMenu?: (event: {
    item: MediaRecord;
    x: number;
    y: number;
    shiftKey: boolean;
  }) => void;
}

export function LibraryView({
  library,
  onClosePreview,
  onMediaContextMenu,
  onOpenPreview,
  previewOpen
}: LibraryViewProps) {
  const selectedRoot = library.roots.find((root) => root.id === library.selectedRootId) ?? null;
  const selectedFolder = library.folders.find((folder) => folder.id === library.selectedFolderId);

  useEffect(() => {
    if (previewOpen && !library.selectedMedia) {
      onClosePreview();
    }
  }, [library.selectedMedia, onClosePreview, previewOpen]);

  function handleOpenPreview(mediaId: number) {
    onOpenPreview(mediaId);
  }

  return (
    <section className="workspace" aria-label="Library workbench">
      <LiquidGlassSurface
        as="header"
        className="toolbar toolbar-library"
        interactive
        tone="chrome"
      >
        <div className="toolbar-titles">
          <div className="toolbar-title">
            {selectedFolder?.name ?? selectedRoot?.displayName ?? "Library"}
          </div>
          <div className="toolbar-meta">
            {library.media.length} media items
            {library.searchActive ? " / filtered" : ""}
            {library.scanActive ? " / scanning" : ""}
          </div>
        </div>
        <div className="toolbar-controls">
          <SearchBar value={library.searchState.q} onChange={library.setQ} />
          <SortMenu value={library.searchState.sort} onChange={library.setSort} />
          <button
            className="icon-button"
            onClick={() => void library.refresh()}
            title="Refresh"
            type="button"
            aria-label="Refresh library"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </LiquidGlassSurface>
      <FilterChips
        kind={library.searchState.kind}
        minRating={library.searchState.minRating}
        favorite={library.searchState.favorite}
        tagIds={library.searchState.tagIds}
        tagsById={library.tagsById}
        onSetKind={library.setKind}
        onSetMinRating={library.setMinRating}
        onToggleFavorite={library.toggleFavoriteFilter}
        onToggleTag={library.toggleTagFilter}
        onClear={library.clearFilters}
      />

      {library.error ? <div className="error-strip">{library.error}</div> : null}
      <div className="grid-surface">
        {renderEmptyState({ library, selectedRoot }) ?? (
          <MediaGrid
            hasMore={library.mediaHasMore}
            items={library.media}
            loading={library.loading}
            loadingMore={library.loadingMoreMedia}
            onContextMenu={onMediaContextMenu}
            onOpenPreview={handleOpenPreview}
            onRequestMore={library.loadMoreMedia}
            onRequestThumbnailStates={library.requestThumbnailStates}
            onSelect={library.setSelectedMediaId}
            selectedMediaId={library.selectedMediaId}
            thumbnailStatesByMediaId={library.thumbnailStatesByMediaId}
          />
        )}
      </div>

      <PreviewPanel
        selectedMedia={library.selectedMedia}
        thumbnail={
          library.selectedMedia ? library.thumbnailStatesByMediaId[library.selectedMedia.id] : undefined
        }
        onOpenPreview={
          library.selectedMedia ? () => handleOpenPreview(library.selectedMedia!.id) : undefined
        }
      >
        {library.selectedMedia ? (
          <InspectorMetadata
            fileId={library.selectedMedia.id}
            metadata={library.selectedMetadata}
            tags={library.tags}
            tagsById={library.tagsById}
            saving={library.metadataSaving}
            onUpdate={library.updateMetadata}
            onAddTag={library.addFileTag}
            onRemoveTag={library.removeFileTag}
            onCreateTag={library.createTag}
          />
        ) : null}
      </PreviewPanel>

      <PreviewDialog
        media={library.selectedMedia}
        onClose={onClosePreview}
        open={previewOpen}
        thumbnail={
          library.selectedMedia
            ? library.thumbnailStatesByMediaId[library.selectedMedia.id]
            : undefined
        }
      />
    </section>
  );
}

function renderEmptyState({
  library,
  selectedRoot
}: {
  library: LibraryState;
  selectedRoot: RootRecord | null;
}) {
  if (library.loading || library.media.length > 0) {
    return null;
  }

  if (library.searchActive) {
    return (
      <div className="grid-empty grid-empty-search" role="status">
        <p className="grid-empty-title">Nothing matched.</p>
        <p className="grid-empty-copy">
          Try different filters, or clear the current ones.
        </p>
        <LiquidGlassButton
          className="grid-empty-action"
          onClick={() => library.clearFilters()}
          tone="primary"
          type="button"
        >
          Clear filters
        </LiquidGlassButton>
      </div>
    );
  }

  if (selectedRoot) {
    return (
      <div className="grid-empty grid-empty-folder" role="status">
        <p className="grid-empty-title">Empty folder</p>
        <p className="grid-empty-copy">
          Add image or video files in{" "}
          <code className="grid-empty-path" title={selectedRoot.path}>
            {selectedRoot.path}
          </code>{" "}
          and they&rsquo;ll appear here.
        </p>
      </div>
    );
  }

  return null;
}
