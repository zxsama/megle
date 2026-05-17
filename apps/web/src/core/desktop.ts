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

export interface MegleDesktopBridge {
  coreUrl?: string;
  sessionToken?: string;
  pickFolder?: () => Promise<string | null>;
  diagnostics?: () => Promise<DesktopDiagnostics>;
  windowControls?: DesktopWindowControls;
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
