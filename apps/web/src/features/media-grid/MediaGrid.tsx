import { useVirtualizer } from "@tanstack/react-virtual";
import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MediaRecord, ThumbnailResponse } from "@megle/core-client";
import { workbenchLayout } from "../../design/tokens";

interface MediaGridProps {
  items: MediaRecord[];
  selectedMediaId: number | null;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onSelect: (mediaId: number) => void;
  onRequestMore: () => void;
  onRequestThumbnailStates: (mediaIds: number[]) => void;
  thumbnailStatesByMediaId: Record<number, ThumbnailResponse>;
  onContextMenu?: (event: { item: MediaRecord; x: number; y: number; shiftKey: boolean }) => void;
}

export function MediaGrid({
  items,
  selectedMediaId,
  loading,
  loadingMore,
  hasMore,
  onRequestMore,
  onRequestThumbnailStates,
  onSelect,
  thumbnailStatesByMediaId,
  onContextMenu
}: MediaGridProps) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);

  useEffect(() => {
    const element = parentRef.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      setViewportWidth(entry.contentRect.width);
    });
    observer.observe(element);
    setViewportWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  const columnCount = Math.max(
    1,
    Math.floor(
      (viewportWidth + workbenchLayout.tileGap) /
        (workbenchLayout.tileMinWidth + workbenchLayout.tileGap)
    )
  );
  const tileWidth = Math.max(
    workbenchLayout.tileMinWidth,
    Math.floor((viewportWidth - workbenchLayout.tileGap * (columnCount - 1)) / columnCount)
  );
  const rowHeight = tileWidth + workbenchLayout.tileLabelHeight + workbenchLayout.tileGap;
  const rows = useMemo(() => chunk(items, columnCount), [columnCount, items]);
  const virtualRows = useVirtualizer({
    count: loading && items.length === 0 ? 4 : rows.length + (hasMore ? 1 : 0),
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 4
  });
  const virtualItems = virtualRows.getVirtualItems();

  useEffect(() => {
    const lastRow = virtualItems.at(-1);
    if (!hasMore || loadingMore || !lastRow || rows.length === 0) {
      return;
    }
    if (lastRow.index >= rows.length - 2) {
      onRequestMore();
    }
  }, [hasMore, loadingMore, onRequestMore, rows.length, virtualItems]);

  const visibleMedia = useMemo(() => {
    const mediaIdSet = new Set<number>();
    for (const virtualRow of virtualItems) {
      if (virtualRow.index >= rows.length) continue;
      for (const item of rows[virtualRow.index] ?? []) {
        mediaIdSet.add(item.id);
      }
    }
    const mediaIds = [...mediaIdSet].sort((left, right) => left - right);
    return {
      ids: mediaIds,
      key: mediaIds.join(":")
    };
  }, [rows, virtualItems]);
  const visibleMediaIds = visibleMedia.ids;
  const visibleMediaKey = visibleMedia.key;

  useEffect(() => {
    onRequestThumbnailStates(visibleMediaIds);
  }, [onRequestThumbnailStates, visibleMediaKey]);

  useEffect(() => {
    const hasPendingThumbnail = virtualItems.some((virtualRow) =>
      (rows[virtualRow.index] ?? []).some((item) =>
        shouldRefreshThumbnailState(item, thumbnailStatesByMediaId[item.id])
      )
    );
    if (!hasPendingThumbnail) {
      return;
    }

    const timer = window.setTimeout(() => {
      onRequestThumbnailStates(visibleMediaIds);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [onRequestThumbnailStates, rows, thumbnailStatesByMediaId, virtualItems, visibleMediaKey]);

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

function MediaTile({
  item,
  onSelect,
  onContextMenu,
  selected,
  thumbnail,
  width
}: {
  item: MediaRecord;
  onSelect: (mediaId: number) => void;
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
        aria-label={`Select ${item.name}`}
        className={selected ? "media-tile selected" : "media-tile"}
        onClick={() => onSelect(item.id)}
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

  if (state === "ready") {
    return (
      <div className="tile-thumb tile-thumb-ready">
        <span>{thumbnail?.asset ? `${thumbnail.asset.width}x${thumbnail.asset.height}` : "ready"}</span>
      </div>
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
    return (
      <div className="tile-thumb tile-thumb-skipped">
        <span>{item.kind ?? "file"}</span>
      </div>
    );
  }

  if (state === "queued") {
    return (
      <div className="tile-thumb tile-thumb-loading">
        <span>queued</span>
      </div>
    );
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
  const state = thumbnail?.state ?? normalizeMediaThumbnailState(item.thumbnailState);
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
