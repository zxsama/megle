import { useEffect, useState } from "react";
import type { MediaRecord, ThumbnailResponse } from "@megle/core-client";
import { createCoreClient } from "@megle/core-client";
import { getCoreClientConfig } from "../../core/client";

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
  if (source === "original") {
    return (
      <ReadyPreviewMedia
        alt={media.name}
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
    return (
      <div className="preview-placeholder skipped">
        <span>{media.kind ?? "file"}</span>
      </div>
    );
  }

  return (
    <div className="preview-placeholder pending">
      <span>{thumbnail?.state ?? media.thumbnailState ?? "pending"}</span>
    </div>
  );
}

function ReadyPreviewMedia({
  alt,
  fileId,
  kind,
  onMediaReady,
  source
}: {
  alt: string;
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
      source === "original" ? client.getPreviewBlob(fileId) : client.getThumbnailBlob(fileId);
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
