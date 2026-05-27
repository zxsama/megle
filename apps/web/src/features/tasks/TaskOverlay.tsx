import { useEffect, useRef, type ReactNode } from "react";
import { LiquidGlassSurface } from "../../design/liquid-glass";
import { useFocusTrap } from "../file-ops/useFocusTrap";

interface TaskOverlayProps {
  mode: "compact" | "center";
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function TaskOverlay({ mode, open, onClose, children }: TaskOverlayProps) {
  const surfaceRef = useRef<HTMLElement | null>(null);
  const modalOpen = open && mode === "center";

  useFocusTrap(modalOpen, surfaceRef);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <>
      {mode === "center" ? (
        <div
          className="task-overlay-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              onClose();
            }
          }}
        />
      ) : null}
      <LiquidGlassSurface
        as="aside"
        aria-labelledby={mode === "center" ? "task-center-title" : "task-drawer-title"}
        aria-modal={mode === "center" ? "true" : undefined}
        className={
          mode === "center"
            ? "task-center-overlay task-overlay-window popup-surface"
            : "floating-popover task-panel task-drawer-panel task-overlay-window popup-surface"
        }
        data-compact-popover={mode === "compact" ? "tasks" : undefined}
        data-compact-popover-root={mode === "compact" ? "tasks" : undefined}
        interactive
        ref={surfaceRef}
        role={mode === "center" ? "dialog" : "complementary"}
        tabIndex={mode === "center" ? -1 : undefined}
        tone={mode === "center" ? "elevated" : "panel"}
      >
        {children}
      </LiquidGlassSurface>
    </>
  );
}
