import { useRef, type ReactNode } from "react";
import { useTitlebarPointerPlane } from "./useTitlebarPointerPlane";
import { LiquidGlassSurface } from "../design/liquid-glass";

interface AppShellProps {
  layout: "library" | "simple";
  titlebarLeft: ReactNode;
  titlebarCenter: ReactNode;
  titlebarRight: ReactNode;
  sidebar: ReactNode;
  workspace: ReactNode;
  overlays: ReactNode;
}

export function AppShell({
  layout,
  titlebarLeft,
  titlebarCenter,
  titlebarRight,
  sidebar,
  workspace,
  overlays
}: AppShellProps) {
  const shellRef = useRef<HTMLElement | null>(null);
  const { titlebarSurfaceProps } = useTitlebarPointerPlane(shellRef);

  return (
    <main ref={shellRef} className="app-shell" data-layout={layout}>
      <LiquidGlassSurface
        as="section"
        className="shell-titlebar shell-titlebar-left shell-drag"
        aria-label="Primary navigation"
        backgroundGlow
        interactive
        {...titlebarSurfaceProps}
        tone="chrome"
      >
        {titlebarLeft}
      </LiquidGlassSurface>
      <LiquidGlassSurface
        as="section"
        className="shell-titlebar shell-titlebar-center shell-drag"
        aria-label="Workspace toolbar"
        backgroundGlow
        interactive
        {...titlebarSurfaceProps}
        tone="chrome"
      >
        {titlebarCenter}
      </LiquidGlassSurface>
      <LiquidGlassSurface
        as="section"
        className="shell-titlebar shell-titlebar-right shell-drag"
        aria-label="Window actions"
        backgroundGlow
        interactive
        {...titlebarSurfaceProps}
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
