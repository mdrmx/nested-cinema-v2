const { ipcMain, app, BrowserWindow, screen } = require("electron");

const path = require("path");
const fs = require("fs");
const http = require("http");

const express = require("express");
const WebSocket = require("ws");

// -------------------- Config --------------------
const HTTP_PORT = 5173; // mobile web (http)
const WS_PORT = 5174; // websocket commands
const TICK_HZ = 30; // master clock tick

const MEDIA_ROOT = path.join(__dirname, "media");
const WALL_MEDIA_DIR = path.join(MEDIA_ROOT, "wall");
const VR_MEDIA_DIR = path.join(MEDIA_ROOT, "vr");

const cues = JSON.parse(
  fs.readFileSync(path.join(__dirname, "cues.json"), "utf-8"),
);

// -------------------- Master timeline clock --------------------
// We store: playing, offsetSeconds, t0MonotonicMillis
// playhead = offset + (now - t0)/1000 when playing
const timeline = {
  playing: false,
  rate: 1.0,
  offset: 0, // seconds
  t0: 0, // ms (monotonic-ish via performance-like; here using process.hrtime)
};

// Monotonic time in ms using hrtime
function nowMs() {
  const [s, ns] = process.hrtime();
  return s * 1000 + ns / 1e6;
}

function getPlayheadSeconds() {
  if (!timeline.playing) return timeline.offset;
  const dt = (nowMs() - timeline.t0) / 1000;
  return timeline.offset + dt * timeline.rate;
}

function play() {
  if (timeline.playing) return;
  timeline.t0 = nowMs();
  timeline.playing = true;
  broadcastState();
}

function pause() {
  if (!timeline.playing) return;
  timeline.offset = getPlayheadSeconds();
  timeline.playing = false;
  broadcastState();
}

function seek(seconds) {
  timeline.offset = Math.max(0, Number(seconds) || 0);
  timeline.t0 = nowMs();
  broadcastState();
  cueEngine.onSeek(timeline.offset);
}

// -------------------- Cue engine --------------------
const cueEngine = {
  lastTime: 0,
  fired: new Set(),

  // call when seeking so cues after seek time can fire again
  onSeek(newTime) {
    this.lastTime = newTime;
    // re-arm cues that are > newTime
    this.fired = new Set(
      [...this.fired].filter((key) => {
        const t = Number(key.split("@")[0]);
        return t <= newTime;
      }),
    );
  },

  tick(currentTime) {
    const last = this.lastTime;
    this.lastTime = currentTime;

    if (controlWin && !controlWin.isDestroyed()) {
      controlWin.webContents.send("op:tick", {
        playhead: getPlayheadSeconds(),
        playing: timeline.playing,
        duration: wallDuration,
      });
    }

    // Only fire when moving forward
    if (currentTime < last) return;

    for (const cue of cues) {
      const key = `${cue.time}@${cue.type}@${cue.clipId || ""}`;
      if (this.fired.has(key)) continue;

      if (cue.time > last && cue.time <= currentTime) {
        this.fired.add(key);
        fireCue(cue);
      }
    }
  },
};

function fireCue(cue) {
  if (cue.type === "trigger360") {
    wsBroadcast({ type: "trigger360", clipId: cue.clipId });
    console.log(`[CUE] trigger360 @${cue.time}s -> ${cue.clipId}`);
  } else if (cue.type === "stop360") {
    wsBroadcast({ type: "stop360" });
    console.log(`[CUE] stop360 @${cue.time}s`);
  } else {
    console.log(`[CUE] unknown cue`, cue);
  }
}

// -------------------- HTTP server for mobile + 360 media --------------------
function startHttpServer() {
  const ex = express();
  //wall media
  ex.use("/wallmedia", express.static(WALL_MEDIA_DIR));
  // mobile app
  ex.use("/mobile", express.static(path.join(__dirname, "mobile")));

  // 360 media served to phones
  ex.use(
    "/media360",
    express.static(VR_MEDIA_DIR, {
      acceptRanges: true,
    }),
  );

  // convenience route
  ex.get("/vr", (req, res) => {
    res.sendFile(path.join(__dirname, "mobile", "vr.html"));
  });

  // optional: expose a simple status page
  ex.get("/status", (req, res) => {
    res.json({
      playing: timeline.playing,
      playhead: getPlayheadSeconds(),
      wsPort: WS_PORT,
    });
  });

  const server = http.createServer(ex);
  server.listen(HTTP_PORT, () => {
    console.log(`HTTP server: http://localhost:${HTTP_PORT}/vr`);
  });
}

