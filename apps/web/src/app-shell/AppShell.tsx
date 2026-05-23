import { useRef, type ReactNode } from "react";
import { useTitlebarPointerPlane } from "./useTitlebarPointerPlane";
import { LiquidGlassSurface } from "../design/liquid-glass";

interface AppShellProps {
  layout: "library" | "simple";
  titlebarLeft: ReactNode;
  titlebarCenter: ReactNode;
  titlebarRight: ReactNode;
  sidebar: ReactNode;
  centerPane: ReactNode;
  rightPane: ReactNode;
  overlays: ReactNode;
}

export function AppShell({
  layout,
  titlebarLeft,
  titlebarCenter,
  titlebarRight,
  sidebar,
  centerPane,
  rightPane,
  overlays
}: AppShellProps) {
  const shellRef = useRef<HTMLElement | null>(null);
  const { titlebarSurfaceProps } = useTitlebarPointerPlane(shellRef);

  return (
    <main ref={shellRef} className="app-shell" data-layout={layout}>
      <div className="shell-backdrop-canvas" aria-hidden="true" />
      <div
        className="window-edge-frame"
        data-window-edge-surface="true"
        data-window-edge-pointer="idle"
        aria-hidden="true"
      />
      <LiquidGlassSurface
        as="section"
        className="workbench-column workbench-column-left"
        aria-label="Primary navigation shell"
        backgroundGlow
        interactive
        tone="chrome"
      >
        <header
          className="shell-titlebar shell-titlebar-left shell-drag"
          aria-label="Primary navigation"
          {...titlebarSurfaceProps}
        >
          {titlebarLeft}
        </header>
        <section className="workbench-column-body workbench-column-body-left">
          {sidebar}
        </section>
      </LiquidGlassSurface>
      <LiquidGlassSurface
        as="section"
        className="workbench-column workbench-column-center"
        aria-label="Center workbench shell"
        backgroundGlow
        interactive
        tone="chrome"
      >
        <header
          className="shell-titlebar shell-titlebar-center shell-drag"
          aria-label="Workspace toolbar"
          {...titlebarSurfaceProps}
        >
          {titlebarCenter}
        </header>
        <section className="workbench-column-body workbench-column-body-center">
          {centerPane}
        </section>
      </LiquidGlassSurface>
      <LiquidGlassSurface
        as="section"
        className="workbench-column workbench-column-right"
        aria-label="Inspector shell"
        backgroundGlow
        interactive
        tone="chrome"
      >
        <header
          className="shell-titlebar shell-titlebar-right shell-drag"
          aria-label="Window actions"
          {...titlebarSurfaceProps}
        >
          {titlebarRight}
        </header>
        <section className="workbench-column-body workbench-column-body-right">
          {rightPane}
        </section>
      </LiquidGlassSurface>
      {overlays}
    </main>
  );
}
