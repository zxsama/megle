import { useEffect, useState } from "react";
import type { MediaRecord, RootRecord } from "@megle/core-client";
import { Check } from "lucide-react";
import type { LibraryState } from "../../core/useLibraryData";
import { LiquidGlassButton } from "../../design/liquid-glass";
import { MediaGrid } from "../media-grid/MediaGrid";
import type { LibraryGridPreferences } from "../media-grid/gridPreferences";
import type { LibraryLayoutMode } from "../media-grid/layoutMode";
import { CentralPreviewStage } from "../preview/CentralPreviewStage";
import { InspectorMetadata } from "../preview/InspectorMetadata";
import { PreviewPanel } from "../preview/PreviewPanel";
import { SubfolderStrip } from "./SubfolderStrip";
import { useFolderCovers } from "./useFolderCovers";

const AHEAD_THUMBNAIL_ROW_COUNT = 4;
const SUBFOLDER_STRIP_COLLAPSED_STORAGE_KEY = "megle.library.subfolder-strip-collapsed";

interface LibraryViewProps {
  gridPreferences: LibraryGridPreferences;
  library: LibraryState;
  layoutMode: LibraryLayoutMode;
  previewOpen: boolean;
  onOpenPreview: (mediaId: number) => void;
  onClosePreview: () => void;
  onPreviewPrevious: () => void;
  onPreviewNext: () => void;
  onPreviewViewStateChange: (state: { mode: "fit-long-edge" | "actual"; scale: number }) => void;
  onPreviewCommandChange: (commands: {
    reset: () => void;
    toggleActualSize: () => void;
  } | null) => void;
  onMediaContextMenu?: (event: {
    item: MediaRecord;
    x: number;
    y: number;
    shiftKey: boolean;
  }) => void;
}

export function LibraryView({
  gridPreferences,
  library,
  layoutMode,
  onClosePreview,
  onMediaContextMenu,
  onOpenPreview,
  onPreviewCommandChange,
  onPreviewNext,
  onPreviewPrevious,
  onPreviewViewStateChange,
  previewOpen
}: LibraryViewProps) {
  return (
    <>
      <LibraryCenterPane
        gridPreferences={gridPreferences}
        library={library}
        layoutMode={layoutMode}
        onClosePreview={onClosePreview}
        onMediaContextMenu={onMediaContextMenu}
        onOpenPreview={onOpenPreview}
        onPreviewCommandChange={onPreviewCommandChange}
        onPreviewNext={onPreviewNext}
        onPreviewPrevious={onPreviewPrevious}
        onPreviewViewStateChange={onPreviewViewStateChange}
        previewOpen={previewOpen}
      />
      <LibraryInspectorPane library={library} previewOpen={previewOpen} />
    </>
  );
}

