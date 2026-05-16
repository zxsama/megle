import type { MediaRecord, ThumbnailResponse } from "@megle/core-client";

interface PreviewPanelProps {
  selectedMedia: MediaRecord | null;
  thumbnail?: ThumbnailResponse;
}

export function PreviewPanel({ selectedMedia, thumbnail }: PreviewPanelProps) {
  return (
    <section className="inspector-panel preview-panel" aria-label="Preview">
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
        </>
      ) : (
        <div className="empty-panel">No selection</div>
      )}
    </section>
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
    return (
      <div className="preview-placeholder ready">
        <span>{thumbnail.asset ? `${thumbnail.asset.width} x ${thumbnail.asset.height}` : "ready"}</span>
      </div>
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
