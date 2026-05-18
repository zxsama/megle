import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  screen,
  shell,
  type OpenDialogOptions
} from "electron";
import { spawn } from "node:child_process";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startCoreProcess, waitForCoreHealth, type CoreProcessHandle } from "./core-process.js";
import { createCoreSession, type CoreSession } from "./core-session.js";

let mainWindow: BrowserWindow | null = null;
let coreProcess: CoreProcessHandle | null = null;
let pendingCoreProcess: CoreProcessHandle | null = null;
let coreSession: CoreSession | null = null;
let coreReadyPromise: Promise<CoreSession> | null = null;
let cachedFfmpegAvailable: boolean | null = null;
let persisted = false;
let persistDebounceTimer: NodeJS.Timeout | null = null;
const PERSIST_DEBOUNCE_MS = 500;

interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
}

const DEFAULT_WINDOW_STATE: WindowState = {
  width: 1440,
  height: 920,
  maximized: false
};

ipcMain.handle("megle:pick-folder", async () => {
  const options: OpenDialogOptions = { properties: ["openDirectory"] };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);

  return result.canceled ? null : result.filePaths[0] ?? null;
});

ipcMain.handle("megle:diagnostics", async () => {
  const session = coreSession;
  return {
    ffmpegAvailable: await detectFfmpeg(),
    dbPath: session?.dbPath ?? null,
    pluginsDir: session ? resolvePluginsDir(session.dbPath) : null
  };
});

ipcMain.handle("megle:window-minimize", () => {
  mainWindow?.minimize();
});

ipcMain.handle("megle:window-maximize", () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
    return false;
  }
  mainWindow.maximize();
  return true;
});

ipcMain.handle("megle:window-close", () => {
  mainWindow?.close();
});

ipcMain.handle("megle:window-is-maximized", () => {
  return mainWindow?.isMaximized() ?? false;
});

ipcMain.handle("megle:shell-reveal-path", (_event, targetPath: string) => {
  if (typeof targetPath !== "string" || targetPath.trim().length === 0) {
    return false;
  }
  shell.showItemInFolder(targetPath);
  return true;
});

ipcMain.handle("megle:shell-open-path", async (_event, targetPath: string) => {
  if (typeof targetPath !== "string" || targetPath.trim().length === 0) {
    return false;
  }
  const error = await shell.openPath(targetPath);
  return error.length === 0;
});

ipcMain.handle("megle:clipboard-write-text", (_event, text: string) => {
  if (typeof text !== "string") {
    return false;
  }
  clipboard.writeText(text);
  return true;
});

