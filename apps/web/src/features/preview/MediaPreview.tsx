import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { MediaRecord, ThumbnailResponse } from "@megle/core-client";
import {
  mediaContentSignature,
  preloadImageObjectUrl,
  previewPlaceholderDataUrl,
  requestOriginalPreviewBlob,
  requestThumbnailBlob
} from "../../core/mediaResources";

export function MediaPreview({
  media,
  onLoadingChange,
  onMediaReady,
  onNaturalSize,
  preferOriginalWhilePending = false,
  source = "thumbnail",
  stableFrame = false,
  thumbnail
}: {
  media: MediaRecord;
  onLoadingChange?: (loading: boolean) => void;
  onMediaReady?: () => void;
  onNaturalSize?: (size: { naturalHeight: number; naturalWidth: number }) => void;
  preferOriginalWhilePending?: boolean;
  source?: "thumbnail" | "original";
  stableFrame?: boolean;
  thumbnail?: ThumbnailResponse;
}) {
  const previewPlaceholderUrl = previewPlaceholderDataUrl(media);
  const stableFrameStyle = stableFrame ? previewStableFrameStyle(media) : undefined;
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
        frameStyle={stableFrameStyle}
        kind={media.kind}
        media={media}
        onLoadingChange={onLoadingChange}
        onMediaReady={onMediaReady}
        onNaturalSize={onNaturalSize}
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
        onLoadingChange={onLoadingChange}
        onMediaReady={onMediaReady}
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
  source: "thumbnail" | "original";
  versionKey?: number | string | null;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [naturalFrameStyle, setNaturalFrameStyle] = useState<CSSProperties | undefined>(undefined);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    let naturalSize: { naturalHeight: number; naturalWidth: number } | null = null;
    onLoadingChange?.(true);
    setError(false);

    const controller = source === "original" ? new AbortController() : null;
    const request = controller
      ? requestOriginalPreviewBlob(media, { signal: controller.signal })
      : requestThumbnailBlob(media.id, typeof versionKey === "number" ? versionKey : null);
    request
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (source === "original" && kind === "video") {
          return undefined;
        }
        return preloadImageObjectUrl(objectUrl).then((size) => {
          naturalSize = size;
        });
      })
      .then(() => {
        if (!objectUrl) {
          return;
        }
        if (revoked) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        if (naturalSize && source === "original") {
          onNaturalSize?.(naturalSize);
          setNaturalFrameStyle({
            height: `${naturalSize.naturalHeight}px`,
            width: `${naturalSize.naturalWidth}px`
          });
        } else if (source !== "original") {
          setNaturalFrameStyle(undefined);
        }
        const previousObjectUrl = objectUrlRef.current;
        objectUrlRef.current = objectUrl;
        setSrc(objectUrl);
        onLoadingChange?.(false);
        if (previousObjectUrl) {
          window.setTimeout(() => URL.revokeObjectURL(previousObjectUrl), 1000);
        }
      })
      .catch(() => {
        if (objectUrl && objectUrlRef.current !== objectUrl) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
        }
        if (!revoked && !controller?.signal.aborted) {
          setError(true);
          onLoadingChange?.(false);
        }
      });

    return () => {
      revoked = true;
      controller?.abort();
      if (objectUrl && objectUrlRef.current !== objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [kind, media.id, onLoadingChange, onNaturalSize, source, versionKey]);

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
      <img alt={alt} className="preview-image" onLoad={onMediaReady} src={src} />
    </div>
  );
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
