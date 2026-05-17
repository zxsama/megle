// CommonJS preload script. Electron's sandboxed preload runtime requires
// CJS, while the rest of the desktop module is ESM (because the workspace
// root sets type: module). We ship this hand-maintained .cjs alongside the
// tsc output so the renderer reliably gets the bridge.

const { contextBridge, ipcRenderer } = require("electron");

function readArg(prefix) {
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

contextBridge.exposeInMainWorld("megleDesktop", {
  coreUrl: readArg("--megle-core-url="),
  sessionToken: readArg("--megle-session-token="),
  pickFolder: () => ipcRenderer.invoke("megle:pick-folder"),
  diagnostics: () => ipcRenderer.invoke("megle:diagnostics"),
  windowControls: {
    minimize: () => ipcRenderer.invoke("megle:window-minimize"),
    maximize: () => ipcRenderer.invoke("megle:window-maximize"),
    close: () => ipcRenderer.invoke("megle:window-close"),
    isMaximized: () => ipcRenderer.invoke("megle:window-is-maximized")
  }
});
