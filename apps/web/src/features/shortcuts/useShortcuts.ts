import { useEffect } from "react";
import type { MediaRecord } from "@megle/core-client";
import type { LibraryState } from "../../core/useLibraryData";
import type { FileOpsController } from "../file-ops/useFileOps";
import {
  matchShortcut,
  useShortcutBindings
} from "./shortcutBindings";

export interface UseShortcutsOptions {
  library: LibraryState;
  fileOps: FileOpsController;
  previewOpen: boolean;
  onClosePreview: () => void;
  onToggleSidebars: () => void;
}

/**
 * Wires global keyboard shortcuts. Suppresses when an editable element has
 * focus so the user can type freely in inputs, textareas, and rich-text
 * surfaces without triggering destructive actions.
 *
 * Defaults preserve the original bindings while allowing users to edit them
 * locally from Settings.
 */
export function useShortcuts({
  fileOps,
  library,
  onClosePreview,
  onToggleSidebars,
  previewOpen
}: UseShortcutsOptions): void {
  const { bindings } = useShortcutBindings();

  useEffect(() => {
    function handler(event: KeyboardEvent) {
      if (isShortcutCaptureTarget(event.target)) {
        return;
      }

      if (isEditableTarget(event.target)) {
        // Esc still useful inside inputs to clear selection / close dialogs.
        if (!matchShortcut(event, bindings, "closeOrReturn")) {
          return;
        }
      }

      const dialogOpen =
        fileOps.rename.target !== null ||
        fileOps.move.target !== null ||
        fileOps.remove.target !== null;

      if (matchShortcut(event, bindings, "closeOrReturn")) {
        if (dialogOpen) {
          // Existing dialogs handle their own Esc; bail so we don't double-close.
          return;
        }
        if (previewOpen) {
          event.preventDefault();
          onClosePreview();
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

      if (matchShortcut(event, bindings, "toggleSidebars")) {
        event.preventDefault();
        onToggleSidebars();
        return;
      }

      if (matchShortcut(event, bindings, "focusSearch")) {
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

      if (matchShortcut(event, bindings, "previewPrevious")) {
        if (previewOpen) {
          event.preventDefault();
          selectPreviewNeighbor(library, -1);
        }
        return;
      }

      if (matchShortcut(event, bindings, "previewNext")) {
        if (previewOpen) {
          event.preventDefault();
          selectPreviewNeighbor(library, 1);
        }
        return;
      }

      if (matchShortcut(event, bindings, "zoomIn")) {
        if (previewOpen) {
          event.preventDefault();
          window.dispatchEvent(new CustomEvent("megle:preview-zoom", { detail: { direction: "in" } }));
        }
        return;
      }

      if (matchShortcut(event, bindings, "zoomOut")) {
        if (previewOpen) {
          event.preventDefault();
          window.dispatchEvent(new CustomEvent("megle:preview-zoom", { detail: { direction: "out" } }));
        }
        return;
      }

      if (matchShortcut(event, bindings, "renameSelected")) {
        if (selected) {
          event.preventDefault();
          fileOps.openRename({ kind: "file", file: selected });
        }
        return;
      }

      if (matchShortcut(event, bindings, "permanentDelete")) {
        if (selected) {
          event.preventDefault();
          fileOps.openDelete({ kind: "file", file: selected }, true);
        }
        return;
      }

      if (matchShortcut(event, bindings, "recycleDelete")) {
        if (selected) {
          event.preventDefault();
          fileOps.openDelete({ kind: "file", file: selected }, false);
        }
        return;
      }
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [bindings, fileOps, library, onClosePreview, onToggleSidebars, previewOpen]);
}

function selectPreviewNeighbor(library: LibraryState, offset: -1 | 1): void {
  const orderedMedia = orderedMediaSlots(library.mediaSlots);
  const previewMedia = orderedMedia.length > 0 ? orderedMedia : library.media;
  const currentIndex = previewMedia.findIndex((item) => item.id === library.selectedMediaId);
  if (currentIndex === -1) return;
  const nextIndex = Math.min(previewMedia.length - 1, Math.max(0, currentIndex + offset));
  const next = previewMedia[nextIndex];
  if (next) {
    library.setSelectedMediaId(next.id);
  }
}

function orderedMediaSlots(mediaSlots: Map<number, MediaRecord>): MediaRecord[] {
  return Array.from(mediaSlots.entries())
    .sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
    .map(([, item]) => item);
}

function isShortcutCaptureTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(target.closest("[data-shortcut-capture='true']"));
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
