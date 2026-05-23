import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  FileOperationRecord,
  FolderRecord,
  MediaRecord,
  RootRecord,
  ScanSummary,
  SearchParams,
  TagRecord,
  TaskRecord,
  ThumbnailResponse,
  UserMetadataRecord,
  UserMetadataUpdate
} from "@megle/core-client";
import { CoreApiError } from "@megle/core-client";
import { createCoreClient } from "./client";
import { readDesktopDiagnostics, type DesktopDiagnostics } from "./desktop";
import {
  isFreshThumbnailForMediaRecord,
  readCachedThumbnailStates,
  requestThumbnailState,
  shouldRequestThumbnailState
} from "./mediaResources";

const PAGE_LIMIT = 200;
const SEARCH_DEBOUNCE_MS = 250;

export type LibrarySort =
  | "mtime_desc"
  | "mtime_asc"
  | "name_asc"
  | "name_desc"
  | "rating_desc"
  | "rating_asc";

export type MediaKindFilter = "image" | "video" | "other";
export type MinRatingFilter = 1 | 2 | 3 | 4 | 5;

export interface FileOpResult {
  ok: boolean;
  code?: string;
  message?: string;
  operations?: FileOperationRecord[];
}

export interface SearchState {
  q: string;
  kind?: MediaKindFilter;
  minRating?: MinRatingFilter;
  favorite?: boolean;
  tagIds: number[];
  sort: LibrarySort;
}

