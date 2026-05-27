import { useEffect, useMemo, useState } from "react";
import type { FolderRecord, MediaRecord } from "@megle/core-client";
import { createCoreClient } from "../../core/client";

const FOLDER_COVER_FETCH_LIMIT = 48;
const FOLDER_COVER_MEDIA_LIMIT = 3;

export function useFolderCovers(folders: FolderRecord[]): Map<number, MediaRecord[]> {
  const client = useMemo(() => createCoreClient(), []);
  const [coversByFolderId, setCoversByFolderId] = useState<Map<number, MediaRecord[]>>(() => new Map());

  useEffect(() => {
    const targetFolders = folders.slice(0, FOLDER_COVER_FETCH_LIMIT);
    const missingFolders = targetFolders.filter((folder) => !coversByFolderId.has(folder.id));
    if (missingFolders.length === 0) {
      return;
    }

    let cancelled = false;
    void Promise.all(
      missingFolders.map(async (folder) => {
        try {
          const page = await client.listMedia({
            folderId: folder.id,
            includeDescendants: true,
            limit: FOLDER_COVER_MEDIA_LIMIT,
            rootId: folder.rootId,
            sort: "mtime_desc"
          });
          return [folder.id, page.items] as const;
        } catch {
          return [folder.id, [] as MediaRecord[]] as const;
        }
      })
    ).then((entries) => {
      if (cancelled) {
        return;
      }
      setCoversByFolderId((current) => {
        const next = new Map(current);
        for (const [folderId, media] of entries) {
          if (!next.has(folderId)) {
            next.set(folderId, media);
          }
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [client, coversByFolderId, folders]);

  return coversByFolderId;
}
