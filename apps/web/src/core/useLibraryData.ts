import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  FolderRecord,
  MediaRecord,
  RootRecord,
  ScanSummary,
  TaskRecord,
  ThumbnailResponse
} from "@megle/core-client";
import { createCoreClient } from "./client";
import {
  isFreshThumbnailForMediaRecord,
  readCachedThumbnailStates,
  requestThumbnailState,
  shouldRequestThumbnailState
} from "./mediaResources";

const PAGE_LIMIT = 200;

export interface LibraryState {
  roots: RootRecord[];
  folders: FolderRecord[];
  media: MediaRecord[];
  selectedRootId: number | null;
  selectedFolderId: number | null;
  selectedMediaId: number | null;
  selectedMedia: MediaRecord | null;
  folderChildrenByParent: Record<number, FolderRecord[]>;
  folderChildNextCursorByParent: Record<number, string | null>;
  expandedFolderIds: Set<number>;
  loadingFolderIds: Set<number>;
  loadingMoreFolderIds: Set<number>;
  loading: boolean;
  loadingMoreMedia: boolean;
  mediaHasMore: boolean;
  thumbnailStatesByMediaId: Record<number, ThumbnailResponse>;
  addingRoot: boolean;
  rescanningRootIds: Set<number>;
  scanActive: boolean;
  tasks: TaskRecord[];
  error: string | null;
  lastScan: ScanSummary | null;
  setSelectedRootId: (rootId: number) => void;
  setSelectedFolder: (folder: FolderRecord) => void;
  setSelectedMediaId: (mediaId: number) => void;
  toggleFolderExpanded: (folderId: number) => void;
  requestThumbnailStates: (mediaIds: number[]) => void;
  loadMoreFolderChildren: (folderId: number) => Promise<void>;
  loadMoreMedia: () => Promise<void>;
  rescanRoot: (rootId: number) => Promise<void>;
  refresh: () => Promise<void>;
  addRoot: (path: string) => Promise<void>;
}

