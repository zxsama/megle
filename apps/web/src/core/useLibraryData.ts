import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  FolderRecord,
  MediaRecord,
  RootRecord,
  ScanSummary,
  TaskRecord
} from "@megle/core-client";
import { createCoreClient } from "./client";

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
  loadMoreFolderChildren: (folderId: number) => Promise<void>;
  loadMoreMedia: () => Promise<void>;
  rescanRoot: (rootId: number) => Promise<void>;
  refresh: () => Promise<void>;
  addRoot: (path: string) => Promise<void>;
}

export function useLibraryData(): LibraryState {
  const client = useMemo(() => createCoreClient(), []);
  const mediaPageGeneration = useRef(0);
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

  const selectedMedia = media.find((item) => item.id === selectedMediaId) ?? null;
  const folders = useMemo(
    () => Object.values(folderChildrenByParent).flat(),
    [folderChildrenByParent]
  );
  const scanActive = tasks.some((task) => task.status === "pending" || task.status === "running");

  const loadFolderChildren = useCallback(
    async (folderId: number) => {
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
      setMediaNextCursor(mediaPage.nextCursor);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoadingMoreMedia(false);
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

function errorMessage(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  return "Core request failed";
}
