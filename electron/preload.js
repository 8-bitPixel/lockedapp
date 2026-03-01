const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("monitorApi", {
  getState: () => ipcRenderer.invoke("monitor:get-state"),
  start: (payload) => ipcRenderer.invoke("monitor:start", payload),
  pause: () => ipcRenderer.invoke("monitor:pause"),
  resume: () => ipcRenderer.invoke("monitor:resume"),
  stop: () => ipcRenderer.invoke("monitor:stop"),
  onUpdate: (handler) => {
    const wrapped = (_event, data) => handler(data);
    ipcRenderer.on("monitor:update", wrapped);
    return () => ipcRenderer.removeListener("monitor:update", wrapped);
  },
  onRoast: (handler) => {
    const wrapped = (_event, data) => handler(data);
    ipcRenderer.on("monitor:roast", wrapped);
    return () => ipcRenderer.removeListener("monitor:roast", wrapped);
  },
  onStopSpeaking: (handler) => {
    const wrapped = () => handler();
    ipcRenderer.on("monitor:stop-speaking", wrapped);
    return () => ipcRenderer.removeListener("monitor:stop-speaking", wrapped);
  },
});
