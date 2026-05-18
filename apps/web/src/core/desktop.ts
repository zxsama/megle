export interface DesktopDiagnostics {
  ffmpegAvailable: boolean;
  dbPath: string | null;
  pluginsDir: string | null;
}

export interface DesktopWindowControls {
  minimize: () => Promise<void>;
  maximize: () => Promise<boolean>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
}

export interface DesktopShellActions {
  revealPath: (path: string) => Promise<boolean>;
  openPath: (path: string) => Promise<boolean>;
  copyText: (text: string) => Promise<boolean>;
}

export interface MegleDesktopBridge {
  coreUrl?: string;
  sessionToken?: string;
  pickFolder?: () => Promise<string | null>;
  diagnostics?: () => Promise<DesktopDiagnostics>;
  windowControls?: DesktopWindowControls;
  shell?: DesktopShellActions;
}

declare global {
  interface Window {
    megleDesktop?: MegleDesktopBridge;
  }
}

export function getDesktopBridge(): MegleDesktopBridge | null {
  return window.megleDesktop ?? null;
}

export function canPickNativeFolder(): boolean {
  return typeof getDesktopBridge()?.pickFolder === "function";
}

export async function pickNativeFolder(): Promise<string | null> {
  return (await getDesktopBridge()?.pickFolder?.()) ?? null;
}

export function getWindowControls(): DesktopWindowControls | null {
  return getDesktopBridge()?.windowControls ?? null;
}

export function getDesktopShellActions(): DesktopShellActions | null {
  return getDesktopBridge()?.shell ?? null;
}

export async function revealPath(path: string): Promise<boolean> {
  return (await getDesktopShellActions()?.revealPath(path)) ?? false;
}

export async function openPath(path: string): Promise<boolean> {
  return (await getDesktopShellActions()?.openPath(path)) ?? false;
}

export async function copyText(text: string): Promise<boolean> {
  const desktop = getDesktopShellActions();
  if (desktop) {
    return desktop.copyText(text);
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function readDesktopDiagnostics(): Promise<DesktopDiagnostics | null> {
  const bridge = getDesktopBridge();
  if (!bridge?.diagnostics) {
    return null;
  }
  try {
    return await bridge.diagnostics();
  } catch {
    return null;
  }
}
