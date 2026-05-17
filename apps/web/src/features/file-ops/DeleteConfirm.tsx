import { useEffect, useRef, useState } from "react";
import { LiquidGlassButton, LiquidGlassSurface } from "../../design/liquid-glass";
import { useFocusTrap } from "./useFocusTrap";

export interface DeleteConfirmProps {
  open: boolean;
  /** True when permanent (skip recycle bin). */
  permanent: boolean;
  fileCount: number;
  folderCount: number;
  busy?: boolean;
  serverError?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteConfirm({
  open,
  permanent,
  fileCount,
  folderCount,
  busy = false,
  serverError = null,
  onCancel,
  onConfirm
}: DeleteConfirmProps) {
  const total = fileCount + folderCount;
  const [confirmText, setConfirmText] = useState("");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const confirmInputRef = useRef<HTMLInputElement | null>(null);

  useFocusTrap(open, dialogRef, {
    initialFocusRef: permanent ? confirmInputRef : undefined
  });

  useEffect(() => {
    if (!open) return;
    setConfirmText("");
  }, [open, permanent]);

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

  if (!open) return null;

  const expected = String(total);
  const matches = confirmText.trim() === expected;
  const canConfirm = !busy && total > 0 && (!permanent || matches);

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
        aria-labelledby="delete-dialog-title"
        aria-modal="true"
        className="dialog"
        interactive
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tone="elevated"
      >
        <header className="dialog-header">
          <h2 className="dialog-title" id="delete-dialog-title">
            {permanent ? "Delete permanently" : "Move to recycle bin"}
          </h2>
          <p className="dialog-subtitle">
            {summarize(fileCount, folderCount)}
            {permanent ? " — this cannot be undone." : ""}
          </p>
        </header>
        <div className="dialog-body">
          {permanent ? (
            <>
              <p className="dialog-text">
                This permanently removes the selected items from disk. To confirm, type{" "}
                <code className="dialog-code">{expected}</code> below.
              </p>
              <label className="dialog-field">
                <span className="dialog-field-label">Type item count to confirm</span>
                <input
                  autoComplete="off"
                  className="dialog-input"
                  disabled={busy}
                  onChange={(event) => setConfirmText(event.target.value)}
                  ref={confirmInputRef}
                  type="text"
                  value={confirmText}
                />
              </label>
            </>
          ) : (
            <p className="dialog-text">
              The selected items will be moved to the Windows recycle bin. You can restore them from
              there.
            </p>
          )}

          {serverError ? <div className="dialog-error">{serverError}</div> : null}

          <footer className="dialog-actions">
            <button
              className="dialog-button"
              disabled={busy}
              onClick={onCancel}
              type="button"
            >
              Cancel
            </button>
            <LiquidGlassButton
              className={`dialog-button ${
                permanent ? "dialog-button-danger" : "dialog-button-primary"
              }`}
              disabled={!canConfirm}
              onClick={onConfirm}
              tone={permanent ? "danger" : "primary"}
              type="button"
            >
              {busy
                ? permanent
                  ? "Deleting…"
                  : "Recycling…"
                : permanent
                  ? "Delete permanently"
                  : "Move to recycle bin"}
            </LiquidGlassButton>
          </footer>
        </div>
      </LiquidGlassSurface>
    </div>
  );
}

function summarize(fileCount: number, folderCount: number): string {
  const parts: string[] = [];
  if (fileCount > 0) parts.push(`${fileCount} file${fileCount === 1 ? "" : "s"}`);
  if (folderCount > 0) parts.push(`${folderCount} folder${folderCount === 1 ? "" : "s"}`);
  return parts.length > 0 ? parts.join(" and ") : "No items";
}
