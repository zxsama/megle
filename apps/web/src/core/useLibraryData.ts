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
  isLiveThumbnailResponseForMediaRecord,
  mediaContentSignature,
  pickPreferredThumbnailResponse,
  readCachedThumbnailStates,
  requestThumbnailState,
  type ThumbnailRequestPriority,
  shouldRequestThumbnailState
} from "./mediaResources";

const INITIAL_MEDIA_WINDOW_LIMIT = 96;
const MEDIA_WINDOW_MAX_LIMIT = 256;
const FOLDER_PAGE_LIMIT = 500;
const SEARCH_DEBOUNCE_MS = 250;
const SCAN_REFRESH_INTERVAL_MS = 800;
const SELECTED_THUMBNAIL_REPOLL_MS = 150;
const THUMBNAIL_SCOPE_SYNC_DEBOUNCE_MS = 0;
const SHOW_SUBFOLDER_CONTENTS_STORAGE_KEY = "megle.library.subfolder-content-open";

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
  mediaSlots: Array<MediaRecord | undefined>;
  mediaTotalCount: number;
  loadedMediaRanges: Array<{ start: number; end: number }>;
  showChildFolderContents: boolean;
  selectedRootId: number | null;
  selectedFolderId: number | null;
  selectedMediaId: number | null;
  selectedMedia: MediaRecord | null;
  selectedMetadata: UserMetadataRecord | null;
  folderChildrenByParent: Record<number, FolderRecord[]>;
  folderDescendantsByParent: Record<number, FolderRecord[]>;
  folderChildNextCursorByParent: Record<number, string | null>;
  expandedFolderIds: Set<number>;
  loadingFolderIds: Set<number>;
  loadingFolderDescendantIds: Set<number>;
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
  toggleShowChildFolderContents: () => void;
  setSelectedMediaId: (mediaId: number | null) => void;
  toggleFolderExpanded: (folderId: number) => void;
  requestThumbnailStates: (mediaIds: number[], priority: ThumbnailRequestPriority) => void;
  requestMediaWindow: (startIndex: number, endIndex: number) => void;
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

type ScanRefreshSelectionToken = {
  rootId: number;
  folderId: number | null;
  version: number;
};

type LibrarySelectionScope = {
  rootId?: number | null;
  folderId?: number | null;
};

type ThumbnailPriorityScope = {
  selected: number[];
  visible: number[];
  ahead: number[];
};

type PendingInteractiveScanRequest = {
  rootId: number;
  folderId: number;
  knownTaskIds: Set<number>;
};

