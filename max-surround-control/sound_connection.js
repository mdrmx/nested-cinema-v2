const maxApi = require("max-api");
const WebSocket = require("ws");
const os = require("os");

const PORT = 5173;
const RECONNECT_DELAY_MS = 2000;
// Jumps larger than this (in seconds) are treated as seeks rather than normal playback drift
const SEEK_THRESHOLD_S = 0.5;

function getLocalIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === "IPv4" && !iface.internal) {
        maxApi.post(`Local IP: ${iface.address}`);
        return iface.address;
      }
    }
  }
  return "localhost";
}

function formatTime(t) {
  const minutes = Math.floor(t / 60);
  const seconds = Math.floor(t % 60);
  const ms = Math.floor((t % 1) * 1000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

const ip = getLocalIp();

// Track previous timeline state to detect play/pause/seek transitions
let prevPlaying = null;
let prevOffset = null;

let ws;

function connect() {
  ws = new WebSocket(`wss://${ip}:${PORT}`, {
    rejectUnauthorized: false, // allow self-signed cert
  });

  ws.on("open", () => {
    maxApi.post("✅ Connected to server");
  });

  ws.on("close", () => {
    maxApi.post("⚠️ Disconnected — reconnecting...");
    setTimeout(connect, RECONNECT_DELAY_MS);
  });

  ws.on("error", (err) => {
    maxApi.post(`❌ WS error: ${err.message}`);
    // "close" fires after "error", which triggers the reconnect
  });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    // Timeline state update — detect play, pause, and seek transitions
    if (msg.type === "state") {
      const { playing, offset } = msg;
      const offsetMs = offset * 1000;

      // Detect seek: offset jumped while play state is unchanged
      if (
        prevOffset !== null &&
        Math.abs(offset - prevOffset) > SEEK_THRESHOLD_S
      ) {
        maxApi.post(`⏩ Seek → ${formatTime(offset)}`);
        maxApi.outlet("seek", offsetMs);
      }

      // Detect play/pause transition
      if (playing !== prevPlaying) {
        if (playing) {
          maxApi.post(`▶ Play @ ${formatTime(offset)}`);
          maxApi.outlet("play", offsetMs);
        } else {
          maxApi.post(`⏸ Pause @ ${formatTime(offset)}`);
          maxApi.outlet("pause", offsetMs);
        }
      }

      prevPlaying = playing;
      prevOffset = offset;
    }

    // Cue: start a 360 clip — use as a sound cue trigger
    if (msg.type === "trigger360") {
      maxApi.post(`🎬 Cue: trigger360 → ${msg.clipId}`);
      maxApi.outlet("trigger", msg.clipId);
    }

    // Cue: stop 360 playback
    if (msg.type === "stop360") {
      maxApi.post("🛑 Cue: stop360");
      maxApi.outlet("stop", 1);
    }
  });
}

// Max → server: send transport commands
maxApi.addHandler("send_play", () => {
  if (ws && ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify({ type: "play" }));
});

maxApi.addHandler("send_pause", () => {
  if (ws && ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify({ type: "pause" }));
});

// send_seek expects time in seconds
maxApi.addHandler("send_seek", (seconds) => {
  if (ws && ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify({ type: "seek", time: Number(seconds) }));
});

connect();
