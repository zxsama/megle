import { Check, ChevronDown, ChevronUp, Folder } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FolderRecord, MediaRecord } from "@megle/core-client";
import {
  mediaContentSignature,
  readCachedThumbnailObjectUrl,
  rememberThumbnailObjectUrl,
  requestOriginalPreviewBlob,
  requestThumbnailBlob,
  thumbnailObjectUrlCacheKey
} from "../../core/mediaResources";

interface SubfolderStripProps {
  collapsed: boolean;
  folderCount: number;
  loading: boolean;
  showChildContents: boolean;
  onToggleCollapsed: () => void;
  onToggleShowChildContents: () => void;
}

interface SubfolderCardProps {
  coverMedia: MediaRecord[];
  folder: FolderRecord;
  selected: boolean;
  onFolderContextMenu?: (event: {
    folder: FolderRecord;
    x: number;
    y: number;
    shiftKey: boolean;
  }) => void;
  onSelectFolder: (folder: FolderRecord) => void;
}

export function SubfolderStrip({
  collapsed,
  folderCount,
  loading,
  showChildContents,
  onToggleCollapsed,
  onToggleShowChildContents
}: SubfolderStripProps) {
  const title = useMemo(() => {
    if (loading && folderCount === 0) {
      return "子文件夹";
    }
    return `子文件夹 (${folderCount})`;
  }, [folderCount, loading]);

  return (
    <section
      className={`subfolder-strip${collapsed ? " is-collapsed" : ""}`}
      aria-label="Child folders"
    >
      <header className="subfolder-strip-header">
        <button
          aria-label={collapsed ? "Expand child folders" : "Collapse child folders"}
          className="subfolder-strip-header-button subfolder-strip-heading-button"
          onClick={onToggleCollapsed}
          title={collapsed ? "Expand child folders" : "Collapse child folders"}
          type="button"
        >
          <span className="subfolder-strip-heading-icon" aria-hidden="true">
            {collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
          </span>
          <span className="subfolder-strip-title">{title}</span>
        </button>

        <label className="subfolder-strip-header-button library-browser-content-toggle">
          <input
            checked={showChildContents}
            onChange={() => onToggleShowChildContents()}
            type="checkbox"
          />
          <span className="library-browser-content-toggle-indicator" aria-hidden="true">
            <Check size={12} />
          </span>
          <span className="library-browser-content-toggle-label">显示子文件夹内容</span>
        </label>
      </header>
    </section>
  );
}

export function SubfolderCard({
  coverMedia,
  folder,
  onFolderContextMenu,
  onSelectFolder,
  selected
}: SubfolderCardProps) {
  return (
    <button
      aria-pressed={selected}
      className={selected ? "subfolder-card selected" : "subfolder-card"}
      data-cover-count={coverMedia.length}
      onClick={() => onSelectFolder(folder)}
      onContextMenu={(event) => {
        if (!onFolderContextMenu) return;
        event.preventDefault();
        onFolderContextMenu({
          folder,
          x: event.clientX,
          y: event.clientY,
          shiftKey: event.shiftKey
        });
      }}
      type="button"
    >
      <span className="subfolder-card-cover" aria-hidden="true">
        <FolderCoverPreview coverMedia={coverMedia} />
      </span>
      <span className="subfolder-card-copy">
        <span className="subfolder-card-name" title={folder.name}>
          {folder.name}
        </span>
      </span>
    </button>
  );
}

function FolderCoverPreview({ coverMedia }: { coverMedia: MediaRecord[] }) {
  const coverMediaItem = coverMedia[0] ?? null;
  const cacheKey = coverMediaItem
    ? thumbnailObjectUrlCacheKey(
        coverMediaItem.id,
        `folder-cover:${mediaContentSignature(coverMediaItem)}`,
        null
      )
    : null;
  const [src, setSrc] = useState<string | null>(() =>
    cacheKey ? readCachedThumbnailObjectUrl(cacheKey) : null
  );
  const [failed, setFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const objectUrlRef = useRef<string | null>(src);

  useEffect(() => {
    if (!coverMediaItem || !cacheKey) {
      setSrc(null);
      setFailed(false);
      objectUrlRef.current = null;
      return undefined;
    }

    const cachedObjectUrl = readCachedThumbnailObjectUrl(cacheKey);
    if (cachedObjectUrl) {
      objectUrlRef.current = cachedObjectUrl;
      setSrc(cachedObjectUrl);
      setFailed(false);
      return undefined;
    }

    let revoked = false;
    let objectUrl: string | null = null;
    setFailed(false);

    requestThumbnailBlob(coverMediaItem.id, null)
      .catch(() => requestOriginalPreviewBlob(coverMediaItem))
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (revoked) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        objectUrlRef.current = objectUrl;
        rememberThumbnailObjectUrl(cacheKey, objectUrl);
        setSrc(objectUrl);
        setFailed(false);
      })
      .catch(() => {
        if (objectUrl && objectUrlRef.current !== objectUrl) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
        }
        if (!revoked) {
          setFailed(true);
          window.setTimeout(() => {
            setRetryTick((value) => value + 1);
          }, 1000);
        }
      });

    return () => {
      revoked = true;
      if (objectUrl && objectUrlRef.current !== objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [cacheKey, coverMediaItem, retryTick]);

  if (!src || failed) {
    return (
      <span
        className="subfolder-card-cover-fallback"
        data-cover-status={failed ? "failed" : coverMediaItem ? "loading" : "empty"}
      >
        <Folder size={22} />
      </span>
    );
  }

  return (
    <span className="subfolder-card-cover-image-frame" data-cover-status="ready">
      <img alt="" className="subfolder-card-cover-image" loading="lazy" src={src} />
    </span>
  );
}
