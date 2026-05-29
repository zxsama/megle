import { useEffect, useMemo, useRef, useState } from "react";
import type { FolderRecord, MediaRecord } from "@megle/core-client";
import { createCoreClient } from "../../core/client";

const FOLDER_COVER_FETCH_LIMIT = 96;
const FOLDER_COVER_MEDIA_LIMIT = 1;

export function useFolderCovers(folders: FolderRecord[]): Map<number, MediaRecord[]> {
  const client = useMemo(() => createCoreClient(), []);
  const [coversByFolderId, setCoversByFolderId] = useState<Map<number, MediaRecord[]>>(() => new Map());
  const inFlightFolderIds = useRef<Set<number>>(new Set());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const targetFolders = folders.slice(0, FOLDER_COVER_FETCH_LIMIT);
    const missingFolders = targetFolders.filter(
      (folder) => !coversByFolderId.has(folder.id) && !inFlightFolderIds.current.has(folder.id)
    );
    if (missingFolders.length === 0) {
      return;
    }

    for (const folder of missingFolders) {
      inFlightFolderIds.current.add(folder.id);
      void (async () => {
        try {
          const page = await client.listMedia({
            folderId: folder.id,
            includeDescendants: true,
            limit: FOLDER_COVER_MEDIA_LIMIT,
            rootId: folder.rootId,
            sort: "mtime_desc"
          });
          return page.items;
        } catch {
          return [] as MediaRecord[];
        }
      })()
        .then((media) => {
          if (!mountedRef.current) {
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
          inFlightFolderIds.current.delete(folder.id);
        });
    }
  }, [client, coversByFolderId, folders]);

  return coversByFolderId;
}
