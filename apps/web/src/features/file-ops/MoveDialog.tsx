import { ChevronDown, ChevronRight, Folder } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FolderRecord } from "@megle/core-client";
import type { LibraryState } from "../../core/useLibraryData";
import { LiquidGlassSurface } from "../../design/liquid-glass";
import { useFocusTrap } from "./useFocusTrap";

export interface MoveDialogProps {
  open: boolean;
  library: LibraryState;
  /** File ids being moved */
  fileIds: number[];
  /** Folder ids being moved */
  folderIds: number[];
  busy?: boolean;
  serverError?: string | null;
  serverErrorCode?: string | null;
  onCancel: () => void;
  onSubmit: (targetFolderId: number) => void;
}

export function MoveDialog({
  open,
  library,
  fileIds,
  folderIds,
  busy = false,
  serverError = null,
  serverErrorCode = null,
  onCancel,
  onSubmit
}: MoveDialogProps) {
  const [target, setTarget] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useFocusTrap(open, dialogRef);

  useEffect(() => {
    if (!open) return;
    setTarget(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (busy) return;
        event.preventDefault();
        onCancel();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onCancel, busy]);

  // Compute the set of folder ids that should be excluded as drop targets
  // (folders being moved themselves and their currently-loaded descendants).
  const excludedFolderIds = useMemo(() => {
    const blocked = new Set<number>(folderIds);
    const queue = [...folderIds];
    while (queue.length > 0) {
      const id = queue.shift();
      if (id === undefined) break;
      const children = library.folderChildrenByParent[id] ?? [];
      for (const child of children) {
        if (!blocked.has(child.id)) {
          blocked.add(child.id);
          queue.push(child.id);
        }
      }
    }
    return blocked;
  }, [folderIds, library.folderChildrenByParent]);

  const itemCount = fileIds.length + folderIds.length;
  const isCrossRoot = serverErrorCode === "cross_root";
  const canSubmit = !busy && target !== null;

  if (!open) return null;

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={() => {
        if (busy) return;
        onCancel();
      }}
    >
      <LiquidGlassSurface
        as="div"
        aria-labelledby="move-dialog-title"
        aria-modal="true"
        className="dialog dialog-wide"
        interactive
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tone="elevated"
      >
        <header className="dialog-header">
          <h2 id="move-dialog-title" className="dialog-title">
            Move {itemCount} item{itemCount === 1 ? "" : "s"}
          </h2>
          <p className="dialog-subtitle">Pick a destination folder</p>
        </header>
        <div className="dialog-body">
          <div className="move-tree" role="tree" aria-label="Destination folder">
            {library.roots.map((root) => (
              <RootBranch
                excludedFolderIds={excludedFolderIds}
                key={root.id}
                library={library}
                root={root}
                selectedTarget={target}
                onSelect={setTarget}
              />
            ))}
            {library.roots.length === 0 ? (
              <div className="empty-panel">No roots available</div>
            ) : null}
          </div>

          {isCrossRoot ? (
            <div className="dialog-error">
              {serverError ?? "Cross-root moves are not supported yet. Pick a destination inside the same root."}
            </div>
          ) : serverError ? (
            <div className="dialog-error">{serverError}</div>
          ) : null}

          <footer className="dialog-actions">
            <button
              className="dialog-button"
              disabled={busy}
              onClick={onCancel}
              type="button"
            >
              Cancel
            </button>
            <button
              className="dialog-button dialog-button-primary"
              disabled={!canSubmit}
              onClick={() => {
                if (target !== null) onSubmit(target);
              }}
              type="button"
            >
              {busy ? "Moving…" : "Move here"}
            </button>
          </footer>
        </div>
      </LiquidGlassSurface>
    </div>
  );
}

function RootBranch({
  library,
  root,
  selectedTarget,
  excludedFolderIds,
  onSelect
}: {
  library: LibraryState;
  root: { id: number; rootFolderId: number | null; displayName: string };
  selectedTarget: number | null;
  excludedFolderIds: Set<number>;
  onSelect: (folderId: number) => void;
}) {
  const folderId = root.rootFolderId;
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (!folderId) return;
    if (!library.folderChildrenByParent[folderId]) {
      // Trigger lazy load by toggling the expansion. The library hook lazy-loads
      // children when toggleFolderExpanded is called.
      // Use the library's own toggle so cursor pages are populated.
      if (!library.expandedFolderIds.has(folderId)) {
        library.toggleFolderExpanded(folderId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId]);

  if (!folderId) {
    return null;
  }
  const isExcluded = excludedFolderIds.has(folderId);
  const selected = selectedTarget === folderId;
  const children = library.folderChildrenByParent[folderId] ?? [];

  return (
    <div className="move-branch">
      <div
        className={`move-row${selected ? " move-row-selected" : ""}${
          isExcluded ? " move-row-disabled" : ""
        }`}
        role="treeitem"
        aria-selected={selected}
      >
        <button
          aria-label={expanded ? "Collapse" : "Expand"}
          className="move-disclosure"
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <button
          className="move-label"
          disabled={isExcluded}
          onClick={() => !isExcluded && onSelect(folderId)}
          type="button"
        >
          <Folder size={14} />
          <span>{root.displayName}</span>
        </button>
      </div>
      {expanded ? (
        <div role="group">
          {children.map((child) => (
            <FolderBranch
              depth={1}
              excludedFolderIds={excludedFolderIds}
              folder={child}
              key={child.id}
              library={library}
              onSelect={onSelect}
              selectedTarget={selectedTarget}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FolderBranch({
  depth,
  folder,
  library,
  selectedTarget,
  excludedFolderIds,
  onSelect
}: {
  depth: number;
  folder: FolderRecord;
  library: LibraryState;
  selectedTarget: number | null;
  excludedFolderIds: Set<number>;
  onSelect: (folderId: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isExcluded = excludedFolderIds.has(folder.id);
  const selected = selectedTarget === folder.id;
  const children = library.folderChildrenByParent[folder.id] ?? [];

  function handleToggle() {
    setExpanded((current) => {
      const next = !current;
      if (next && !library.folderChildrenByParent[folder.id]) {
        library.toggleFolderExpanded(folder.id);
      }
      return next;
    });
  }

  return (
    <div className="move-branch">
      <div
        className={`move-row${selected ? " move-row-selected" : ""}${
          isExcluded ? " move-row-disabled" : ""
        }`}
        role="treeitem"
        aria-selected={selected}
        style={{ "--move-depth": String(depth) } as CSSProperties}
      >
        <button
          aria-label={expanded ? "Collapse" : "Expand"}
          className="move-disclosure"
          onClick={handleToggle}
          type="button"
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <button
          className="move-label"
          disabled={isExcluded}
          onClick={() => !isExcluded && onSelect(folder.id)}
          type="button"
        >
          <Folder size={14} />
          <span>{folder.name}</span>
        </button>
      </div>
      {expanded ? (
        <div role="group">
          {children.map((child) => (
            <FolderBranch
              depth={depth + 1}
              excludedFolderIds={excludedFolderIds}
              folder={child}
              key={child.id}
              library={library}
              onSelect={onSelect}
              selectedTarget={selectedTarget}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
