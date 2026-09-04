const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("op", {
  play: () => ipcRenderer.invoke("op:play"),
  pause: () => ipcRenderer.invoke("op:pause"),
  stop: () => ipcRenderer.invoke("op:stop"),
  seek: (t) => ipcRenderer.invoke("op:seek", t),
  setDuration: (d) => ipcRenderer.invoke("op:setDuration", d),
  getDisplays: () => ipcRenderer.invoke("op:getDisplays"),
  getProjectionState: () => ipcRenderer.invoke("op:getProjectionState"),
  getProjectionDiagnostics: () =>
    ipcRenderer.invoke("op:getProjectionDiagnostics"),
  openProjection: (displayId) =>
    ipcRenderer.invoke("op:openProjection", displayId),
  setVideo: (screenIndex, videoFile) =>
    ipcRenderer.invoke("op:setVideo", { screenIndex, videoFile }),
  setMuted: (screenIndex, muted) =>
    ipcRenderer.invoke("op:setMuted", { screenIndex, muted }),
  onTick: (cb) => ipcRenderer.on("op:tick", (_e, payload) => cb(payload)),
  listWallVideos: () => ipcRenderer.invoke("op:listWallVideos"),
  listVrVideos: () => ipcRenderer.invoke("op:listVrVideos"),
  getCues: () => ipcRenderer.invoke("op:getCues"),
  setCue: (cue) => ipcRenderer.invoke("op:setCue", cue),
  deleteCue: (index) => ipcRenderer.invoke("op:deleteCue", index),
  getScreenCount: () => ipcRenderer.invoke("op:getScreenCount"),
});
