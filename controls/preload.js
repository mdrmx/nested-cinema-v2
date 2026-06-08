const { contextBridge, ipcRenderer } = require("electron");

console.log("controls preload loaded ✅");

contextBridge.exposeInMainWorld("op", {
  play: () => ipcRenderer.invoke("op:play"),
  pause: () => ipcRenderer.invoke("op:pause"),
  stop: () => ipcRenderer.invoke("op:stop"),
  seek: (t) => ipcRenderer.invoke("op:seek", t),
  setDuration: (d) => ipcRenderer.invoke("op:setDuration", d),
  setVideo: (screenIndex, videoFile) =>
    ipcRenderer.invoke("op:setVideo", { screenIndex, videoFile }),
  onTick: (cb) => ipcRenderer.on("op:tick", (_e, payload) => cb(payload)),
});
