import { useVirtualizer } from "@tanstack/react-virtual";
import type { KeyboardEvent } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MediaRecord, ThumbnailResponse } from "@megle/core-client";
import {
  mediaContentSignature,
  previewPlaceholderDataUrl,
  requestThumbnailBlob,
  type ThumbnailRequestPriority
} from "../../core/mediaResources";
import { workbenchLayout } from "../../design/tokens";

const AHEAD_THUMBNAIL_ROW_COUNT = 4;
const FOREGROUND_THUMBNAIL_REPOLL_MS = 250;
const VISIBLE_PRIORITY_ITEM_LIMIT = 10;
const AHEAD_PRIORITY_ITEM_LIMIT = 10;
const scrollPositionByKey = new Map<string, number>();

interface MediaGridProps {
  aheadRowCount?: number;
  items: MediaRecord[];
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
      if (
        scrollPositionKey &&
        !restoringScrollRef.current &&
        scrollPersistenceUnlockedRef.current
      ) {
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

  const columnCount = Math.max(
    1,
    Math.floor(
      (viewportSize.width + workbenchLayout.tileGap) /
        (workbenchLayout.tileMinWidth + workbenchLayout.tileGap)
    )
  );
  const tileWidth = Math.max(
    workbenchLayout.tileMinWidth,
    Math.floor((viewportSize.width - workbenchLayout.tileGap * (columnCount - 1)) / columnCount)
  );
  const rowHeight = tileWidth + workbenchLayout.tileLabelHeight + workbenchLayout.tileGap;
  const rows = useMemo(() => chunk(items, columnCount), [columnCount, items]);
  const virtualRows = useVirtualizer({
    count: loading && items.length === 0 ? 4 : rows.length + (hasMore ? 1 : 0),
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    initialOffset: savedScrollTop,
    overscan: 4
  });
  const virtualItems = virtualRows.getVirtualItems();

  useLayoutEffect(() => {
    const element = parentRef.current;
    if (!element) return;
    if (savedScrollTop > 0 && items.length === 0) {
      return;
    }
    restoringScrollRef.current = true;
    if (element.scrollTop === savedScrollTop) {
      setScrollTop(savedScrollTop);
    } else {
      element.scrollTop = savedScrollTop;
      virtualRows.scrollToOffset(savedScrollTop);
      setScrollTop(savedScrollTop);
    }
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
  }, [items.length, savedScrollTop, scrollPositionKey, virtualRows]);

  useEffect(() => {
    const lastRow = virtualItems.at(-1);
    if (!hasMore || loadingMore || !lastRow || rows.length === 0) {
      return;
    }
    if (lastRow.index >= rows.length - 2) {
      onRequestMore();
    }
  }, [hasMore, loadingMore, onRequestMore, rows.length, virtualItems]);

  const visibleRowRange = useMemo(() => {
    if (rows.length === 0) {
      return null;
    }
    const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight));
    const endIndex = Math.min(
      rows.length - 1,
      Math.max(
        startIndex,
        Math.ceil((scrollTop + Math.max(viewportSize.height, rowHeight)) / rowHeight) - 1
      )
    );
    return { endIndex, startIndex };
  }, [rowHeight, rows.length, scrollTop, viewportSize.height]);

  const visibleMedia = useMemo(
    () =>
      collectScopedMedia(rows, visibleRowRange?.startIndex ?? 0, visibleRowRange?.endIndex ?? -1, {
        excludeMediaId: selectedMediaId
      }),
    [rows, selectedMediaId, visibleRowRange]
  );
  const aheadMedia = useMemo(() => {
    if (!visibleRowRange) {
      return emptyScopedMedia();
    }
    return collectScopedMedia(
      rows,
      visibleRowRange.endIndex + 1,
      Math.min(rows.length - 1, visibleRowRange.endIndex + aheadRowCount),
      { excludeMediaId: selectedMediaId }
    );
  }, [aheadRowCount, rows, selectedMediaId, visibleRowRange]);
  const visibleMediaIds = visibleMedia.ids;
  const visibleMediaSignatureKey = visibleMedia.signatureKey;
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
        const item = items.find((candidate) => candidate.id === mediaId);
        return item ? shouldRefreshThumbnailState(item, thumbnailStatesByMediaId[item.id]) : false;
      }),
    [items, thumbnailStatesByMediaId, visiblePriorityMediaIds]
  );
  const hasAheadPending = useMemo(
    () =>
      aheadPriorityMediaIds.some((mediaId) => {
        const item = items.find((candidate) => candidate.id === mediaId);
        return item ? shouldRefreshThumbnailState(item, thumbnailStatesByMediaId[item.id]) : false;
      }),
    [aheadPriorityMediaIds, items, thumbnailStatesByMediaId]
  );

  useEffect(() => {
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

  function moveSelection(offset: number) {
    if (items.length === 0) return;
    const currentIndex = Math.max(
      0,
      items.findIndex((item) => item.id === selectedMediaId)
    );
    const nextIndex = Math.min(items.length - 1, Math.max(0, currentIndex + offset));
    selectIndex(nextIndex);
  }

  function selectIndex(index: number) {
    const item = items[index];
    if (!item) return;

    onSelect(item.id);
    virtualRows.scrollToIndex(Math.floor(index / columnCount), { align: "auto" });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveSelection(-1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(columnCount);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-columnCount);
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

  if (!loading && items.length === 0) {
    return <div className="grid-empty">No indexed media</div>;
  }

  return (
    <div
      className="virtual-grid"
      ref={parentRef}
      role="grid"
      aria-label="Media grid"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div
        className="virtual-grid-spacer"
        style={{ height: virtualRows.getTotalSize() }}
      >
        {virtualItems.map((virtualRow) => {
          const row = rows[virtualRow.index] ?? [];
          const isLoadMoreRow = virtualRow.index >= rows.length;

          if (isLoadMoreRow) {
            return (
              <div
                className="virtual-grid-row load-more-row"
                key={virtualRow.key}
                role="row"
                style={{
                  height: rowHeight,
                  transform: `translateY(${virtualRow.start}px)`
                }}
              >
                <div
                  className="load-more-button"
                  role="gridcell"
                >
                  <button disabled={loadingMore} onClick={onRequestMore} type="button">
                    {loadingMore ? "Loading more media" : "Load more media"}
                  </button>
                </div>
              </div>
            );
          }

          return (
            <div
              className="virtual-grid-row"
              key={virtualRow.key}
              role="row"
              style={{
                gap: workbenchLayout.tileGap,
                height: rowHeight,
                transform: `translateY(${virtualRow.start}px)`
              }}
            >
              {loading && row.length === 0
                ? skeletonCells(columnCount, tileWidth)
                : row.map((item) => (
                    <MediaTile
                      item={item}
                      key={item.id}
                      onContextMenu={onContextMenu}
                      onOpenPreview={onOpenPreview}
                      onSelect={onSelect}
                      selected={item.id === selectedMediaId}
                      thumbnail={thumbnailStatesByMediaId[item.id]}
                      width={tileWidth}
                    />
                  ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function emptyScopedMedia() {
  return {
    ids: [] as number[],
    key: "",
    signatureKey: ""
  };
}

function collectScopedMedia(
  rows: MediaRecord[][],
  startIndex: number,
  endIndex: number,
  options: {
    excludeMediaId?: number | null;
  } = {}
) {
  if (startIndex > endIndex || rows.length === 0) {
    return emptyScopedMedia();
  }

  const mediaIdSet = new Set<number>();
  const mediaSignatures: string[] = [];
  const mediaIds: number[] = [];
  for (let rowIndex = startIndex; rowIndex <= endIndex; rowIndex += 1) {
    for (const item of rows[rowIndex] ?? []) {
      if (options.excludeMediaId === item.id) {
        continue;
      }
      if (mediaIdSet.has(item.id)) {
        continue;
      }
      mediaIdSet.add(item.id);
      mediaIds.push(item.id);
      mediaSignatures.push(mediaContentSignature(item));
    }
  }
  return {
    ids: mediaIds,
    key: mediaIds.join(":"),
    signatureKey: mediaSignatures.join("|")
  };
}

function MediaTile({
  item,
  onSelect,
  onOpenPreview,
  onContextMenu,
  selected,
  thumbnail,
  width
}: {
  item: MediaRecord;
  onSelect: (mediaId: number) => void;
  onOpenPreview: (mediaId: number) => void;
  onContextMenu?: (event: { item: MediaRecord; x: number; y: number; shiftKey: boolean }) => void;
  selected: boolean;
  thumbnail?: ThumbnailResponse;
  width: number;
}) {
  return (
    <div
      aria-selected={selected}
      className="media-gridcell"
      onContextMenu={(event) => {
        if (!onContextMenu) return;
        event.preventDefault();
        onSelect(item.id);
        onContextMenu({ item, x: event.clientX, y: event.clientY, shiftKey: event.shiftKey });
      }}
      role="gridcell"
      style={{ width }}
    >
      <button
        aria-label={`Select ${item.name}; press Enter or Space, or double-click, to open preview`}
        className={selected ? "media-tile selected" : "media-tile"}
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
        type="button"
      >
        <ThumbnailStateView item={item} thumbnail={thumbnail} />
        <div className="tile-label" title={item.name}>
          {item.name}
        </div>
      </button>
    </div>
  );
}

function ThumbnailStateView({
  item,
  thumbnail
}: {
  item: MediaRecord;
  thumbnail?: ThumbnailResponse;
}) {
  const state = thumbnail?.state ?? normalizeMediaThumbnailState(item.thumbnailState);
  const previewPlaceholderUrl = previewPlaceholderDataUrl(item);
  const hasLiveReadyThumbnail = thumbnail?.state === "ready" && thumbnail.updatedAt !== null;
  const canLoadCurrentThumbnailBlob = state === "ready";

  if (canLoadCurrentThumbnailBlob) {
    return (
      <ReadyThumbnail
        fileId={item.id}
        alt={item.name}
        previewPlaceholderUrl={previewPlaceholderUrl}
        thumbnailUpdatedAt={hasLiveReadyThumbnail ? thumbnail.updatedAt : null}
      />
    );
  }

  if (state === "failed") {
    return (
      <div className="tile-thumb tile-thumb-failed">
        <span>failed</span>
      </div>
    );
  }

  if (state === "skipped_small") {
    if (previewPlaceholderUrl) {
      return <PlaceholderThumbnail alt={item.name} src={previewPlaceholderUrl} />;
    }
    return (
      <div className="tile-thumb tile-thumb-skipped">
        <span>{item.kind ?? "file"}</span>
      </div>
    );
  }

  if (state === "queued") {
    if (previewPlaceholderUrl) {
      return <PlaceholderThumbnail alt={item.name} src={previewPlaceholderUrl} />;
    }
    return (
      <div className="tile-thumb tile-thumb-loading">
        <span>queued</span>
      </div>
    );
  }

  if (previewPlaceholderUrl) {
    return <PlaceholderThumbnail alt={item.name} src={previewPlaceholderUrl} />;
  }

  return (
    <div className="tile-thumb tile-thumb-loading">
      <span>pending</span>
    </div>
  );
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

function skeletonCells(count: number, width: number) {
  return Array.from({ length: count }, (_, index) => (
    <div
      aria-hidden="true"
      className="media-tile skeleton"
      key={index}
      role="gridcell"
      style={{ width }}
    >
      <div className="tile-thumb" />
      <div className="tile-label" />
    </div>
  ));
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}

function PlaceholderThumbnail({ alt, src }: { alt: string; src: string }) {
  return (
    <div className="tile-thumb tile-thumb-placeholder" data-preview-placeholder="grid">
      <img alt={alt} className="tile-thumb-image" loading="lazy" src={src} />
    </div>
  );
}

function ReadyThumbnail({
  fileId,
  alt,
  previewPlaceholderUrl,
  thumbnailUpdatedAt
}: {
  fileId: number;
  alt: string;
  previewPlaceholderUrl: string | null;
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
      <div className="tile-thumb tile-thumb-failed">
        <span>load error</span>
      </div>
    );
  }

  if (!src) {
    if (previewPlaceholderUrl) {
      return <PlaceholderThumbnail alt={alt} src={previewPlaceholderUrl} />;
    }
    return (
      <div className="tile-thumb tile-thumb-loading">
        <span>loading</span>
      </div>
    );
  }

  return (
    <div className="tile-thumb tile-thumb-ready">
      <img alt={alt} className="tile-thumb-image" loading="lazy" src={src} />
    </div>
  );
}
