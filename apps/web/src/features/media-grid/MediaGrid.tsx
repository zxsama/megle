import { useVirtualizer } from "@tanstack/react-virtual";
import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { MediaRecord, ThumbnailResponse } from "@megle/core-client";
import {
  mediaContentSignature,
  preloadImageObjectUrl,
  previewPlaceholderDataUrl,
  readCachedThumbnailObjectUrl,
  rememberThumbnailObjectUrl,
  requestThumbnailBlob,
  thumbnailObjectUrlCacheKey,
  type ThumbnailRequestPriority
} from "../../core/mediaResources";
import { workbenchLayout } from "../../design/tokens";
import type { LibraryGridPreferences } from "./gridPreferences";
import type { LibraryLayoutMode } from "./layoutMode";
import {
  buildLayoutGeometry,
  collectPlacementIndexesFromSegmentRange,
  collectScopedMediaInViewport,
  findDirectionalNeighborIndex,
  resolveScrollTopForPlacement,
  type FolderCoverLayoutPlacement
} from "./layoutGeometry";

const AHEAD_THUMBNAIL_ROW_COUNT = 4;
const FOREGROUND_THUMBNAIL_REPOLL_MS = 250;
const VISIBLE_PRIORITY_ITEM_LIMIT = 10;
const AHEAD_PRIORITY_ITEM_LIMIT = 10;
const SECTION_HEADER_HEIGHT = 32;
const EMPTY_ROW_HEIGHT = 132;
const LIST_WINDOW_ROW_HEIGHT_PX = 104;
const LIST_WINDOW_FRAME_HEIGHT_PX = 90;
const LIST_WINDOW_THUMBNAIL_WIDTH_PX = 108;
const LIST_WINDOW_THUMBNAIL_HEIGHT_PX = 72;
const WINDOWED_MEDIA_COUNT_THRESHOLD = 1000;
const scrollPositionByKey = new Map<string, number>();
const EMPTY_MEDIA_ITEMS: MediaRecord[] = [];
type MediaGridCssVariables = CSSProperties & {
  "--library-tile-label-gap": string;
  "--library-tile-label-visible-height": string;
};

type VirtualSegment =
  | { type: "folder-header"; size: number }
  | { type: "folder-row"; folderSegmentIndex: number; size: number }
  | { type: "content-header"; size: number }
  | { type: "empty"; size: number }
  | { type: "media-row"; mediaSegmentIndex: number; size: number };

interface MediaWindowGeometry {
  contentWidth: number;
  columnCount: number;
  rowCount: number;
  rowHeight: number;
  tileWidth: number;
  totalSize: number;
}

interface FolderWindowGeometry {
  columnCount: number;
  coverHeight: number;
  frameHeight: number;
  rowCount: number;
  rowHeight: number;
  tileWidth: number;
  totalSize: number;
}

interface MediaGridFolderSection {
  collapsed: boolean;
  itemCount: number;
  loading: boolean;
  header: ReactNode;
  onVisibleFolderIndexesChange?: (indexes: number[]) => void;
  renderFolder: (index: number, placement: FolderCoverLayoutPlacement) => ReactNode;
}

interface MediaGridProps {
  aheadRowCount?: number;
  contentHeader?: ReactNode;
  emptyContent?: ReactNode;
  folderSection?: MediaGridFolderSection;
  gridPreferences: LibraryGridPreferences;
  items: MediaRecord[];
  layoutMode: LibraryLayoutMode;
  mediaSlots?: Array<MediaRecord | undefined>;
  totalCount?: number;
  selectedMediaId: number | null;
  loading: boolean;
  loadingMore: boolean;
  onSelect: (mediaId: number) => void;
  onOpenPreview: (mediaId: number) => void;
  onRequestMediaWindow?: (startIndex: number, endIndex: number) => void;
  onRequestThumbnailStates: (mediaIds: number[], priority: ThumbnailRequestPriority) => void;
  scrollPositionKey?: string;
  thumbnailStatesByMediaId: Record<number, ThumbnailResponse>;
  onContextMenu?: (event: { item: MediaRecord; x: number; y: number; shiftKey: boolean }) => void;
}