export function useLibraryData(): LibraryState {
  const client = useMemo(() => createCoreClient(), []);
  const mediaPageGeneration = useRef(0);
  const inFlightMediaPageKeys = useRef<Set<string>>(new Set());
  const loadedMediaPageKeys = useRef<Set<string>>(new Set());
  const inFlightFolderChildPageKeys = useRef<Set<string>>(new Set());
  const loadedFolderChildPageKeys = useRef<Set<string>>(new Set());
  const [roots, setRoots] = useState<RootRecord[]>([]);
  const [folderChildrenByParent, setFolderChildrenByParent] = useState<Record<number, FolderRecord[]>>(
    {}
  );
  const [folderChildNextCursorByParent, setFolderChildNextCursorByParent] = useState<
    Record<number, string | null>
  >({});
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<number>>(() => new Set());
  const [loadingFolderIds, setLoadingFolderIds] = useState<Set<number>>(() => new Set());
  const [loadingMoreFolderIds, setLoadingMoreFolderIds] = useState<Set<number>>(() => new Set());
  const [media, setMedia] = useState<MediaRecord[]>([]);
  const [thumbnailStatesByMediaId, setThumbnailStatesByMediaId] = useState<
    Record<number, ThumbnailResponse>
  >({});
  const [mediaNextCursor, setMediaNextCursor] = useState<string | null>(null);
  const mediaHasMore = mediaNextCursor !== null;
  const [selectedRootId, selectRoot] = useState<number | null>(null);
  const [selectedFolderId, selectFolder] = useState<number | null>(null);
  const [selectedMediaId, selectMedia] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMoreMedia, setLoadingMoreMedia] = useState(false);
  const [addingRoot, setAddingRoot] = useState(false);
  const [rescanningRootIds, setRescanningRootIds] = useState<Set<number>>(() => new Set());
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [taskPollFailures, setTaskPollFailures] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<ScanSummary | null>(null);
  const mediaById = useMemo(() => new Map(media.map((item) => [item.id, item])), [media]);
  const mediaByIdRef = useRef(mediaById);
  mediaByIdRef.current = mediaById;
  const freshThumbnailStatesByMediaId = useMemo(
    () => filterFreshThumbnailStates(thumbnailStatesByMediaId, mediaById),
    [mediaById, thumbnailStatesByMediaId]
  );

  const selectedMedia = media.find((item) => item.id === selectedMediaId) ?? null;
  const folders = useMemo(
    () => Object.values(folderChildrenByParent).flat(),
    [folderChildrenByParent]
  );
  const scanActive = tasks.some((task) => task.status === "pending" || task.status === "running");

  const requestThumbnailStates = useCallback((mediaIds: number[]) => {
    const mediaRecords = [...new Set(mediaIds)]
      .filter((mediaId) => Number.isFinite(mediaId))
      .map((mediaId) => mediaByIdRef.current.get(mediaId))
      .filter((mediaRecord): mediaRecord is MediaRecord => Boolean(mediaRecord));
    if (mediaRecords.length === 0) {
      return;
    }

    const cachedStates = readCachedThumbnailStates(mediaRecords);
    if (Object.keys(cachedStates).length > 0) {
      setThumbnailStatesByMediaId((current) => mergeThumbnailStates(current, cachedStates));
    }

    for (const mediaRecord of mediaRecords) {
      if (!shouldRequestThumbnailState(mediaRecord)) {
        continue;
      }

      void requestThumbnailState(mediaRecord)
        .then((thumbnail) => {
          setThumbnailStatesByMediaId((current) => {
            const currentMediaRecord = mediaByIdRef.current.get(mediaRecord.id);
            if (!currentMediaRecord || !isFreshThumbnailForMediaRecord(currentMediaRecord, thumbnail)) {
              return removeThumbnailState(current, mediaRecord.id);
            }

            if (current[mediaRecord.id] === thumbnail) {
              return current;
            }
            return {
              ...current,
              [mediaRecord.id]: thumbnail
            };
          });
        })
        .catch((cause) => {
          setThumbnailStatesByMediaId((current) => ({
            ...current,
            [mediaRecord.id]: failedThumbnailState(mediaRecord.id, cause)
          }));
        });
    }
  }, []);

  const loadFolderChildren = useCallback(
    async (folderId: number) => {
      clearFolderChildPageKeys(loadedFolderChildPageKeys.current, folderId);
      setLoadingFolderIds((current) => new Set(current).add(folderId));
      try {
        const cursor = null;
        const page = await client.listFolderChildren(folderId, {
          cursor: cursor ?? undefined,
          limit: PAGE_LIMIT
        });
        setFolderChildrenByParent((current) => ({
          ...current,
          [folderId]: page.items
        }));
        setFolderChildNextCursorByParent((current) => ({
          ...current,
          [folderId]: page.nextCursor
        }));
        return page.items;
      } finally {
        setLoadingFolderIds((current) => {
          const next = new Set(current);
          next.delete(folderId);
          return next;
        });
      }
    },
    [client]
  );

  const loadMoreFolderChildren = useCallback(
    async (folderId: number) => {
      const cursor = folderChildNextCursorByParent[folderId];
      if (!cursor || loadingMoreFolderIds.has(folderId)) {
        return;
      }
      const requestKey = folderChildPageRequestKey(folderId, cursor);
      if (
        inFlightFolderChildPageKeys.current.has(requestKey) ||
        loadedFolderChildPageKeys.current.has(requestKey)
      ) {
        return;
      }

      inFlightFolderChildPageKeys.current.add(requestKey);
      setLoadingMoreFolderIds((current) => new Set(current).add(folderId));
      setError(null);
      try {
        const page = await client.listFolderChildren(folderId, {
          cursor: cursor ?? undefined,
          limit: PAGE_LIMIT
        });
        setFolderChildrenByParent((current) => ({
          ...current,
          [folderId]: [...(current[folderId] ?? []), ...page.items]
        }));
        loadedFolderChildPageKeys.current.add(requestKey);
        setFolderChildNextCursorByParent((current) => ({
          ...current,
          [folderId]: page.nextCursor
        }));
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setLoadingMoreFolderIds((current) => {
          const next = new Set(current);
          next.delete(folderId);
          return next;
        });
        inFlightFolderChildPageKeys.current.delete(requestKey);
      }
    },
    [client, folderChildNextCursorByParent, loadingMoreFolderIds]
  );

  const loadRoots = useCallback(async () => {
    const response = await client.listRoots();
    setRoots(response.items);
    const nextRootId = selectedRootId ?? response.items[0]?.id ?? null;
    selectRoot(nextRootId);
    const nextRoot = response.items.find((root) => root.id === nextRootId) ?? response.items[0];
    selectFolder((current) => current ?? nextRoot?.rootFolderId ?? null);
    return { roots: response.items, selectedRoot: nextRoot ?? null };
  }, [client, selectedRootId]);

  const loadTasks = useCallback(async () => {
    const response = await client.listTasks();
    setTasks(response.items);
    setTaskPollFailures(0);
    return response.items;
  }, [client]);

  const loadLibrary = useCallback(async () => {
    const requestGeneration = ++mediaPageGeneration.current;
    inFlightMediaPageKeys.current.clear();
    loadedMediaPageKeys.current.clear();
    setLoading(true);
    setError(null);
    try {
      const result = await loadRoots();
      await loadTasks();
      const root =
        result.roots.find((item) => item.id === selectedRootId) ?? result.selectedRoot;
      const folderId = selectedFolderId ?? root?.rootFolderId ?? null;

      if (folderId) {
        setExpandedFolderIds((current) => new Set(current).add(folderId));
        await loadFolderChildren(folderId);
      } else {
        setFolderChildrenByParent({});
        setFolderChildNextCursorByParent({});
      }

      if (root) {
        const folderFilter =
          selectedFolderId && selectedFolderId !== root.rootFolderId ? selectedFolderId : undefined;
        const cursor = null;
        const mediaPage = await client.listMedia({
          cursor: cursor ?? undefined,
          folderId: folderFilter,
          limit: PAGE_LIMIT,
          rootId: root.id,
          sort: "mtime_desc"
        });
        if (requestGeneration !== mediaPageGeneration.current) {
          return;
        }
        setMedia(mediaPage.items);
        setMediaNextCursor(mediaPage.nextCursor);
        selectMedia((current) =>
          current && mediaPage.items.some((item) => item.id === current)
            ? current
            : mediaPage.items[0]?.id ?? null
        );
      } else {
        setMedia([]);
        setMediaNextCursor(null);
        selectMedia(null);
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [client, loadFolderChildren, loadRoots, loadTasks, selectedFolderId, selectedRootId]);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    if (selectedMediaId === null) {
      return;
    }
    requestThumbnailStates([selectedMediaId]);
  }, [requestThumbnailStates, selectedMediaId]);

  useEffect(() => {
    if (!scanActive || taskPollFailures >= 3) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadTasks()
        .then((nextTasks) => {
          if (
            !nextTasks.some((task) => task.status === "pending" || task.status === "running")
          ) {
            void loadLibrary();
          }
        })
        .catch((cause) => {
          setTaskPollFailures((failures) => failures + 1);
          setError(errorMessage(cause));
        });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [loadLibrary, loadTasks, scanActive, taskPollFailures]);

  const refresh = useCallback(async () => {
    await loadLibrary();
  }, [loadLibrary]);

  const addRoot = useCallback(
    async (path: string) => {
      const trimmedPath = path.trim();
      if (!trimmedPath) return;

      setAddingRoot(true);
      setError(null);
      try {
        const response = await client.addRoot(trimmedPath);
        setLastScan(response.scan);
        if (response.rootId) {
          mediaPageGeneration.current += 1;
          selectRoot(response.rootId);
          selectFolder(null);
          setExpandedFolderIds(new Set());
          setFolderChildNextCursorByParent({});
        }
        await loadTasks();
        await loadLibrary();
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setAddingRoot(false);
      }
    },
    [client, loadLibrary, loadTasks]
  );

  const loadMoreMedia = useCallback(async () => {
    if (!mediaNextCursor || loadingMoreMedia) {
      return;
    }

    const root = roots.find((item) => item.id === selectedRootId);
    if (!root) {
      return;
    }

    const folderFilter =
      selectedFolderId && selectedFolderId !== root.rootFolderId ? selectedFolderId : undefined;
    const cursor = mediaNextCursor;
    const requestGeneration = mediaPageGeneration.current;
    const requestKey = mediaPageRequestKey(root.id, folderFilter, cursor);
    if (
      inFlightMediaPageKeys.current.has(requestKey) ||
      loadedMediaPageKeys.current.has(requestKey)
    ) {
      return;
    }

    inFlightMediaPageKeys.current.add(requestKey);
    setLoadingMoreMedia(true);
    setError(null);
    try {
      const mediaPage = await client.listMedia({
        cursor: cursor ?? undefined,
        folderId: folderFilter,
        limit: PAGE_LIMIT,
        rootId: root.id,
        sort: "mtime_desc"
      });
      if (requestGeneration !== mediaPageGeneration.current) {
        return;
      }
      setMedia((current) => [...current, ...mediaPage.items]);
      loadedMediaPageKeys.current.add(requestKey);
      setMediaNextCursor(mediaPage.nextCursor);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoadingMoreMedia(false);
      inFlightMediaPageKeys.current.delete(requestKey);
    }
  }, [client, loadingMoreMedia, mediaNextCursor, roots, selectedFolderId, selectedRootId]);

  const rescanRoot = useCallback(
    async (rootId: number) => {
      setRescanningRootIds((current) => new Set(current).add(rootId));
      setError(null);
      try {
        await client.enqueueScan(rootId);
        await loadTasks();
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setRescanningRootIds((current) => {
          const next = new Set(current);
          next.delete(rootId);
          return next;
        });
      }
    },
    [client, loadTasks]
  );

  return {
    roots,
    folders,
    media,
    selectedRootId,
    selectedFolderId,
    selectedMediaId,
    selectedMedia,
    folderChildrenByParent,
    folderChildNextCursorByParent,
    expandedFolderIds,
    loadingFolderIds,
    loadingMoreFolderIds,
    loading,
    loadingMoreMedia,
    mediaHasMore,
    thumbnailStatesByMediaId: freshThumbnailStatesByMediaId,
    addingRoot,
    rescanningRootIds,
    scanActive,
    tasks,
    error,
    lastScan,
    setSelectedRootId: (rootId: number) => {
      const root = roots.find((item) => item.id === rootId);
      mediaPageGeneration.current += 1;
      selectRoot(rootId);
      selectFolder(root?.rootFolderId ?? null);
      if (root?.rootFolderId) {
        const rootFolderId = root.rootFolderId;
        setExpandedFolderIds((current) => new Set(current).add(rootFolderId));
        void loadFolderChildren(rootFolderId);
      }
    },
    setSelectedFolder: (folder: FolderRecord) => {
      mediaPageGeneration.current += 1;
      selectRoot(folder.rootId);
      selectFolder(folder.id);
    },
    setSelectedMediaId: selectMedia,
    requestThumbnailStates,
    toggleFolderExpanded: (folderId: number) => {
      setExpandedFolderIds((current) => {
        const next = new Set(current);
        if (next.has(folderId)) {
          next.delete(folderId);
        } else {
          next.add(folderId);
          void loadFolderChildren(folderId);
        }
        return next;
      });
    },
    loadMoreFolderChildren,
    loadMoreMedia,
    rescanRoot,
    refresh,
    addRoot
  };
}

function mediaPageRequestKey(
  rootId: number,
  folderId: number | undefined,
  cursor: string
): string {
  return [rootId, folderId ?? "root", cursor].join(":");
}

function folderChildPageRequestKey(folderId: number, cursor: string): string {
  return [folderId, cursor].join(":");
}

function clearFolderChildPageKeys(keys: Set<string>, folderId: number): void {
  const prefix = `${folderId}:`;
  for (const key of keys) {
    if (key.startsWith(prefix)) {
      keys.delete(key);
    }
  }
}

function failedThumbnailState(mediaId: number, cause: unknown): ThumbnailResponse {
  return {
    fileId: mediaId,
    profile: "grid_320",
    state: "failed",
    shortSidePx: 320,
    outputFormat: "image/webp",
    asset: null,
    error: errorMessage(cause),
    updatedAt: null
  };
}

function mergeThumbnailStates(
  current: Record<number, ThumbnailResponse>,
  nextStates: Record<number, ThumbnailResponse>
): Record<number, ThumbnailResponse> {
  let changed = false;
  const next = { ...current };
  for (const [mediaId, thumbnail] of Object.entries(nextStates)) {
    const key = Number(mediaId);
    if (current[key] !== thumbnail) {
      next[key] = thumbnail;
      changed = true;
    }
  }
  return changed ? next : current;
}

function filterFreshThumbnailStates(
  current: Record<number, ThumbnailResponse>,
  mediaById: Map<number, MediaRecord>
): Record<number, ThumbnailResponse> {
  let changed = false;
  const next: Record<number, ThumbnailResponse> = {};
  for (const [mediaId, thumbnail] of Object.entries(current)) {
    const key = Number(mediaId);
    const mediaRecord = mediaById.get(key);
    if (mediaRecord && isFreshThumbnailForMediaRecord(mediaRecord, thumbnail)) {
      next[key] = thumbnail;
    } else {
      changed = true;
    }
  }
  return changed ? next : current;
}

function removeThumbnailState(
  current: Record<number, ThumbnailResponse>,
  mediaId: number
): Record<number, ThumbnailResponse> {
  if (!current[mediaId]) {
    return current;
  }
  const next = { ...current };
  delete next[mediaId];
  return next;
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  return "Core request failed";
}
