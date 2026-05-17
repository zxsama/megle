import { useEffect } from "react";
import type { RefObject } from "react";

const TABBABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function isVisible(element: HTMLElement): boolean {
  if (element.hidden) return false;
  if (element.getAttribute("aria-hidden") === "true") return false;
  // offsetParent is null for elements with display:none (and for fixed-position
  // elements without an offset parent — that's fine for our dialogs because
  // the dialog itself uses non-fixed flow and its descendants are visible).
  if (element.offsetParent === null && getComputedStyle(element).position !== "fixed") {
    return false;
  }
  return true;
}

function getTabbable(container: HTMLElement): HTMLElement[] {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR));
  return nodes.filter((node) => {
    if (node.hasAttribute("disabled")) return false;
    if (node.getAttribute("aria-hidden") === "true") return false;
    if (!isVisible(node)) return false;
    return true;
  });
}

export interface UseFocusTrapOptions {
  /**
   * Element that should receive focus on open. If omitted, focuses the
   * container itself (which must therefore be tabbable, e.g. tabIndex={-1}
   * or the first tabbable descendant).
   */
  initialFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * Trap focus inside a dialog while open and restore it to the previously
 * focused element on close. Tab and Shift+Tab cycle through the tabbable
 * descendants of `containerRef`.
 */
export function useFocusTrap(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
  options: UseFocusTrapOptions = {}
): void {
  const { initialFocusRef } = options;

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;

    const previousFocus = document.activeElement as HTMLElement | null;

    // Move focus into the dialog. Prefer the explicit initial-focus element,
    // otherwise the first tabbable descendant, otherwise the container itself.
    const initial = initialFocusRef?.current ?? null;
    if (initial) {
      initial.focus();
    } else {
      const tabbables = getTabbable(container);
      if (tabbables.length > 0) {
        tabbables[0].focus();
      } else {
        container.focus();
      }
    }

    function handleKey(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const node = containerRef.current;
      if (!node) return;
      const tabbables = getTabbable(node);
      if (tabbables.length === 0) {
        event.preventDefault();
        node.focus();
        return;
      }
      const first = tabbables[0];
      const last = tabbables[tabbables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (active === first || !node.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !node.contains(active)) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKey, true);
    return () => {
      document.removeEventListener("keydown", handleKey, true);
      // Restore focus to the previously-focused element if it's still attached
      // to the document.
      if (previousFocus && document.contains(previousFocus)) {
        previousFocus.focus();
      }
    };
  }, [open, containerRef, initialFocusRef]);
}
