import type { MediaRecord, ThumbnailResponse } from "@megle/core-client";
import { createCoreClient } from "./client";

export type ThumbnailStateByMediaId = Record<number, ThumbnailResponse>;
type CachedThumbnailEntry = {
  mediaSignature: string;
  thumbnail: ThumbnailResponse;
};

export const GRID_THUMBNAIL_TARGET = "grid_320";

const thumbnailClient = createCoreClient();
export const thumbnailResourceCache = new Map<number, CachedThumbnailEntry>();
export const inFlightThumbnailRequests = new Map<string, Promise<ThumbnailResponse>>();
export const inFlightThumbnailBlobRequests = new Map<string, Promise<Blob>>();

export async function requestThumbnailState(mediaRecord: MediaRecord): Promise<ThumbnailResponse> {
  const mediaId = mediaRecord.id;
  const requestKey = thumbnailRequestKey(mediaRecord);
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
    .getThumbnail(mediaId, GRID_THUMBNAIL_TARGET)
    .then((thumbnail) => {
      if (isLiveThumbnailResponseForMediaRecord(mediaRecord, thumbnail)) {
        thumbnailResourceCache.set(mediaId, {
          mediaSignature: mediaContentSignature(mediaRecord),
          thumbnail
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
  if (
    isTerminalThumbnailState(thumbnail.state) &&
    mediaState !== null &&
    mediaState !== thumbnail.state
  ) {
    return false;
  }

  // Trust the thumbnail response state directly. The /media listing
  // endpoint may omit per-row thumbnailState during paging for
  // performance, so we cannot cross-validate against the media row.
  // Pending/queued states are short-lived and are simply re-requested
  // on the next poll.
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

function thumbnailRequestKey(mediaRecord: MediaRecord): string {
  return [mediaContentSignature(mediaRecord), GRID_THUMBNAIL_TARGET].join(":");
}

export function mediaContentSignature(mediaRecord: MediaRecord): string {
  return [
    mediaRecord.id,
    mediaRecord.mtime,
    mediaRecord.size,
    normalizeMediaThumbnailState(mediaRecord.thumbnailState)
  ].join(":");
}

function bytesToBase64(bytes: number[]): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    const chunk = bytes.slice(offset, offset + 8192);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
