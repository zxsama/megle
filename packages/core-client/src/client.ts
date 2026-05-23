import type {
  AcceptedRootResponse,
  AddFileTagRequest,
  CreateTagRequest,
  DeletePluginResponse,
  DeleteRequest,
  DeleteTagResponse,
  FileOperationListResponse,
  FileOperationRecord,
  FileOperationsResponse,
  FileTagsResponse,
  FolderRecord,
  ListFileOperationsParams,
  ListFolderChildrenParams,
  ListMediaParams,
  MediaRecord,
  MoveRequest,
  Page,
  PluginDiscoveryResponse,
  PluginListResponse,
  PluginRecord,
  RenameRequest,
  RootRecord,
  ScanTaskRequest,
  SearchParams,
  SetFileTagsRequest,
  TagListResponse,
  TagRecord,
  TaskRecord,
  ThumbnailResponse,
  UserMetadataRecord,
  UserMetadataUpdate
} from "./generated-contract";

export interface CoreClientConfig {
  baseUrl: string;
  sessionToken?: string;
}

export class CoreApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`Core API request failed with status ${status}`);
    this.name = "CoreApiError";
    this.status = status;
    this.body = body;
  }
}

type QueryParams = Partial<ListMediaParams & ListFolderChildrenParams> & {
  target?: "grid_320";
};

export function createCoreClient(config: CoreClientConfig) {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    if (config.sessionToken) {
      headers.set("x-megle-session", config.sessionToken);
    }

    const response = await fetch(resolveUrl(config.baseUrl, path), {
      ...init,
      headers
    });
    if (!response.ok) {
      const body = await readResponseBody(response);
      throw new CoreApiError(response.status, body);
    }
    const body = await readJson(response);
    return body as T;
  }

  async function fetchBlob(path: string): Promise<Blob> {
    const headers = new Headers();
    if (config.sessionToken) {
      headers.set("x-megle-session", config.sessionToken);
    }
    const response = await fetch(resolveUrl(config.baseUrl, path), { headers });
    if (!response.ok) {
      const body = await readResponseBody(response);
      throw new CoreApiError(response.status, body);
    }
    return response.blob();
  }

  return {
    listRoots: () => request<Page<RootRecord>>("/roots"),
    listTasks: () => request<Page<TaskRecord>>("/tasks"),
    addRoot: (path: string, displayName?: string) =>
      request<AcceptedRootResponse>("/roots", {
        method: "POST",
        body: JSON.stringify({ path, displayName })
      }),
    removeRoot: (rootId: number) =>
      request<AcceptedRootResponse>(`/roots/${rootId}`, {
        method: "DELETE"
      }),
    enqueueScan: (rootId: number) =>
      request<AcceptedRootResponse>("/tasks/scan", {
        method: "POST",
        body: JSON.stringify({ rootId } satisfies ScanTaskRequest)
      }),
    cancelTask: (taskId: number) =>
      request<AcceptedRootResponse>(`/tasks/${taskId}/cancel`, {
        method: "POST"
      }),
    retryTask: (taskId: number) =>
      request<AcceptedRootResponse>(`/tasks/${taskId}/retry`, {
        method: "POST"
      }),
    listFolderChildren: (folderId: number, params: ListFolderChildrenParams = {}) =>
      request<Page<FolderRecord>>(`/folders/${folderId}/children${query(params)}`),
    listMedia: (params: ListMediaParams = {}) => request<Page<MediaRecord>>(`/media${query(params)}`),
    getMedia: (fileId: number) => request<MediaRecord>(`/media/${fileId}`),
    getThumbnail: (fileId: number, target: "grid_320" = "grid_320") =>
      request<ThumbnailResponse>(`/media/${fileId}/thumbnail${query({ target })}`),
    getThumbnailBlob: async (fileId: number, target: "grid_320" = "grid_320") => {
      return fetchBlob(`/media/${fileId}/thumbnail/blob${query({ target })}`);
    },
    getPreviewBlob: (fileId: number) => fetchBlob(`/media/${fileId}/preview`),
    listTags: () => request<TagListResponse>("/tags"),
    createTag: (body: CreateTagRequest) =>
      request<TagRecord>("/tags", {
        method: "POST",
        body: JSON.stringify(body)
      }),
    deleteTag: (tagId: number) =>
      request<DeleteTagResponse>(`/tags/${tagId}`, {
        method: "DELETE"
      }),
    getUserMetadata: (fileId: number) =>
      request<UserMetadataRecord>(`/media/${fileId}/metadata`),
    updateUserMetadata: (fileId: number, body: UserMetadataUpdate) =>
      request<UserMetadataRecord>(`/media/${fileId}/metadata`, {
        method: "PUT",
        body: JSON.stringify(body)
      }),
    setFileTags: (fileId: number, body: SetFileTagsRequest) =>
      request<FileTagsResponse>(`/media/${fileId}/tags`, {
        method: "PUT",
        body: JSON.stringify(body)
      }),
    addFileTag: (fileId: number, body: AddFileTagRequest) =>
      request<FileTagsResponse>(`/media/${fileId}/tags`, {
        method: "POST",
        body: JSON.stringify(body)
      }),
    removeFileTag: (fileId: number, tagId: number) =>
      request<FileTagsResponse>(`/media/${fileId}/tags/${tagId}`, {
        method: "DELETE"
      }),
    searchMedia: (params: SearchParams = {}) =>
      request<Page<MediaRecord>>(`/search${searchQuery(params)}`),
    renameFileOp: (body: RenameRequest) =>
      request<FileOperationRecord>("/file-ops/rename", {
        method: "POST",
        body: JSON.stringify(body)
      }),
    moveFileOps: (body: MoveRequest) =>
      request<FileOperationsResponse>("/file-ops/move", {
        method: "POST",
        body: JSON.stringify(body)
      }),
    deleteFileOps: (body: DeleteRequest) =>
      request<FileOperationsResponse>("/file-ops/delete", {
        method: "POST",
        body: JSON.stringify(body)
      }),
    listFileOperations: (params: ListFileOperationsParams = {}) =>
      request<FileOperationListResponse>(`/file-ops${fileOpsQuery(params)}`),
    listPlugins: () => request<PluginListResponse>("/plugins"),
    getPlugin: (pluginId: string) =>
      request<PluginRecord>(`/plugins/${encodeURIComponent(pluginId)}`),
    discoverPlugins: () =>
      request<PluginDiscoveryResponse>("/plugins/discover", {
        method: "POST"
      }),
    enablePlugin: (pluginId: string) =>
      request<PluginRecord>(`/plugins/${encodeURIComponent(pluginId)}/enable`, {
        method: "POST"
      }),
    disablePlugin: (pluginId: string) =>
      request<PluginRecord>(`/plugins/${encodeURIComponent(pluginId)}/disable`, {
        method: "POST"
      }),
    deletePlugin: (pluginId: string) =>
      request<DeletePluginResponse>(`/plugins/${encodeURIComponent(pluginId)}`, {
        method: "DELETE"
      })
  };
}

function resolveUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedPath = path.replace(/^\//, "");
  return new URL(normalizedPath, normalizedBase).toString();
}

function query(params: QueryParams): string {
  const search = new URLSearchParams();
  if ("rootId" in params && params.rootId) search.set("rootId", String(params.rootId));
  if ("folderId" in params && params.folderId) search.set("folderId", String(params.folderId));
  if (params.limit) search.set("limit", String(params.limit));
  if (params.cursor) search.set("cursor", params.cursor);
  if ("sort" in params && params.sort) search.set("sort", params.sort);
  if ("kind" in params && params.kind) search.set("kind", params.kind);
  if ("target" in params && params.target) search.set("target", params.target);
  const value = search.toString();
  return value ? `?${value}` : "";
}

function searchQuery(params: SearchParams): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.rootId) search.set("rootId", String(params.rootId));
  if (params.folderId) search.set("folderId", String(params.folderId));
  if (params.kind) search.set("kind", params.kind);
  if (typeof params.minRating === "number") search.set("minRating", String(params.minRating));
  if (typeof params.favorite === "boolean") search.set("favorite", params.favorite ? "true" : "false");
  if (params.tagIds) {
    for (const tagId of params.tagIds) {
      search.append("tagId", String(tagId));
    }
  }
  if (params.sort) search.set("sort", params.sort);
  if (params.limit) search.set("limit", String(params.limit));
  if (params.cursor) search.set("cursor", params.cursor);
  const value = search.toString();
  return value ? `?${value}` : "";
}

function fileOpsQuery(params: ListFileOperationsParams): string {
  const search = new URLSearchParams();
  if (params.limit) search.set("limit", String(params.limit));
  if (params.cursor) search.set("cursor", params.cursor);
  const value = search.toString();
  return value ? `?${value}` : "";
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  return JSON.parse(text);
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
