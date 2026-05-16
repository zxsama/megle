import type {
  AcceptedRootResponse,
  FolderRecord,
  ListFolderChildrenParams,
  ListMediaParams,
  MediaRecord,
  Page,
  RootRecord,
  ScanTaskRequest,
  TaskRecord
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
    listFolderChildren: (folderId: number, params: ListFolderChildrenParams = {}) =>
      request<Page<FolderRecord>>(`/folders/${folderId}/children${query(params)}`),
    listMedia: (params: ListMediaParams = {}) => request<Page<MediaRecord>>(`/media${query(params)}`),
    getMedia: (fileId: number) => request<MediaRecord>(`/media/${fileId}`)
  };
}

function resolveUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedPath = path.replace(/^\//, "");
  return new URL(normalizedPath, normalizedBase).toString();
}

function query(params: ListMediaParams | ListFolderChildrenParams): string {
  const search = new URLSearchParams();
  if ("rootId" in params && params.rootId) search.set("rootId", String(params.rootId));
  if ("folderId" in params && params.folderId) search.set("folderId", String(params.folderId));
  if (params.limit) search.set("limit", String(params.limit));
  if (params.cursor) search.set("cursor", params.cursor);
  if ("sort" in params && params.sort) search.set("sort", params.sort);
  if ("kind" in params && params.kind) search.set("kind", params.kind);
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
