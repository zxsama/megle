import type { MediaRecord, ThumbnailResponse } from "@megle/core-client";
import { createCoreClient } from "./client";

export type ThumbnailStateByMediaId = Record<number, ThumbnailResponse>;
export type ThumbnailRequestPriority = "background" | "ahead" | "visible" | "selected";
type CachedThumbnailEntry = {
  mediaSignature: string;
  thumbnail: ThumbnailResponse;
};
type CachedOriginalPreviewEntry = {
  mediaSignature: string;
  blob: Blob;
};
type OriginalPreviewRequestOptions = {
  signal?: AbortSignal;
};

export const GRID_THUMBNAIL_TARGET = "grid_320";

const thumbnailClient = createCoreClient();
export const thumbnailResourceCache = new Map<number, CachedThumbnailEntry>();
export const inFlightThumbnailRequests = new Map<string, Promise<ThumbnailResponse>>();
export const inFlightThumbnailBlobRequests = new Map<string, Promise<Blob>>();
export const originalPreviewBlobCache = new Map<number, CachedOriginalPreviewEntry>();
export const inFlightOriginalPreviewRequests = new Map<string, Promise<Blob>>();
const ORIGINAL_PREVIEW_CACHE_LIMIT = 5;

export async function requestThumbnailState(
  mediaRecord: MediaRecord,
  priority: ThumbnailRequestPriority = "background"
): Promise<ThumbnailResponse> {
  const mediaId = mediaRecord.id;
  const requestKey = thumbnailRequestKey(mediaRecord, priority);
  const cached = thumbnailResourceCache.get(mediaId);
  if (cached) {
    if (isFreshCachedThumbnailForMediaRecord(mediaRecord, cached)) {
      if (cached.thumbnail.state !== "pending" && cached.thumbnail.state !== "queued") {
        return cached.thumbnail;
      }
    } else {
      thumbnailResourceCache.delete(mediaId);
    }
  }

  const inFlight = inFlightThumbnailRequests.get(requestKey);
  if (inFlight) {
    return inFlight;
  }

  const request = thumbnailClient
    .getThumbnail(mediaId, GRID_THUMBNAIL_TARGET, priority)
    .then((thumbnail) => {
      if (isLiveThumbnailResponseForMediaRecord(mediaRecord, thumbnail)) {
        const mediaSignature = mediaContentSignature(mediaRecord);
        const cachedEntry = thumbnailResourceCache.get(mediaId);
        thumbnailResourceCache.set(mediaId, {
          mediaSignature,
          thumbnail:
            cachedEntry?.mediaSignature === mediaSignature
              ? pickPreferredThumbnailResponse(cachedEntry.thumbnail, thumbnail)
              : thumbnail
        });
      } else {
        thumbnailResourceCache.delete(mediaId);
      }
      return thumbnail;
    })
    .finally(() => {
      inFlightThumbnailRequests.delete(requestKey);
    });
  inFlightThumbnailRequests.set(requestKey, request);
  return request;
}

export async function requestThumbnailBlob(
  fileId: number,
  versionKey: number | null = null
): Promise<Blob> {
  const requestKey = `${fileId}:${GRID_THUMBNAIL_TARGET}:${versionKey ?? "current"}`;
  const inFlight = inFlightThumbnailBlobRequests.get(requestKey);
  if (inFlight) {
    return inFlight;
  }

  const request = thumbnailClient
    .getThumbnailBlob(fileId, GRID_THUMBNAIL_TARGET, { version: versionKey })
    .finally(() => {
      inFlightThumbnailBlobRequests.delete(requestKey);
    });
  inFlightThumbnailBlobRequests.set(requestKey, request);
  return request;
}

export function requestOriginalPreviewBlob(
  mediaRecord: MediaRecord,
  options: OriginalPreviewRequestOptions = {}
): Promise<Blob> {
  const mediaSignature = mediaContentSignature(mediaRecord);
  const cached = originalPreviewBlobCache.get(mediaRecord.id);
  if (cached) {
    if (cached.mediaSignature === mediaSignature) {
      originalPreviewBlobCache.delete(mediaRecord.id);
      originalPreviewBlobCache.set(mediaRecord.id, cached);
      return withAbortSignal(Promise.resolve(cached.blob), options.signal);
    }
    originalPreviewBlobCache.delete(mediaRecord.id);
  }

  if (options.signal?.aborted) {
    return Promise.reject(createAbortError());
  }

  const requestKey = originalPreviewRequestKey(mediaRecord);
  const inFlight = inFlightOriginalPreviewRequests.get(requestKey);
  if (inFlight) {
    return withAbortSignal(inFlight, options.signal);
  }

  const request = thumbnailClient
    .getPreviewBlob(mediaRecord.id, {
      version: mediaContentSignature(mediaRecord)
    })
    .then((blob) => {
      originalPreviewBlobCache.set(mediaRecord.id, {
        mediaSignature,
        blob
      });
      pruneOriginalPreviewCache();
      return blob;
    })
    .finally(() => {
      inFlightOriginalPreviewRequests.delete(requestKey);
    });
  inFlightOriginalPreviewRequests.set(requestKey, request);
  return withAbortSignal(request, options.signal);
}

export function prefetchOriginalPreview(mediaRecord: MediaRecord): void {
  void requestOriginalPreviewBlob(mediaRecord).catch(() => {
    originalPreviewBlobCache.delete(mediaRecord.id);
  });
}

