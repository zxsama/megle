import type { PluginStatus } from "@megle/core-client";

const STATUS_LABEL: Record<PluginStatus, string> = {
  registered: "Registered",
  enabled: "Enabled",
  disabled: "Disabled",
  invalid: "Invalid"
};

interface StatusPillProps {
  status: PluginStatus;
  title?: string;
}

export function StatusPill({ status, title }: StatusPillProps) {
  return (
    <span
      className={`plugin-status-pill plugin-status-pill-${status}`}
      title={title}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