export function LibraryCenterPane({
  gridPreferences,
  library,
  layoutMode,
  onClosePreview,
  onMediaContextMenu,
  onOpenPreview,
  onPreviewCommandChange,
  onPreviewNext,
  onPreviewPrevious,
  onPreviewViewStateChange,
  previewOpen
}: LibraryViewProps) {
  const selectedRoot = library.roots.find((root) => root.id === library.selectedRootId) ?? null;
  const selectedMedia = library.selectedMedia;
  const previewMedia = previewOpen && selectedMedia ? selectedMedia : null;
  const mediaScrollKey = mediaScrollPositionKey(
    layoutMode,
    library.selectedRootId,
    library.selectedFolderId
  );
  const [subfolderStripCollapsed, setSubfolderStripCollapsed] = useState<boolean>(() =>
    readStoredSubfolderStripCollapsed()
  );
  const currentFolderId = library.selectedFolderId ?? selectedRoot?.rootFolderId ?? null;
  const childFolders = currentFolderId ? library.folderChildrenByParent[currentFolderId] ?? [] : [];
  const childFoldersLoading = currentFolderId ? library.loadingFolderIds.has(currentFolderId) : false;
  const showSubfolderStrip = !previewMedia && (childFolders.length > 0 || childFoldersLoading);
  const coverMediaByFolderId = useFolderCovers(childFolders);
  const contentCountLabel = `${library.media.length}${library.mediaHasMore ? "+" : ""}`;

  useEffect(() => {
    if (previewOpen && !selectedMedia) {
      onClosePreview();
    }
  }, [onClosePreview, previewOpen, selectedMedia]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SUBFOLDER_STRIP_COLLAPSED_STORAGE_KEY,
        subfolderStripCollapsed ? "1" : "0"
      );
    } catch {
      // Ignore storage failures.
    }
  }, [subfolderStripCollapsed]);

  function handleOpenPreview(mediaId: number) {
    onOpenPreview(mediaId);
  }

  return (
    <section className="workspace" aria-label="Library workbench">
      <section
        className={previewMedia ? "grid-surface grid-surface-preview" : "grid-surface"}
        aria-label="Media workspace"
      >
        {library.error ? <div className="error-strip">{library.error}</div> : null}
        <div className="library-grid-content">
          {previewMedia ? (
            <CentralPreviewStage
              selectedMedia={previewMedia}
              thumbnail={library.thumbnailStatesByMediaId[previewMedia.id]}
              onClosePreview={onClosePreview}
              onCommandChange={onPreviewCommandChange}
              onPreviewNext={onPreviewNext}
              onPreviewPrevious={onPreviewPrevious}
              onViewStateChange={onPreviewViewStateChange}
            />
          ) : (
            <div className="library-browser-layout">
              {showSubfolderStrip ? (
                <SubfolderStrip
                  collapsed={subfolderStripCollapsed}
                  coverMediaByFolderId={coverMediaByFolderId}
                  folders={childFolders}
                  loading={childFoldersLoading}
                  onToggleCollapsed={() => setSubfolderStripCollapsed((current) => !current)}
                  onSelectFolder={library.setSelectedFolder}
                  selectedFolderId={library.selectedFolderId}
                />
              ) : null}
              <div className="library-browser-content">
                <div className="library-browser-content-header">
                  <div className="library-browser-content-title">{`Contents (${contentCountLabel})`}</div>
                  {showSubfolderStrip ? (
                    <label className="library-browser-content-toggle">
                      <input
                        checked={library.showChildFolderContents}
                        onChange={() => library.toggleShowChildFolderContents()}
                        type="checkbox"
                      />
                      <span className="library-browser-content-toggle-indicator" aria-hidden="true">
                        <Check size={12} />
                      </span>
                      <span className="library-browser-content-toggle-label">
                        Show child folder contents
                      </span>
                    </label>
                  ) : null}
                </div>
                {renderEmptyState({ library, selectedRoot }) ?? (
                  <MediaGrid
                    aheadRowCount={AHEAD_THUMBNAIL_ROW_COUNT}
                    gridPreferences={gridPreferences}
                    hasMore={library.mediaHasMore}
                    items={library.media}
                    layoutMode={layoutMode}
                    loading={library.loading}
                    loadingMore={library.loadingMoreMedia}
                    onContextMenu={onMediaContextMenu}
                    onOpenPreview={handleOpenPreview}
                    onRequestMore={library.loadMoreMedia}
                    onRequestThumbnailStates={library.requestThumbnailStates}
                    onSelect={library.setSelectedMediaId}
                    scrollPositionKey={mediaScrollKey}
                    selectedMediaId={library.selectedMediaId}
                    thumbnailStatesByMediaId={library.thumbnailStatesByMediaId}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </section>
  );
}

export function LibraryInspectorPane({
  library,
  previewOpen
}: Pick<LibraryViewProps, "library" | "previewOpen">) {
  const selectedMedia = library.selectedMedia;

  return (
    <PreviewPanel
      selectedMedia={selectedMedia}
      showPreviewImage={!previewOpen}
      thumbnail={selectedMedia ? library.thumbnailStatesByMediaId[selectedMedia.id] : undefined}
    >
      {selectedMedia ? (
        <InspectorMetadata
          fileId={selectedMedia.id}
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
          </code>
          {library.showChildFolderContents
            ? " or its child folders and they\u2019ll appear here."
            : " and they\u2019ll appear here."}
        </p>
      </div>
    );
  }

  return null;
}

function mediaScrollPositionKey(
  layoutMode: LibraryLayoutMode,
  rootId: number | null,
  folderId: number | null
): string {
  return `${layoutMode}:${rootId ?? "root"}:${folderId ?? "folder"}`;
}

function readStoredSubfolderStripCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SUBFOLDER_STRIP_COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
