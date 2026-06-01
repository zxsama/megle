import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { MediaRecord, ThumbnailResponse } from "@megle/core-client";
import {
  mediaContentSignature,
  mediaFileContentSignature,
  preloadImageObjectUrl,
  previewPlaceholderDataUrl,
  readCachedThumbnailObjectUrl,
  requestOriginalPreviewBlob,
  requestThumbnailBlob,
  thumbnailObjectUrlCacheKey
} from "../../core/mediaResources";

const STALE_PREVIEW_OBJECT_URL_REVOKE_DELAY_MS = 8000;

export function MediaPreview({
  media,
  onLoadingChange,
  onMediaReady,
  onNaturalSize,
  preferOriginalWhilePending = false,
  preserveNaturalFrame,
  source = "thumbnail",
  stableFrame = false,
  thumbnail
}: {
  media: MediaRecord;
  onLoadingChange?: (loading: boolean) => void;
  onMediaReady?: () => void;
  onNaturalSize?: (size: { naturalHeight: number; naturalWidth: number }) => void;
  preferOriginalWhilePending?: boolean;
  preserveNaturalFrame?: boolean;
  source?: "thumbnail" | "original";
  stableFrame?: boolean;
  thumbnail?: ThumbnailResponse;
}) {
  const previewPlaceholderUrl = previewPlaceholderDataUrl(media);
  const stableFrameStyle = stableFrame ? previewStableFrameStyle(media) : undefined;
  const shouldPreserveNaturalFrame =
    preserveNaturalFrame ?? (source === "original" && stableFrame);
  const originalVersionKey = mediaFileContentSignature(media);
  const hasLiveReadyThumbnail = thumbnail?.state === "ready" && thumbnail.updatedAt !== null;
  const shouldUseOriginalWhilePending =
    source === "thumbnail" &&
    preferOriginalWhilePending &&
    media.kind === "image" &&
    thumbnail?.state !== "failed" &&
    thumbnail?.state !== "skipped_small" &&
    !hasLiveReadyThumbnail;
  const fallbackThumbnail = useThumbnailFallbackUrl(
    source === "original" && hasLiveReadyThumbnail ? media.id : null,
    mediaContentSignature(media),
    hasLiveReadyThumbnail ? thumbnail.updatedAt : null
  );
  const fallbackUrl = fallbackThumbnail ?? previewPlaceholderUrl;

  if (source === "original" || shouldUseOriginalWhilePending) {
    return (
      <ReadyPreviewMedia
        alt={media.name}
        fallbackUrl={fallbackUrl}
        frameStyle={stableFrameStyle}
        kind={media.kind}
        media={media}
        onLoadingChange={onLoadingChange}
        onMediaReady={onMediaReady}
        onNaturalSize={onNaturalSize}
        preserveNaturalFrame={shouldPreserveNaturalFrame}
        source="original"
        versionKey={originalVersionKey}
      />
    );
  }

  if (hasLiveReadyThumbnail) {
    return (
      <ReadyPreviewMedia
        alt={media.name}
        fallbackUrl={previewPlaceholderUrl}
        kind={media.kind}
        media={media}
        onLoadingChange={onLoadingChange}
        onMediaReady={onMediaReady}
        preserveNaturalFrame={false}
        source="thumbnail"
        versionKey={hasLiveReadyThumbnail ? thumbnail.updatedAt : null}
      />
    );
  }

  if (thumbnail?.state === "failed") {
    return (
      <div className="preview-placeholder failed" style={stableFrameStyle}>
        <span>thumbnail failed</span>
      </div>
    );
  }

  if (thumbnail?.state === "skipped_small") {
    if (previewPlaceholderUrl) {
      return (
        <PreviewFallbackImage
          alt={media.name}
          frameStyle={stableFrameStyle}
          src={previewPlaceholderUrl}
          state="skipped"
        />
      );
    }
    return (
      <div className="preview-placeholder skipped" style={stableFrameStyle}>
        <span>{media.kind ?? "file"}</span>
      </div>
    );
  }

  if (previewPlaceholderUrl) {
    return (
      <PreviewFallbackImage
        alt={media.name}
        frameStyle={stableFrameStyle}
        src={previewPlaceholderUrl}
        state="pending"
      />
    );
  }

  return <div className="preview-placeholder pending preview-placeholder-empty" style={stableFrameStyle} />;
}

