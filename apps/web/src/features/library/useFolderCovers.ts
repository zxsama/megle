import { useEffect, useMemo, useRef, useState } from "react";
import type { FolderRecord, MediaRecord } from "@megle/core-client";
import { createCoreClient } from "../../core/client";

const FOLDER_COVER_FETCH_LIMIT = 96;
const FOLDER_COVER_CONCURRENT_FETCH_LIMIT = 8;
const FOLDER_COVER_MEDIA_LIMIT = 1;

export function useFolderCovers(
  folders: FolderRecord[],
  options: { disabled?: boolean } = {}
): Map<number, MediaRecord[]> {
  const client = useMemo(() => createCoreClient(), []);
  const disabled = options.disabled ?? false;
  const [coversByFolderId, setCoversByFolderId] = useState<Map<number, MediaRecord[]>>(() => new Map());
  const inFlightFolderIds = useRef<Set<number>>(new Set());
  const inFlightControllersByFolderId = useRef<Map<number, AbortController>>(new Map());
  const mountedRef = useRef(true);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortAllControllers(inFlightControllersByFolderId.current);
      inFlightFolderIds.current.clear();
    };
  }, []);

  useEffect(() => {
    if (disabled) {
      abortAllControllers(inFlightControllersByFolderId.current);
      inFlightFolderIds.current.clear();
      return;
    }

    const targetFolders = folders.slice(0, FOLDER_COVER_FETCH_LIMIT);
    const targetFolderIds = new Set(targetFolders.map((folder) => folder.id));
    for (const [folderId, controller] of inFlightControllersByFolderId.current) {
      if (!targetFolderIds.has(folderId)) {
        controller.abort();
        inFlightControllersByFolderId.current.delete(folderId);
        inFlightFolderIds.current.delete(folderId);
      }
    }

    const availableSlots = Math.max(
      0,
      FOLDER_COVER_CONCURRENT_FETCH_LIMIT - inFlightFolderIds.current.size
    );
    if (availableSlots === 0) {
      return;
    }

    const missingFolders = targetFolders
      .filter((folder) => !coversByFolderId.has(folder.id) && !inFlightFolderIds.current.has(folder.id))
      .slice(0, availableSlots);
    if (missingFolders.length === 0) {
      return;
    }

    for (const folder of missingFolders) {
      const controller = new AbortController();
      inFlightFolderIds.current.add(folder.id);
      inFlightControllersByFolderId.current.set(folder.id, controller);
      void (async () => {
        try {
          const page = await client.listMedia({
            folderId: folder.id,
            includeDescendants: true,
            limit: FOLDER_COVER_MEDIA_LIMIT,
            rootId: folder.rootId,
            sort: "name_asc"
          }, {
            requestPriority: "resource",
            signal: controller.signal
          });
          return page.items;
        } catch (cause) {
          if (isAbortError(cause)) {
            return null;
          }
          return [] as MediaRecord[];
        }
      })()
        .then((media) => {
          if (
            !mountedRef.current ||
            media === null ||
            inFlightControllersByFolderId.current.get(folder.id) !== controller
          ) {
            return;
          }
          setCoversByFolderId((current) => {
            if (current.has(folder.id)) {
              return current;
            }
            const next = new Map(current);
            next.set(folder.id, media);
            return next;
          });
        })
        .finally(() => {
          if (inFlightControllersByFolderId.current.get(folder.id) === controller) {
            inFlightControllersByFolderId.current.delete(folder.id);
            inFlightFolderIds.current.delete(folder.id);
            setRequestVersion((value) => value + 1);
          }
        });
    }
  }, [client, coversByFolderId, disabled, folders, requestVersion]);

  return coversByFolderId;
}

function abortAllControllers<K>(controllers: Map<K, AbortController>): void {
  for (const controller of controllers.values()) {
    controller.abort();
  }
  controllers.clear();
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === "AbortError";
}
