import { useEffect, useState } from "react";
import type { MediaRecord, ThumbnailResponse } from "@megle/core-client";
import { createCoreClient } from "@megle/core-client";
import { getCoreClientConfig } from "../../core/client";
import {
  previewPlaceholderDataUrl,
  requestThumbnailBlob
} from "../../core/mediaResources";

export function MediaPreview({
  media,
  onMediaReady,
  source = "thumbnail",
  thumbnail
}: {
  media: MediaRecord;
  onMediaReady?: () => void;
  source?: "thumbnail" | "original";
  thumbnail?: ThumbnailResponse;
}) {
  const previewPlaceholderUrl = previewPlaceholderDataUrl(media);
  const hasLiveReadyThumbnail = thumbnail?.state === "ready" && thumbnail.updatedAt !== null;
  const fallbackThumbnail = useThumbnailFallbackUrl(
    source === "original" && hasLiveReadyThumbnail ? thumbnail.fileId : null,
    thumbnail?.updatedAt ?? null
  );
  const fallbackUrl = fallbackThumbnail ?? previewPlaceholderUrl;

  if (source === "original") {
    return (
      <ReadyPreviewMedia
        alt={media.name}
        fallbackUrl={fallbackUrl}
        fileId={media.id}
        kind={media.kind}
        onMediaReady={onMediaReady}
        source="original"
      />
    );
  }

  if (hasLiveReadyThumbnail) {
    return (
      <ReadyPreviewMedia
        alt={media.name}
        fallbackUrl={previewPlaceholderUrl}
        fileId={media.id}
        kind={media.kind}
        onMediaReady={onMediaReady}
        source="thumbnail"
        versionKey={thumbnail.updatedAt}
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
  fileId,
  kind,
  onMediaReady,
  source,
  versionKey
}: {
  alt: string;
  fallbackUrl: string | null;
  fileId: number;
  kind?: string | null;
  onMediaReady?: () => void;
  source: "thumbnail" | "original";
  versionKey?: number | null;
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
      ? createCoreClient(getCoreClientConfig()).getPreviewBlob(fileId, {
          signal: controller.signal
        })
      : requestThumbnailBlob(fileId, versionKey ?? null);
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
  }, [fileId, source, versionKey]);

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
