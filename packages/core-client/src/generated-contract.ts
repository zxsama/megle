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

export type TaskKind = "root_scan" | "thumbnail";
export type TaskStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

export interface TaskRecord {
  id: number;
  kind: TaskKind;
  priority: number;
  status: TaskStatus;
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

export interface ThumbnailAsset {
  cacheKey: string;
  width: number;
  height: number;
  byteSize: number;
}

export interface ThumbnailResponse {
  fileId: number;
  profile: "grid_320";
  state: "pending" | "queued" | "ready" | "failed" | "skipped_small";
  shortSidePx: number;
  outputFormat: "image/webp";
  asset: ThumbnailAsset | null;
  error: string | null;
  updatedAt: number | null;
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