export function useLibraryData(): LibraryState {
  const client = useMemo(() => createCoreClient(), []);
  const mediaPageGeneration = useRef(0);
  const inFlightMediaPageKeys = useRef<Set<string>>(new Set());
  const loadedMediaPageKeys = useRef<Set<string>>(new Set());
  const inFlightFolderChildPageKeys = useRef<Set<string>>(new Set());
  const loadedFolderChildPageKeys = useRef<Set<string>>(new Set());
  const inFlightFolderDescendantIds = useRef<Set<number>>(new Set());
  const scanRefreshInFlightRef = useRef(false);
  const scanRefreshActiveRootIdRef = useRef<number | null>(null);
  const scanRefreshSelectionVersionRef = useRef(0);
  const [roots, setRoots] = useState<RootRecord[]>([]);
  const [folderChildrenByParent, setFolderChildrenByParent] = useState<Record<number, FolderRecord[]>>(
    {}
  );
  const [folderDescendantsByParent, setFolderDescendantsByParent] = useState<
    Record<number, FolderRecord[]>
  >({});
  const folderDescendantsByParentRef = useRef(folderDescendantsByParent);
  folderDescendantsByParentRef.current = folderDescendantsByParent;
  const [folderChildNextCursorByParent, setFolderChildNextCursorByParent] = useState<
    Record<number, string | null>
  >({});
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<number>>(() => new Set());
  const [loadingFolderIds, setLoadingFolderIds] = useState<Set<number>>(() => new Set());
  const [loadingFolderDescendantIds, setLoadingFolderDescendantIds] = useState<Set<number>>(
    () => new Set()
  );
  const [loadingMoreFolderIds, setLoadingMoreFolderIds] = useState<Set<number>>(() => new Set());
  const [media, setMedia] = useState<MediaRecord[]>([]);
  const [mediaSlots, setMediaSlots] = useState<Array<MediaRecord | undefined>>([]);
  const [mediaTotalCount, setMediaTotalCount] = useState(0);
  const [loadedMediaRanges, setLoadedMediaRanges] = useState<Array<{ start: number; end: number }>>(
    []
  );
  const mediaTotalCountRef = useRef(mediaTotalCount);
  mediaTotalCountRef.current = mediaTotalCount;
  const loadedMediaRangesRef = useRef(loadedMediaRanges);
  loadedMediaRangesRef.current = loadedMediaRanges;
  const [thumbnailStatesByMediaId, setThumbnailStatesByMediaId] = useState<
    Record<number, ThumbnailResponse>
  >({});
  const thumbnailStateSignaturesByMediaIdRef = useRef<Record<number, string>>({});
  const [mediaNextCursor, setMediaNextCursor] = useState<string | null>(null);
  const mediaHasMore = media.length < mediaTotalCount || mediaNextCursor !== null;
  const [showChildFolderContents, setShowChildFolderContents] = useState<boolean>(() =>
    readStoredShowChildFolderContents()
  );
  const [selectedRootId, selectRoot] = useState<number | null>(null);
  const [selectedFolderId, selectFolder] = useState<number | null>(null);
  const [selectedMediaId, selectMedia] = useState<number | null>(null);
  const selectedRootIdRef = useRef<number | null>(selectedRootId);
  const selectedFolderIdRef = useRef<number | null>(selectedFolderId);
  const selectedMediaIdRef = useRef<number | null>(selectedMediaId);
  const thumbnailPriorityScopeRef = useRef<ThumbnailPriorityScope>(emptyThumbnailPriorityScope());
  const thumbnailPriorityScopeSyncKeyRef = useRef<string | null>(null);
  const thumbnailPriorityScopeSyncTimerRef = useRef<number | null>(null);
  const pendingInteractiveScanRequestRef = useRef<PendingInteractiveScanRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMoreMedia, setLoadingMoreMedia] = useState(false);
  const [addingRoot, setAddingRoot] = useState(false);
  const [rescanningRootIds, setRescanningRootIds] = useState<Set<number>>(() => new Set());
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [busyTaskIds, setBusyTaskIds] = useState<Set<number>>(() => new Set());
  const [taskPollFailures, setTaskPollFailures] = useState(0);
  const [scanRefreshFailures, setScanRefreshFailures] = useState(0);
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
  const metadataEditGenerationRef = useRef(0);
  const [recentOps, setRecentOps] = useState<FileOperationRecord[]>([]);
  const [recentOpsLoading, setRecentOpsLoading] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DesktopDiagnostics | null>(null);
  const [diagnosticsProbed, setDiagnosticsProbed] = useState(false);
  const mediaById = useMemo(() => new Map(media.map((item) => [item.id, item])), [media]);
  const mediaByIdRef = useRef(mediaById);
  mediaByIdRef.current = mediaById;
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const failedThumbnailRetrySignaturesRef = useRef<Set<string>>(new Set());
  const freshThumbnailStatesByMediaId = useMemo(
    () =>
      filterFreshThumbnailStates(
        thumbnailStatesByMediaId,
        mediaById,
        thumbnailStateSignaturesByMediaIdRef.current
      ),
    [mediaById, thumbnailStatesByMediaId]
  );

  const selectedMedia = media.find((item) => item.id === selectedMediaId) ?? null;
  const selectedRoot = roots.find((item) => item.id === selectedRootId) ?? null;
  const selectedThumbnail = selectedMedia
    ? freshThumbnailStatesByMediaId[selectedMedia.id]
    : undefined;
  const selectedMediaThumbnailRequestKey = selectedMedia
    ? mediaContentSignature(selectedMedia)
    : null;
  const folders = useMemo(
    () => Object.values(folderChildrenByParent).flat(),
    [folderChildrenByParent]
  );
  const scanActive = tasks.some((task) => task.status === "pending" || task.status === "running");
  const scanActiveRootTask =
    selectedRootId !== null &&
    tasks.some(
      (task) =>
        task.kind === "root_scan" &&
        task.rootId === selectedRootId &&
        isTaskActive(task)
    );
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
  const showChildFolderContentsRef = useRef(showChildFolderContents);
  showChildFolderContentsRef.current = showChildFolderContents;
  const searchStateRef = useRef(searchState);
  searchStateRef.current = searchState;
  const debouncedQRef = useRef(debouncedQ);
  debouncedQRef.current = debouncedQ;
  selectedRootIdRef.current = selectedRootId;
  selectedFolderIdRef.current = selectedFolderId;
  selectedMediaIdRef.current = selectedMediaId;

  const flushThumbnailPriorityScopeSync = useCallback(
    async (rootId = selectedRootIdRef.current) => {
      if (thumbnailPriorityScopeSyncTimerRef.current !== null) {
        window.clearTimeout(thumbnailPriorityScopeSyncTimerRef.current);
        thumbnailPriorityScopeSyncTimerRef.current = null;
      }
      if (rootId === null) {
        return;
      }

      const input = {
        rootId,
        selectedFileIds: thumbnailPriorityScopeRef.current.selected,
        visibleFileIds: thumbnailPriorityScopeRef.current.visible,
        aheadFileIds: thumbnailPriorityScopeRef.current.ahead
      };
      const requestKey = thumbnailPriorityScopeRequestKey(input);
      if (thumbnailPriorityScopeSyncKeyRef.current === requestKey) {
        return;
      }

      thumbnailPriorityScopeSyncKeyRef.current = requestKey;
      try {
        await client.syncThumbnailPriorityScope(input);
      } catch (cause) {
        thumbnailPriorityScopeSyncKeyRef.current = null;
        throw cause;
      }
    },
    [client]
  );

  const scheduleThumbnailPriorityScopeSync = useCallback(
    (priority: ThumbnailRequestPriority, mediaIds: number[]) => {
      if (priority === "background") {
        return;
      }

      thumbnailPriorityScopeRef.current = nextThumbnailPriorityScope(
        thumbnailPriorityScopeRef.current,
        priority,
        mediaIds,
        selectedMediaIdRef.current
      );
      if (thumbnailPriorityScopeSyncTimerRef.current !== null) {
        window.clearTimeout(thumbnailPriorityScopeSyncTimerRef.current);
      }
      if (selectedRootIdRef.current === null) {
        return;
      }
      thumbnailPriorityScopeSyncTimerRef.current = window.setTimeout(() => {
        void flushThumbnailPriorityScopeSync().catch((cause) => {
          setError(errorMessage(cause));
        });
      }, THUMBNAIL_SCOPE_SYNC_DEBOUNCE_MS);
    },
    [flushThumbnailPriorityScopeSync]
  );

  const requestThumbnailStates = useCallback((
    mediaIds: number[],
    priority: ThumbnailRequestPriority
  ) => {
    scheduleThumbnailPriorityScopeSync(priority, mediaIds);

    const normalizedMediaIds = normalizeThumbnailScopeMediaIds(
      mediaIds,
      priority,
      selectedMediaIdRef.current
    );
    const mediaRecords = normalizedMediaIds
      .map((mediaId) => mediaByIdRef.current.get(mediaId))
      .filter((mediaRecord): mediaRecord is MediaRecord => Boolean(mediaRecord));
    if (mediaRecords.length === 0) {
      return;
    }

    const cachedStates = readCachedThumbnailStates(mediaRecords);
    if (Object.keys(cachedStates).length > 0) {
      recordThumbnailStateSignatures(
        cachedStates,
        mediaByIdRef.current,
        thumbnailStateSignaturesByMediaIdRef.current
      );
      setThumbnailStatesByMediaId((current) => mergeThumbnailStates(current, cachedStates));
    }

    for (const mediaRecord of mediaRecords) {
      const currentThumbnail = freshThumbnailStatesByMediaId[mediaRecord.id];
      const currentMediaSignature = mediaContentSignature(mediaRecord);
      const effectiveState =
        currentThumbnail?.state ?? explicitMediaThumbnailState(mediaRecord.thumbnailState);
      if (
        effectiveState === "failed" &&
        priority !== "background" &&
        !failedThumbnailRetrySignaturesRef.current.has(currentMediaSignature)
      ) {
        const failedTask = latestFailedThumbnailTaskForFile(tasksRef.current, mediaRecord.id);
        if (failedTask) {
          failedThumbnailRetrySignaturesRef.current.add(currentMediaSignature);
          thumbnailStateSignaturesByMediaIdRef.current[mediaRecord.id] = currentMediaSignature;
          setThumbnailStatesByMediaId((current) => ({
            ...current,
            [mediaRecord.id]: optimisticQueuedThumbnail(mediaRecord.id)
          }));
          void client
            .retryTask(failedTask.id)
            .then(() => client.listTasks())
            .then((response) => {
              setTasks(response.items);
              setTaskPollFailures(0);
            })
            .then(() => requestThumbnailState(mediaRecord, priority))
            .then((thumbnail) => {
              setThumbnailStatesByMediaId((current) => ({
                ...current,
                [mediaRecord.id]: pickPreferredThumbnailResponse(
                  current[mediaRecord.id],
                  thumbnail
                )
              }));
            })
            .catch((cause) => {
              setError(errorMessage(cause));
            });
          continue;
        }
      }
      const shouldFetchThumbnail =
        currentThumbnail?.state === "pending" ||
        currentThumbnail?.state === "queued" ||
        shouldRequestThumbnailState(mediaRecord);
      if (!shouldFetchThumbnail) {
        continue;
      }

      const requestedMediaSignature = currentMediaSignature;
      void requestThumbnailState(mediaRecord, priority)
        .then((thumbnail) => {
          setThumbnailStatesByMediaId((current) => {
            const currentMediaRecord = mediaByIdRef.current.get(mediaRecord.id);
            const currentMediaSignature = currentMediaRecord
              ? mediaContentSignature(currentMediaRecord)
              : null;
            if (
              !currentMediaRecord ||
              currentMediaSignature !== requestedMediaSignature ||
              !isLiveThumbnailResponseForMediaRecord(currentMediaRecord, thumbnail)
            ) {
              delete thumbnailStateSignaturesByMediaIdRef.current[mediaRecord.id];
              return removeThumbnailState(current, mediaRecord.id);
            }

            thumbnailStateSignaturesByMediaIdRef.current[mediaRecord.id] =
              currentMediaSignature;
            const mergedThumbnail = pickPreferredThumbnailResponse(
              current[mediaRecord.id],
              thumbnail
            );
            if (current[mediaRecord.id] === mergedThumbnail) {
              return current;
            }
            return {
              ...current,
              [mediaRecord.id]: mergedThumbnail
            };
          });
        })
        .catch((cause) => {
          setThumbnailStatesByMediaId((current) => {
            const currentMediaRecord = mediaByIdRef.current.get(mediaRecord.id);
            const currentMediaSignature = currentMediaRecord
              ? mediaContentSignature(currentMediaRecord)
              : null;
            if (!currentMediaRecord || currentMediaSignature !== requestedMediaSignature) {
              delete thumbnailStateSignaturesByMediaIdRef.current[mediaRecord.id];
              return removeThumbnailState(current, mediaRecord.id);
            }
            if (cause instanceof Error && cause.name === "AbortError") {
              return current;
            }
            delete thumbnailStateSignaturesByMediaIdRef.current[mediaRecord.id];
            return removeThumbnailState(current, mediaRecord.id);
          });
        });
    }
  }, [client, freshThumbnailStatesByMediaId, scheduleThumbnailPriorityScopeSync]);

  const loadFolderChildren = useCallback(
    async (folderId: number) => {
      clearFolderChildPageKeys(loadedFolderChildPageKeys.current, folderId);
      setLoadingFolderIds((current) => new Set(current).add(folderId));
      try {
        const cursor = null;
        const page = await client.listFolderChildren(folderId, {
          cursor: cursor ?? undefined,
          limit: FOLDER_PAGE_LIMIT
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
          limit: FOLDER_PAGE_LIMIT
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

  const loadFolderDescendants = useCallback(
    async (folderId: number) => {
      if (inFlightFolderDescendantIds.current.has(folderId)) {
        return folderDescendantsByParentRef.current[folderId] ?? [];
      }

      inFlightFolderDescendantIds.current.add(folderId);
      setLoadingFolderDescendantIds((current) => new Set(current).add(folderId));
      try {
        let cursor: string | null = null;
        let descendants: FolderRecord[] = [];
        let publishedFirstPage = false;
        do {
          const page = await client.listFolderChildren(folderId, {
            cursor: cursor ?? undefined,
            includeDescendants: true,
            limit: FOLDER_PAGE_LIMIT
          });
          descendants.push(...page.items);
          cursor = page.nextCursor;
          if (!publishedFirstPage || !cursor) {
            const publishedDescendants = descendants.slice();
            setFolderDescendantsByParent((current) => ({
              ...current,
              [folderId]: publishedDescendants
            }));
            publishedFirstPage = true;
            await yieldToBrowser();
          }
        } while (cursor);
        return descendants;
      } finally {
        inFlightFolderDescendantIds.current.delete(folderId);
        setLoadingFolderDescendantIds((current) => {
          const next = new Set(current);
          next.delete(folderId);
          return next;
        });
      }
    },
    [client]
  );

  const loadRoots = useCallback(async (scope?: LibrarySelectionScope) => {
    const response = await client.listRoots();
    setRoots(response.items);
    const requestedRootId =
      scope && "rootId" in scope ? scope.rootId ?? null : selectedRootIdRef.current;
    const nextRootId = requestedRootId ?? response.items[0]?.id ?? null;
    selectRoot(nextRootId);
    const nextRoot = response.items.find((root) => root.id === nextRootId) ?? response.items[0];
    const nextFolderId =
      scope && "folderId" in scope
        ? scope.folderId ?? null
        : selectedFolderIdRef.current ?? nextRoot?.rootFolderId ?? null;
    selectedRootIdRef.current = nextRootId;
    selectedFolderIdRef.current = nextFolderId;
    selectFolder(nextFolderId);
    return { roots: response.items, selectedRoot: nextRoot ?? null, selectedFolderId: nextFolderId };
  }, [client]);

  const loadTasks = useCallback(async () => {
    const response = await client.listTasks();
    setTasks(response.items);
    setTaskPollFailures(0);
    return response.items;
  }, [client]);

  const createScanRefreshSelectionToken = useCallback((): ScanRefreshSelectionToken | null => {
    if (selectedRootId === null) {
      return null;
    }

    return {
      rootId: selectedRootId,
      folderId: selectedFolderId,
      version: scanRefreshSelectionVersionRef.current
    };
  }, [selectedFolderId, selectedRootId]);

  const isCurrentScanRefreshSelection = useCallback(
    (token: ScanRefreshSelectionToken) =>
      token.version === scanRefreshSelectionVersionRef.current &&
      token.rootId === selectedRootId &&
      token.folderId === selectedFolderId,
    [selectedFolderId, selectedRootId]
  );

  const loadMediaPage = useCallback(
    async (scope: {
      rootId: number;
      folderId: number | undefined;
      includeDescendants: boolean;
      cursor?: string;
      offset?: number;
      limit: number;
    }) => {
      const sort = searchStateRef.current.sort;
      return searchActiveRef.current
        ? client.searchMedia(buildSearchParams(searchStateRef.current, debouncedQRef.current, scope))
        : client.listMedia({
            cursor: scope.cursor,
            folderId: scope.folderId,
            includeDescendants: scope.includeDescendants,
            limit: scope.limit,
            offset: scope.offset,
            rootId: scope.rootId,
            sort: listMediaSort(sort)
          });
    },
    [client]
  );

  const loadMediaWindow = useCallback(
    async (scope: {
      rootId: number;
      folderId: number | undefined;
      includeDescendants: boolean;
      offset: number;
      limit: number;
      requestGeneration: number;
      selectFirst?: boolean;
    }) => {
      const offset = Math.max(0, scope.offset);
      const limit = Math.max(1, Math.min(MEDIA_WINDOW_MAX_LIMIT, scope.limit));
      const requestKey = mediaPageRequestKey(
        scope.rootId,
        scope.folderId,
        `offset:${offset}:${limit}`,
        scope.includeDescendants
      );
      if (
        inFlightMediaPageKeys.current.has(requestKey) ||
        loadedMediaPageKeys.current.has(requestKey)
      ) {
        return;
      }

      inFlightMediaPageKeys.current.add(requestKey);
      setLoadingMoreMedia(true);
      try {
        const mediaPage = await loadMediaPage({
          folderId: scope.folderId,
          includeDescendants: scope.includeDescendants,
          limit,
          offset,
          rootId: scope.rootId
        });
        if (scope.requestGeneration !== mediaPageGeneration.current) {
          return;
        }
        const totalCount = Math.max(
          mediaPage.totalCount ?? mediaTotalCountRef.current,
          offset + mediaPage.items.length
        );
        setMediaTotalCount(totalCount);
        setMediaSlots((current) => {
          return applyMediaWindowToSlots(current, totalCount, offset, mediaPage.items);
        });
        setMedia((current) => appendUniqueMedia(current, mediaPage.items));
        setLoadedMediaRanges((current) =>
          mergeLoadedMediaRanges(current, offset, offset + mediaPage.items.length)
        );
        loadedMediaPageKeys.current.add(requestKey);
        setMediaNextCursor(mediaPage.nextCursor);
        if (scope.selectFirst) {
          selectMedia((current) =>
            current && mediaPage.items.some((item) => item.id === current)
              ? current
              : mediaPage.items[0]?.id ?? null
          );
        }
        await yieldToBrowser();
      } catch (cause) {
        if (scope.requestGeneration === mediaPageGeneration.current) {
          setError(errorMessage(cause));
        }
      } finally {
        inFlightMediaPageKeys.current.delete(requestKey);
        if (scope.requestGeneration === mediaPageGeneration.current) {
          setLoadingMoreMedia(false);
        }
      }
    },
    [loadMediaPage]
  );

  const requestMediaWindow = useCallback(
    (startIndex: number, endIndex: number) => {
      const totalCount = mediaTotalCountRef.current;
      const clampedStart = Math.max(0, Math.floor(startIndex));
      const clampedEnd = Math.max(clampedStart, Math.ceil(endIndex));
      if (totalCount <= 0 || clampedStart >= totalCount) {
        return;
      }
      const pageOffset = clampedStart;
      const pageEnd = Math.min(
        totalCount,
        pageOffset + Math.min(MEDIA_WINDOW_MAX_LIMIT, Math.max(1, clampedEnd - pageOffset))
      );
      const missingRange = firstMissingMediaRange(
        loadedMediaRangesRef.current,
        pageOffset,
        pageEnd
      );
      if (!missingRange) {
        return;
      }
      const rootId = selectedRootIdRef.current;
      if (rootId === null) {
        return;
      }
      const folderId = selectedFolderIdRef.current;
      const folderFilter = folderId !== null && folderId !== undefined ? folderId : undefined;
      void loadMediaWindow({
        rootId,
        folderId: folderFilter,
        includeDescendants: showChildFolderContentsRef.current,
        offset: missingRange.start,
        limit: missingRange.end - missingRange.start,
        requestGeneration: mediaPageGeneration.current
      });
    },
    [loadMediaWindow]
  );

  const reloadCurrentMedia = useCallback(
    async (scope?: {
      rootId?: number;
      folderId?: number | null;
      includeDescendants?: boolean;
      scanRefreshSelectionToken?: ScanRefreshSelectionToken;
      setLoadingState?: boolean;
    }) => {
      const requestGeneration = ++mediaPageGeneration.current;
      const rootId = scope?.rootId ?? selectedRootId;
      const setLoadingState = scope?.setLoadingState ?? false;
      if (setLoadingState) {
        setLoading(true);
      }
      if (rootId === null) {
        if (setLoadingState) {
          setLoading(false);
        }
        return;
      }

      const scanRefreshSelectionToken = scope?.scanRefreshSelectionToken;
      if (
        scanRefreshSelectionToken &&
        !isCurrentScanRefreshSelection(scanRefreshSelectionToken)
      ) {
        return;
      }

      const root = roots.find((item) => item.id === rootId);
      if (!root) {
        if (setLoadingState) {
          setLoading(false);
        }
        return;
      }

      const folderId = scope && "folderId" in scope ? scope.folderId : selectedFolderId;
      const includeDescendants =
        scope?.includeDescendants ?? showChildFolderContentsRef.current;
      const folderFilter = folderId !== null && folderId !== undefined ? folderId : undefined;
      inFlightMediaPageKeys.current.clear();
      loadedMediaPageKeys.current.clear();
      setMedia([]);
      setMediaSlots([]);
      setMediaTotalCount(0);
      setLoadedMediaRanges([]);
      setMediaNextCursor(null);
      setError(null);

      try {
        await loadMediaWindow({
          rootId: root.id,
          folderId: folderFilter,
          includeDescendants,
          offset: 0,
          limit: INITIAL_MEDIA_WINDOW_LIMIT,
          requestGeneration,
          selectFirst: true
        });
        if (
          requestGeneration !== mediaPageGeneration.current ||
          (scanRefreshSelectionToken &&
            !isCurrentScanRefreshSelection(scanRefreshSelectionToken))
        ) {
          return;
        }
      } catch (cause) {
        setError(errorMessage(cause));
        throw cause;
      } finally {
        if (
          setLoadingState &&
          requestGeneration === mediaPageGeneration.current &&
          (!scanRefreshSelectionToken ||
            isCurrentScanRefreshSelection(scanRefreshSelectionToken))
        ) {
          setLoading(false);
        }
      }
    },
    [
      isCurrentScanRefreshSelection,
      loadMediaWindow,
      roots,
      selectedFolderId,
      selectedRootId
    ]
  );

  const refreshCurrentScanView = useCallback(async () => {
    const selectionToken = createScanRefreshSelectionToken();
    if (!selectionToken || !isCurrentScanRefreshSelection(selectionToken)) {
      return;
    }

    const rootsScope =
      selectionToken.folderId === null
        ? { rootId: selectionToken.rootId }
        : { rootId: selectionToken.rootId, folderId: selectionToken.folderId };
    const rootsResult = await loadRoots(rootsScope);
    const root =
      rootsResult.roots.find((item) => item.id === selectionToken.rootId) ?? rootsResult.selectedRoot;
    const resolvedFolderId =
      selectionToken.folderId ?? root?.rootFolderId ?? rootsResult.selectedFolderId ?? null;
    if (resolvedFolderId !== null) {
      setExpandedFolderIds((current) => new Set(current).add(resolvedFolderId));
    }

    await loadTasks();
    if (!isCurrentScanRefreshSelection(selectionToken)) {
      return;
    }

    if (selectionToken.folderId !== null || resolvedFolderId !== null) {
      const folderId = selectionToken.folderId ?? resolvedFolderId;
      if (folderId === null) {
        return;
      }
      await loadFolderChildren(folderId);
      if (showChildFolderContentsRef.current) {
        void loadFolderDescendants(folderId).catch((cause) => {
          setError(errorMessage(cause));
        });
      }
      if (!isCurrentScanRefreshSelection(selectionToken)) {
        return;
      }
      if (root?.rootFolderId && root.rootFolderId !== folderId) {
        await loadFolderChildren(root.rootFolderId);
      }
      await reloadCurrentMedia({
        rootId: selectionToken.rootId,
        folderId: selectionToken.folderId ?? resolvedFolderId,
        scanRefreshSelectionToken: selectionToken
      });
      return;
    }

    await reloadCurrentMedia({
      rootId: selectionToken.rootId,
      folderId: null,
      scanRefreshSelectionToken: selectionToken
    });
  }, [
    createScanRefreshSelectionToken,
    isCurrentScanRefreshSelection,
    loadFolderChildren,
    loadFolderDescendants,
    loadRoots,
    loadTasks,
    reloadCurrentMedia
  ]);

  const loadLibrary = useCallback(async (scope?: LibrarySelectionScope) => {
    const requestGeneration = ++mediaPageGeneration.current;
    inFlightMediaPageKeys.current.clear();
    loadedMediaPageKeys.current.clear();
    setLoading(true);
    setError(null);
    try {
      const result = await loadRoots(scope);
      await loadTasks();
      const root =
        result.roots.find((item) => item.id === selectedRootIdRef.current) ?? result.selectedRoot;
      const folderId =
        scope && "folderId" in scope
          ? scope.folderId ?? null
          : result.selectedFolderId ?? root?.rootFolderId ?? null;
      const includeDescendants = showChildFolderContentsRef.current;

      if (folderId) {
        setExpandedFolderIds((current) => new Set(current).add(folderId));
        await loadFolderChildren(folderId);
        if (includeDescendants) {
          void loadFolderDescendants(folderId).catch((cause) => {
            setError(errorMessage(cause));
          });
        }
      } else {
        setFolderChildrenByParent({});
        setFolderDescendantsByParent({});
        setFolderChildNextCursorByParent({});
      }

      if (root) {
        const folderFilter = folderId !== null && folderId !== undefined ? folderId : undefined;
        setMedia([]);
        setMediaSlots([]);
        setMediaTotalCount(0);
        setLoadedMediaRanges([]);
        setMediaNextCursor(null);
        await loadMediaWindow({
          rootId: root.id,
          folderId: folderFilter,
          includeDescendants,
          offset: 0,
          limit: INITIAL_MEDIA_WINDOW_LIMIT,
          requestGeneration,
          selectFirst: true
        });
      } else {
        setMedia([]);
        setMediaSlots([]);
        setMediaTotalCount(0);
        setLoadedMediaRanges([]);
        setMediaNextCursor(null);
        selectMedia(null);
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [
    loadMediaWindow,
    loadFolderChildren,
    loadFolderDescendants,
    loadRoots,
    loadTasks
  ]);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    return () => {
      if (thumbnailPriorityScopeSyncTimerRef.current !== null) {
        window.clearTimeout(thumbnailPriorityScopeSyncTimerRef.current);
        thumbnailPriorityScopeSyncTimerRef.current = null;
      }
    };
  }, []);

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

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SHOW_SUBFOLDER_CONTENTS_STORAGE_KEY,
        showChildFolderContents ? "1" : "0"
      );
    } catch {
      // Ignore storage failures.
    }
  }, [showChildFolderContents]);

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
    const requestGeneration = metadataEditGenerationRef.current;
    const requestMediaId = selectedMediaId;
    void client
      .getUserMetadata(selectedMediaId)
      .then((record) => {
        if (
          !cancelled &&
          selectedMediaIdRef.current === requestMediaId &&
          metadataEditGenerationRef.current === requestGeneration
        ) {
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
    if (!selectedMedia) {
      scheduleThumbnailPriorityScopeSync("selected", []);
      return;
    }
    requestThumbnailStates([selectedMedia.id], "selected");
  }, [
    requestThumbnailStates,
    scheduleThumbnailPriorityScopeSync,
    selectedMedia,
    selectedMediaThumbnailRequestKey
  ]);

  useEffect(() => {
    if (!selectedMedia || !shouldRepollThumbnailState(selectedMedia, selectedThumbnail)) {
      return;
    }

    const timer = window.setInterval(() => {
      requestThumbnailStates([selectedMedia.id], "selected");
    }, SELECTED_THUMBNAIL_REPOLL_MS);
    return () => window.clearInterval(timer);
  }, [
    requestThumbnailStates,
    selectedMedia,
    selectedMediaThumbnailRequestKey,
    selectedThumbnail?.state,
    selectedThumbnail?.updatedAt
  ]);

  useEffect(() => {
    if (selectedFolderId === null) {
      pendingInteractiveScanRequestRef.current = null;
      return;
    }

    // Never recursively "interactive-scan" the root folder itself for very
    // large libraries. On million-file roots this duplicates the background
    // root scan and blocks folder browsing without adding useful disclosure.
    if (selectedRoot?.rootFolderId === selectedFolderId) {
      pendingInteractiveScanRequestRef.current = null;
      return;
    }

    const rootId = selectedRootIdRef.current;
    if (rootId === null) {
      pendingInteractiveScanRequestRef.current = null;
      return;
    }

    pendingInteractiveScanRequestRef.current = {
      rootId,
      folderId: selectedFolderId,
      knownTaskIds: new Set(
        tasksRef.current
          .filter(
            (task) =>
              task.kind === "interactive_folder_scan" &&
              task.rootId === rootId &&
              task.folderId === selectedFolderId
          )
          .map((task) => task.id)
      )
    };

    let cancelled = false;
    void client.enqueueInteractiveFolderScan(selectedFolderId).catch((cause) => {
      if (!cancelled) {
        pendingInteractiveScanRequestRef.current = null;
        setError(errorMessage(cause));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [client, selectedFolderId, selectedRoot?.rootFolderId]);

  const previousTaskStatusRef = useRef<Map<number, TaskRecord["status"]>>(new Map());
  useEffect(() => {
    const previous = previousTaskStatusRef.current;
    let shouldReloadLibrary = false;
    let interactiveRefreshScope: { rootId: number; folderId: number | null } | null = null;
    const pendingInteractiveScan = pendingInteractiveScanRequestRef.current;
    for (const task of tasks) {
      const prior = previous.get(task.id);
      const transitionedToSucceeded =
        Boolean(prior) && prior !== task.status && task.status === "succeeded";
      if (transitionedToSucceeded && task.kind === "root_scan" && task.rootId === selectedRootId) {
        shouldReloadLibrary = true;
        break;
      }
      if (
        pendingInteractiveScan &&
        task.kind === "interactive_folder_scan" &&
        task.rootId !== null &&
        task.status === "succeeded" &&
        task.rootId === pendingInteractiveScan.rootId &&
        task.folderId === pendingInteractiveScan.folderId
      ) {
        const firstObservedSucceeded =
          !prior && !pendingInteractiveScan.knownTaskIds.has(task.id);
        if (transitionedToSucceeded || firstObservedSucceeded) {
          interactiveRefreshScope = {
            rootId: task.rootId,
            folderId: task.folderId
          };
          pendingInteractiveScanRequestRef.current = null;
        }
      }
    }
    previousTaskStatusRef.current = new Map(tasks.map((task) => [task.id, task.status]));
    if (shouldReloadLibrary) {
      void loadLibrary();
      return;
    }
    if (interactiveRefreshScope) {
      void reloadCurrentMedia({
        rootId: interactiveRefreshScope.rootId,
        folderId: interactiveRefreshScope.folderId
      }).catch((cause) => {
        setError(errorMessage(cause));
      });
    }
  }, [loadLibrary, reloadCurrentMedia, selectedFolderId, selectedRootId, tasks]);

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

  useEffect(() => {
    if (!scanActiveRootTask || scanRefreshFailures >= 3) {
      return;
    }

    const timer = window.setInterval(() => {
      if (scanRefreshInFlightRef.current) {
        return;
      }
      scanRefreshInFlightRef.current = true;
      void refreshCurrentScanView()
        .then(() => {
          setScanRefreshFailures(0);
        })
        .catch((cause) => {
          setScanRefreshFailures((failures) => failures + 1);
          setError(errorMessage(cause));
        })
        .finally(() => {
          scanRefreshInFlightRef.current = false;
        });
    }, SCAN_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refreshCurrentScanView, scanActiveRootTask, scanRefreshFailures]);

  useEffect(() => {
    if (!scanActiveRootTask) {
      scanRefreshActiveRootIdRef.current = null;
      return;
    }

    if (scanRefreshActiveRootIdRef.current !== selectedRootId) {
      scanRefreshActiveRootIdRef.current = selectedRootId;
      setScanRefreshFailures(0);
    }
  }, [scanActiveRootTask, selectedRootId]);

  const refresh = useCallback(async () => {
    await loadLibrary();
  }, [loadLibrary]);

  const prepareNavigationMediaReload = useCallback(() => {
    mediaPageGeneration.current += 1;
    scanRefreshSelectionVersionRef.current += 1;
    setScanRefreshFailures(0);
    setLoading(true);
    setLoadingMoreMedia(false);
    setError(null);
    setMedia([]);
    setMediaNextCursor(null);
    selectMedia(null);
    thumbnailPriorityScopeRef.current = emptyThumbnailPriorityScope();
    thumbnailPriorityScopeSyncKeyRef.current = null;
    void flushThumbnailPriorityScopeSync().catch((cause) => {
      setError(errorMessage(cause));
    });
  }, [flushThumbnailPriorityScopeSync]);

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
          scanRefreshSelectionVersionRef.current += 1;
          setScanRefreshFailures(0);
          selectedRootIdRef.current = response.rootId;
          selectedFolderIdRef.current = null;
          selectRoot(response.rootId);
          selectFolder(null);
          setExpandedFolderIds(new Set());
          setFolderDescendantsByParent({});
          setFolderChildNextCursorByParent({});
        }
        await loadTasks();
        await loadLibrary(response.rootId ? { rootId: response.rootId, folderId: null } : undefined);
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setAddingRoot(false);
      }
    },
    [client, loadLibrary, loadTasks]
  );

  const loadMoreMedia = useCallback(async () => {
    const loadedEnd = loadedMediaRangesRef.current.reduce(
      (maxEnd, range) => Math.max(maxEnd, range.end),
      0
    );
    requestMediaWindow(loadedEnd, loadedEnd + INITIAL_MEDIA_WINDOW_LIMIT);
  }, [requestMediaWindow]);

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
        if (current && current.fileId !== fileId) return current;
        if (!current && selectedMediaIdRef.current !== fileId) return current;
        const base = current ?? emptyUserMetadataRecord(fileId);
        const next: UserMetadataRecord = { ...base };
        if ("rating" in patch) next.rating = patch.rating ?? null;
        if ("favorite" in patch && patch.favorite !== undefined) next.favorite = patch.favorite;
        if ("note" in patch) next.note = patch.note ?? null;
        next.updatedAt = Date.now();
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
      metadataEditGenerationRef.current += 1;
      reflectMetadataLocally(fileId, patch);
      setMetadataSaving(true);
      try {
        const record = await client.updateUserMetadata(fileId, patch);
        reflectMetadataLocally(fileId, confirmedMetadataPatch(patch, record));
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
    setSelectedMetadata((current) => {
      if (current && current.fileId !== fileId) return current;
      if (!current && selectedMediaIdRef.current !== fileId) return current;
      const base = current ?? emptyUserMetadataRecord(fileId);
      return { ...base, tagIds, updatedAt: Date.now() };
    });
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
      metadataEditGenerationRef.current += 1;
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
      metadataEditGenerationRef.current += 1;
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
      metadataEditGenerationRef.current += 1;
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
      const previousDescendants = folderDescendantsByParent;
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
      setFolderDescendantsByParent((current) => renameFolderInMap(current, folderId, newName));
      try {
        await client.renameFileOp({ folderId, newName });
        await Promise.all([loadRecentOps(), loadLibrary()]);
        return { ok: true };
      } catch (cause) {
        setFolderChildrenByParent(previousChildren);
        setFolderDescendantsByParent(previousDescendants);
        const result = fileOpFailure(cause);
        setError(result.message ?? "Rename failed");
        return result;
      }
    },
    [client, folderChildrenByParent, folderDescendantsByParent, loadLibrary, loadRecentOps]
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
      const previousDescendants = folderDescendantsByParent;

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
        setFolderDescendantsByParent((current) => removeFoldersFromMap(current, folderIds));
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
        setFolderDescendantsByParent(previousDescendants);
        const result = fileOpFailure(cause);
        setError(result.message ?? "Delete failed");
        return result;
      }
    },
    [
      client,
      folderChildrenByParent,
      folderDescendantsByParent,
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
    mediaSlots,
    mediaTotalCount,
    loadedMediaRanges,
    showChildFolderContents,
    selectedRootId,
    selectedFolderId,
    selectedMediaId,
    selectedMedia,
    selectedMetadata,
    folderChildrenByParent,
    folderDescendantsByParent,
    folderChildNextCursorByParent,
    expandedFolderIds,
    loadingFolderIds,
    loadingFolderDescendantIds,
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
      const rootFolderId = root?.rootFolderId ?? null;
      prepareNavigationMediaReload();
      selectedRootIdRef.current = rootId;
      selectedFolderIdRef.current = rootFolderId;
      selectRoot(rootId);
      selectFolder(rootFolderId);
      if (rootFolderId) {
        setExpandedFolderIds((current) => new Set(current).add(rootFolderId));
        void loadFolderChildren(rootFolderId);
        if (showChildFolderContentsRef.current) {
          void loadFolderDescendants(rootFolderId).catch((cause) => {
            setError(errorMessage(cause));
          });
        }
      }
      void reloadCurrentMedia({
        rootId,
        folderId: rootFolderId,
        includeDescendants: showChildFolderContentsRef.current,
        setLoadingState: true
      }).catch((cause) => {
        setError(errorMessage(cause));
      });
    },
    setSelectedFolder: (folder: FolderRecord) => {
      prepareNavigationMediaReload();
      selectedRootIdRef.current = folder.rootId;
      selectedFolderIdRef.current = folder.id;
      selectRoot(folder.rootId);
      selectFolder(folder.id);
      void loadFolderChildren(folder.id);
      if (showChildFolderContentsRef.current) {
        void loadFolderDescendants(folder.id).catch((cause) => {
          setError(errorMessage(cause));
        });
      }
      void reloadCurrentMedia({
        rootId: folder.rootId,
        folderId: folder.id,
        includeDescendants: showChildFolderContentsRef.current,
        setLoadingState: true
      }).catch((cause) => {
        setError(errorMessage(cause));
      });
    },
    toggleShowChildFolderContents: () => {
      const nextShowChildFolderContents = !showChildFolderContentsRef.current;
      showChildFolderContentsRef.current = nextShowChildFolderContents;
      setShowChildFolderContents(nextShowChildFolderContents);
      if (nextShowChildFolderContents && selectedFolderIdRef.current !== null) {
        void loadFolderDescendants(selectedFolderIdRef.current).catch((cause) => {
          setError(errorMessage(cause));
        });
      }
      prepareNavigationMediaReload();
      void reloadCurrentMedia({
        rootId: selectedRootIdRef.current ?? undefined,
        folderId: selectedFolderIdRef.current,
        includeDescendants: nextShowChildFolderContents,
        setLoadingState: true
      }).catch((cause) => {
        setError(errorMessage(cause));
      });
    },
    setSelectedMediaId: selectMedia,
    requestThumbnailStates,
    requestMediaWindow,
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

function appendUniqueMedia(current: MediaRecord[], incoming: MediaRecord[]): MediaRecord[] {
  if (incoming.length === 0) {
    return current;
  }

  const next = [...current];
  const indexById = new Map(current.map((item, index) => [item.id, index]));
  let changed = false;
  for (const item of incoming) {
    const existingIndex = indexById.get(item.id);
    if (existingIndex === undefined) {
      indexById.set(item.id, next.length);
      next.push(item);
      changed = true;
    } else if (next[existingIndex] !== item) {
      next[existingIndex] = item;
      changed = true;
    }
  }
  return changed ? next : current;
}

function mergeLoadedMediaRanges(
  current: Array<{ start: number; end: number }>,
  start: number,
  end: number
): Array<{ start: number; end: number }> {
  if (end <= start) return current;
  const ranges = [...current, { start, end }].sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (!previous || range.start > previous.end) {
      merged.push({ ...range });
    } else {
      previous.end = Math.max(previous.end, range.end);
    }
  }
  return merged;
}

function firstMissingMediaRange(
  ranges: Array<{ start: number; end: number }>,
  start: number,
  end: number
): { start: number; end: number } | null {
  if (end <= start) return null;
  const sortedRanges = [...ranges].sort((left, right) => left.start - right.start);
  let cursor = start;
  for (const range of sortedRanges) {
    if (range.end <= cursor) {
      continue;
    }
    if (range.start > cursor) {
      break;
    }
    cursor = Math.max(cursor, range.end);
    if (cursor >= end) {
      return null;
    }
  }
  return { start: cursor, end };
}

function applyMediaWindowToSlots(
  current: Array<MediaRecord | undefined>,
  totalCount: number,
  offset: number,
  items: MediaRecord[]
): Array<MediaRecord | undefined> {
  const next = current.length === totalCount
    ? current.slice()
    : new Array<MediaRecord | undefined>(totalCount);
  if (current.length > 0 && current.length !== totalCount) {
    const copyLength = Math.min(current.length, totalCount);
    for (let index = 0; index < copyLength; index += 1) {
      next[index] = current[index];
    }
  }
  items.forEach((item, index) => {
    const targetIndex = offset + index;
    if (targetIndex >= 0 && targetIndex < totalCount) {
      next[targetIndex] = item;
    }
  });
  return next;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

function mediaPageRequestKey(
  rootId: number,
  folderId: number | undefined,
  cursor: string,
  includeDescendants = false
): string {
  return [rootId, folderId ?? "root", includeDescendants ? "recursive" : "direct", cursor].join(":");
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

function emptyUserMetadataRecord(fileId: number): UserMetadataRecord {
  return {
    favorite: false,
    fileId,
    note: null,
    rating: null,
    tagIds: [],
    updatedAt: Date.now()
  };
}

function confirmedMetadataPatch(
  requestedPatch: UserMetadataUpdate,
  record: UserMetadataRecord
): UserMetadataUpdate {
  const confirmed: UserMetadataUpdate = {};
  if ("rating" in requestedPatch) confirmed.rating = record.rating;
  if ("favorite" in requestedPatch) confirmed.favorite = record.favorite;
  if ("note" in requestedPatch) confirmed.note = record.note;
  return confirmed;
}

function emptyThumbnailPriorityScope(): ThumbnailPriorityScope {
  return {
    selected: [],
    visible: [],
    ahead: []
  };
}

function normalizeThumbnailScopeMediaIds(
  mediaIds: number[],
  priority: ThumbnailRequestPriority,
  selectedMediaId: number | null
): number[] {
  return [...new Set(mediaIds)]
    .filter((mediaId) => Number.isFinite(mediaId))
    .filter((mediaId) => priority === "selected" || mediaId !== selectedMediaId);
}

function nextThumbnailPriorityScope(
  current: ThumbnailPriorityScope,
  priority: ThumbnailRequestPriority,
  mediaIds: number[],
  selectedMediaId: number | null
): ThumbnailPriorityScope {
  if (priority === "background") {
    return current;
  }
  return {
    ...current,
    [priority]: normalizeThumbnailScopeMediaIds(mediaIds, priority, selectedMediaId)
  };
}

function thumbnailPriorityScopeRequestKey(input: {
  rootId: number;
  selectedFileIds: number[];
  visibleFileIds: number[];
  aheadFileIds: number[];
}): string {
  return JSON.stringify(input);
}

function mergeThumbnailStates(
  current: Record<number, ThumbnailResponse>,
  nextStates: Record<number, ThumbnailResponse>
): Record<number, ThumbnailResponse> {
  let changed = false;
  const next = { ...current };
  for (const [mediaId, thumbnail] of Object.entries(nextStates)) {
    const key = Number(mediaId);
    const mergedThumbnail = pickPreferredThumbnailResponse(current[key], thumbnail);
    if (current[key] !== mergedThumbnail) {
      next[key] = mergedThumbnail;
      changed = true;
    }
  }
  return changed ? next : current;
}

function recordThumbnailStateSignatures(
  states: Record<number, ThumbnailResponse>,
  mediaById: Map<number, MediaRecord>,
  signaturesByMediaId: Record<number, string>
): void {
  for (const mediaId of Object.keys(states)) {
    const mediaRecord = mediaById.get(Number(mediaId));
    if (mediaRecord) {
      signaturesByMediaId[Number(mediaId)] = mediaContentSignature(mediaRecord);
    }
  }
}

function filterFreshThumbnailStates(
  current: Record<number, ThumbnailResponse>,
  mediaById: Map<number, MediaRecord>,
  signaturesByMediaId: Record<number, string>
): Record<number, ThumbnailResponse> {
  let changed = false;
  const next: Record<number, ThumbnailResponse> = {};
  for (const [mediaId, thumbnail] of Object.entries(current)) {
    const key = Number(mediaId);
    const mediaRecord = mediaById.get(key);
    if (
      mediaRecord &&
      signaturesByMediaId[key] === mediaContentSignature(mediaRecord) &&
      isFreshThumbnailForMediaRecord(mediaRecord, thumbnail)
    ) {
      next[key] = thumbnail;
    } else {
      changed = true;
      delete signaturesByMediaId[key];
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

function renameFolderInMap(
  current: Record<number, FolderRecord[]>,
  folderId: number,
  newName: string
): Record<number, FolderRecord[]> {
  let changed = false;
  const next: Record<number, FolderRecord[]> = {};
  for (const [parentId, children] of Object.entries(current)) {
    const updated = children.map((child) =>
      child.id === folderId ? { ...child, name: newName } : child
    );
    if (updated.some((child, index) => child !== children[index])) {
      changed = true;
    }
    next[Number(parentId)] = updated;
  }
  return changed ? next : current;
}

function removeFoldersFromMap(
  current: Record<number, FolderRecord[]>,
  folderIds: number[]
): Record<number, FolderRecord[]> {
  const folderIdSet = new Set(folderIds);
  let changed = false;
  const next: Record<number, FolderRecord[]> = {};
  for (const [parentId, children] of Object.entries(current)) {
    const updated = children.filter((child) => !folderIdSet.has(child.id));
    if (updated.length !== children.length) {
      changed = true;
    }
    next[Number(parentId)] = updated;
  }
  return changed ? next : current;
}

function latestFailedThumbnailTaskForFile(tasks: TaskRecord[], fileId: number): TaskRecord | null {
  return (
    tasks
      .filter(
        (task) => task.kind === "thumbnail" && task.fileId === fileId && task.status === "failed"
      )
      .sort((left, right) => right.id - left.id)[0] ?? null
  );
}

function optimisticQueuedThumbnail(fileId: number): ThumbnailResponse {
  return {
    fileId,
    target: "grid_320",
    state: "queued",
    shortSidePx: 320,
    outputFormat: "image/webp",
    width: null,
    height: null,
    byteSize: null,
    servedBy: null,
    asset: null,
    error: null,
    updatedAt: null
  };
}

function explicitMediaThumbnailState(
  value: string | null | undefined
): ThumbnailResponse["state"] | null {
  if (
    value === "pending" ||
    value === "queued" ||
    value === "ready" ||
    value === "failed" ||
    value === "skipped_small"
  ) {
    return value;
  }
  return null;
}

function shouldRepollThumbnailState(
  mediaRecord: MediaRecord,
  thumbnail: ThumbnailResponse | undefined
): boolean {
  if (!shouldRequestThumbnailState(mediaRecord)) {
    return false;
  }
  return thumbnail?.state === undefined || thumbnail.state === "pending" || thumbnail.state === "queued";
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

function isTaskActive(task: TaskRecord): boolean {
  return task.status === "pending" || task.status === "running";
}

function buildSearchParams(
  state: SearchState,
  debouncedQ: string,
  scope: {
    rootId: number;
    folderId: number | undefined;
    includeDescendants: boolean;
    cursor?: string;
    offset?: number;
    limit: number;
  }
): SearchParams {
  const params: SearchParams = {
    rootId: scope.rootId,
    limit: scope.limit,
    sort: state.sort
  };
  if (scope.cursor) params.cursor = scope.cursor;
  if (typeof scope.offset === "number") params.offset = scope.offset;
  if (scope.folderId !== undefined) {
    params.folderId = scope.folderId;
    params.includeDescendants = scope.includeDescendants;
  }
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

function readStoredShowChildFolderContents(): boolean {
  try {
    return window.localStorage.getItem(SHOW_SUBFOLDER_CONTENTS_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}
