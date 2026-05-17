import { strict as assert } from "node:assert";
import { afterEach, beforeEach, describe, test } from "node:test";

import { createCoreClient } from "../src/client.ts";

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
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
    recorded.push({ url, method, headers, body });
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

  test("listMedia serializes filters and sort", async () => {
    mockFetch({ items: [], nextCursor: null });
    await client().listMedia({ rootId: 7, sort: "mtime_desc", kind: "image", limit: 50 });
    const url = new URL(recorded[0].url);
    assert.equal(url.searchParams.get("rootId"), "7");
    assert.equal(url.searchParams.get("sort"), "mtime_desc");
    assert.equal(url.searchParams.get("kind"), "image");
    assert.equal(url.searchParams.get("limit"), "50");
  });

  test("searchMedia repeats tagId for AND filtering", async () => {
    mockFetch({ items: [], nextCursor: null });
    await client().searchMedia({ rootId: 1, tagIds: [10, 20, 30], sort: "rating_desc" });
    const url = new URL(recorded[0].url);
    const tagIds = url.searchParams.getAll("tagId");
    assert.deepEqual(tagIds, ["10", "20", "30"]);
    assert.equal(url.searchParams.get("sort"), "rating_desc");
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