function schedulePreviewObjectUrlRevoke(objectUrl: string): void {
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), STALE_PREVIEW_OBJECT_URL_REVOKE_DELAY_MS);
}

function useThumbnailFallbackUrl(
  fileId: number | null,
  mediaSignature: string,
  versionKey: number | null
): string | null {
  const cacheKey =
    fileId === null ? null : thumbnailObjectUrlCacheKey(fileId, mediaSignature, versionKey);
  const [fallbackThumbnail, setFallbackThumbnail] = useState<string | null>(() =>
    cacheKey ? readCachedThumbnailObjectUrl(cacheKey) : null
  );

  useEffect(() => {
    if (fileId === null || cacheKey === null) {
      setFallbackThumbnail(null);
      return undefined;
    }

    const cachedObjectUrl = readCachedThumbnailObjectUrl(cacheKey);
    if (cachedObjectUrl) {
      setFallbackThumbnail(cachedObjectUrl);
      return undefined;
    }

    let revoked = false;
    let objectUrl: string | null = null;
    const controller = new AbortController();
    setFallbackThumbnail(null);

    requestThumbnailBlob(fileId, versionKey, {
      requestPriority: "interactive",
      resourcePriority: "preview",
      signal: controller.signal
    })
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
      controller.abort();
      if (objectUrl) schedulePreviewObjectUrlRevoke(objectUrl);
    };
  }, [cacheKey, fileId, versionKey]);

  return fallbackThumbnail;
}

function PreviewFallbackImage({
  alt,
  frameStyle,
  src,
  state
}: {
  alt: string;
  frameStyle?: CSSProperties;
  src: string;
  state: "pending" | "skipped";
}) {
  return (
    <div
      className={`preview-placeholder ${state} preview-placeholder-image`}
      data-preview-placeholder="preview"
      style={frameStyle}
    >
      <img alt={alt} className="preview-image preview-fallback-image" src={src} />
    </div>
  );
}

