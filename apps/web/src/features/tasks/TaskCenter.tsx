import { useMemo, useState } from "react";
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCw,
  RotateCcw,
  X
} from "lucide-react";
import type { TaskRecord, TaskStatus } from "@megle/core-client";
import { LiquidGlassSurface } from "../../design/liquid-glass";

interface TaskCenterProps {
  tasks: TaskRecord[];
  busyTaskIds: Set<number>;
  scanActive: boolean;
  onCancel: (taskId: number) => void;
  onRetry: (taskId: number) => void;
  onRefresh: () => void;
}

type StatusFilter = "all" | TaskStatus;

const STATUS_ORDER: TaskStatus[] = [
  "running",
  "pending",
  "failed",
  "cancelled",
  "succeeded"
];

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "Pending",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled"
};

const KIND_LABEL: Record<string, string> = {
  root_scan: "Root scan",
  thumbnail: "Thumbnail"
};

export function TaskCenter({
  tasks,
  busyTaskIds,
  scanActive,
  onCancel,
  onRetry,
  onRefresh
}: TaskCenterProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const counts = useMemo(() => buildCounts(tasks), [tasks]);

  const sortedTasks = useMemo(() => {
    return tasks.slice().sort(compareTasks);
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    if (statusFilter === "all") {
      return sortedTasks;
    }
    return sortedTasks.filter((task) => task.status === statusFilter);
  }, [sortedTasks, statusFilter]);

  return (
    <section className="workspace simple-workspace" aria-label="Task workbench">
      <LiquidGlassSurface
        as="header"
        className="toolbar task-center-toolbar"
        interactive
        tone="chrome"
      >
        <div>
          <div className="toolbar-title">Task center</div>
          <div className="toolbar-meta">
            {tasks.length} tracked {tasks.length === 1 ? "task" : "tasks"}
            {scanActive ? " - activity running" : ""}
          </div>
        </div>
        <button
          className="task-center-refresh"
          onClick={onRefresh}
          type="button"
          aria-label="Refresh task list"
        >
          <RefreshCw size={14} />
          <span>Refresh</span>
        </button>
      </LiquidGlassSurface>

      <div className="task-center">
        <div
          className="task-center-filters"
          role="tablist"
          aria-label="Filter tasks by status"
        >
          <FilterChip
            active={statusFilter === "all"}
            label="All"
            count={tasks.length}
            onClick={() => setStatusFilter("all")}
          />
          {STATUS_ORDER.map((status) => (
            <FilterChip
              active={statusFilter === status}
              count={counts[status]}
              key={status}
              label={STATUS_LABEL[status]}
              onClick={() => setStatusFilter(status)}
              status={status}
            />
          ))}
        </div>

        <div className="task-center-list" role="list">
          {filteredTasks.length > 0 ? (
            filteredTasks.map((task) => (
              <TaskCenterRow
                busy={busyTaskIds.has(task.id)}
                key={task.id}
                onCancel={() => onCancel(task.id)}
                onRetry={() => onRetry(task.id)}
                task={task}
              />
            ))
          ) : (
            <div className="empty-panel">
              {tasks.length === 0
                ? "No tasks yet. Add a library root to start a scan."
                : `No ${statusFilter} tasks.`}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

interface TaskCenterRowProps {
  task: TaskRecord;
  busy: boolean;
  onCancel: () => void;
  onRetry: () => void;
}

function TaskCenterRow({ task, busy, onCancel, onRetry }: TaskCenterRowProps) {
  const [expandError, setExpandError] = useState(false);
  const cancellable = task.status === "pending" || task.status === "running";
  const retryable = task.status === "failed" || task.status === "cancelled";
  const showProgress = task.status === "running" || task.status === "pending";
  const progressLabel = formatProgressLabel(task);
  const progressPct = computeProgressPercent(task);
  const indeterminate = task.status === "running" && progressPct === null;
  const hasError = Boolean(task.error);

  return (
    <LiquidGlassSurface
      as="article"
      className={`task-card status-${task.status}`}
      interactive
      role="listitem"
      aria-label={`${kindLabel(task.kind)} task ${task.id}`}
      tone="panel"
    >
      <header className="task-card-header">
        <div className="task-card-heading">
          <StatusBadge status={task.status} />
          <div className="task-card-title">
            <span className="task-card-kind">{kindLabel(task.kind)}</span>
            <span className="task-card-id">#{task.id}</span>
          </div>
        </div>
        <div className="task-card-actions">
          {cancellable ? (
            <button
              className="task-action"
              disabled={busy}
              onClick={onCancel}
              type="button"
              aria-label={`Cancel task ${task.id}`}
            >
              <X size={14} />
              <span>Cancel</span>
            </button>
          ) : null}
          {retryable ? (
            <button
              className="task-action"
              disabled={busy}
              onClick={onRetry}
              type="button"
              aria-label={`Retry task ${task.id}`}
            >
              <RotateCcw size={14} />
              <span>Retry</span>
            </button>
          ) : null}
        </div>
      </header>

      <dl className="task-card-meta">
        <div>
          <dt>Target</dt>
          <dd>{describeTarget(task)}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>
            <time dateTime={new Date(task.createdAt * 1000).toISOString()}>
              {formatTime(task.createdAt)}
            </time>
          </dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>
            <time dateTime={new Date(task.updatedAt * 1000).toISOString()}>
              {formatTime(task.updatedAt)}
            </time>
          </dd>
        </div>
      </dl>

      {showProgress ? (
        <div className="task-progress" aria-label="Task progress">
          <div
            className={`task-progress-bar${indeterminate ? " indeterminate" : ""}`}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPct ?? undefined}
            aria-valuetext={progressLabel ?? undefined}
          >
            <div
              className="task-progress-fill"
              style={
                progressPct !== null
                  ? { width: `${progressPct}%` }
                  : undefined
              }
            />
          </div>
          {progressLabel ? (
            <div className="task-progress-label">{progressLabel}</div>
          ) : null}
        </div>
      ) : task.status === "succeeded" ? (
        <div className="task-progress-summary">
          {summarizeCounts(task) ?? "Completed"}
        </div>
      ) : null}

      {hasError ? (
        <div className={`task-card-error${expandError ? " expanded" : ""}`}>
          <AlertCircle aria-hidden="true" size={14} />
          <div className="task-card-error-body">
            <span
              className="task-card-error-message"
              title={task.error ?? undefined}
            >
              {task.error}
            </span>
            {task.error && task.error.length > 80 ? (
              <button
                className="task-card-error-toggle"
                onClick={() => setExpandError((current) => !current)}
                type="button"
              >
                {expandError ? "Show less" : "Show more"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </LiquidGlassSurface>
  );
}

function StatusBadge({ status }: { status: TaskStatus }) {
  const Icon =
    status === "running"
      ? Loader2
      : status === "pending"
        ? Clock3
        : status === "succeeded"
          ? CheckCircle2
          : status === "failed"
            ? AlertCircle
            : Ban;
  return (
    <span className={`status-badge status-badge-${status}`}>
      <Icon
        aria-hidden="true"
        className={status === "running" ? "spin" : undefined}
        size={14}
      />
      <span>{STATUS_LABEL[status]}</span>
    </span>
  );
}

interface FilterChipProps {
  active: boolean;
  label: string;
  count: number;
  status?: TaskStatus;
  onClick: () => void;
}

function FilterChip({ active, label, count, status, onClick }: FilterChipProps) {
  const className = [
    "task-filter-chip",
    status ? `task-filter-chip-${status}` : "",
    active ? "active" : ""
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      aria-pressed={active}
      className={className}
      onClick={onClick}
      role="tab"
      type="button"
    >
      <span>{label}</span>
      <span className="task-filter-chip-count">{count}</span>
    </button>
  );
}

function buildCounts(tasks: TaskRecord[]): Record<TaskStatus, number> {
  const counts: Record<TaskStatus, number> = {
    pending: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0
  };
  for (const task of tasks) {
    counts[task.status] += 1;
  }
  return counts;
}

function compareTasks(a: TaskRecord, b: TaskRecord): number {
  const statusDelta = statusWeight(a.status) - statusWeight(b.status);
  if (statusDelta !== 0) return statusDelta;
  return b.updatedAt - a.updatedAt;
}

function statusWeight(status: TaskStatus): number {
  switch (status) {
    case "running":
      return 0;
    case "pending":
      return 1;
    case "failed":
      return 2;
    case "cancelled":
      return 3;
    case "succeeded":
      return 4;
    default:
      return 5;
  }
}

function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind.replaceAll("_", " ");
}

function describeTarget(task: TaskRecord): string {
  if (task.rootId !== null) {
    return `Root #${task.rootId}`;
  }
  if (task.fileId !== null) {
    return `File #${task.fileId}`;
  }
  return "—";
}

function formatProgressLabel(task: TaskRecord): string | null {
  const parts: string[] = [];
  if (task.itemsTotal && task.itemsTotal > 0) {
    parts.push(`${formatNumber(task.itemsSeen)} / ${formatNumber(task.itemsTotal)} items`);
  } else if (task.itemsSeen > 0) {
    parts.push(`${formatNumber(task.itemsSeen)} items`);
  }
  if (task.foldersSeen > 0) {
    parts.push(`${formatNumber(task.foldersSeen)} folders`);
  }
  if (task.mediaFilesSeen > 0) {
    parts.push(`${formatNumber(task.mediaFilesSeen)} media`);
  }
  if (task.skippedFiles > 0) {
    parts.push(`${formatNumber(task.skippedFiles)} skipped`);
  }
  if (parts.length === 0) {
    return task.status === "running" ? "Working…" : null;
  }
  return parts.join(" · ");
}

function summarizeCounts(task: TaskRecord): string | null {
  const parts: string[] = [];
  if (task.foldersSeen > 0) parts.push(`${formatNumber(task.foldersSeen)} folders`);
  if (task.mediaFilesSeen > 0) parts.push(`${formatNumber(task.mediaFilesSeen)} media`);
  if (task.skippedFiles > 0) parts.push(`${formatNumber(task.skippedFiles)} skipped`);
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

function computeProgressPercent(task: TaskRecord): number | null {
  if (task.itemsTotal && task.itemsTotal > 0) {
    const pct = Math.floor((task.itemsSeen / task.itemsTotal) * 100);
    if (Number.isFinite(pct)) {
      return Math.min(100, Math.max(0, pct));
    }
  }
  return null;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatTime(epochSeconds: number): string {
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return "—";
  const date = new Date(epochSeconds * 1000);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  });
}
