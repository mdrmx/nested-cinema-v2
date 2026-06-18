const { ipcMain, app, BrowserWindow, screen } = require("electron");

const path = require("path");
const fs = require("fs");
const https = require("https");
const os = require("os");

const express = require("express");
const WebSocket = require("ws");
const QRCode = require("qrcode");

// -------------------- Config --------------------
const HTTPS_PORT = 5173; // HTTPS + WSS on the same port
const HTTP_CA_PORT = 5174; // plain HTTP — CA download only
const TICK_HZ = 30; // master clock tick

const TLS_CERT = fs.readFileSync(path.join(__dirname, "certs", "cert.pem"));
const TLS_KEY = fs.readFileSync(path.join(__dirname, "certs", "key.pem"));

// Dynamically resolve the active LAN IPv4 address
function getLanIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "<unknown>";
}

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

// -------------------- HTTPS server for mobile + 360 media --------------------
let httpsServer;

function startHttpServer() {
  const ex = express();
  // wall media
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

  // mobile operator remote
  ex.get("/remote", (req, res) => {
    res.sendFile(path.join(__dirname, "mobile", "remote.html"));
  });

  // expose a simple status page
  ex.get("/status", (req, res) => {
    res.json({
      playing: timeline.playing,
      playhead: getPlayheadSeconds(),
      wsPort: HTTPS_PORT,
    });
  });

  httpsServer = https.createServer({ cert: TLS_CERT, key: TLS_KEY }, ex);
  httpsServer.listen(HTTPS_PORT, () => {
    const lanIp = getLanIp();
    const hostname = os.hostname();
    console.log(`HTTPS server: https://localhost:${HTTPS_PORT}/vr`);
    console.log(`              https://${lanIp}:${HTTPS_PORT}/vr  (LAN IP)`);
    console.log(
      `              https://${hostname}:${HTTPS_PORT}/vr  (LAN hostname)`,
    );
    console.log(`Remote ctrl:  https://${lanIp}:${HTTPS_PORT}/remote`);
    console.log(
      `              https://${hostname}:${HTTPS_PORT}/remote  (LAN hostname)`,
    );
  });
}

// -------------------- Plain HTTP server — CA download only --------------------
// Phones can't reach the HTTPS server before trusting the CA (chicken-and-egg),
// so we serve the CA file over plain HTTP on a separate port.
function startCaServer() {
  let caRoot;
  if (process.platform === "darwin") {
    caRoot = path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "mkcert",
    );
  } else if (process.platform === "win32") {
    caRoot = path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
      "mkcert",
    );
  } else {
    caRoot = path.join(os.homedir(), ".local", "share", "mkcert");
  }
  const CA_PATH = path.join(caRoot, "rootCA.pem");

  if (!fs.existsSync(CA_PATH)) {
    console.warn("[CA] rootCA.pem not found — run: mkcert -install");
    return;
  }

  const http = require("http");
  const caApp = express();

  caApp.get("/rootca", (_req, res) => {
    res.setHeader("Content-Type", "application/x-pem-file");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="mkcert-rootCA.pem"',
    );
    res.sendFile(CA_PATH);
  });

  http.createServer(caApp).listen(HTTP_CA_PORT, () => {
    const lanIp = getLanIp();
    console.log(`CA download:  http://${lanIp}:${HTTP_CA_PORT}/rootca`);
  });
}

// -------------------- WebSocket server (WSS — attached to HTTPS server) --------------------
let wss;

