import type { MediaRecord, ThumbnailResponse } from "@megle/core-client";
import { createCoreClient } from "./client";

export type ThumbnailStateByMediaId = Record<number, ThumbnailResponse>;

const thumbnailClient = createCoreClient();
export const thumbnailResourceCache = new Map<number, ThumbnailResponse>();
export const inFlightThumbnailRequests = new Map<string, Promise<ThumbnailResponse>>();

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
    .getThumbnail(mediaId)
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
  if (mediaState === "ready") {
    return Boolean(mediaRecord.thumbnailCacheKey);
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

  // Trust the thumbnail response state directly. The /media listing
  // endpoint omits per-row thumbnailState/thumbnailCacheKey for
  // performance, so we cannot cross-validate against the media row.
  // Pending/queued states are short-lived and are simply re-requested
  // on the next poll.
  return true;
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
    mediaRecord.thumbnailCacheKey ?? ""
  ].join(":");
}
