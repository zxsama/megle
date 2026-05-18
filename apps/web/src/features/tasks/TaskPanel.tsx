import { CheckCircle2, Clock3, ExternalLink, Loader2, X, XCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import type { TaskRecord } from "../../core/types";
import { LiquidGlassButton, LiquidGlassSurface } from "../../design/liquid-glass";
import { useFocusTrap } from "../file-ops/useFocusTrap";

interface TaskPanelProps {
  tasks: TaskRecord[];
  scanActive: boolean;
  open: boolean;
  onClose: () => void;
  onOpenTaskCenter: () => void;
}

export function TaskPanel({
  tasks,
  scanActive,
  open,
  onClose,
  onOpenTaskCenter
}: TaskPanelProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const visibleTasks = tasks.slice(-6).reverse();
  const running = tasks.filter((task) => task.status === "running").length;
  const pending = tasks.filter((task) => task.status === "pending").length;
  const complete = tasks.filter((task) => task.status === "succeeded").length;
  const failed = tasks.filter((task) => task.status === "failed").length;

  useFocusTrap(open, panelRef, { initialFocusRef: closeButtonRef });

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

  if (!open) {
    return null;
  }

  return (
    <>
      <div
        className="task-drawer-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            onClose();
          }
        }}
      />
      <LiquidGlassSurface
        as="aside"
        aria-labelledby="task-drawer-title"
        aria-modal="true"
        className="task-panel task-drawer-panel"
        interactive
        ref={panelRef}
        role="dialog"
        scrollable
        tabIndex={-1}
        tone="elevated"
      >
        <div className="panel-heading task-drawer-heading">
          <div>
            <div className="panel-title" id="task-drawer-title">Tasks</div>
            <div className="panel-subtitle">{scanActive ? "Activity running" : "Idle"}</div>
          </div>
          <div className="task-drawer-actions">
            <LiquidGlassButton
              aria-label="Open full task center"
              className="task-drawer-action"
              onClick={onOpenTaskCenter}
              title="Open full task center"
              tone="control"
              type="button"
            >
              <ExternalLink size={14} />
            </LiquidGlassButton>
            <LiquidGlassButton
              aria-label="Close tasks palette"
              className="task-drawer-action"
              onClick={onClose}
              ref={closeButtonRef}
              title="Close tasks palette"
              tone="control"
              type="button"
            >
              <X size={14} />
            </LiquidGlassButton>
          </div>
        </div>
        <div className={scanActive ? "activity-dot active" : "activity-dot"} aria-hidden="true" />

        <div className="task-counters" aria-label="Task counters">
          <Counter label="Running" value={running} />
          <Counter label="Pending" value={pending} />
          <Counter label="Done" value={complete} />
          <Counter label="Failed" value={failed} />
        </div>

        <div className="task-list">
          {visibleTasks.length > 0 ? (
            visibleTasks.map((task) => <TaskRow key={task.id} task={task} />)
          ) : (
            <div className="empty-panel">No tasks</div>
          )}
        </div>
      </LiquidGlassSurface>
    </>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="counter">
      <span>{value}</span>
      <small>{label}</small>
    </div>
  );
}

function TaskRow({ task }: { task: TaskRecord }) {
  const Icon =
    task.status === "running"
      ? Loader2
      : task.status === "pending"
        ? Clock3
        : task.status === "failed"
          ? XCircle
          : CheckCircle2;

  return (
    <div className="task-row">
      <Icon className={task.status === "running" ? "spin" : undefined} size={16} />
      <div className="task-copy">
        <span>{task.kind.replaceAll("_", " ")}</span>
        <small>
          {task.itemsSeen} entries / {task.foldersSeen} folders / {task.mediaFilesSeen} media
        </small>
        {task.error ? <small className="task-error">{task.error}</small> : null}
      </div>
    </div>
  );
}