export function readCachedThumbnailStates(mediaRecords: MediaRecord[]): ThumbnailStateByMediaId {
  const states: ThumbnailStateByMediaId = {};
  for (const mediaRecord of mediaRecords) {
    const entry = thumbnailResourceCache.get(mediaRecord.id);
    if (!entry) {
      continue;
    }
    if (isFreshCachedThumbnailForMediaRecord(mediaRecord, entry)) {
      states[mediaRecord.id] = entry.thumbnail;
    } else {
      thumbnailResourceCache.delete(mediaRecord.id);
    }
  }
  return states;
}

export function shouldRequestThumbnailState(mediaRecord: MediaRecord): boolean {
  const mediaState = normalizeMediaThumbnailState(mediaRecord.thumbnailState);
  if (mediaState === "failed" || mediaState === "skipped_small") {
    return false;
  }
  return true;
}

export function isFreshThumbnailForMediaRecord(
  mediaRecord: MediaRecord,
  thumbnail: ThumbnailResponse
): boolean {
  return isFreshThumbnailResponseForMediaRecord(mediaRecord, thumbnail);
}

export function pickPreferredThumbnailResponse(
  current: ThumbnailResponse | undefined,
  next: ThumbnailResponse
): ThumbnailResponse {
  if (!current) {
    return next;
  }

  const currentRank = thumbnailStateRank(current.state);
  const nextRank = thumbnailStateRank(next.state);
  if (nextRank > currentRank) {
    return next;
  }
  if (nextRank < currentRank) {
    return current;
  }

  if (next.state === "ready" && current.state === "ready") {
    const currentUpdatedAt = current.updatedAt ?? -1;
    const nextUpdatedAt = next.updatedAt ?? -1;
    if (nextUpdatedAt > currentUpdatedAt) {
      return next;
    }
    if (nextUpdatedAt < currentUpdatedAt) {
      return current;
    }
  }

  return next;
}

export function isFreshCachedThumbnailForMediaRecord(
  mediaRecord: MediaRecord,
  entry: CachedThumbnailEntry
): boolean {
  if (entry.mediaSignature !== mediaContentSignature(mediaRecord)) {
    return false;
  }
  return isFreshThumbnailResponseForMediaRecord(mediaRecord, entry.thumbnail);
}

function isFreshThumbnailResponseForMediaRecord(
  mediaRecord: MediaRecord,
  thumbnail: ThumbnailResponse
): boolean {
  if (thumbnail.fileId !== mediaRecord.id) {
    return false;
  }
  if (thumbnail.target !== GRID_THUMBNAIL_TARGET) {
    return false;
  }
  const mediaState = explicitMediaThumbnailState(mediaRecord.thumbnailState);
  if (mediaState === "ready" && thumbnail.state !== "ready") {
    return false;
  }
  return true;
}

export function isLiveThumbnailResponseForMediaRecord(
  mediaRecord: MediaRecord,
  thumbnail: ThumbnailResponse
): boolean {
  return thumbnail.fileId === mediaRecord.id && thumbnail.target === GRID_THUMBNAIL_TARGET;
}

function explicitMediaThumbnailState(
  value: string | null | undefined
): ThumbnailResponse["state"] | null {
  if (
    value === "pending" ||
    value === "queued" ||
    value === "ready" ||
    value === "failed" ||
    value === "skipped_small"
  ) {
    return value;
  }
  return null;
}

function isTerminalThumbnailState(value: ThumbnailResponse["state"]): boolean {
  return value === "ready" || value === "failed" || value === "skipped_small";
}

export function previewPlaceholderDataUrl(mediaRecord: MediaRecord): string | null {
  const bytes = mediaRecord.previewPlaceholder;
  if (!bytes || bytes.length === 0) {
    return null;
  }
  const mediaType = mediaRecord.previewPlaceholderFormat ?? "image/webp";
  return `data:${mediaType};base64,${bytesToBase64(bytes)}`;
}

function normalizeMediaThumbnailState(value: string | null | undefined): ThumbnailResponse["state"] {
  if (
    value === "pending" ||
    value === "queued" ||
    value === "ready" ||
    value === "failed" ||
    value === "skipped_small"
  ) {
    return value;
  }
  return "pending";
}

function thumbnailRequestKey(
  mediaRecord: MediaRecord,
  priority: ThumbnailRequestPriority
): string {
  return [mediaContentSignature(mediaRecord), GRID_THUMBNAIL_TARGET, priority].join(":");
}

function originalPreviewRequestKey(mediaRecord: MediaRecord): string {
  return [mediaContentSignature(mediaRecord), "original"].join(":");
}

function pruneOriginalPreviewCache(): void {
  while (originalPreviewBlobCache.size > ORIGINAL_PREVIEW_CACHE_LIMIT) {
    const firstKey = originalPreviewBlobCache.keys().next().value;
    if (firstKey === undefined) break;
    originalPreviewBlobCache.delete(firstKey);
  }
}

function withAbortSignal<T>(request: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return request;
  if (signal.aborted) return Promise.reject(createAbortError());

  return new Promise((resolve, reject) => {
    const abort = () => reject(createAbortError());
    signal.addEventListener("abort", abort, { once: true });
    request.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

function createAbortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

export function mediaContentSignature(mediaRecord: MediaRecord): string {
  return [
    mediaRecord.id,
    mediaRecord.mtime,
    mediaRecord.size,
    normalizeMediaThumbnailState(mediaRecord.thumbnailState)
  ].join(":");
}

function thumbnailStateRank(state: ThumbnailResponse["state"]): number {
  switch (state) {
    case "ready":
      return 4;
    case "failed":
      return 3;
    case "skipped_small":
      return 2;
    case "queued":
      return 1;
    case "pending":
    default:
      return 0;
  }
}

function bytesToBase64(bytes: number[]): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    const chunk = bytes.slice(offset, offset + 8192);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
