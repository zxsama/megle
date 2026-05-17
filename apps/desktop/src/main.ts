import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from "electron";
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

async function createWindow(): Promise<void> {
  const session = await ensureCoreReady();
  const state = await loadWindowState();

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#101215",
    frame: false,
    titleBarStyle: "hidden",
    webPreferences: {
      preload: fileURLToPath(new URL("./preload.js", import.meta.url)),
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

  mainWindow.on("close", () => {
    void persistWindowState();
  });

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
  try {
    await fsp.mkdir(path.dirname(windowStatePath()), { recursive: true });
    await fsp.writeFile(windowStatePath(), JSON.stringify(state), "utf8");
  } catch {
    // Best-effort persistence; never block app shutdown on this.
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
  await ensureCoreReady();
  await createWindow();
});

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

app.on("before-quit", () => {
  pendingCoreProcess?.stop();
  pendingCoreProcess = null;
  coreProcess?.stop();
  coreProcess = null;
});
