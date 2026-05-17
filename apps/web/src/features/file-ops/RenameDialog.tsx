import { useEffect, useMemo, useRef, useState } from "react";

export interface RenameDialogProps {
  open: boolean;
  kind: "file" | "folder";
  currentName: string;
  busy?: boolean;
  serverError?: string | null;
  onCancel: () => void;
  onSubmit: (newName: string) => void;
}

const RESERVED_WIN_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`)
]);

function validate(name: string): string | null {
  if (name.length === 0) return "Name cannot be empty";
  if (name.length > 255) return "Name must be 255 characters or fewer";
  if (name === "." || name === "..") return "Name cannot be . or ..";
  if (name.includes("..")) return "Name cannot contain '..'";
  if (/[\\/]/.test(name)) return "Name cannot contain '/' or '\\\\'";
  // Strip extension before checking Windows reserved names
  const stem = name.includes(".") ? name.slice(0, name.indexOf(".")) : name;
  if (RESERVED_WIN_NAMES.has(stem.toUpperCase())) {
    return `'${stem}' is reserved on Windows`;
  }
  return null;
}

export function RenameDialog({
  open,
  kind,
  currentName,
  busy = false,
  serverError = null,
  onCancel,
  onSubmit
}: RenameDialogProps) {
  const [value, setValue] = useState(currentName);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setValue(currentName);
  }, [currentName, open]);

  useEffect(() => {
    if (!open) return;
    const node = inputRef.current;
    if (!node) return;
    node.focus();
    // Select stem (without extension) for files; whole name for folders
    if (kind === "file") {
      const dot = currentName.lastIndexOf(".");
      if (dot > 0) {
        node.setSelectionRange(0, dot);
      } else {
        node.select();
      }
    } else {
      node.select();
    }
  }, [open, currentName, kind]);

  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onCancel]);

  const validationError = useMemo(() => validate(value.trim()), [value]);
  const trimmed = value.trim();
  const unchanged = trimmed === currentName;
  const canSubmit = !busy && !validationError && !unchanged;
  const displayedError = validationError ?? serverError;

  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onCancel}>
      <div
        aria-labelledby="rename-dialog-title"
        aria-modal="true"
        className="dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="dialog-header">
          <h2 id="rename-dialog-title" className="dialog-title">
            Rename {kind}
          </h2>
        </header>
        <form
          className="dialog-body"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            onSubmit(trimmed);
          }}
        >
          <label className="dialog-field">
            <span className="dialog-field-label">New name</span>
            <input
              autoComplete="off"
              className="dialog-input"
              disabled={busy}
              onChange={(event) => setValue(event.target.value)}
              ref={inputRef}
              type="text"
              value={value}
            />
          </label>
          {displayedError ? <div className="dialog-error">{displayedError}</div> : null}
          <footer className="dialog-actions">
            <button
              className="dialog-button"
              disabled={busy}
              onClick={onCancel}
              type="button"
            >
              Cancel
            </button>
            <button className="dialog-button dialog-button-primary" disabled={!canSubmit} type="submit">
              {busy ? "Renaming…" : "Rename"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
