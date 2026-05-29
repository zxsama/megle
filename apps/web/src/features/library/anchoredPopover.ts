import type { CSSProperties, RefObject } from "react";
import { useLayoutEffect, useState } from "react";

const POPOVER_VIEWPORT_GUTTER_PX = 12;

interface AnchoredPopoverOptions {
  align?: "start" | "end";
  minWidth?: number;
  offsetY?: number;
  preferredWidth?: number;
}

export function useAnchoredPopoverStyle<TElement extends HTMLElement>(
  open: boolean,
  triggerRef: RefObject<TElement | null>,
  options: AnchoredPopoverOptions = {}
) {
  const [style, setStyle] = useState<CSSProperties>();

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    function updatePopoverStyle() {
      const triggerRect = triggerRef.current?.getBoundingClientRect();
      if (!triggerRect) {
        return;
      }
      setStyle(resolveAnchoredPopoverStyle(triggerRect, options));
    }

    updatePopoverStyle();
    const rafId = window.requestAnimationFrame(updatePopoverStyle);
    window.addEventListener("resize", updatePopoverStyle);
    window.addEventListener("scroll", updatePopoverStyle, true);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", updatePopoverStyle);
      window.removeEventListener("scroll", updatePopoverStyle, true);
    };
  }, [open, options.align, options.minWidth, options.offsetY, options.preferredWidth, triggerRef]);

  return style;
}

function resolveAnchoredPopoverStyle(
  triggerRect: DOMRect,
  {
    align = "start",
    minWidth = Math.round(triggerRect.width),
    offsetY = 4,
    preferredWidth
  }: AnchoredPopoverOptions
): CSSProperties {
  const width = preferredWidth
    ? Math.min(preferredWidth, window.innerWidth - POPOVER_VIEWPORT_GUTTER_PX * 2)
    : Math.max(minWidth, Math.round(triggerRect.width));
  const maxLeft = Math.max(
    POPOVER_VIEWPORT_GUTTER_PX,
    window.innerWidth - width - POPOVER_VIEWPORT_GUTTER_PX
  );
  const rawLeft =
    align === "end" ? Math.round(triggerRect.right - width) : Math.round(triggerRect.left);

  return {
    left: Math.min(Math.max(POPOVER_VIEWPORT_GUTTER_PX, rawLeft), maxLeft),
    minWidth,
    position: "fixed",
    top: Math.round(triggerRect.bottom + offsetY),
    width
  };
}
