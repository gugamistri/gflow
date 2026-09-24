const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("guiaDesktop", {
  send: (message) => ipcRenderer.invoke("capture:page-message", message),
  onState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on("capture:state", handler);
    return () => ipcRenderer.removeListener("capture:state", handler);
  },
});
