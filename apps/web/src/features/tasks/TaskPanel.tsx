import { CheckCircle2, Clock3, Loader2, XCircle } from "lucide-react";
import type { TaskRecord } from "../../core/types";

interface TaskPanelProps {
  tasks: TaskRecord[];
  scanActive: boolean;
}

export function TaskPanel({ tasks, scanActive }: TaskPanelProps) {
  const visibleTasks = tasks.slice(-6).reverse();
  const running = tasks.filter((task) => task.status === "running").length;
  const pending = tasks.filter((task) => task.status === "pending").length;
  const complete = tasks.filter((task) => task.status === "succeeded").length;
  const failed = tasks.filter((task) => task.status === "failed").length;

  return (
    <aside className="task-panel" aria-label="Tasks">
      <div className="panel-heading">
        <div>
          <div className="panel-title">Tasks</div>
          <div className="panel-subtitle">{scanActive ? "Activity running" : "Idle"}</div>
        </div>
        <div className={scanActive ? "activity-dot active" : "activity-dot"} aria-hidden="true" />
      </div>

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
    </aside>
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
