import { strict as assert } from "node:assert";
import { afterEach, beforeEach, describe, test } from "node:test";

import { createCoreClient } from "../src/client.ts";

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  signal?: AbortSignal | null;
}

const BASE_URL = "http://127.0.0.1:47321/api";

let originalFetch: typeof fetch;
let recorded: RecordedRequest[] = [];

function mockFetch(responseBody: unknown, status = 200) {
  globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    const headers: Record<string, string> = {};
    const reqHeaders = new Headers(init?.headers);
    reqHeaders.forEach((value, key) => {
      headers[key] = value;
    });
    let body: string | null = null;
    if (init?.body) {
      body = init.body instanceof ArrayBuffer ? "" : String(init.body);
    }
    recorded.push({ url, method, headers, body, signal: init?.signal ?? null });
    return new Response(JSON.stringify(responseBody), {
      status,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;
}

function client() {
  return createCoreClient({ baseUrl: BASE_URL, sessionToken: "secret" });
}

beforeEach(() => {
  recorded = [];
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("createCoreClient", () => {
  test("session token is sent on every request", async () => {
    mockFetch({ items: [] });
    await client().listRoots();
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].headers["x-megle-session"], "secret");
  });

  test("listMedia serializes filters, offset window, and sort", async () => {
    mockFetch({ items: [], nextCursor: null, totalCount: 1234 });
    const page = await client().listMedia({
      rootId: 7,
      sort: "mtime_desc",
      kind: "image",
      limit: 50,
      offset: 100
    });
    const url = new URL(recorded[0].url);
    assert.equal(url.searchParams.get("rootId"), "7");
    assert.equal(url.searchParams.get("sort"), "mtime_desc");
    assert.equal(url.searchParams.get("kind"), "image");
    assert.equal(url.searchParams.get("limit"), "50");
    assert.equal(url.searchParams.get("offset"), "100");
    assert.equal(page.totalCount, 1234);
  });

  test("listFolderChildren serializes recursive descendant mode", async () => {
    mockFetch({ items: [], nextCursor: null });
    await client().listFolderChildren(42, { includeDescendants: true, limit: 25 });
    const url = new URL(recorded[0].url);
    assert.equal(url.pathname, "/api/folders/42/children");
    assert.equal(url.searchParams.get("includeDescendants"), "true");
    assert.equal(url.searchParams.get("limit"), "25");
  });

  test("searchMedia repeats tagId for AND filtering and offset windows", async () => {
    mockFetch({ items: [], nextCursor: null });
    await client().searchMedia({
      rootId: 1,
      tagIds: [10, 20, 30],
      sort: "rating_desc",
      offset: 250
    });
    const url = new URL(recorded[0].url);
    const tagIds = url.searchParams.getAll("tagId");
    assert.deepEqual(tagIds, ["10", "20", "30"]);
    assert.equal(url.searchParams.get("sort"), "rating_desc");
    assert.equal(url.searchParams.get("offset"), "250");
  });

  test("createTag posts JSON body", async () => {
    mockFetch({ id: 1, name: "Sample", color: null }, 201);
    const tag = await client().createTag({ name: "Sample", color: null });
    assert.equal(recorded[0].method, "POST");
    assert.equal(recorded[0].headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(recorded[0].body!), { name: "Sample", color: null });
    assert.equal(tag.id, 1);
  });

  test("updateUserMetadata uses PUT and includes the patch", async () => {
    mockFetch({ fileId: 12, rating: 4, favorite: true, note: null, tagIds: [], updatedAt: 0 });
    await client().updateUserMetadata(12, { rating: 4, favorite: true });
    assert.equal(recorded[0].method, "PUT");
    assert.equal(recorded[0].url, `${BASE_URL}/media/12/metadata`);
    assert.deepEqual(JSON.parse(recorded[0].body!), { rating: 4, favorite: true });
  });

  test("file ops rename posts to /file-ops/rename", async () => {
    mockFetch({
      id: 1,
      operation: "rename",
      sourcePath: "/old",
      targetPath: "/new",
      status: "succeeded",
      createdAt: 0,
      finishedAt: 0,
      error: null
    });
    await client().renameFileOp({ fileId: 5, newName: "new.jpg" });
    assert.equal(recorded[0].method, "POST");
    assert.equal(recorded[0].url, `${BASE_URL}/file-ops/rename`);
    assert.deepEqual(JSON.parse(recorded[0].body!), { fileId: 5, newName: "new.jpg" });
  });

  test("listFileOperations attaches limit and cursor", async () => {
    mockFetch({ items: [], nextCursor: null });
    await client().listFileOperations({ limit: 25, cursor: "42" });
    const url = new URL(recorded[0].url);
    assert.equal(url.searchParams.get("limit"), "25");
    assert.equal(url.searchParams.get("cursor"), "42");
  });

  test("plugin endpoints encode the id", async () => {
    mockFetch({ deleted: true });
    await client().deletePlugin("org.example/risky");
    assert.equal(recorded[0].method, "DELETE");
    // encoded slash so we don't accidentally hit /plugins/org.example/risky as two path segments
    assert.match(recorded[0].url, /\/plugins\/org\.example%2Frisky$/);
  });

  test("getPreviewBlob requests original media bytes", async () => {
    mockFetch("original bytes");
    const blob = await client().getPreviewBlob(42);
    assert.equal(recorded[0].method, "GET");
    assert.equal(recorded[0].url, `${BASE_URL}/media/42/preview`);
    assert.equal(recorded[0].headers["x-megle-session"], "secret");
    assert.equal(await blob.text(), JSON.stringify("original bytes"));
  });

  test("getPreviewBlob forwards abort signal", async () => {
    mockFetch("original bytes");
    const controller = new AbortController();
    await client().getPreviewBlob(42, { signal: controller.signal });
    assert.equal(recorded[0].signal, controller.signal);
  });

  test("getPreviewBlob attaches version cache buster", async () => {
    mockFetch("original bytes");
    await client().getPreviewBlob(42, { version: "42:1000:2048:ready" });
    assert.equal(recorded[0].url, `${BASE_URL}/media/42/preview?v=42%3A1000%3A2048%3Aready`);
  });

  test("getThumbnail requests the default grid target", async () => {
    mockFetch({
      fileId: 42,
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
      updatedAt: 1
    });
    await client().getThumbnail(42);
    assert.equal(recorded[0].method, "GET");
    assert.equal(
      recorded[0].url,
      `${BASE_URL}/media/42/thumbnail?target=grid_320&priority=background`
    );
  });

  test("getThumbnail forwards explicit thumbnail priority", async () => {
    mockFetch({
      fileId: 42,
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
      updatedAt: 1
    });
    await client().getThumbnail(42, "grid_320", "selected");
    assert.equal(recorded[0].method, "GET");
    assert.equal(
      recorded[0].url,
      `${BASE_URL}/media/42/thumbnail?target=grid_320&priority=selected`
    );
  });

  test("getThumbnailBlob requests the default grid target", async () => {
    mockFetch("thumbnail bytes");
    await client().getThumbnailBlob(42);
    assert.equal(recorded[0].method, "GET");
    assert.equal(recorded[0].url, `${BASE_URL}/media/42/thumbnail/blob?target=grid_320`);
  });

  test("getThumbnailBlob forwards abort signal", async () => {
    mockFetch("thumbnail bytes");
    const controller = new AbortController();
    await client().getThumbnailBlob(42, "grid_320", { signal: controller.signal });
    assert.equal(recorded[0].signal, controller.signal);
  });

  test("getThumbnailBlob attaches version cache buster", async () => {
    mockFetch("thumbnail bytes");
    await client().getThumbnailBlob(42, "grid_320", { version: 1234 });
    assert.equal(recorded[0].url, `${BASE_URL}/media/42/thumbnail/blob?target=grid_320&v=1234`);
  });

  test("CoreApiError is thrown on non-2xx with parsed body", async () => {
    mockFetch({ error: "nope", code: "plugin_not_found" }, 404);
    await assert.rejects(() => client().getPlugin("missing"), (error: Error) => {
      assert.equal(error.name, "CoreApiError");
      const status = (error as Error & { status?: number }).status;
      const body = (error as Error & { body?: unknown }).body;
      assert.equal(status, 404);
      assert.deepEqual(body, { error: "nope", code: "plugin_not_found" });
      return true;
    });
  });
});