// -------------------- WebSocket server (mobile triggers + optional control) --------------------
let wss;

function startWsServer() {
  wss = new WebSocket.Server({ port: WS_PORT });

  wss.on("connection", (ws) => {
    ws.send(JSON.stringify({ type: "hello", wsPort: WS_PORT }));

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      // Optional: allow remote control from a phone/laptop UI later
      if (msg.type === "play") play();
      if (msg.type === "pause") pause();
      if (msg.type === "seek") seek(msg.time);
    });
  });

  console.log(`WS server: ws://localhost:${WS_PORT}`);
}

function wsBroadcast(obj) {
  if (!wss) return;
  const data = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
}

// -------------------- IPC handlers for controls window (via preload) --------------------
let controlWin;
let wallDuration = 600;

ipcMain.handle("op:play", () => {
  console.log("[IPC] op:play");
  play();
  return { ok: true };
});

ipcMain.handle("op:pause", () => {
  console.log("[IPC] op:pause");
  pause();
  return { ok: true };
});

ipcMain.handle("op:stop", () => {
  console.log("[IPC] op:stop");
  pause();
  seek(0);
  return { ok: true };
});

ipcMain.handle("op:seek", (_e, t) => {
  console.log("[IPC] op:seek", t);
  seek(t);
  return { ok: true };
});

ipcMain.handle("op:setDuration", (_e, d) => {
  console.log("[IPC] op:setDuration", d);
  wallDuration = d;
  return { ok: true };
});

function createControlWindow() {
  controlWin = new BrowserWindow({
    width: 760,
    height: 420,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "controls", "preload.js"),
    },
  });

  controlWin.loadURL(
    `file://${path.join(__dirname, "controls", "controls.html")}`,
  );
}

// -------------------- Wall windows + IPC via postMessage --------------------
// (Simplest: use webContents.send without a preload by disabling contextIsolation,
// but we’ll keep contextIsolation and just use URL + minimal messaging via webContents.)
const wallWindows = [];
function broadcastState() {
  const payload = {
    type: "state",
    playing: timeline.playing,
    rate: timeline.rate,
    offset: getPlayheadSeconds(), // ✅ IMPORTANT
    t0: timeline.t0,
  };

  for (const win of wallWindows) {
    if (!win || win.isDestroyed()) continue;
    win.webContents.send("timeline:state", payload);
  }
}

function createWallWindows() {
  const displays = screen.getAllDisplays();

  // Use first 3 displays; adjust if you want a mapping UI later
  const selected = displays.slice(0, 3);

  selected.forEach((d, i) => {
    const wallPreloadPath = path.join(__dirname, "renderer-wall", "preload.js");
    console.log(
      "[MAIN] wall preload path:",
      wallPreloadPath,
      "exists:",
      fs.existsSync(wallPreloadPath),
    );

    const win = new BrowserWindow({
      x: d.bounds.x,
      y: d.bounds.y,
      width: d.bounds.width,
      height: d.bounds.height,
      fullscreen: true,
      frame: false,
      autoHideMenuBar: true,
      backgroundColor: "#000000",

      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        preload: wallPreloadPath,
      },
    });
    win.webContents.on("console-message", (_e, level, message) => {
      console.log(`[WALL console ${level}]`, message);
    });

    win.webContents.once("did-finish-load", () => {
      win.webContents.openDevTools({ mode: "detach" });
    });

    const url = `file://${path.join(__dirname, "renderer-wall", "wall.html")}?screen=${i}`;
    win.loadURL(url);
    win.webContents.openDevTools({ mode: "detach" });
    // controlWin.webContents.openDevTools({ mode: "detach" });
    wallWindows.push(win);
  });
}

// -------------------- App lifecycle --------------------
function startMasterTick() {
  setInterval(
    () => {
      const t = getPlayheadSeconds();
      cueEngine.tick(t);

      // Push state periodically so windows can correct drift, even if no commands happen
      broadcastState();
    },
    Math.round(1000 / TICK_HZ),
  );
}

app.whenReady().then(() => {
  startHttpServer();
  startWsServer();
  createControlWindow();

  createWallWindows();

  startMasterTick();

  // Start paused at 0
  seek(0);

  // For quick testing: auto-play after 1s
  // setTimeout(play, 1000);
});

app.on("window-all-closed", () => {
  app.quit();
});
