import { Maximize2 } from "lucide-react";
import { type CSSProperties, type ReactNode } from "react";
import type { MediaRecord, ThumbnailResponse } from "@megle/core-client";
import { LiquidGlassButton, LiquidGlassSurface } from "../../design/liquid-glass";
import { MediaPreview } from "./MediaPreview";

interface PreviewPanelProps {
  selectedMedia: MediaRecord | null;
  thumbnail?: ThumbnailResponse;
  onOpenPreview?: () => void;
  showPreviewImage?: boolean;
  children?: ReactNode;
}

export function PreviewPanel({
  selectedMedia,
  showPreviewImage = true,
  thumbnail,
  onOpenPreview,
  children
}: PreviewPanelProps) {
  return (
    <LiquidGlassSurface
      as="section"
      className="inspector-panel preview-panel"
      aria-label="Preview"
      interactive
      scrollable
      tone="panel"
    >
      <div className="preview-panel-heading">
        <div className="panel-title">Preview</div>
        <LiquidGlassButton
          aria-label="Open selected media preview"
          className="preview-panel-open"
          disabled={!selectedMedia || !onOpenPreview}
          onClick={onOpenPreview}
          title="Open preview"
          tone="control"
          type="button"
        >
          <Maximize2 size={14} />
        </LiquidGlassButton>
      </div>
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
    </LiquidGlassSurface>
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