export interface LibraryState {
  roots: RootRecord[];
  folders: FolderRecord[];
  media: MediaRecord[];
  selectedRootId: number | null;
  selectedFolderId: number | null;
  selectedMediaId: number | null;
  selectedMedia: MediaRecord | null;
  selectedMetadata: UserMetadataRecord | null;
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
  busyTaskIds: Set<number>;
  tags: TagRecord[];
  tagsById: Map<number, TagRecord>;
  searchState: SearchState;
  searchActive: boolean;
  metadataSaving: boolean;
  error: string | null;
  lastScan: ScanSummary | null;
  recentOps: FileOperationRecord[];
  recentOpsLoading: boolean;
  diagnostics: DesktopDiagnostics | null;
  diagnosticsProbed: boolean;
  loadRecentOps: () => Promise<void>;
  renameFile: (fileId: number, newName: string) => Promise<FileOpResult>;
  renameFolder: (folderId: number, newName: string) => Promise<FileOpResult>;
  moveItems: (input: {
    fileIds?: number[];
    folderIds?: number[];
    targetFolderId: number;
  }) => Promise<FileOpResult>;
  deleteItems: (input: {
    fileIds?: number[];
    folderIds?: number[];
    permanent: boolean;
  }) => Promise<FileOpResult>;
  setSelectedRootId: (rootId: number) => void;
  setSelectedFolder: (folder: FolderRecord) => void;
  setSelectedMediaId: (mediaId: number | null) => void;
  toggleFolderExpanded: (folderId: number) => void;
  requestThumbnailStates: (mediaIds: number[]) => void;
  loadMoreFolderChildren: (folderId: number) => Promise<void>;
  loadMoreMedia: () => Promise<void>;
  rescanRoot: (rootId: number) => Promise<void>;
  cancelTask: (taskId: number) => Promise<void>;
  retryTask: (taskId: number) => Promise<void>;
  refreshTasks: () => Promise<void>;
  refresh: () => Promise<void>;
  addRoot: (path: string) => Promise<void>;
  setQ: (q: string) => void;
  setKind: (kind: MediaKindFilter | undefined) => void;
  setMinRating: (rating: MinRatingFilter | undefined) => void;
  toggleFavoriteFilter: () => void;
  toggleTagFilter: (tagId: number) => void;
  setSort: (sort: LibrarySort) => void;
  clearFilters: () => void;
  updateMetadata: (fileId: number, patch: UserMetadataUpdate) => Promise<void>;
  setFileTags: (fileId: number, tagIds: number[]) => Promise<void>;
  addFileTag: (fileId: number, tagId: number) => Promise<void>;
  removeFileTag: (fileId: number, tagId: number) => Promise<void>;
  createTag: (name: string, color?: string | null) => Promise<TagRecord | null>;
  deleteTag: (tagId: number) => Promise<void>;
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
  const [busyTaskIds, setBusyTaskIds] = useState<Set<number>>(() => new Set());
  const [taskPollFailures, setTaskPollFailures] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<ScanSummary | null>(null);
  const [tags, setTags] = useState<TagRecord[]>([]);
  const [searchState, setSearchState] = useState<SearchState>({
    q: "",
    kind: undefined,
    minRating: undefined,
    favorite: undefined,
    tagIds: [],
    sort: "mtime_desc"
  });
  const [debouncedQ, setDebouncedQ] = useState("");
  const [selectedMetadata, setSelectedMetadata] = useState<UserMetadataRecord | null>(null);
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [recentOps, setRecentOps] = useState<FileOperationRecord[]>([]);
  const [recentOpsLoading, setRecentOpsLoading] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DesktopDiagnostics | null>(null);
  const [diagnosticsProbed, setDiagnosticsProbed] = useState(false);
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
  const tagsById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);

  const searchActive = useMemo(
    () =>
      debouncedQ.trim() !== "" ||
      searchState.kind !== undefined ||
      searchState.minRating !== undefined ||
      searchState.favorite !== undefined ||
      searchState.tagIds.length > 0,
    [debouncedQ, searchState.kind, searchState.minRating, searchState.favorite, searchState.tagIds]
  );
  const searchActiveRef = useRef(searchActive);
  searchActiveRef.current = searchActive;
  const searchStateRef = useRef(searchState);
  searchStateRef.current = searchState;
  const debouncedQRef = useRef(debouncedQ);
  debouncedQRef.current = debouncedQ;

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
        const sort = searchStateRef.current.sort;
        const mediaPage = searchActiveRef.current
          ? await client.searchMedia(buildSearchParams(searchStateRef.current, debouncedQRef.current, {
              rootId: root.id,
              folderId: folderFilter,
              cursor: cursor ?? undefined,
              limit: PAGE_LIMIT
            }))
          : await client.listMedia({
              cursor: cursor ?? undefined,
              folderId: folderFilter,
              limit: PAGE_LIMIT,
              rootId: root.id,
              sort: listMediaSort(sort)
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

  // Debounce the search query input
  useEffect(() => {
    if (searchState.q === debouncedQ) {
      return;
    }
    const handle = window.setTimeout(() => {
      setDebouncedQ(searchState.q);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [searchState.q, debouncedQ]);

  // Reload media when filters/sort/debounced-q change
  useEffect(() => {
    void loadLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    debouncedQ,
    searchState.kind,
    searchState.minRating,
    searchState.favorite,
    searchState.sort,
    searchState.tagIds.join(",")
  ]);

  // Load tag list once and refresh on demand via createTag/deleteTag.
  useEffect(() => {
    let cancelled = false;
    void client
      .listTags()
      .then((response) => {
        if (!cancelled) {
          setTags(response.items);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(errorMessage(cause));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  // Load user metadata for the currently selected media item.
  useEffect(() => {
    if (selectedMediaId === null) {
      setSelectedMetadata(null);
      return;
    }
    let cancelled = false;
    void client
      .getUserMetadata(selectedMediaId)
      .then((record) => {
        if (!cancelled) {
          setSelectedMetadata(record);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(errorMessage(cause));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, selectedMediaId]);

  useEffect(() => {
    if (selectedMediaId === null) {
      return;
    }
    requestThumbnailStates([selectedMediaId]);
  }, [requestThumbnailStates, selectedMediaId]);

  const previousTaskStatusRef = useRef<Map<number, TaskRecord["status"]>>(new Map());
  useEffect(() => {
    const previous = previousTaskStatusRef.current;
    let scanCompleted = false;
    for (const task of tasks) {
      const prior = previous.get(task.id);
      if (
        prior &&
        prior !== task.status &&
        task.status === "succeeded" &&
        (task.kind === "root_scan" || task.kind === "thumbnail")
      ) {
        scanCompleted = true;
        break;
      }
    }
    previousTaskStatusRef.current = new Map(tasks.map((task) => [task.id, task.status]));
    if (scanCompleted) {
      void loadLibrary();
    }
  }, [tasks, loadLibrary]);

  useEffect(() => {
    if (!scanActive || taskPollFailures >= 3) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadTasks().catch((cause) => {
        setTaskPollFailures((failures) => failures + 1);
        setError(errorMessage(cause));
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [loadTasks, scanActive, taskPollFailures]);

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
      const sort = searchStateRef.current.sort;
      const mediaPage = searchActiveRef.current
        ? await client.searchMedia(buildSearchParams(searchStateRef.current, debouncedQRef.current, {
            rootId: root.id,
            folderId: folderFilter,
            cursor: cursor ?? undefined,
            limit: PAGE_LIMIT
          }))
        : await client.listMedia({
            cursor: cursor ?? undefined,
            folderId: folderFilter,
            limit: PAGE_LIMIT,
            rootId: root.id,
            sort: listMediaSort(sort)
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

  const markTaskBusy = useCallback((taskId: number, busy: boolean) => {
    setBusyTaskIds((current) => {
      const next = new Set(current);
      if (busy) {
        next.add(taskId);
      } else {
        next.delete(taskId);
      }
      return next;
    });
  }, []);

  const cancelTask = useCallback(
    async (taskId: number) => {
      markTaskBusy(taskId, true);
      setError(null);
      try {
        await client.cancelTask(taskId);
        await loadTasks();
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        markTaskBusy(taskId, false);
      }
    },
    [client, loadTasks, markTaskBusy]
  );

  const retryTask = useCallback(
    async (taskId: number) => {
      markTaskBusy(taskId, true);
      setError(null);
      try {
        await client.retryTask(taskId);
        await loadTasks();
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        markTaskBusy(taskId, false);
      }
    },
    [client, loadTasks, markTaskBusy]
  );

  const refreshTasks = useCallback(async () => {
    try {
      await loadTasks();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [loadTasks]);

  const setQ = useCallback((q: string) => {
    setSearchState((current) => (current.q === q ? current : { ...current, q }));
  }, []);

  const setKind = useCallback((kind: MediaKindFilter | undefined) => {
    setSearchState((current) => ({ ...current, kind }));
  }, []);

  const setMinRating = useCallback((rating: MinRatingFilter | undefined) => {
    setSearchState((current) => ({ ...current, minRating: rating }));
  }, []);

  const toggleFavoriteFilter = useCallback(() => {
    setSearchState((current) => ({
      ...current,
      favorite: current.favorite === true ? undefined : true
    }));
  }, []);

  const toggleTagFilter = useCallback((tagId: number) => {
    setSearchState((current) => {
      const has = current.tagIds.includes(tagId);
      return {
        ...current,
        tagIds: has ? current.tagIds.filter((id) => id !== tagId) : [...current.tagIds, tagId]
      };
    });
  }, []);

  const setSort = useCallback((sort: LibrarySort) => {
    setSearchState((current) => (current.sort === sort ? current : { ...current, sort }));
  }, []);

  const clearFilters = useCallback(() => {
    setSearchState((current) => ({
      q: "",
      kind: undefined,
      minRating: undefined,
      favorite: undefined,
      tagIds: [],
      sort: current.sort
    }));
    setDebouncedQ("");
  }, []);

  const reflectMetadataLocally = useCallback(
    (fileId: number, patch: UserMetadataUpdate) => {
      setSelectedMetadata((current) => {
        if (!current || current.fileId !== fileId) return current;
        const next: UserMetadataRecord = { ...current };
        if ("rating" in patch) next.rating = patch.rating ?? null;
        if ("favorite" in patch && patch.favorite !== undefined) next.favorite = patch.favorite;
        if ("note" in patch) next.note = patch.note ?? null;
        return next;
      });
      if ("favorite" in patch && patch.favorite !== undefined) {
        const favorite = patch.favorite;
        setMedia((current) =>
          current.map((item) => (item.id === fileId ? { ...item, favorite } : item))
        );
      }
      if ("rating" in patch) {
        const rating = patch.rating ?? null;
        setMedia((current) =>
          current.map((item) => (item.id === fileId ? { ...item, rating } : item))
        );
      }
    },
    []
  );

  const updateMetadata = useCallback(
    async (fileId: number, patch: UserMetadataUpdate) => {
      const previousMetadata =
        selectedMetadata && selectedMetadata.fileId === fileId ? selectedMetadata : null;
      const previousMediaRow = media.find((item) => item.id === fileId) ?? null;
      reflectMetadataLocally(fileId, patch);
      setMetadataSaving(true);
      try {
        const record = await client.updateUserMetadata(fileId, patch);
        setSelectedMetadata((current) =>
          current && current.fileId === fileId ? record : current
        );
      } catch (cause) {
        if (previousMetadata) {
          setSelectedMetadata((current) =>
            current && current.fileId === fileId ? previousMetadata : current
          );
        }
        if (previousMediaRow) {
          setMedia((current) =>
            current.map((item) => (item.id === fileId ? previousMediaRow : item))
          );
        }
        setError(errorMessage(cause));
      } finally {
        setMetadataSaving(false);
      }
    },
    [client, media, reflectMetadataLocally, selectedMetadata]
  );

  const reflectFileTagsLocally = useCallback((fileId: number, tagIds: number[]) => {
    setSelectedMetadata((current) =>
      current && current.fileId === fileId ? { ...current, tagIds } : current
    );
    setMedia((current) =>
      current.map((item) => (item.id === fileId ? { ...item, tagIds } : item))
    );
  }, []);

  const capturePreviousTagIds = useCallback(
    (fileId: number): number[] | null => {
      if (selectedMetadata && selectedMetadata.fileId === fileId) {
        return selectedMetadata.tagIds;
      }
      const mediaRow = media.find((item) => item.id === fileId);
      if (mediaRow && mediaRow.tagIds) {
        return [...mediaRow.tagIds];
      }
      return null;
    },
    [media, selectedMetadata]
  );

  const setFileTags = useCallback(
    async (fileId: number, tagIds: number[]) => {
      const previous = capturePreviousTagIds(fileId);
      reflectFileTagsLocally(fileId, tagIds);
      try {
        const response = await client.setFileTags(fileId, { tagIds });
        reflectFileTagsLocally(fileId, response.tagIds);
      } catch (cause) {
        if (previous) reflectFileTagsLocally(fileId, previous);
        setError(errorMessage(cause));
      }
    },
    [capturePreviousTagIds, client, reflectFileTagsLocally]
  );

  const addFileTag = useCallback(
    async (fileId: number, tagId: number) => {
      const previous = capturePreviousTagIds(fileId);
      const optimistic = previous && previous.includes(tagId) ? previous : [...(previous ?? []), tagId];
      reflectFileTagsLocally(fileId, optimistic);
      try {
        const response = await client.addFileTag(fileId, { tagId });
        reflectFileTagsLocally(fileId, response.tagIds);
      } catch (cause) {
        if (previous) reflectFileTagsLocally(fileId, previous);
        setError(errorMessage(cause));
      }
    },
    [capturePreviousTagIds, client, reflectFileTagsLocally]
  );

  const removeFileTag = useCallback(
    async (fileId: number, tagId: number) => {
      const previous = capturePreviousTagIds(fileId);
      const optimistic = (previous ?? []).filter((id) => id !== tagId);
      reflectFileTagsLocally(fileId, optimistic);
      try {
        const response = await client.removeFileTag(fileId, tagId);
        reflectFileTagsLocally(fileId, response.tagIds);
      } catch (cause) {
        if (previous) reflectFileTagsLocally(fileId, previous);
        setError(errorMessage(cause));
      }
    },
    [capturePreviousTagIds, client, reflectFileTagsLocally]
  );

  const createTag = useCallback(
    async (name: string, color?: string | null) => {
      try {
        const tag = await client.createTag({ name, color: color ?? null });
        setTags((current) => {
          if (current.some((existing) => existing.id === tag.id)) return current;
          return [...current, tag].sort((a, b) => a.name.localeCompare(b.name));
        });
        return tag;
      } catch (cause) {
        setError(errorMessage(cause));
        return null;
      }
    },
    [client]
  );

  const deleteTag = useCallback(
    async (tagId: number) => {
      try {
        await client.deleteTag(tagId);
        setTags((current) => current.filter((tag) => tag.id !== tagId));
        setSearchState((current) => ({
          ...current,
          tagIds: current.tagIds.filter((id) => id !== tagId)
        }));
      } catch (cause) {
        setError(errorMessage(cause));
      }
    },
    [client]
  );

  const loadRecentOps = useCallback(async () => {
    setRecentOpsLoading(true);
    try {
      const response = await client.listFileOperations({ limit: 50 });
      setRecentOps(response.items);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setRecentOpsLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void loadRecentOps();
  }, [loadRecentOps]);

  useEffect(() => {
    let cancelled = false;
    void readDesktopDiagnostics().then((result) => {
      if (!cancelled) {
        setDiagnostics(result);
        setDiagnosticsProbed(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const renameFile = useCallback(
    async (fileId: number, newName: string): Promise<FileOpResult> => {
      const previousMedia = media;
      const previousSelectedMediaId = selectedMediaId;
      // Optimistic: update name in grid
      setMedia((current) =>
        current.map((item) => (item.id === fileId ? { ...item, name: newName } : item))
      );
      try {
        await client.renameFileOp({ fileId, newName });
        await Promise.all([loadRecentOps(), loadLibrary()]);
        return { ok: true };
      } catch (cause) {
        setMedia(previousMedia);
        selectMedia(previousSelectedMediaId);
        const result = fileOpFailure(cause);
        setError(result.message ?? "Rename failed");
        return result;
      }
    },
    [client, loadLibrary, loadRecentOps, media, selectedMediaId]
  );

  const renameFolder = useCallback(
    async (folderId: number, newName: string): Promise<FileOpResult> => {
      const previousChildren = folderChildrenByParent;
      // Optimistic: update folder name everywhere it appears
      setFolderChildrenByParent((current) => {
        let changed = false;
        const next: Record<number, FolderRecord[]> = {};
        for (const [parentId, children] of Object.entries(current)) {
          const updated = children.map((child) =>
            child.id === folderId ? { ...child, name: newName } : child
          );
          if (updated.some((child, idx) => child !== children[idx])) {
            changed = true;
          }
          next[Number(parentId)] = updated;
        }
        return changed ? next : current;
      });
      try {
        await client.renameFileOp({ folderId, newName });
        await Promise.all([loadRecentOps(), loadLibrary()]);
        return { ok: true };
      } catch (cause) {
        setFolderChildrenByParent(previousChildren);
        const result = fileOpFailure(cause);
        setError(result.message ?? "Rename failed");
        return result;
      }
    },
    [client, folderChildrenByParent, loadLibrary, loadRecentOps]
  );

  const moveItems = useCallback(
    async (input: {
      fileIds?: number[];
      folderIds?: number[];
      targetFolderId: number;
    }): Promise<FileOpResult> => {
      const fileIds = input.fileIds ?? [];
      const folderIds = input.folderIds ?? [];
      if (fileIds.length === 0 && folderIds.length === 0) {
        return { ok: true };
      }
      const previousMedia = media;
      // Optimistic: drop moved files from current view if their target is different from current folder
      if (fileIds.length > 0 && input.targetFolderId !== selectedFolderId) {
        setMedia((current) => current.filter((item) => !fileIds.includes(item.id)));
      }
      try {
        const response = await client.moveFileOps({
          fileIds: fileIds.length > 0 ? fileIds : undefined,
          folderIds: folderIds.length > 0 ? folderIds : undefined,
          targetFolderId: input.targetFolderId
        });
        await Promise.all([loadRecentOps(), loadLibrary()]);
        return { ok: true, operations: response.operations };
      } catch (cause) {
        setMedia(previousMedia);
        const result = fileOpFailure(cause);
        setError(result.message ?? "Move failed");
        return result;
      }
    },
    [client, loadLibrary, loadRecentOps, media, selectedFolderId]
  );

  const deleteItems = useCallback(
    async (input: {
      fileIds?: number[];
      folderIds?: number[];
      permanent: boolean;
    }): Promise<FileOpResult> => {
      const fileIds = input.fileIds ?? [];
      const folderIds = input.folderIds ?? [];
      if (fileIds.length === 0 && folderIds.length === 0) {
        return { ok: true };
      }
      const previousMedia = media;
      const previousSelectedMediaId = selectedMediaId;
      const previousChildren = folderChildrenByParent;

      // Optimistic: remove deleted items locally
      if (fileIds.length > 0) {
        setMedia((current) => current.filter((item) => !fileIds.includes(item.id)));
        if (selectedMediaId !== null && fileIds.includes(selectedMediaId)) {
          selectMedia(null);
        }
      }
      if (folderIds.length > 0) {
        setFolderChildrenByParent((current) => {
          const next: Record<number, FolderRecord[]> = {};
          for (const [parentId, children] of Object.entries(current)) {
            next[Number(parentId)] = children.filter((child) => !folderIds.includes(child.id));
          }
          return next;
        });
      }

      try {
        const response = await client.deleteFileOps({
          fileIds: fileIds.length > 0 ? fileIds : undefined,
          folderIds: folderIds.length > 0 ? folderIds : undefined,
          permanent: input.permanent
        });
        await Promise.all([loadRecentOps(), loadLibrary()]);
        return { ok: true, operations: response.operations };
      } catch (cause) {
        // Rollback
        setMedia(previousMedia);
        selectMedia(previousSelectedMediaId);
        setFolderChildrenByParent(previousChildren);
        const result = fileOpFailure(cause);
        setError(result.message ?? "Delete failed");
        return result;
      }
    },
    [
      client,
      folderChildrenByParent,
      loadLibrary,
      loadRecentOps,
      media,
      selectedMediaId
    ]
  );

  return {
    roots,
    folders,
    media,
    selectedRootId,
    selectedFolderId,
    selectedMediaId,
    selectedMedia,
    selectedMetadata,
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
    busyTaskIds,
    tags,
    tagsById,
    searchState,
    searchActive,
    metadataSaving,
    error,
    lastScan,
    recentOps,
    recentOpsLoading,
    diagnostics,
    diagnosticsProbed,
    loadRecentOps,
    renameFile,
    renameFolder,
    moveItems,
    deleteItems,
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
    cancelTask,
    retryTask,
    refreshTasks,
    refresh,
    addRoot,
    setQ,
    setKind,
    setMinRating,
    toggleFavoriteFilter,
    toggleTagFilter,
    setSort,
    clearFilters,
    updateMetadata,
    setFileTags,
    addFileTag,
    removeFileTag,
    createTag,
    deleteTag
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
    target: "grid_320",
    state: "failed",
    shortSidePx: 320,
    outputFormat: "image/webp",
    width: null,
    height: null,
    byteSize: null,
    servedBy: null,
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

function listMediaSort(sort: LibrarySort): "mtime_desc" | "mtime_asc" | "name_asc" | "name_desc" {
  switch (sort) {
    case "mtime_asc":
    case "name_asc":
    case "name_desc":
      return sort;
    default:
      return "mtime_desc";
  }
}

function buildSearchParams(
  state: SearchState,
  debouncedQ: string,
  scope: { rootId: number; folderId: number | undefined; cursor?: string; limit: number }
): SearchParams {
  const params: SearchParams = {
    rootId: scope.rootId,
    limit: scope.limit,
    sort: state.sort
  };
  if (scope.cursor) params.cursor = scope.cursor;
  if (scope.folderId !== undefined) params.folderId = scope.folderId;
  const q = debouncedQ.trim();
  if (q) params.q = q;
  if (state.kind) params.kind = state.kind;
  if (state.minRating !== undefined) params.minRating = state.minRating;
  if (state.favorite !== undefined) params.favorite = state.favorite;
  if (state.tagIds.length > 0) params.tagIds = [...state.tagIds];
  return params;
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  return "Core request failed";
}

function fileOpFailure(cause: unknown): FileOpResult {
  if (cause instanceof CoreApiError) {
    const body = cause.body;
    let code: string | undefined;
    let message: string | undefined;
    if (body && typeof body === "object") {
      const record = body as Record<string, unknown>;
      if (typeof record.code === "string") code = record.code;
      if (typeof record.error === "string") message = record.error;
      else if (typeof record.message === "string") message = record.message;
    }
    return {
      ok: false,
      code,
      message: message ?? `Request failed (${cause.status})`
    };
  }
  return {
    ok: false,
    message: errorMessage(cause)
  };
}
