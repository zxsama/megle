import { contextBridge, ipcRenderer } from "electron";

function readArg(prefix: string): string | undefined {
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg?.slice(prefix.length);
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
