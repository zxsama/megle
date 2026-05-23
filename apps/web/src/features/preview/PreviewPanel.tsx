import { type CSSProperties, type ReactNode } from "react";
import type { MediaRecord, ThumbnailResponse } from "@megle/core-client";
import { MediaPreview } from "./MediaPreview";

interface PreviewPanelProps {
  selectedMedia: MediaRecord | null;
  thumbnail?: ThumbnailResponse;
  showPreviewImage?: boolean;
  children?: ReactNode;
}

export function PreviewPanel({
  selectedMedia,
  showPreviewImage = true,
  thumbnail,
  children
}: PreviewPanelProps) {
  return (
    <aside
      className="inspector-panel preview-panel"
      aria-label="Preview"
    >
      {selectedMedia ? (
        <>
          {showPreviewImage ? (
            <div className="preview-stage" style={previewStageStyle(selectedMedia)}>
              <MediaPreview
                media={selectedMedia}
                onMediaReady={undefined}
                source="original"
                thumbnail={thumbnail}
              />
            </div>
          ) : null}
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
    </aside>
  );
}

function previewStageStyle(media: MediaRecord): CSSProperties | undefined {
  if (!media.width || !media.height || media.width <= 0 || media.height <= 0) {
    return undefined;
  }
  return { aspectRatio: `${media.width} / ${media.height}` };
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
