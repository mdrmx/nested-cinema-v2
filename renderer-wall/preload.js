const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("timeline", {
  onState: (cb) => ipcRenderer.on("timeline:state", (_evt, data) => cb(data)),
  onSetVideo: (cb) => ipcRenderer.on("wall:setVideo", (_evt, data) => cb(data)),
  onSetInitialVideo: (cb) =>
    ipcRenderer.on("wall:setInitialVideo", (_evt, file) => cb(file)),
  onSetMuted: (cb) =>
    ipcRenderer.on("wall:setMuted", (_evt, muted) => cb(muted)),
  onQrCode: (cb) => ipcRenderer.on("wall:qrCode", (_evt, url) => cb(url)),
});