function buildMediaWindowGeometry({
  count,
  gap,
  labelHeight,
  layoutMode,
  tileMinWidth,
  viewportWidth
}: {
  count: number;
  gap: number;
  labelHeight: number;
  layoutMode: LibraryLayoutMode;
  tileMinWidth: number;
  viewportWidth: number;
}): MediaWindowGeometry {
  const contentWidth = Math.max(tileMinWidth, Math.floor(viewportWidth || tileMinWidth));
  if (layoutMode === "list") {
    return {
      contentWidth,
      columnCount: 1,
      rowCount: Math.max(0, count),
      rowHeight: LIST_WINDOW_ROW_HEIGHT_PX,
      tileWidth: contentWidth,
      totalSize: Math.max(0, count) * LIST_WINDOW_ROW_HEIGHT_PX
    };
  }

  const columnCount = Math.max(1, Math.floor((contentWidth + gap) / (tileMinWidth + gap)));
  const tileWidth = Math.max(1, Math.floor((contentWidth - gap * (columnCount - 1)) / columnCount));
  const rowHeight = tileWidth + labelHeight + gap;
  const rowCount = Math.ceil(Math.max(0, count) / columnCount);
  return {
    contentWidth,
    columnCount,
    rowCount,
    rowHeight,
    tileWidth,
    totalSize: rowCount * rowHeight
  };
}

function buildFolderWindowGeometry({
  count,
  gap,
  labelHeight,
  tileMinWidth,
  viewportWidth
}: {
  count: number;
  gap: number;
  labelHeight: number;
  tileMinWidth: number;
  viewportWidth: number;
}): FolderWindowGeometry {
  const contentWidth = Math.max(tileMinWidth, Math.floor(viewportWidth || tileMinWidth));
  const columnCount = Math.max(1, Math.floor((contentWidth + gap) / (tileMinWidth + gap)));
  const tileWidth = Math.max(1, Math.floor((contentWidth - gap * (columnCount - 1)) / columnCount));
  const coverHeight = Math.round(tileWidth * 4 / 3);
  const frameHeight = coverHeight + labelHeight;
  const rowHeight = frameHeight + gap;
  const rowCount = Math.ceil(Math.max(0, count) / columnCount);
  return {
    columnCount,
    coverHeight,
    frameHeight,
    rowCount,
    rowHeight,
    tileWidth,
    totalSize: rowCount * rowHeight
  };
}

