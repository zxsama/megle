// Generated-client boundary placeholder.
// Keep this file mechanically aligned with contracts/core-api/openapi.yaml until generator output replaces it.

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ScanSummary {
  foldersSeen: number;
  mediaFilesSeen: number;
  skippedFiles: number;
}

export interface AcceptedRootResponse {
  accepted: boolean;
  taskId: number | null;
  rootId: number | null;
  scan: ScanSummary | null;
}

export interface ScanTaskRequest {
  rootId: number;
}

export interface RootRecord {
  id: number;
  path: string;
  displayName: string;
  enabled: boolean;
  createdAt: number;
  lastScanAt: number | null;
  rootFolderId: number | null;
}

export interface TaskRecord {
  id: number;
  kind: string;
  priority: number;
  status: "pending" | "running" | "succeeded" | "failed";
  rootId: number | null;
  fileId: number | null;
  createdAt: number;
  updatedAt: number;
  itemsSeen: number;
  itemsTotal: number | null;
  foldersSeen: number;
  mediaFilesSeen: number;
  skippedFiles: number;
  error: string | null;
}

export interface FolderRecord {
  id: number;
  rootId: number;
  parentId: number | null;
  name: string;
  status: string;
}

export interface MediaRecord {
  id: number;
  rootId: number;
  folderId: number;
  name: string;
  ext: string;
  size: number;
  mtime: number;
  kind?: string | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  codec?: string | null;
  thumbnailState?: string | null;
  thumbnailCacheKey?: string | null;
}

export interface ListFolderChildrenParams {
  limit?: number;
  cursor?: string;
}

export interface ListMediaParams {
  rootId?: number;
  folderId?: number;
  limit?: number;
  cursor?: string;
  sort?: "mtime_desc" | "mtime_asc" | "name_asc" | "name_desc";
  kind?: "image" | "video" | "other";
}
