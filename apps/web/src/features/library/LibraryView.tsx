import { RefreshCw } from "lucide-react";
import type { LibraryState } from "../../core/useLibraryData";
import { MediaGrid } from "../media-grid/MediaGrid";
import { InspectorMetadata } from "../preview/InspectorMetadata";
import { PreviewPanel } from "../preview/PreviewPanel";
import { FilterChips } from "./FilterChips";
import { SearchBar } from "./SearchBar";
import { SortMenu } from "./SortMenu";

interface LibraryViewProps {
  library: LibraryState;
}

export function LibraryView({ library }: LibraryViewProps) {
  const selectedRoot = library.roots.find((root) => root.id === library.selectedRootId) ?? null;
  const selectedFolder = library.folders.find((folder) => folder.id === library.selectedFolderId);

  return (
    <section className="workspace" aria-label="Library workbench">
      <header className="toolbar toolbar-library">
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
      </header>
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
    </section>
  );
}