export function MediaGrid({
  aheadRowCount = AHEAD_THUMBNAIL_ROW_COUNT,
  contentHeader,
  emptyContent,
  folderSection,
  gridPreferences,
  items,
  layoutMode,
  mediaSlots,
  totalCount,
  selectedMediaId,
  loading,
  loadingMore,
  onRequestMediaWindow,
  onRequestThumbnailStates,
  onOpenPreview,
  onSelect,
  scrollPositionKey,
  thumbnailStatesByMediaId,
  onContextMenu
}: MediaGridProps) {
  const savedScrollTop = scrollPositionKey ? (scrollPositionByKey.get(scrollPositionKey) ?? 0) : 0;
  const parentRef = useRef<HTMLDivElement | null>(null);
  const previousMediaOffsetRef = useRef(0);
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

  const mediaItemCount = Math.max(items.length, totalCount ?? items.length);
  const windowedMedia =
    mediaSlots !== undefined &&
    (mediaItemCount > items.length || mediaItemCount > WINDOWED_MEDIA_COUNT_THRESHOLD);
  const layoutItems = windowedMedia ? EMPTY_MEDIA_ITEMS : items;
  const layout = useMemo(
    () =>
      buildLayoutGeometry({
        gap: gridPreferences.tileGap,
        items: layoutItems,
        labelHeight: gridPreferences.tileLabelHeight,
        layoutMode,
        viewportWidth: viewportSize.width,
        tileMinWidth: workbenchLayout.tileMinWidth
      }),
    [gridPreferences.tileGap, gridPreferences.tileLabelHeight, layoutItems, layoutMode, viewportSize.width]
  );
  const mediaWindow = useMemo(
    () =>
      buildMediaWindowGeometry({
        count: mediaItemCount,
        gap: gridPreferences.tileGap,
        labelHeight: gridPreferences.tileLabelHeight,
        layoutMode,
        tileMinWidth: workbenchLayout.tileMinWidth,
        viewportWidth: viewportSize.width
      }),
    [
      gridPreferences.tileGap,
      gridPreferences.tileLabelHeight,
      layoutMode,
      mediaItemCount,
      viewportSize.width
    ]
  );
  const activeMediaEstimatedSegmentSize = windowedMedia
    ? mediaWindow.rowHeight
    : layout.estimatedSegmentSize;
  const folderWindow = useMemo(
    () =>
      buildFolderWindowGeometry({
        count: folderSection && !folderSection.collapsed ? folderSection.itemCount : 0,
        gap: gridPreferences.tileGap,
        labelHeight: gridPreferences.tileLabelHeight,
        tileMinWidth: workbenchLayout.tileMinWidth,
        viewportWidth: viewportSize.width
      }),
    [
      folderSection?.collapsed,
      folderSection?.itemCount,
      gridPreferences.tileGap,
      gridPreferences.tileLabelHeight,
      viewportSize.width
    ]
  );
  const folderSectionVisible = Boolean(folderSection);
  const folderHeaderHeight = folderSectionVisible ? SECTION_HEADER_HEIGHT : 0;
  const folderGridOffset = folderHeaderHeight;
  const contentHeaderOffset = folderGridOffset + folderWindow.totalSize;
  const contentHeaderHeight = contentHeader ? SECTION_HEADER_HEIGHT : 0;
  const mediaOffset = contentHeaderOffset + contentHeaderHeight;
  const itemIndexById = useMemo(() => {
    const map = new Map<number, number>();
    items.forEach((item, index) => {
      map.set(item.id, index);
    });
    return map;
  }, [items]);
  const slotIndexById = useMemo(() => {
    const map = new Map<number, number>();
    mediaSlots?.forEach((item, index) => {
      if (item) {
        map.set(item.id, index);
      }
    });
    return map;
  }, [mediaSlots]);
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

  const virtualSegments = useMemo<VirtualSegment[]>(() => {
    const segments: VirtualSegment[] = [];
    if (folderSectionVisible) {
      segments.push({ type: "folder-header", size: SECTION_HEADER_HEIGHT });
      if (!folderSection?.collapsed) {
        for (let rowIndex = 0; rowIndex < folderWindow.rowCount; rowIndex += 1) {
          segments.push({
            type: "folder-row",
            folderSegmentIndex: rowIndex,
            size: folderWindow.rowHeight
          });
        }
      }
    }
    if (contentHeader) {
      segments.push({ type: "content-header", size: SECTION_HEADER_HEIGHT });
    }
    if (mediaItemCount === 0 && emptyContent !== undefined) {
      segments.push({ type: "empty", size: EMPTY_ROW_HEIGHT });
    }
    if (windowedMedia) {
      for (let rowIndex = 0; rowIndex < mediaWindow.rowCount; rowIndex += 1) {
        segments.push({
          type: "media-row",
          mediaSegmentIndex: rowIndex,
          size: mediaWindow.rowHeight
        });
      }
    } else {
      for (const segment of layout.segments) {
        segments.push({
          type: "media-row",
          mediaSegmentIndex: segment.index,
          size: segment.size
        });
      }
    }
    return segments;
  }, [
    contentHeader,
    emptyContent,
    folderSection?.collapsed,
    folderSectionVisible,
    folderWindow.rowCount,
    folderWindow.rowHeight,
    mediaWindow.rowCount,
    mediaWindow.rowHeight,
    layout.segments,
    mediaItemCount,
    windowedMedia
  ]);
  const mediaVirtualSegmentIndexBySegmentIndex = useMemo(() => {
    const map = new Map<number, number>();
    virtualSegments.forEach((segment, virtualIndex) => {
      if (segment.type === "media-row") {
        map.set(segment.mediaSegmentIndex, virtualIndex);
      }
    });
    return map;
  }, [virtualSegments]);
  const virtualRows = useVirtualizer({
    count: virtualSegments.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => virtualSegments[index]?.size ?? activeMediaEstimatedSegmentSize,
    initialOffset: savedScrollTop,
    overscan: layoutMode === "waterfall" ? 6 : 4,
  });
  const virtualItems = virtualRows.getVirtualItems();

  useLayoutEffect(() => {
    const element = parentRef.current;
    const previousMediaOffset = previousMediaOffsetRef.current;
    previousMediaOffsetRef.current = mediaOffset;
    if (!element || previousMediaOffset === mediaOffset) {
      return;
    }

    const mediaOffsetDelta = mediaOffset - previousMediaOffset;
    if (Math.abs(mediaOffsetDelta) < 1 || element.scrollTop <= previousMediaOffset + 1) {
      return;
    }

    const nextScrollTop = Math.max(0, element.scrollTop + mediaOffsetDelta);
    element.scrollTop = nextScrollTop;
    setScrollTop(nextScrollTop);
    if (scrollPositionKey) {
      scrollPositionByKey.set(scrollPositionKey, nextScrollTop);
    }
  }, [mediaOffset, scrollPositionKey]);

  useLayoutEffect(() => {
    const element = parentRef.current;
    if (!element) return;
    if (scrollPersistenceUnlockedRef.current) {
      return;
    }
    if (savedScrollTop > 0 && mediaItemCount === 0 && !(folderSection?.itemCount ?? 0)) {
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
  }, [folderSection?.itemCount, mediaItemCount, savedScrollTop, scrollPositionKey]);

  const mediaScrollTop = Math.max(0, scrollTop - mediaOffset);
  const visibleRangeEnd = Math.max(
    0,
    scrollTop + Math.max(viewportSize.height, activeMediaEstimatedSegmentSize) - mediaOffset
  );
  const visibleMediaIndexRange = useMemo(() => {
    if (!windowedMedia) return null;
    const startRow = Math.max(0, Math.floor(mediaScrollTop / mediaWindow.rowHeight));
    const endRow = Math.max(
      startRow,
      Math.floor(Math.max(mediaScrollTop, visibleRangeEnd - 1) / mediaWindow.rowHeight)
    );
    return {
      start: Math.min(mediaItemCount, startRow * mediaWindow.columnCount),
      end: Math.min(mediaItemCount, (endRow + 1) * mediaWindow.columnCount)
    };
  }, [
    mediaWindow.columnCount,
    mediaWindow.rowHeight,
    mediaItemCount,
    mediaScrollTop,
    visibleRangeEnd,
    windowedMedia
  ]);
  const aheadMediaIndexRange = useMemo(() => {
    if (!windowedMedia || !visibleMediaIndexRange) return null;
    const aheadRows = Math.max(1, aheadRowCount);
    return {
      start: visibleMediaIndexRange.end,
      end: Math.min(
        mediaItemCount,
        visibleMediaIndexRange.end + aheadRows * mediaWindow.columnCount
      )
    };
  }, [
    aheadRowCount,
    mediaWindow.columnCount,
    mediaItemCount,
    visibleMediaIndexRange,
    windowedMedia
  ]);
  const visibleMedia = useMemo(
    () => {
      if (windowedMedia && visibleMediaIndexRange) {
        const ids: number[] = [];
        const signatures: string[] = [];
        for (let index = visibleMediaIndexRange.start; index < visibleMediaIndexRange.end; index += 1) {
          const item = mediaSlots?.[index];
          if (!item || item.id === selectedMediaId) continue;
          ids.push(item.id);
          signatures.push(mediaContentSignature(item));
        }
        return {
          ids,
          key: `${visibleMediaIndexRange.start}:${visibleMediaIndexRange.end}`,
          signatureKey: signatures.join("|")
        };
      }
      return collectScopedMediaInViewport(layout, mediaScrollTop, visibleRangeEnd, {
        excludeMediaId: selectedMediaId
      });
    },
    [
      layout,
      mediaScrollTop,
      mediaSlots,
      selectedMediaId,
      visibleMediaIndexRange,
      visibleRangeEnd,
      windowedMedia
    ]
  );
  const aheadMedia = useMemo(() => {
    if (windowedMedia && aheadMediaIndexRange) {
      const ids: number[] = [];
      const signatures: string[] = [];
      for (let index = aheadMediaIndexRange.start; index < aheadMediaIndexRange.end; index += 1) {
        const item = mediaSlots?.[index];
        if (!item || item.id === selectedMediaId) continue;
        ids.push(item.id);
        signatures.push(mediaContentSignature(item));
      }
      return {
        ids,
        key: `${aheadMediaIndexRange.start}:${aheadMediaIndexRange.end}`,
        signatureKey: signatures.join("|")
      };
    }
    const aheadStart = visibleRangeEnd;
    const aheadEnd = aheadStart + aheadRowCount * activeMediaEstimatedSegmentSize;
    return collectScopedMediaInViewport(layout, aheadStart, aheadEnd, {
      excludeMediaId: selectedMediaId
    });
  }, [
    activeMediaEstimatedSegmentSize,
    aheadMediaIndexRange,
    aheadRowCount,
    layout,
    mediaSlots,
    selectedMediaId,
    visibleRangeEnd,
    windowedMedia
  ]);

  useEffect(() => {
    if (!windowedMedia || !onRequestMediaWindow || !visibleMediaIndexRange) {
      return;
    }
    onRequestMediaWindow(
      visibleMediaIndexRange.start,
      aheadMediaIndexRange?.end ?? visibleMediaIndexRange.end
    );
  }, [
    aheadMediaIndexRange,
    onRequestMediaWindow,
    visibleMediaIndexRange,
    windowedMedia
  ]);

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

  const tileLabelGap = resolveTileLabelGap(gridPreferences.tileLabelHeight);
  const tileLabelVisibleHeight = Math.max(
    12,
    gridPreferences.tileLabelHeight - tileLabelGap
  );
  const gridStyle = useMemo<MediaGridCssVariables>(
    () => ({
      "--library-tile-label-gap": `${tileLabelGap}px`,
      "--library-tile-label-visible-height": `${tileLabelVisibleHeight}px`
    }),
    [tileLabelGap, tileLabelVisibleHeight]
  );

  const renderedMediaSegmentIndexes = virtualItems
    .map((item) => virtualSegments[item.index])
    .filter((segment): segment is Extract<VirtualSegment, { type: "media-row" }> =>
      segment?.type === "media-row"
    )
    .map((segment) => segment.mediaSegmentIndex);
  const renderedPlacementIndexes =
    !windowedMedia && renderedMediaSegmentIndexes.length > 0
      ? collectPlacementIndexesFromSegmentRange(
          layout,
          Math.min(...renderedMediaSegmentIndexes),
          Math.max(...renderedMediaSegmentIndexes)
        )
      : [];
  const renderedWindowedMediaIndexes = windowedMedia
    ? renderedMediaSegmentIndexes.flatMap((rowIndex) => {
        const start = rowIndex * mediaWindow.columnCount;
        const end = Math.min(mediaItemCount, start + mediaWindow.columnCount);
        return Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index);
      })
    : [];
  const renderedFolderSegmentIndexes = virtualItems
    .map((item) => virtualSegments[item.index])
    .filter((segment): segment is Extract<VirtualSegment, { type: "folder-row" }> =>
      segment?.type === "folder-row"
    )
    .map((segment) => segment.folderSegmentIndex);
  const renderedFolderIndexes =
    renderedFolderSegmentIndexes.length > 0
      ? renderedFolderSegmentIndexes.flatMap((rowIndex) => {
          const start = rowIndex * folderWindow.columnCount;
          const end = Math.min(folderSection?.itemCount ?? 0, start + folderWindow.columnCount);
          return Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index);
        })
      : [];
  const renderedFolderIndexKey = renderedFolderIndexes.join(":");

  useEffect(() => {
    if (!folderSection?.onVisibleFolderIndexesChange) {
      return;
    }
    folderSection.onVisibleFolderIndexesChange(renderedFolderIndexes);
  }, [
    folderSection,
    renderedFolderIndexKey,
    renderedFolderIndexes
  ]);

  function moveSelection(direction: "left" | "right" | "up" | "down") {
    if (windowedMedia) {
      if (mediaItemCount === 0) return;
      const currentIndex =
        selectedMediaId !== null
          ? slotIndexById.get(selectedMediaId) ?? visibleMediaIndexRange?.start ?? 0
          : visibleMediaIndexRange?.start ?? 0;
      const step = direction === "up" || direction === "down" ? mediaWindow.columnCount : 1;
      const delta = direction === "left" || direction === "up" ? -step : step;
      selectWindowedIndex(Math.max(0, Math.min(mediaItemCount - 1, currentIndex + delta)));
      return;
    }

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
    const virtualSegmentIndex =
      segmentIndex !== undefined ? mediaVirtualSegmentIndexBySegmentIndex.get(segmentIndex) : undefined;
    if (virtualSegmentIndex !== undefined) {
      virtualRows.scrollToIndex(virtualSegmentIndex, { align: "auto" });
    }
    const element = parentRef.current;
    if (!element) {
      return;
    }
    const nextScrollTop = mediaOffset + resolveScrollTopForPlacement(
      placement,
      element.clientHeight,
      Math.max(0, element.scrollTop - mediaOffset),
      layout.totalSize
    );
    if (nextScrollTop !== element.scrollTop) {
      scrollPersistenceUnlockedRef.current = true;
      element.scrollTop = nextScrollTop;
    }
  }

  function selectWindowedIndex(index: number) {
    if (mediaItemCount === 0) return;
    const clampedIndex = Math.max(0, Math.min(mediaItemCount - 1, index));
    const item = mediaSlots?.[clampedIndex];
    if (item) {
      onSelect(item.id);
    } else {
      onRequestMediaWindow?.(
        clampedIndex,
        Math.min(mediaItemCount, clampedIndex + mediaWindow.columnCount)
      );
    }

    const rowIndex = Math.floor(clampedIndex / mediaWindow.columnCount);
    const virtualSegmentIndex = mediaVirtualSegmentIndexBySegmentIndex.get(rowIndex);
    if (virtualSegmentIndex !== undefined) {
      virtualRows.scrollToIndex(virtualSegmentIndex, { align: "auto" });
    }
    const element = parentRef.current;
    if (!element) {
      return;
    }
    const nextScrollTop = mediaOffset + rowIndex * mediaWindow.rowHeight;
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
    } else if (event.key === "Home" && (windowedMedia ? mediaItemCount > 0 : items[0])) {
      event.preventDefault();
      if (windowedMedia) selectWindowedIndex(0);
      else selectIndex(0);
    } else if (event.key === "End" && (windowedMedia ? mediaItemCount > 0 : items[items.length - 1])) {
      event.preventDefault();
      if (windowedMedia) selectWindowedIndex(mediaItemCount - 1);
      else selectIndex(items.length - 1);
    } else if ((event.key === "Enter" || event.key === " ") && selectedMediaId !== null) {
      event.preventDefault();
      onOpenPreview(selectedMediaId);
    }
  }

  return (
    <div
      aria-label={`Media ${layoutMode} view`}
      aria-busy={loading || loadingMore}
      className={`virtual-grid virtual-grid--${layoutMode}${mediaItemCount === 0 ? " media-grid-empty-shell" : ""}`}
      ref={parentRef}
      role="grid"
      style={gridStyle}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div className="virtual-grid-spacer" style={{ height: virtualRows.getTotalSize() }}>
        {folderSectionVisible && virtualItems.some((item) => virtualSegments[item.index]?.type === "folder-header") ? (
          <div
            className="virtual-grid-section-header virtual-grid-folder-header"
            style={{
              height: SECTION_HEADER_HEIGHT,
              left: 0,
              position: "absolute",
              top: 0,
              width: "100%"
            }}
          >
            {folderSection?.header}
          </div>
        ) : null}

        {folderSection && !folderSection.collapsed
          ? renderedFolderIndexes.map((folderIndex) => {
              const placement = resolveFolderWindowPlacement(
                folderIndex,
                folderWindow,
                gridPreferences.tileGap
              );
              return (
                <div
                  className="folder-gridcell"
                  key={`folder-${placement.itemIndex}`}
                  role="listitem"
                  style={{
                    height: placement.height,
                    left: placement.left,
                    position: "absolute",
                    top: folderGridOffset + placement.top,
                    width: placement.width
                  }}
                >
                  {folderSection.renderFolder(placement.itemIndex, placement)}
                </div>
              );
            })
          : null}

        {contentHeader && virtualItems.some((item) => virtualSegments[item.index]?.type === "content-header") ? (
          <div
            className="virtual-grid-section-header virtual-grid-content-header"
            style={{
              height: SECTION_HEADER_HEIGHT,
              left: 0,
              position: "absolute",
              top: contentHeaderOffset,
              width: "100%"
            }}
          >
            {contentHeader}
          </div>
        ) : null}

        {mediaItemCount === 0 &&
        emptyContent !== undefined &&
        virtualItems.some((item) => virtualSegments[item.index]?.type === "empty") ? (
          <div
            className="virtual-grid-empty-row"
            style={{
              height: EMPTY_ROW_HEIGHT,
              left: 0,
              position: "absolute",
              top: mediaOffset,
              width: "100%"
            }}
          >
            {emptyContent}
          </div>
        ) : null}

        {renderedWindowedMediaIndexes.map((mediaIndex) => {
          const item = mediaSlots?.[mediaIndex];
          const placement = resolveMediaWindowPlacement(
            mediaIndex,
            mediaWindow,
            layoutMode,
            gridPreferences.tileGap,
            gridPreferences.tileLabelHeight
          );

          return (
            <div
              className={`media-gridcell media-gridcell--${layoutMode}`}
              key={item ? item.id : `media-window-placeholder-${mediaIndex}`}
              role="row"
              style={{
                height: placement.height,
                left: placement.left,
                position: "absolute",
                top: mediaOffset + placement.top,
                width: placement.width
              }}
            >
              <div
                aria-selected={item ? item.id === selectedMediaId : undefined}
                className="media-gridcell-content"
                role="gridcell"
              >
                {item ? (
                  <MediaTile
                    labelGap={tileLabelGap}
                    item={item}
                    layoutMode={layoutMode}
                    onContextMenu={onContextMenu}
                    onOpenPreview={onOpenPreview}
                    onSelect={onSelect}
                    placement={placement}
                    selected={item.id === selectedMediaId}
                    thumbnail={thumbnailStatesByMediaId[item.id]}
                  />
                ) : (
                  <MediaTileSkeleton layoutMode={layoutMode} placement={placement} />
                )}
              </div>
            </div>
          );
        })}

        {renderedPlacementIndexes.map((placementIndex) => {
          const placement = layout.placements[placementIndex];
          const item = placement?.item;
          if (!placement || !item) {
            return null;
          }

          return (
            <div
              className={`media-gridcell media-gridcell--${layoutMode}`}
              key={item.id}
              role="row"
              style={{
                height: placement.height,
                left: placement.left,
                position: "absolute",
                top: mediaOffset + placement.top,
                width: placement.width
              }}
            >
              <div
                aria-selected={item.id === selectedMediaId}
                className="media-gridcell-content"
                role="gridcell"
              >
                <MediaTile
                  labelGap={tileLabelGap}
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
            </div>
          );
        })}

      </div>
      {loading || loadingMore ? <MediaGridRefreshIndicator label="Refreshing media" /> : null}
    </div>
  );
}

