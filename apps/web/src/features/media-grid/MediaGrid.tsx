import { useVirtualizer } from "@tanstack/react-virtual";
import type { KeyboardEvent } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { MediaRecord, ThumbnailResponse } from "@megle/core-client";
import {
  mediaContentSignature,
  previewPlaceholderDataUrl,
  requestThumbnailBlob,
  type ThumbnailRequestPriority
} from "../../core/mediaResources";
import { workbenchLayout } from "../../design/tokens";
import type { LibraryLayoutMode } from "./layoutMode";
import {
  buildLayoutGeometry,
  collectPlacementIndexesFromSegmentRange,
  collectScopedMediaInViewport,
  findDirectionalNeighborIndex,
  resolveScrollTopForPlacement
} from "./layoutGeometry";

const AHEAD_THUMBNAIL_ROW_COUNT = 4;
const FOREGROUND_THUMBNAIL_REPOLL_MS = 250;
const VISIBLE_PRIORITY_ITEM_LIMIT = 10;
const AHEAD_PRIORITY_ITEM_LIMIT = 10;
const LOAD_MORE_ROW_HEIGHT = 52;
const scrollPositionByKey = new Map<string, number>();

interface MediaGridProps {
  aheadRowCount?: number;
  items: MediaRecord[];
  layoutMode: LibraryLayoutMode;
  selectedMediaId: number | null;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onSelect: (mediaId: number) => void;
  onOpenPreview: (mediaId: number) => void;
  onRequestMore: () => void;
  onRequestThumbnailStates: (mediaIds: number[], priority: ThumbnailRequestPriority) => void;
  scrollPositionKey?: string;
  thumbnailStatesByMediaId: Record<number, ThumbnailResponse>;
  onContextMenu?: (event: { item: MediaRecord; x: number; y: number; shiftKey: boolean }) => void;
}

