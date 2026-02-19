const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("timeline", {
  onState: (cb) => ipcRenderer.on("timeline:state", (_evt, data) => cb(data)),
});
