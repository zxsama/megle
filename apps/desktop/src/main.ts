import { app, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import { startCoreProcess, waitForCoreHealth, type CoreProcessHandle } from "./core-process.js";
import { createCoreSession, type CoreSession } from "./core-session.js";

let mainWindow: BrowserWindow | null = null;
let coreProcess: CoreProcessHandle | null = null;
let pendingCoreProcess: CoreProcessHandle | null = null;
let coreSession: CoreSession | null = null;
let coreReadyPromise: Promise<CoreSession> | null = null;

async function createWindow(): Promise<void> {
  const session = await ensureCoreReady();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#101215",
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