export function MediaGrid({
  aheadRowCount = AHEAD_THUMBNAIL_ROW_COUNT,
  items,
  layoutMode,
  selectedMediaId,
  loading,
  loadingMore,
  hasMore,
  onRequestMore,
  onRequestThumbnailStates,
  onOpenPreview,
  onSelect,
  scrollPositionKey,
  thumbnailStatesByMediaId,
  onContextMenu
}: MediaGridProps) {
  const savedScrollTop = scrollPositionKey ? (scrollPositionByKey.get(scrollPositionKey) ?? 0) : 0;
  const parentRef = useRef<HTMLDivElement | null>(null);
  const scrollPersistenceUnlockedRef = useRef(false);
  const restoringScrollRef = useRef(false);
  const [viewportSize, setViewportSize] = useState({ height: 0, width: 0 });
  const [scrollTop, setScrollTop] = useState(savedScrollTop);

  useEffect(() => {
    const element = parentRef.current;
    if (!element) return;

    scrollPersistenceUnlockedRef.current = false;
    const observer = new ResizeObserver(([entry]) => {
      setViewportSize({
        height: entry.contentRect.height,
        width: entry.contentRect.width
      });
    });
    observer.observe(element);

    const unlockScrollPersistence = () => {
      scrollPersistenceUnlockedRef.current = true;
    };
    const updateScrollTop = () => {
      const nextScrollTop = element.scrollTop;
      setScrollTop(nextScrollTop);
      if (scrollPositionKey && !restoringScrollRef.current && scrollPersistenceUnlockedRef.current) {
        scrollPositionByKey.set(scrollPositionKey, nextScrollTop);
      }
    };

    element.addEventListener("scroll", updateScrollTop, { passive: true });
    element.addEventListener("wheel", unlockScrollPersistence, { passive: true });
    element.addEventListener("pointerdown", unlockScrollPersistence, { passive: true });
    element.addEventListener("keydown", unlockScrollPersistence);
    setViewportSize({ height: element.clientHeight, width: element.clientWidth });
    setScrollTop(savedScrollTop);
    if (scrollPositionKey) {
      scrollPositionByKey.set(scrollPositionKey, savedScrollTop);
    }

    return () => {
      element.removeEventListener("scroll", updateScrollTop);
      element.removeEventListener("wheel", unlockScrollPersistence);
      element.removeEventListener("pointerdown", unlockScrollPersistence);
      element.removeEventListener("keydown", unlockScrollPersistence);
      observer.disconnect();
    };
  }, [savedScrollTop, scrollPositionKey]);

  const layout = useMemo(
    () =>
      buildLayoutGeometry({
        gap: workbenchLayout.tileGap,
        items,
        labelHeight: workbenchLayout.tileLabelHeight,
        layoutMode,
        viewportWidth: viewportSize.width,
        tileMinWidth: workbenchLayout.tileMinWidth
      }),
    [items, layoutMode, viewportSize.width]
  );
  const itemIndexById = useMemo(() => {
    const map = new Map<number, number>();
    items.forEach((item, index) => {
      map.set(item.id, index);
    });
    return map;
  }, [items]);
  const placementSegmentIndexByPlacementIndex = useMemo(() => {
    const map = new Map<number, number>();
    layout.segments.forEach((segment, segmentIndex) => {
      segment.itemIndexes.forEach((placementIndex) => {
        if (!map.has(placementIndex)) {
          map.set(placementIndex, segmentIndex);
        }
      });
    });
    return map;
  }, [layout.segments]);

  const virtualRows = useVirtualizer({
    count: layout.segments.length + (hasMore ? 1 : 0),
    getScrollElement: () => parentRef.current,
    estimateSize: (index) =>
      index < layout.segments.length
        ? layout.segments[index]?.size ?? layout.estimatedSegmentSize
        : LOAD_MORE_ROW_HEIGHT,
    initialOffset: savedScrollTop,
    overscan: layoutMode === "waterfall" ? 6 : 4
  });
  const virtualItems = virtualRows.getVirtualItems();

  useLayoutEffect(() => {
    const element = parentRef.current;
    if (!element) return;
    if (savedScrollTop > 0 && items.length === 0) {
      return;
    }

    restoringScrollRef.current = true;
    if (element.scrollTop !== savedScrollTop) {
      element.scrollTop = savedScrollTop;
    }
    setScrollTop(savedScrollTop);
    if (scrollPositionKey) {
      scrollPositionByKey.set(scrollPositionKey, savedScrollTop);
    }

    const restoreFrame = window.requestAnimationFrame(() => {
      restoringScrollRef.current = false;
    });
    return () => {
      window.cancelAnimationFrame(restoreFrame);
      restoringScrollRef.current = false;
    };
  }, [items.length, savedScrollTop, scrollPositionKey]);

  useEffect(() => {
    const lastVirtualItem = virtualItems.at(-1);
    if (!hasMore || loadingMore || !lastVirtualItem || layout.segments.length === 0) {
      return;
    }
    if (lastVirtualItem.index >= layout.segments.length - 2) {
      onRequestMore();
    }
  }, [hasMore, layout.segments.length, loadingMore, onRequestMore, virtualItems]);

  const visibleRangeEnd = scrollTop + Math.max(viewportSize.height, layout.estimatedSegmentSize);
  const visibleMedia = useMemo(
    () =>
      collectScopedMediaInViewport(layout, scrollTop, visibleRangeEnd, {
        excludeMediaId: selectedMediaId
      }),
    [layout, scrollTop, selectedMediaId, visibleRangeEnd]
  );
  const aheadMedia = useMemo(() => {
    const aheadStart = visibleRangeEnd;
    const aheadEnd = aheadStart + aheadRowCount * layout.estimatedSegmentSize;
    return collectScopedMediaInViewport(layout, aheadStart, aheadEnd, {
      excludeMediaId: selectedMediaId
    });
  }, [aheadRowCount, layout, selectedMediaId, visibleRangeEnd]);

  const visibleMediaIds = visibleMedia.ids;
  const visibleMediaContentSignatures = useMemo(
    () =>
      visibleMediaIds
        .map((mediaId) => {
          const itemIndex = itemIndexById.get(mediaId);
          return itemIndex !== undefined ? mediaContentSignature(items[itemIndex]) : "";
        })
        .filter(Boolean)
        .join("|"),
    [itemIndexById, items, visibleMediaIds]
  );
  const visibleMediaSignatureKey = visibleMedia.signatureKey || visibleMediaContentSignatures;
  const aheadMediaIds = aheadMedia.ids;
  const aheadMediaSignatureKey = aheadMedia.signatureKey;
  const visiblePriorityMediaIds = useMemo(
    () => visibleMediaIds.slice(0, VISIBLE_PRIORITY_ITEM_LIMIT),
    [visibleMediaIds]
  );
  const visibleOverflowMediaIds = useMemo(
    () => visibleMediaIds.slice(VISIBLE_PRIORITY_ITEM_LIMIT),
    [visibleMediaIds]
  );
  const aheadPriorityMediaIds = useMemo(
    () =>
      [...new Set([...visibleOverflowMediaIds, ...aheadMediaIds])].slice(0, AHEAD_PRIORITY_ITEM_LIMIT),
    [aheadMediaIds, visibleOverflowMediaIds]
  );
  const visiblePriorityMediaKey = visiblePriorityMediaIds.join(":");
  const aheadPriorityMediaKey = aheadPriorityMediaIds.join(":");
  const hasVisiblePending = useMemo(
    () =>
      visiblePriorityMediaIds.some((mediaId) => {
        const item = itemIndexById.get(mediaId);
        return item !== undefined
          ? shouldRefreshThumbnailState(items[item], thumbnailStatesByMediaId[mediaId])
          : false;
      }),
    [itemIndexById, items, thumbnailStatesByMediaId, visiblePriorityMediaIds]
  );
  const hasAheadPending = useMemo(
    () =>
      aheadPriorityMediaIds.some((mediaId) => {
        const item = itemIndexById.get(mediaId);
        return item !== undefined
          ? shouldRefreshThumbnailState(items[item], thumbnailStatesByMediaId[mediaId])
          : false;
      }),
    [aheadPriorityMediaIds, itemIndexById, items, thumbnailStatesByMediaId]
  );

  useEffect(() => {
    if (visiblePriorityMediaIds.length === 0) {
      return;
    }
    onRequestThumbnailStates(visiblePriorityMediaIds, "visible");
  }, [
    onRequestThumbnailStates,
    visiblePriorityMediaIds,
    visiblePriorityMediaKey,
    visibleMediaSignatureKey
  ]);

  useEffect(() => {
    if (aheadPriorityMediaIds.length === 0) {
      return;
    }
    onRequestThumbnailStates(aheadPriorityMediaIds, "ahead");
  }, [
    aheadPriorityMediaIds,
    aheadPriorityMediaKey,
    aheadMediaSignatureKey,
    onRequestThumbnailStates
  ]);

  useEffect(() => {
    if (!hasVisiblePending && !hasAheadPending) {
      return;
    }

    const timer = window.setTimeout(() => {
      if (hasVisiblePending) {
        onRequestThumbnailStates(visiblePriorityMediaIds, "visible");
      }
      if (hasAheadPending) {
        onRequestThumbnailStates(aheadPriorityMediaIds, "ahead");
      }
    }, FOREGROUND_THUMBNAIL_REPOLL_MS);
    return () => window.clearTimeout(timer);
  }, [
    aheadPriorityMediaIds,
    aheadPriorityMediaKey,
    aheadMediaSignatureKey,
    hasAheadPending,
    hasVisiblePending,
    onRequestThumbnailStates,
    visiblePriorityMediaIds,
    visiblePriorityMediaKey,
    visibleMediaSignatureKey
  ]);

  if (loading && items.length === 0) {
    return renderLoadingState(layoutMode);
  }

  if (!loading && items.length === 0) {
    return <div className="grid-empty">No indexed media</div>;
  }

  const renderedPlacementIndexes = collectPlacementIndexesFromSegmentRange(
    layout,
    virtualItems.find((item) => item.index < layout.segments.length)?.index ?? 0,
    virtualItems
      .filter((item) => item.index < layout.segments.length)
      .at(-1)?.index ?? -1
  );

  function moveSelection(direction: "left" | "right" | "up" | "down") {
    if (items.length === 0) return;
    const currentIndex =
      selectedMediaId !== null ? itemIndexById.get(selectedMediaId) ?? 0 : 0;
    const nextIndex = findDirectionalNeighborIndex(layout.placements, currentIndex, direction);
    selectIndex(nextIndex);
  }

  function selectIndex(index: number) {
    const item = items[index];
    const placement = layout.placements[index];
    if (!item || !placement) return;

    onSelect(item.id);
    const segmentIndex = placementSegmentIndexByPlacementIndex.get(index);
    if (segmentIndex !== undefined) {
      virtualRows.scrollToIndex(segmentIndex, { align: "auto" });
    }
    const element = parentRef.current;
    if (!element) {
      return;
    }
    const nextScrollTop = resolveScrollTopForPlacement(
      placement,
      element.clientHeight,
      element.scrollTop,
      layout.totalSize
    );
    if (nextScrollTop !== element.scrollTop) {
      scrollPersistenceUnlockedRef.current = true;
      element.scrollTop = nextScrollTop;
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveSelection("right");
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveSelection("left");
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection("down");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection("up");
    } else if (event.key === "Home" && items[0]) {
      event.preventDefault();
      selectIndex(0);
    } else if (event.key === "End" && items[items.length - 1]) {
      event.preventDefault();
      selectIndex(items.length - 1);
    } else if ((event.key === "Enter" || event.key === " ") && selectedMediaId !== null) {
      event.preventDefault();
      onOpenPreview(selectedMediaId);
    }
  }

  return (
    <div
      aria-label={`Media ${layoutMode} view`}
      className={`virtual-grid virtual-grid--${layoutMode}`}
      ref={parentRef}
      role="grid"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div className="virtual-grid-spacer" style={{ height: virtualRows.getTotalSize() }}>
        {renderedPlacementIndexes.map((placementIndex) => {
          const placement = layout.placements[placementIndex];
          const item = placement?.item;
          if (!placement || !item) {
            return null;
          }

          return (
            <div
              aria-selected={item.id === selectedMediaId}
              className={`media-gridcell media-gridcell--${layoutMode}`}
              key={item.id}
              role="gridcell"
              style={{
                height: placement.height,
                left: placement.left,
                position: "absolute",
                top: placement.top,
                width: placement.width
              }}
            >
              <MediaTile
                item={item}
                layoutMode={layoutMode}
                onContextMenu={onContextMenu}
                onOpenPreview={onOpenPreview}
                onSelect={onSelect}
                placement={placement}
                selected={item.id === selectedMediaId}
                thumbnail={thumbnailStatesByMediaId[item.id]}
              />
            </div>
          );
        })}

        {hasMore && virtualItems.some((item) => item.index >= layout.segments.length) ? (
          <div
            className={`virtual-grid-row load-more-row load-more-row--${layoutMode}`}
            role="row"
            style={{
              height: LOAD_MORE_ROW_HEIGHT,
              left: 0,
              position: "absolute",
              top:
                virtualItems.find((item) => item.index >= layout.segments.length)?.start ?? layout.totalSize,
              width: "100%"
            }}
          >
            <div className="load-more-button" role="gridcell">
              <button disabled={loadingMore} onClick={onRequestMore} type="button">
                {loadingMore ? "Loading more media" : "Load more media"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MediaTile({
  item,
  layoutMode,
  onSelect,
  onOpenPreview,
  onContextMenu,
  placement,
  selected,
  thumbnail
}: {
  item: MediaRecord;
  layoutMode: LibraryLayoutMode;
  onSelect: (mediaId: number) => void;
  onOpenPreview: (mediaId: number) => void;
  onContextMenu?: (event: { item: MediaRecord; x: number; y: number; shiftKey: boolean }) => void;
  placement: { frameHeight: number; thumbHeight: number; thumbWidth: number; width: number };
  selected: boolean;
  thumbnail?: ThumbnailResponse;
}) {
  const listMode = layoutMode === "list";
  return (
    <button
      aria-label={`Select ${item.name}; press Enter or Space, or double-click, to open preview`}
      className={selected ? `media-tile media-tile--${layoutMode} selected` : `media-tile media-tile--${layoutMode}`}
      onClick={() => {
        onSelect(item.id);
      }}
      onDoubleClick={() => {
        onSelect(item.id);
        onOpenPreview(item.id);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          onSelect(item.id);
          onOpenPreview(item.id);
        }
      }}
      onContextMenu={(event) => {
        if (!onContextMenu) return;
        event.preventDefault();
        onSelect(item.id);
        onContextMenu({ item, x: event.clientX, y: event.clientY, shiftKey: event.shiftKey });
      }}
      style={
        listMode
          ? {
              alignItems: "center",
              columnGap: 12,
              display: "grid",
              gridTemplateColumns: `${placement.thumbWidth}px minmax(0, 1fr)`,
              height: placement.frameHeight,
              padding: 8,
              width: "100%"
            }
          : {
              display: "flex",
              flexDirection: "column",
              gap: 6,
              height: placement.frameHeight,
              padding: 0,
              width: "100%"
            }
      }
      type="button"
    >
      <ThumbnailStateView
        item={item}
        layoutMode={layoutMode}
        thumbnail={thumbnail}
        thumbHeight={placement.thumbHeight}
        thumbWidth={placement.thumbWidth}
      />
      {listMode ? (
        <div className="media-tile-text" style={{ minWidth: 0 }}>
          <div
            className="tile-label tile-label--list"
            style={{
              height: "auto",
              marginTop: 0,
              textAlign: "left",
              whiteSpace: "nowrap"
            }}
            title={item.name}
          >
            {item.name}
          </div>
          <div
            className="tile-meta"
            style={{
              color: "var(--text-muted)",
              fontSize: 12,
              lineHeight: 1.3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}
            title={mediaMetadataSummary(item)}
          >
            {mediaMetadataSummary(item)}
          </div>
        </div>
      ) : (
        <div className="tile-label" title={item.name}>
          {item.name}
        </div>
      )}
    </button>
  );
}

function ThumbnailStateView({
  item,
  layoutMode,
  thumbnail,
  thumbHeight,
  thumbWidth
}: {
  item: MediaRecord;
  layoutMode: LibraryLayoutMode;
  thumbnail?: ThumbnailResponse;
  thumbHeight: number;
  thumbWidth: number;
}) {
  const state = thumbnail?.state ?? normalizeMediaThumbnailState(item.thumbnailState);
  const previewPlaceholderUrl = previewPlaceholderDataUrl(item);
  const hasLiveReadyThumbnail = thumbnail?.state === "ready" && thumbnail.updatedAt !== null;
  const canLoadCurrentThumbnailBlob = state === "ready";
  const presentationStyle = thumbnailPresentationStyle(layoutMode, thumbWidth, thumbHeight);

  if (canLoadCurrentThumbnailBlob) {
    return (
      <ReadyThumbnail
        alt={item.name}
        className={`tile-thumb tile-thumb--${layoutMode}`}
        fileId={item.id}
        previewPlaceholderUrl={previewPlaceholderUrl}
        style={presentationStyle}
        thumbnailUpdatedAt={hasLiveReadyThumbnail ? thumbnail.updatedAt : null}
      />
    );
  }

  if (state === "failed") {
    return (
      <div className={`tile-thumb tile-thumb-failed tile-thumb--${layoutMode}`} style={presentationStyle}>
        <span>failed</span>
      </div>
    );
  }

  if (state === "skipped_small") {
    if (previewPlaceholderUrl) {
      return (
        <PlaceholderThumbnail
          alt={item.name}
          className={`tile-thumb tile-thumb-placeholder tile-thumb--${layoutMode}`}
          src={previewPlaceholderUrl}
          style={presentationStyle}
        />
      );
    }
    return (
      <div className={`tile-thumb tile-thumb-skipped tile-thumb--${layoutMode}`} style={presentationStyle}>
        <span>{item.kind ?? "file"}</span>
      </div>
    );
  }

  if (state === "queued") {
    if (previewPlaceholderUrl) {
      return (
        <PlaceholderThumbnail
          alt={item.name}
          className={`tile-thumb tile-thumb-placeholder tile-thumb--${layoutMode}`}
          src={previewPlaceholderUrl}
          style={presentationStyle}
        />
      );
    }
    return (
      <div className={`tile-thumb tile-thumb-loading tile-thumb--${layoutMode}`} style={presentationStyle}>
        <span>queued</span>
      </div>
    );
  }

  if (previewPlaceholderUrl) {
    return (
      <PlaceholderThumbnail
        alt={item.name}
        className={`tile-thumb tile-thumb-placeholder tile-thumb--${layoutMode}`}
        src={previewPlaceholderUrl}
        style={presentationStyle}
      />
    );
  }

  return (
    <div className={`tile-thumb tile-thumb-loading tile-thumb--${layoutMode}`} style={presentationStyle}>
      <span>pending</span>
    </div>
  );
}

function thumbnailPresentationStyle(
  layoutMode: LibraryLayoutMode,
  thumbWidth: number,
  thumbHeight: number
): CSSProperties {
  if (layoutMode === "list") {
    return {
      height: thumbHeight,
      width: thumbWidth
    };
  }

  return {
    aspectRatio: `${Math.max(1, Math.round(thumbWidth))} / ${Math.max(1, Math.round(thumbHeight))}`,
    width: "100%"
  };
}

function normalizeMediaThumbnailState(value: string | null | undefined): ThumbnailResponse["state"] {
  if (
    value === "pending" ||
    value === "queued" ||
    value === "ready" ||
    value === "failed" ||
    value === "skipped_small"
  ) {
    return value;
  }
  return "pending";
}

function shouldRefreshThumbnailState(
  item: MediaRecord,
  thumbnail: ThumbnailResponse | undefined
): boolean {
  const rowState = normalizeMediaThumbnailState(item.thumbnailState);
  const hasLiveThumbnailMetadata = thumbnail?.state === "ready" && thumbnail.updatedAt !== null;
  if (!hasLiveThumbnailMetadata && rowState === "ready") {
    return true;
  }
  const state = thumbnail?.state ?? rowState;
  return state === "pending" || state === "queued";
}

function renderLoadingState(layoutMode: LibraryLayoutMode) {
  return (
    <div className={`virtual-grid virtual-grid--${layoutMode} media-grid-loading`} role="status">
      <div className="grid-empty">Loading media...</div>
    </div>
  );
}

function mediaMetadataSummary(item: MediaRecord) {
  const parts: string[] = [];
  if (item.kind) {
    parts.push(item.kind);
  } else if (item.ext) {
    parts.push(item.ext.toUpperCase());
  }
  if (item.width && item.height) {
    parts.push(`${item.width}×${item.height}`);
  }
  if (item.size > 0) {
    parts.push(formatByteSize(item.size));
  }
  return parts.join(" • ");
}

function formatByteSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function PlaceholderThumbnail({
  alt,
  className,
  src,
  style
}: {
  alt: string;
  className: string;
  src: string;
  style: CSSProperties;
}) {
  return (
    <div className={className} data-preview-placeholder="grid" style={style}>
      <img alt={alt} className="tile-thumb-image" loading="lazy" src={src} />
    </div>
  );
}

function ReadyThumbnail({
  alt,
  className,
  fileId,
  previewPlaceholderUrl,
  style,
  thumbnailUpdatedAt
}: {
  alt: string;
  className: string;
  fileId: number;
  previewPlaceholderUrl: string | null;
  style: CSSProperties;
  thumbnailUpdatedAt: number | null;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    setError(false);
    setSrc(null);

    requestThumbnailBlob(fileId, thumbnailUpdatedAt)
      .then((blob) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!revoked) setError(true);
      });

    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileId, thumbnailUpdatedAt]);

  if (error) {
    return (
      <div className={`${className} tile-thumb-failed`} style={style}>
        <span>load error</span>
      </div>
    );
  }

  if (!src) {
    if (previewPlaceholderUrl) {
      return (
        <PlaceholderThumbnail alt={alt} className={className} src={previewPlaceholderUrl} style={style} />
      );
    }
    return (
      <div className={`${className} tile-thumb-loading`} style={style}>
        <span>loading</span>
      </div>
    );
  }

  return (
    <div className={className} style={style}>
      <img alt={alt} className="tile-thumb-image" loading="lazy" src={src} />
    </div>
  );
}
