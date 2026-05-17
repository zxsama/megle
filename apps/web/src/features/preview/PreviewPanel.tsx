import { useEffect, useState, type ReactNode } from "react";
import type { MediaRecord, ThumbnailResponse } from "@megle/core-client";
import { createCoreClient } from "@megle/core-client";
import { getCoreClientConfig } from "../../core/client";
import { LiquidGlassSurface } from "../../design/liquid-glass";

interface PreviewPanelProps {
  selectedMedia: MediaRecord | null;
  thumbnail?: ThumbnailResponse;
  children?: ReactNode;
}

export function PreviewPanel({ selectedMedia, thumbnail, children }: PreviewPanelProps) {
  return (
    <LiquidGlassSurface
      as="section"
      className="inspector-panel preview-panel"
      aria-label="Preview"
      interactive
      tone="panel"
    >
      <div className="panel-title">Preview</div>
      {selectedMedia ? (
        <>
          <div className="preview-stage">
            <ThumbnailPreview media={selectedMedia} thumbnail={thumbnail} />
          </div>
          <dl className="metadata-list">
            <dt>Name</dt>
            <dd>{selectedMedia.name}</dd>
            <dt>Kind</dt>
            <dd>{selectedMedia.kind ?? "unknown"}</dd>
            <dt>Size</dt>
            <dd>{formatBytes(selectedMedia.size)}</dd>
            <dt>Dimensions</dt>
            <dd>{formatDimensions(selectedMedia)}</dd>
            <dt>Thumbnail</dt>
            <dd>{thumbnail?.state ?? selectedMedia.thumbnailState ?? "pending"}</dd>
          </dl>
          {children}
        </>
      ) : (
        <div className="empty-panel">No selection</div>
      )}
    </LiquidGlassSurface>
  );
}

function ThumbnailPreview({
  media,
  thumbnail
}: {
  media: MediaRecord;
  thumbnail?: ThumbnailResponse;
}) {
  if (thumbnail?.state === "ready") {
    return <ReadyPreviewImage fileId={media.id} alt={media.name} />;
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

function ReadyPreviewImage({ fileId, alt }: { fileId: number; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    setSrc(null);
    setError(false);

    const client = createCoreClient(getCoreClientConfig());
    client
      .getThumbnailBlob(fileId)
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
  }, [fileId]);

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

  return (
    <div className="preview-placeholder ready">
      <img alt={alt} className="preview-image" src={src} />
    </div>
  );
}

function formatDimensions(media: MediaRecord): string {
  if (media.width && media.height) {
    return `${media.width} x ${media.height}`;
  }
  return "unknown";
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