function resolveMediaWindowPlacement(
  mediaIndex: number,
  geometry: MediaWindowGeometry,
  layoutMode: LibraryLayoutMode,
  gap: number,
  labelHeight: number
) {
  if (layoutMode === "list") {
    return {
      frameHeight: LIST_WINDOW_FRAME_HEIGHT_PX,
      height: geometry.rowHeight,
      left: 0,
      thumbHeight: LIST_WINDOW_THUMBNAIL_HEIGHT_PX,
      thumbWidth: LIST_WINDOW_THUMBNAIL_WIDTH_PX,
      top: mediaIndex * geometry.rowHeight,
      width: geometry.contentWidth
    };
  }

  const rowIndex = Math.floor(mediaIndex / geometry.columnCount);
  const columnIndex = mediaIndex % geometry.columnCount;
  return {
    frameHeight: geometry.tileWidth + labelHeight,
    height: geometry.rowHeight,
    left: columnIndex * (geometry.tileWidth + gap),
    thumbHeight: geometry.tileWidth,
    thumbWidth: geometry.tileWidth,
    top: rowIndex * geometry.rowHeight,
    width: geometry.tileWidth
  };
}

function resolveFolderWindowPlacement(
  folderIndex: number,
  geometry: FolderWindowGeometry,
  gap: number
): FolderCoverLayoutPlacement {
  const rowIndex = Math.floor(folderIndex / geometry.columnCount);
  const columnIndex = folderIndex % geometry.columnCount;
  return {
    coverHeight: geometry.coverHeight,
    frameHeight: geometry.frameHeight,
    height: geometry.rowHeight,
    itemIndex: folderIndex,
    left: columnIndex * (geometry.tileWidth + gap),
    top: rowIndex * geometry.rowHeight,
    width: geometry.tileWidth
  };
}