async function createWindow(): Promise<void> {
  const session = await ensureCoreReady();
  const state = await loadWindowState();
  const placement = clampWindowPlacement(state);

  mainWindow = new BrowserWindow({
    width: placement.width,
    height: placement.height,
    x: placement.x,
    y: placement.y,
    minWidth: 1100,
    minHeight: 720,
    backgroundMaterial: "acrylic",
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    titleBarStyle: "hidden",
    webPreferences: {
      preload: fileURLToPath(new URL("./preload.cjs", import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [
        `--megle-core-url=${session.baseUrl}`,
        `--megle-session-token=${session.sessionToken}`
      ]
    }
  });

  if (state.maximized) {
    mainWindow.maximize();
  }

  // Persist on move/resize so a forced shutdown loses at most
  // PERSIST_DEBOUNCE_MS of window state. The `before-quit` handler still
  // writes synchronously so a clean exit always flushes the latest bounds.
  mainWindow.on("move", schedulePersistWindowState);
  mainWindow.on("resize", schedulePersistWindowState);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  const devServer = process.env.MEGLE_WEB_URL ?? "http://127.0.0.1:5173";
  await mainWindow.loadURL(devServer);
}

async function ensureCoreReady(): Promise<CoreSession> {
  if (coreSession) {
    return coreSession;
  }
  if (coreReadyPromise) {
    return coreReadyPromise;
  }

  coreReadyPromise = startCoreSession();
  return coreReadyPromise;
}

async function startCoreSession(): Promise<CoreSession> {
  let pendingProcess: CoreProcessHandle | null = null;

  try {
    const session = await createCoreSession();
    pendingProcess = startCoreProcess(session);
    pendingCoreProcess = pendingProcess;
    await waitForCoreHealth(session.baseUrl, session.sessionToken);
    coreProcess = pendingProcess;
    pendingCoreProcess = null;
    coreSession = session;
    return session;
  } catch (error) {
    pendingProcess?.stop();
    pendingCoreProcess = null;
    coreReadyPromise = null;
    coreProcess = null;
    coreSession = null;
    throw error;
  }
}

function windowStatePath(): string {
  return path.join(app.getPath("userData"), "window-state.json");
}

async function loadWindowState(): Promise<WindowState> {
  try {
    const raw = await fsp.readFile(windowStatePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<WindowState>;
    return {
      width: typeof parsed.width === "number" ? parsed.width : DEFAULT_WINDOW_STATE.width,
      height: typeof parsed.height === "number" ? parsed.height : DEFAULT_WINDOW_STATE.height,
      x: typeof parsed.x === "number" ? parsed.x : undefined,
      y: typeof parsed.y === "number" ? parsed.y : undefined,
      maximized: parsed.maximized === true
    };
  } catch {
    return { ...DEFAULT_WINDOW_STATE };
  }
}

/// Bounds-check a saved window placement against the currently connected
/// displays. After a monitor disconnect a saved (x, y) can land entirely
/// offscreen, so we look up a display that contains the saved rect and
/// either clamp the position into its `workArea` or drop x/y entirely
/// (Electron then picks a sensible default). Width/height are always
/// honored — a too-wide window is still preferable to ignoring the user's
/// preference outright.
function clampWindowPlacement(state: WindowState): {
  width: number;
  height: number;
  x?: number;
  y?: number;
} {
  if (typeof state.x !== "number" || typeof state.y !== "number") {
    return { width: state.width, height: state.height };
  }

  const savedBounds = {
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height
  };
  const display = screen.getDisplayMatching(savedBounds);
  const workArea = display.workArea;

  // Reject the saved x/y if the saved rect doesn't actually overlap the
  // matched display's work area. `getDisplayMatching` always returns *a*
  // display, even when the saved rect is far outside any monitor, so this
  // overlap check is what catches the post-disconnect case.
  const overlapsHorizontally =
    savedBounds.x + savedBounds.width > workArea.x &&
    savedBounds.x < workArea.x + workArea.width;
  const overlapsVertically =
    savedBounds.y + savedBounds.height > workArea.y &&
    savedBounds.y < workArea.y + workArea.height;

  if (!overlapsHorizontally || !overlapsVertically) {
    return { width: state.width, height: state.height };
  }

  // Clamp x/y so the window is fully within the matched display's work
  // area. Partial overlap becomes fully visible.
  const maxX = workArea.x + workArea.width - savedBounds.width;
  const maxY = workArea.y + workArea.height - savedBounds.height;
  const clampedX = Math.max(workArea.x, Math.min(savedBounds.x, maxX));
  const clampedY = Math.max(workArea.y, Math.min(savedBounds.y, maxY));

  return {
    width: state.width,
    height: state.height,
    x: clampedX,
    y: clampedY
  };
}

function schedulePersistWindowState(): void {
  if (persistDebounceTimer) {
    clearTimeout(persistDebounceTimer);
  }
  persistDebounceTimer = setTimeout(() => {
    persistDebounceTimer = null;
    void persistWindowState();
  }, PERSIST_DEBOUNCE_MS);
}

async function persistWindowState(): Promise<void> {
  if (!mainWindow) return;
  const maximized = mainWindow.isMaximized();
  const bounds = maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
  const state: WindowState = {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    maximized
  };
  const targetPath = windowStatePath();
  // Atomic write: render to a sibling temp file, then rename. A crash
  // mid-write leaves `window-state.json` untouched instead of corrupting it
  // to truncated JSON the next launch can't parse.
  const tempPath = `${targetPath}.${process.pid}.tmp`;
  try {
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await fsp.writeFile(tempPath, JSON.stringify(state), "utf8");
    await fsp.rename(tempPath, targetPath);
  } catch {
    // Best-effort persistence; never block app shutdown on this. Try to
    // clean up the temp file if we created one.
    try {
      await fsp.unlink(tempPath);
    } catch {
      // ignore
    }
  }
}

async function detectFfmpeg(): Promise<boolean> {
  if (cachedFfmpegAvailable !== null) {
    return cachedFfmpegAvailable;
  }
  cachedFfmpegAvailable = await new Promise<boolean>((resolve) => {
    try {
      const child = spawn("ffmpeg", ["-version"], {
        stdio: "ignore",
        windowsHide: true
      });
      child.on("error", () => resolve(false));
      child.on("exit", (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
  return cachedFfmpegAvailable;
}

function resolvePluginsDir(dbPath: string): string {
  const fromEnv = process.env.MEGLE_PLUGINS_DIR;
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  const parent = path.dirname(dbPath);
  if (parent && parent !== "." && parent !== "") {
    return path.join(parent, "plugins");
  }
  return path.join(".", "plugins");
}

app.whenReady().then(async () => {
  const session = await ensureCoreReady();
  await maybeAutoAddRoot(session);
  await createWindow();
});

async function maybeAutoAddRoot(session: CoreSession): Promise<void> {
  const target = process.env.MEGLE_AUTO_ADD_ROOT?.trim();
  if (!target) return;
  try {
    const response = await fetch(`${session.baseUrl}/roots`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-megle-session": session.sessionToken
      },
      body: JSON.stringify({ path: target, displayName: path.basename(target) })
    });
    if (!response.ok) {
      const text = await response.text();
      console.warn(`[megle] MEGLE_AUTO_ADD_ROOT addRoot failed (${response.status}): ${text}`);
    } else {
      console.log(`[megle] auto-added root ${target}`);
    }
  } catch (error) {
    console.warn("[megle] MEGLE_AUTO_ADD_ROOT request failed:", error);
  }
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

app.on("before-quit", (event) => {
  // Persist window state synchronously before tearing Core down. The
  // `persisted` guard prevents the second `before-quit` (after `app.exit`)
  // from re-entering this branch — Node would otherwise double-stop Core
  // and double-flush the JSON.
  if (!persisted) {
    event.preventDefault();
    persisted = true;
    if (persistDebounceTimer) {
      clearTimeout(persistDebounceTimer);
      persistDebounceTimer = null;
    }
    void (async () => {
      try {
        await persistWindowState();
      } finally {
        pendingCoreProcess?.stop();
        pendingCoreProcess = null;
        coreProcess?.stop();
        coreProcess = null;
        app.exit(0);
      }
    })();
    return;
  }

  pendingCoreProcess?.stop();
  pendingCoreProcess = null;
  coreProcess?.stop();
  coreProcess = null;
});
