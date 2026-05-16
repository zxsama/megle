import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  FolderRecord,
  MediaRecord,
  RootRecord,
  ScanSummary,
  TaskRecord
} from "@megle/core-client";
import { createCoreClient } from "./client";

export interface LibraryState {
  roots: RootRecord[];
  folders: FolderRecord[];
  media: MediaRecord[];
  selectedRootId: number | null;
  selectedFolderId: number | null;
  selectedMediaId: number | null;
  selectedMedia: MediaRecord | null;
  loading: boolean;
  addingRoot: boolean;
  scanActive: boolean;
  tasks: TaskRecord[];
  error: string | null;
  lastScan: ScanSummary | null;
  setSelectedRootId: (rootId: number) => void;
  setSelectedFolderId: (folderId: number | null) => void;
  setSelectedMediaId: (mediaId: number) => void;
  refresh: () => Promise<void>;
  addRoot: (path: string) => Promise<void>;
}

export function useLibraryData(): LibraryState {
  const client = useMemo(() => createCoreClient(), []);
  const [roots, setRoots] = useState<RootRecord[]>([]);
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [media, setMedia] = useState<MediaRecord[]>([]);
  const [selectedRootId, selectRoot] = useState<number | null>(null);
  const [selectedFolderId, selectFolder] = useState<number | null>(null);
  const [selectedMediaId, selectMedia] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [addingRoot, setAddingRoot] = useState(false);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [taskPollFailures, setTaskPollFailures] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<ScanSummary | null>(null);

  const selectedRoot = roots.find((root) => root.id === selectedRootId) ?? null;
  const selectedMedia = media.find((item) => item.id === selectedMediaId) ?? null;
  const scanActive = tasks.some((task) => task.status === "pending" || task.status === "running");

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
    setLoading(true);
    setError(null);
    try {
      const result = await loadRoots();
      await loadTasks();
      const root = roots.find((item) => item.id === selectedRootId) ?? result.selectedRoot;
      const folderId = selectedFolderId ?? root?.rootFolderId ?? null;

      if (folderId) {
        const folderResponse = await client.listFolderChildren(folderId);
        setFolders(folderResponse.items);
      } else {
        setFolders([]);
      }

      if (root) {
        const mediaResponse = await client.listMedia({
          rootId: root.id,
          folderId: selectedFolderId ?? undefined,
          limit: 200,
          sort: "mtime_desc"
        });
        setMedia(mediaResponse.items);
        selectMedia((current) =>
          current && mediaResponse.items.some((item) => item.id === current)
            ? current
            : mediaResponse.items[0]?.id ?? null
        );
      } else {
        setMedia([]);
        selectMedia(null);
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [client, loadRoots, loadTasks, roots, selectedFolderId, selectedRootId]);

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
          selectRoot(response.rootId);
          selectFolder(null);
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

  return {
    roots,
    folders,
    media,
    selectedRootId,
    selectedFolderId,
    selectedMediaId,
    selectedMedia,
    loading,
    addingRoot,
    scanActive,
    tasks,
    error,
    lastScan,
    setSelectedRootId: (rootId: number) => {
      const root = roots.find((item) => item.id === rootId);
      selectRoot(rootId);
      selectFolder(root?.rootFolderId ?? null);
    },
    setSelectedFolderId: (folderId: number | null) => {
      selectFolder(folderId);
    },
    setSelectedMediaId: selectMedia,
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
