const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("guiaDesktopApp", {
  isDesktop: true,
  openCapture: () => ipcRenderer.invoke("capture:open"),
  cartesiaStatus: () => ipcRenderer.invoke("cartesia:status"),
  cartesiaSaveKey: (apiKey) => ipcRenderer.invoke("cartesia:save-key", apiKey),
  cartesiaLogout: () => ipcRenderer.invoke("cartesia:logout"),
  cartesiaSpeak: (payload) => ipcRenderer.invoke("cartesia:speak", payload),
});

ipcRenderer.on("capture:import", (_event, payload) => {
  window.dispatchEvent(
    new CustomEvent("guia-desktop-import", {
      detail: payload,
    })
  );
});
