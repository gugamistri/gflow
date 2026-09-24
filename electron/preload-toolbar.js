const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("captureToolbar", {
  navigate: (url) => ipcRenderer.invoke("capture:navigate", url),
  start: () => ipcRenderer.invoke("capture:start"),
  send: (message) => ipcRenderer.invoke("capture:toolbar", message),
  status: () => ipcRenderer.invoke("capture:status"),
  onState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on("capture:state", handler);
    return () => ipcRenderer.removeListener("capture:state", handler);
  },
});