function MediaTile({
  labelGap,
  item,
  layoutMode,
  onSelect,
  onOpenPreview,
  onContextMenu,
  placement,
  selected,
  thumbnail
}: {
  labelGap: number;
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
              gap: labelGap,
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

function MediaTileSkeleton({
  layoutMode,
  placement
}: {
  layoutMode: LibraryLayoutMode;
  placement: { frameHeight: number; thumbHeight: number; thumbWidth: number; width: number };
}) {
  return (
    <div
      aria-hidden="true"
      className={`media-tile media-tile--${layoutMode} skeleton`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 0,
        height: placement.frameHeight,
        width: placement.width
      }}
    >
      <div
        className="tile-thumb tile-thumb-loading"
        style={{ height: placement.thumbHeight, width: placement.thumbWidth }}
      />
      <span className="tile-label" />
    </div>
  );
}

function resolveTileLabelGap(tileLabelHeight: number) {
  return Math.max(1, Math.round(tileLabelHeight / 6));
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
  const rowState = normalizeMediaThumbnailState(item.thumbnailState);
  const state = thumbnail?.state ?? rowState;
  const previewPlaceholderUrl = previewPlaceholderDataUrl(item);
  const hasLiveReadyThumbnail = thumbnail?.state === "ready" && thumbnail.updatedAt !== null;
  const canLoadCurrentThumbnailBlob = hasLiveReadyThumbnail || rowState === "ready" || state === "ready";
  const presentationStyle = thumbnailPresentationStyle(layoutMode, thumbWidth, thumbHeight);

  if (canLoadCurrentThumbnailBlob) {
    return (
      <ReadyThumbnail
        alt={item.name}
        className={`tile-thumb tile-thumb--${layoutMode}`}
        fileId={item.id}
        mediaSignature={mediaContentSignature(item)}
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
    return <div className={`tile-thumb tile-thumb-loading tile-thumb--${layoutMode}`} style={presentationStyle} />;
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

  return <div className={`tile-thumb tile-thumb-loading tile-thumb--${layoutMode}`} style={presentationStyle} />;
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

function MediaGridRefreshIndicator({ label }: { label: string }) {
  return (
    <div aria-label={label} className="media-grid-refresh-indicator" role="status">
      <span className="central-preview-loading-spinner" aria-hidden="true" />
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
  mediaSignature,
  previewPlaceholderUrl,
  style,
  thumbnailUpdatedAt
}: {
  alt: string;
  className: string;
  fileId: number;
  mediaSignature: string;
  previewPlaceholderUrl: string | null;
  style: CSSProperties;
  thumbnailUpdatedAt: number | null;
}) {
  const cacheKey = thumbnailObjectUrlCacheKey(fileId, mediaSignature, thumbnailUpdatedAt);
  const [src, setSrc] = useState<string | null>(() => readCachedThumbnailObjectUrl(cacheKey));
  const [error, setError] = useState(false);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const cachedObjectUrl = readCachedThumbnailObjectUrl(cacheKey);
    if (cachedObjectUrl) {
      objectUrlRef.current = cachedObjectUrl;
      setSrc(cachedObjectUrl);
      setError(false);
      return undefined;
    }

    let revoked = false;
    let objectUrl: string | null = null;
    setError(false);

    requestThumbnailBlob(fileId, thumbnailUpdatedAt)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        return preloadImageObjectUrl(objectUrl);
      })
      .then(() => {
        if (!objectUrl) {
          return;
        }
        if (revoked) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        objectUrlRef.current = objectUrl;
        rememberThumbnailObjectUrl(cacheKey, objectUrl);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (objectUrl && objectUrlRef.current !== objectUrl) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
        }
        if (!revoked) setError(true);
      });

    return () => {
      revoked = true;
      if (objectUrl && objectUrlRef.current !== objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [cacheKey, fileId, thumbnailUpdatedAt]);

  if (error && !src) {
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
    return <div className={`${className} tile-thumb-loading`} style={style} />;
  }

  return (
    <div className={className} style={style}>
      <img alt={alt} className="tile-thumb-image" loading="lazy" src={src} />
    </div>
  );
}