function startWsServer() {
  // Attach WSS to the same TLS server so browsers allow it from an HTTPS page
  wss = new WebSocket.Server({ server: httpsServer });

  wss.on("connection", (ws) => {
    ws.send(JSON.stringify({ type: "hello", wsPort: HTTPS_PORT }));

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

  console.log(`WSS server attached to HTTPS port ${HTTPS_PORT}`);
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
let qrDataUrl = null; // generated once server is up; sent to each wall window on load
let qrPayload = null;

ipcMain.handle("op:play", () => {
  play();
  return { ok: true };
});

ipcMain.handle("op:pause", () => {
  pause();
  return { ok: true };
});

ipcMain.handle("op:stop", () => {
  pause();
  seek(0);
  return { ok: true };
});

ipcMain.handle("op:seek", (_e, t) => {
  seek(t);
  return { ok: true };
});

ipcMain.handle("op:setDuration", (_e, d) => {
  wallDuration = d;
  return { ok: true };
});

// Returns the sorted list of video filenames present in the wall media directory
ipcMain.handle("op:listWallVideos", () => {
  try {
    return fs
      .readdirSync(WALL_MEDIA_DIR)
      .filter((f) => /\.(mp4|mov|webm|mkv)$/i.test(f))
      .sort();
  } catch {
    return [];
  }
});

// Returns the current cues array
ipcMain.handle("op:getCues", () => cues);

// Upserts a cue. If a cue already exists at the same time it is replaced;
// otherwise the new cue is inserted and the array is re-sorted by time.
// Persists the result back to cues.json and re-arms the cue engine.
ipcMain.handle("op:setCue", (_e, cue) => {
  const time = Number(cue.time);
  if (!Number.isFinite(time)) return { ok: false, error: "invalid time" };
  const type = cue.type === "stop360" ? "stop360" : "trigger360";
  const newCue = { time, type };
  if (type === "trigger360") newCue.clipId = cue.clipId || "vr1";

  const idx = cues.findIndex((c) => c.time === time);
  if (idx >= 0) {
    cues[idx] = newCue;
  } else {
    cues.push(newCue);
    cues.sort((a, b) => a.time - b.time);
  }
  fs.writeFileSync(
    path.join(__dirname, "cues.json"),
    JSON.stringify(cues, null, 2),
  );
  cueEngine.onSeek(getPlayheadSeconds()); // re-arm so updated cues fire correctly
  return { ok: true, cues };
});

// Deletes a cue by its index in the sorted array and persists the result.
ipcMain.handle("op:deleteCue", (_e, index) => {
  if (index < 0 || index >= cues.length)
    return { ok: false, error: "index out of range" };
  const removed = cues.splice(index, 1)[0];
  fs.writeFileSync(
    path.join(__dirname, "cues.json"),
    JSON.stringify(cues, null, 2),
  );
  cueEngine.onSeek(getPlayheadSeconds());
  return { ok: true, cues };
});

ipcMain.handle("op:setMuted", (_e, { screenIndex, muted }) => {
  const win = wallWindows[screenIndex];
  if (!win || win.isDestroyed())
    return { ok: false, error: "window not found" };
  win.webContents.send("wall:setMuted", muted);
  return { ok: true };
});

// screenIndex: 0-based wall window index; videoFile: filename under /wallmedia/ e.g. "screen1.mp4"
ipcMain.handle("op:setVideo", (_e, { screenIndex, videoFile }) => {
  const win = wallWindows[screenIndex];
  if (!win || win.isDestroyed())
    return { ok: false, error: "window not found" };
  win.webContents.send("wall:setVideo", { videoFile });
  return { ok: true };
});

function createControlWindow() {
  controlWin = new BrowserWindow({
    width: 900,
    height: 780,
    minWidth: 900,
    minHeight: 780,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "controls", "preload.js"),
    },
  });

  controlWin.webContents.on("console-message", (_e, level, message) => {
    if (level >= 3) console.error(`[CTRL]`, message);
  });

  controlWin.loadFile(path.join(__dirname, "controls", "controls.html"));
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

  // Also broadcast to all WebSocket clients (e.g. Max/MSP sound client)
  wsBroadcast(payload);
}

function createWallWindows() {
  const displays = screen.getAllDisplays();

  // Use first 3 displays; adjust if you want a mapping UI later
  const selected = displays.slice(0, 3);

  selected.forEach((d, i) => {
    const wallPreloadPath = path.join(__dirname, "renderer-wall", "preload.js");

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
      if (level >= 3) console.error(`[WALL-${i}]`, message);
    });

    win.loadFile(path.join(__dirname, "renderer-wall", "wall.html"), {
      query: { screen: String(i) },
    });
    win.webContents.once("did-finish-load", () => {
      if (qrPayload) win.webContents.send("wall:qrCode", qrPayload);
      // Send the first available video file so the wall can preload without
      // requiring a manual assignment from the operator
      const videos = (() => {
        try {
          return fs
            .readdirSync(WALL_MEDIA_DIR)
            .filter((f) => /\.(mp4|mov|webm|mkv)$/i.test(f))
            .sort();
        } catch {
          return [];
        }
      })();
      const defaultFile = videos[i] ?? videos[0];
      if (defaultFile)
        win.webContents.send("wall:setInitialVideo", defaultFile);
    });
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

app.whenReady().then(async () => {
  startHttpServer();
  startCaServer();
  startWsServer();
  createControlWindow();

  // Generate QR before wall windows load so it is ready to send on did-finish-load
  const vrUrl = `https://${getLanIp()}:${HTTPS_PORT}/vr`;
  qrDataUrl = await QRCode.toDataURL(vrUrl, {
    width: 400,
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
  });
  qrPayload = { dataUrl: qrDataUrl, url: vrUrl };

  // Print a scannable QR code for the remote control URL directly in the terminal
  const remoteUrl = `https://${getLanIp()}:${HTTPS_PORT}/remote`;
  const remoteQr = await QRCode.toString(remoteUrl, {
    type: "terminal",
    small: true,
  });
  console.log("\nRemote control QR code:");
  console.log(remoteQr);
  console.log(`URL: ${remoteUrl}\n`);

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
