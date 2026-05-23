import type { MediaRecord, ThumbnailResponse } from "@megle/core-client";
import { createCoreClient } from "./client";

export type ThumbnailStateByMediaId = Record<number, ThumbnailResponse>;

export const GRID_THUMBNAIL_TARGET = "grid_320";

const thumbnailClient = createCoreClient();
export const thumbnailResourceCache = new Map<number, ThumbnailResponse>();
export const inFlightThumbnailRequests = new Map<string, Promise<ThumbnailResponse>>();
export const inFlightThumbnailBlobRequests = new Map<string, Promise<Blob>>();

export async function requestThumbnailState(mediaRecord: MediaRecord): Promise<ThumbnailResponse> {
  const mediaId = mediaRecord.id;
  const requestKey = thumbnailRequestKey(mediaRecord);
  const cached = thumbnailResourceCache.get(mediaId);
  if (cached) {
    if (isFreshThumbnailForMediaRecord(mediaRecord, cached)) {
      if (cached.state !== "pending" && cached.state !== "queued") {
        return cached;
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
      if (isFreshThumbnailForMediaRecord(mediaRecord, thumbnail)) {
        thumbnailResourceCache.set(mediaId, thumbnail);
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

export async function requestThumbnailBlob(fileId: number): Promise<Blob> {
  const requestKey = `${fileId}:${GRID_THUMBNAIL_TARGET}`;
  const inFlight = inFlightThumbnailBlobRequests.get(requestKey);
  if (inFlight) {
    return inFlight;
  }

  const request = thumbnailClient
    .getThumbnailBlob(fileId, GRID_THUMBNAIL_TARGET)
    .finally(() => {
      inFlightThumbnailBlobRequests.delete(requestKey);
    });
  inFlightThumbnailBlobRequests.set(requestKey, request);
  return request;
}

export function readCachedThumbnailStates(mediaRecords: MediaRecord[]): ThumbnailStateByMediaId {
  const states: ThumbnailStateByMediaId = {};
  for (const mediaRecord of mediaRecords) {
    const thumbnail = thumbnailResourceCache.get(mediaRecord.id);
    if (!thumbnail) {
      continue;
    }
    if (isFreshThumbnailForMediaRecord(mediaRecord, thumbnail)) {
      states[mediaRecord.id] = thumbnail;
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
  if (thumbnail.fileId !== mediaRecord.id) {
    return false;
  }
  if (thumbnail.target !== GRID_THUMBNAIL_TARGET) {
    return false;
  }

  // Trust the thumbnail response state directly. The /media listing
  // endpoint may omit per-row thumbnailState during paging for
  // performance, so we cannot cross-validate against the media row.
  // Pending/queued states are short-lived and are simply re-requested
  // on the next poll.
  return true;
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
  return [
    mediaRecord.id,
    normalizeMediaThumbnailState(mediaRecord.thumbnailState),
    GRID_THUMBNAIL_TARGET
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
