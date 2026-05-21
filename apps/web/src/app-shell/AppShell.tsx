import type { MouseEvent, ReactNode } from "react";
import { getWindowControls } from "../core/desktop";
import { LiquidGlassSurface } from "../design/liquid-glass";

interface AppShellProps {
  titlebarLeft: ReactNode;
  titlebarCenter: ReactNode;
  titlebarRight: ReactNode;
  sidebar: ReactNode;
  workspace: ReactNode;
  overlays: ReactNode;
}

const titlebarNoDragSelector = [
  ".no-drag",
  '[data-no-drag="true"]',
  "button",
  "input",
  "select",
  "textarea",
  "a",
  '[role="button"]',
  '[role="tab"]',
  '[role="tablist"]',
  '[role="group"]'
].join(",");

function handleTitlebarDoubleClick(event: MouseEvent<HTMLElement>) {
  const target = event.target;
  if (!(target instanceof Element) || target.closest(titlebarNoDragSelector)) return;
  void getWindowControls()?.maximize();
}

export function AppShell({
  titlebarLeft,
  titlebarCenter,
  titlebarRight,
  sidebar,
  workspace,
  overlays
}: AppShellProps) {
  return (
    <main className="app-shell">
      <LiquidGlassSurface
        as="section"
        className="shell-titlebar shell-titlebar-left shell-drag"
        aria-label="Primary navigation"
        interactive
        onDoubleClick={handleTitlebarDoubleClick}
        tone="chrome"
      >
        {titlebarLeft}
      </LiquidGlassSurface>
      <LiquidGlassSurface
        as="section"
        className="shell-titlebar shell-titlebar-center shell-drag"
        aria-label="Workspace toolbar"
        interactive
        onDoubleClick={handleTitlebarDoubleClick}
        tone="chrome"
      >
        {titlebarCenter}
      </LiquidGlassSurface>
      <LiquidGlassSurface
        as="section"
        className="shell-titlebar shell-titlebar-right shell-drag"
        aria-label="Window actions"
        interactive
        onDoubleClick={handleTitlebarDoubleClick}
        tone="chrome"
      >
        {titlebarRight}
      </LiquidGlassSurface>
      {sidebar}
      <section className="app-workspace-slot">{workspace}</section>
      {overlays}
    </main>
  );
}
