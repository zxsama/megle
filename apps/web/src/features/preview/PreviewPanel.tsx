import { Maximize2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { MediaRecord, ThumbnailResponse } from "@megle/core-client";
import { createCoreClient } from "@megle/core-client";
import { getCoreClientConfig } from "../../core/client";
import { LiquidGlassButton, LiquidGlassSurface } from "../../design/liquid-glass";
import { useFocusTrap } from "../file-ops/useFocusTrap";

interface PreviewPanelProps {
  selectedMedia: MediaRecord | null;
  thumbnail?: ThumbnailResponse;
  onOpenPreview?: () => void;
  children?: ReactNode;
}

export function PreviewPanel({
  selectedMedia,
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

export function PreviewDialog({
  media,
  thumbnail,
  open,
  onClose
}: {
  media: MediaRecord | null;
  thumbnail?: ThumbnailResponse;
  open: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useFocusTrap(open, dialogRef, { initialFocusRef: closeButtonRef });

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose, open]);

  if (!open || !media) {
    return null;
  }

  return (
    <div
      className="preview-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <LiquidGlassSurface
        as="section"
        aria-labelledby="preview-dialog-title"
        aria-modal="true"
        className="preview-dialog-panel"
        interactive
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        tone="elevated"
      >
        <header className="preview-dialog-header">
          <div className="preview-dialog-title-block">
            <h2 className="preview-dialog-title" id="preview-dialog-title">
              {media.name}
            </h2>
            <p className="preview-dialog-subtitle">
              {media.kind ?? "file"} - {formatBytes(media.size)} - {formatDimensions(media)}
            </p>
          </div>
          <LiquidGlassButton
            aria-label="Close preview"
            className="preview-dialog-close"
            onClick={onClose}
            ref={closeButtonRef}
            title="Close preview"
            tone="control"
            type="button"
          >
            <X size={16} />
          </LiquidGlassButton>
        </header>

        <div className="preview-dialog-body">
          <div className="preview-dialog-stage" aria-label={`Preview image for ${media.name}`}>
            <ThumbnailPreview media={media} thumbnail={thumbnail} />
          </div>
          <aside className="preview-dialog-details" aria-label="Preview details">
            <dl className="metadata-list preview-dialog-metadata">
              <dt>Name</dt>
              <dd>{media.name}</dd>
              <dt>Kind</dt>
              <dd>{media.kind ?? "unknown"}</dd>
              <dt>Size</dt>
              <dd>{formatBytes(media.size)}</dd>
              <dt>Dimensions</dt>
              <dd>{formatDimensions(media)}</dd>
              <dt>Thumbnail</dt>
              <dd>{thumbnail?.state ?? media.thumbnailState ?? "pending"}</dd>
            </dl>
          </aside>
        </div>
      </LiquidGlassSurface>
    </div>
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
