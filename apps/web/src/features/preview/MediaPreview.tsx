import { useEffect, useState } from "react";
import type { MediaRecord, ThumbnailResponse } from "@megle/core-client";
import { createCoreClient } from "@megle/core-client";
import { getCoreClientConfig } from "../../core/client";
import {
  previewPlaceholderBlob,
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
  const previewPlaceholderUrl = usePreviewPlaceholderUrl(media);
  const fallbackThumbnail = useThumbnailFallbackUrl(
    thumbnail?.state === "ready" ? thumbnail.fileId : null
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

  if (thumbnail?.state === "ready") {
    return (
      <ReadyPreviewMedia
        alt={media.name}
        fallbackUrl={previewPlaceholderUrl}
        fileId={media.id}
        kind={media.kind}
        onMediaReady={onMediaReady}
        source="thumbnail"
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

function usePreviewPlaceholderUrl(media: MediaRecord): string | null {
  const [previewPlaceholderUrl, setPreviewPlaceholderUrl] = useState<string | null>(null);

  useEffect(() => {
    const blob = previewPlaceholderBlob(media);
    if (!blob) {
      setPreviewPlaceholderUrl(null);
      return undefined;
    }

    const objectUrl = URL.createObjectURL(blob);
    setPreviewPlaceholderUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [media.id, media.previewPlaceholder, media.previewPlaceholderFormat]);

  return previewPlaceholderUrl;
}

function useThumbnailFallbackUrl(fileId: number | null): string | null {
  const [fallbackThumbnail, setFallbackThumbnail] = useState<string | null>(null);

  useEffect(() => {
    if (fileId === null) {
      setFallbackThumbnail(null);
      return undefined;
    }

    let revoked = false;
    let objectUrl: string | null = null;
    setFallbackThumbnail(null);

    requestThumbnailBlob(fileId)
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
  }, [fileId]);

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
    <div className={`preview-placeholder ${state} preview-placeholder-image`}>
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
  source
}: {
  alt: string;
  fallbackUrl: string | null;
  fileId: number;
  kind?: string | null;
  onMediaReady?: () => void;
  source: "thumbnail" | "original";
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    setSrc(null);
    setError(false);

    const client = createCoreClient(getCoreClientConfig());
    const request =
      source === "original" ? client.getPreviewBlob(fileId) : requestThumbnailBlob(fileId);
    request
      .then((blob) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!revoked) setError(true);
      });

    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileId, source]);

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
