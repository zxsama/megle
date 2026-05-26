import { useEffect, useState } from "react";
import type { MediaRecord, ThumbnailResponse } from "@megle/core-client";
import {
  mediaContentSignature,
  previewPlaceholderDataUrl,
  requestOriginalPreviewBlob,
  requestThumbnailBlob
} from "../../core/mediaResources";

export function MediaPreview({
  media,
  onMediaReady,
  preferOriginalWhilePending = false,
  source = "thumbnail",
  thumbnail
}: {
  media: MediaRecord;
  onMediaReady?: () => void;
  preferOriginalWhilePending?: boolean;
  source?: "thumbnail" | "original";
  thumbnail?: ThumbnailResponse;
}) {
  const previewPlaceholderUrl = previewPlaceholderDataUrl(media);
  const originalVersionKey = mediaContentSignature(media);
  const rowThumbnailReady = normalizeMediaThumbnailState(media.thumbnailState) === "ready";
  const hasLiveReadyThumbnail = thumbnail?.state === "ready" && thumbnail.updatedAt !== null;
  const shouldUseOriginalWhilePending =
    source === "thumbnail" &&
    preferOriginalWhilePending &&
    media.kind === "image" &&
    thumbnail?.state !== "failed" &&
    thumbnail?.state !== "skipped_small" &&
    !hasLiveReadyThumbnail;
  const fallbackThumbnail = useThumbnailFallbackUrl(
    source === "original" && (hasLiveReadyThumbnail || rowThumbnailReady) ? media.id : null,
    hasLiveReadyThumbnail ? thumbnail.updatedAt : null
  );
  const fallbackUrl = fallbackThumbnail ?? previewPlaceholderUrl;

  if (source === "original" || shouldUseOriginalWhilePending) {
    return (
      <ReadyPreviewMedia
        alt={media.name}
        fallbackUrl={fallbackUrl}
        kind={media.kind}
        media={media}
        onMediaReady={onMediaReady}
        source="original"
        versionKey={originalVersionKey}
      />
    );
  }

  if (hasLiveReadyThumbnail || rowThumbnailReady) {
    return (
      <ReadyPreviewMedia
        alt={media.name}
        fallbackUrl={previewPlaceholderUrl}
        kind={media.kind}
        media={media}
        onMediaReady={onMediaReady}
        source="thumbnail"
        versionKey={hasLiveReadyThumbnail ? thumbnail.updatedAt : null}
      />
    );
  }

  if (thumbnail?.state === "failed") {
    return (
      <div className="preview-placeholder failed">
        <span>thumbnail failed</span>
      </div>
    );
  }

  if (thumbnail?.state === "skipped_small") {
    if (previewPlaceholderUrl) {
      return <PreviewFallbackImage alt={media.name} src={previewPlaceholderUrl} state="skipped" />;
    }
    return (
      <div className="preview-placeholder skipped">
        <span>{media.kind ?? "file"}</span>
      </div>
    );
  }

  if (previewPlaceholderUrl) {
    return <PreviewFallbackImage alt={media.name} src={previewPlaceholderUrl} state="pending" />;
  }

  return (
    <div className="preview-placeholder pending">
      <span>{thumbnail?.state ?? media.thumbnailState ?? "pending"}</span>
    </div>
  );
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

function useThumbnailFallbackUrl(fileId: number | null, versionKey: number | null): string | null {
  const [fallbackThumbnail, setFallbackThumbnail] = useState<string | null>(null);

  useEffect(() => {
    if (fileId === null) {
      setFallbackThumbnail(null);
      return undefined;
    }

    let revoked = false;
    let objectUrl: string | null = null;
    setFallbackThumbnail(null);

    requestThumbnailBlob(fileId, versionKey)
      .then((blob) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setFallbackThumbnail(objectUrl);
      })
      .catch(() => {
        if (!revoked) setFallbackThumbnail(null);
      });

    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileId, versionKey]);

  return fallbackThumbnail;
}

function PreviewFallbackImage({
  alt,
  src,
  state
}: {
  alt: string;
  src: string;
  state: "pending" | "skipped";
}) {
  return (
    <div
      className={`preview-placeholder ${state} preview-placeholder-image`}
      data-preview-placeholder="preview"
    >
      <img alt={alt} className="preview-image preview-fallback-image" src={src} />
    </div>
  );
}

function ReadyPreviewMedia({
  alt,
  fallbackUrl,
  kind,
  media,
  onMediaReady,
  source,
  versionKey
}: {
  alt: string;
  fallbackUrl: string | null;
  kind?: string | null;
  media: MediaRecord;
  onMediaReady?: () => void;
  source: "thumbnail" | "original";
  versionKey?: number | string | null;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    setSrc(null);
    setError(false);

    const controller = source === "original" ? new AbortController() : null;
    const request = controller
      ? requestOriginalPreviewBlob(media, { signal: controller.signal })
      : requestThumbnailBlob(media.id, typeof versionKey === "number" ? versionKey : null);
    request
      .then((blob) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!revoked && !controller?.signal.aborted) setError(true);
      });

    return () => {
      revoked = true;
      controller?.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [media.id, source, versionKey]);

  if (error) {
    return (
      <div className="preview-placeholder failed">
        <span>load error</span>
      </div>
    );
  }

  if (!src) {
    if (fallbackUrl) {
      return <PreviewFallbackImage alt={alt} src={fallbackUrl} state="pending" />;
    }
    return (
      <div className="preview-placeholder pending">
        <span>loading</span>
      </div>
    );
  }

  if (source === "original" && kind === "video") {
    return (
      <div className="preview-placeholder ready" data-preview-source={source}>
        <video
          aria-label={alt}
          className="preview-image preview-video"
          controls
          onLoadedMetadata={onMediaReady}
          preload="metadata"
          src={src}
        />
      </div>
    );
  }

  return (
    <div className="preview-placeholder ready" data-preview-source={source}>
      <img alt={alt} className="preview-image" onLoad={onMediaReady} src={src} />
    </div>
  );
}
