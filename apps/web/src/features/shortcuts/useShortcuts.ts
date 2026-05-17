import { useEffect } from "react";
import type { LibraryState } from "../../core/useLibraryData";
import type { FileOpsController } from "../file-ops/useFileOps";

export interface UseShortcutsOptions {
  library: LibraryState;
  fileOps: FileOpsController;
}

/**
 * Wires global keyboard shortcuts. Suppresses when an editable element has
 * focus so the user can type freely in inputs, textareas, and rich-text
 * surfaces without triggering destructive actions.
 *
 *   F2            rename selected file
 *   Delete        recycle-bin delete on selection
 *   Shift+Delete  permanent delete (with confirmation)
 *   Ctrl+F        focus the library search input
 *   Esc           close any open file-ops dialog, else clear selection
 */
export function useShortcuts({ library, fileOps }: UseShortcutsOptions): void {
  useEffect(() => {
    function handler(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) {
        // Esc still useful inside inputs to clear selection / close dialogs.
        if (event.key !== "Escape") {
          return;
        }
      }

      const dialogOpen =
        fileOps.rename.target !== null ||
        fileOps.move.target !== null ||
        fileOps.remove.target !== null;

      if (event.key === "Escape") {
        if (dialogOpen) {
          // Existing dialogs handle their own Esc; bail so we don't double-close.
          return;
        }
        if (library.selectedMediaId !== null) {
          event.preventDefault();
          library.setSelectedMediaId(null);
        }
        return;
      }

      // Modal dialogs already trap interaction; suppress global shortcuts.
      if (dialogOpen) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && (event.key === "f" || event.key === "F")) {
        const search = document.querySelector<HTMLInputElement>(
          '[aria-label="Search library"]'
        );
        if (search) {
          event.preventDefault();
          search.focus();
          search.select();
        }
        return;
      }

      const selected = library.selectedMedia;

      if (event.key === "F2") {
        if (selected) {
          event.preventDefault();
          fileOps.openRename({ kind: "file", file: selected });
        }
        return;
      }

      if (event.key === "Delete") {
        if (selected) {
          event.preventDefault();
          fileOps.openDelete({ kind: "file", file: selected }, event.shiftKey);
        }
        return;
      }
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [fileOps, library]);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  return false;
}