function ReadyPreviewMedia({
  alt,
  fallbackUrl,
  frameStyle,
  kind,
  media,
  onLoadingChange,
  onMediaReady,
  onNaturalSize,
  preserveNaturalFrame,
  source,
  versionKey
}: {
  alt: string;
  fallbackUrl: string | null;
  frameStyle?: CSSProperties;
  kind?: string | null;
  media: MediaRecord;
  onLoadingChange?: (loading: boolean) => void;
  onMediaReady?: () => void;
  onNaturalSize?: (size: { naturalHeight: number; naturalWidth: number }) => void;
  preserveNaturalFrame: boolean;
  source: "thumbnail" | "original";
  versionKey?: number | string | null;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [containedMediaStyle, setContainedMediaStyle] = useState<CSSProperties | undefined>(undefined);
  const [naturalFrameStyle, setNaturalFrameStyle] = useState<CSSProperties | undefined>(undefined);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        schedulePreviewObjectUrlRevoke(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    onLoadingChange?.(true);
    setError(false);

    const controller = new AbortController();
    const request = source === "original"
      ? requestOriginalPreviewBlob(media, {
          requestPriority: "interactive",
          resourcePriority: "preview",
          signal: controller.signal
        })
      : requestThumbnailBlob(media.id, typeof versionKey === "number" ? versionKey : null, {
          requestPriority: "interactive",
          resourcePriority: "preview",
          signal: controller.signal
        });
    request
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (revoked) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        const nextObjectUrl = objectUrl;
        if (source !== "original" || !preserveNaturalFrame) {
          setNaturalFrameStyle(undefined);
          setContainedMediaStyle(undefined);
        }
        const previousObjectUrl = objectUrlRef.current;
        objectUrlRef.current = nextObjectUrl;
        setSrc(nextObjectUrl);
        onLoadingChange?.(false);
        if (previousObjectUrl) {
          schedulePreviewObjectUrlRevoke(previousObjectUrl);
        }
        if (source === "original" && kind === "video") {
          return;
        }
        void preloadImageObjectUrl(nextObjectUrl)
          .then((naturalSize) => {
            if (revoked || objectUrlRef.current !== nextObjectUrl) {
              return;
            }
            if (source === "original" && preserveNaturalFrame) {
              onNaturalSize?.(naturalSize);
              setContainedMediaStyle(undefined);
              setNaturalFrameStyle({
                height: `${naturalSize.naturalHeight}px`,
                width: `${naturalSize.naturalWidth}px`
              });
            } else if (!preserveNaturalFrame) {
              setNaturalFrameStyle(undefined);
              setContainedMediaStyle(containedPreviewMediaStyle(naturalSize));
            }
          })
          .catch(() => undefined);
      })
      .catch(() => {
        if (objectUrl && objectUrlRef.current !== objectUrl) {
          schedulePreviewObjectUrlRevoke(objectUrl);
          objectUrl = null;
        }
        if (!revoked && !controller.signal.aborted) {
          setError(true);
          onLoadingChange?.(false);
        }
      });

    return () => {
      revoked = true;
      controller.abort();
      if (objectUrl && objectUrlRef.current !== objectUrl) {
        schedulePreviewObjectUrlRevoke(objectUrl);
      }
    };
  }, [kind, media.id, onLoadingChange, onNaturalSize, preserveNaturalFrame, source, versionKey]);

  const effectiveFrameStyle = frameStyle ?? naturalFrameStyle;

  if (error && !src) {
    return (
      <div className="preview-placeholder failed" style={effectiveFrameStyle}>
        <span>load error</span>
      </div>
    );
  }

  if (!src) {
    if (fallbackUrl) {
      return <PreviewFallbackImage alt={alt} frameStyle={effectiveFrameStyle} src={fallbackUrl} state="pending" />;
    }
    return (
      <div className="preview-placeholder pending preview-placeholder-empty" style={effectiveFrameStyle} />
    );
  }

  if (source === "original" && kind === "video") {
    return (
      <div className="preview-placeholder ready" data-preview-source={source} style={effectiveFrameStyle}>
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
    <div className="preview-placeholder ready" data-preview-source={source} style={effectiveFrameStyle}>
        <img
          alt={alt}
          className="preview-image"
          decoding="async"
          onLoad={(event) => {
            const image = event.currentTarget;
            const naturalSize = {
              naturalHeight: image.naturalHeight,
              naturalWidth: image.naturalWidth
            };
            if (source === "original" && preserveNaturalFrame) {
              onNaturalSize?.(naturalSize);
              setContainedMediaStyle(undefined);
              setNaturalFrameStyle({
                height: `${naturalSize.naturalHeight}px`,
                width: `${naturalSize.naturalWidth}px`
              });
            } else if (!preserveNaturalFrame) {
              setNaturalFrameStyle(undefined);
              setContainedMediaStyle(containedPreviewMediaStyle(naturalSize));
            }
            onMediaReady?.();
          }}
          onError={() => {
            setError(true);
            onLoadingChange?.(false);
          }}
          src={src}
          style={containedMediaStyle}
        />
    </div>
  );
}

function containedPreviewMediaStyle(size: {
  naturalHeight: number;
  naturalWidth: number;
}): CSSProperties {
  return {
    height: "auto",
    maxHeight: "100cqh",
    maxWidth: "100cqw",
    width: "auto"
  };
}

function previewStableFrameStyle(media: MediaRecord): CSSProperties | undefined {
  if (!media.width || !media.height || media.width <= 0 || media.height <= 0) {
    return undefined;
  }
  return {
    height: `${media.height}px`,
    width: `${media.width}px`
  };
}
