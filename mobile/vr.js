const statusEl = document.getElementById("status");
const enableBtn = document.getElementById("enable");
const enterVrBtn = document.getElementById("enterVR");

const video = document.getElementById("v");
video.muted = false; // set true if you want to avoid audio restrictions
video.loop = false;

let ws;
let playbackEnabled = false;

// Connect to WS on same host as HTTP, but WS_PORT is different
const wsUrl = `ws://${location.hostname}:5174`;

function setStatus(msg) {
  statusEl.textContent = msg;
}

function connect() {
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    setStatus("Connected");
    ws.send(JSON.stringify({ type: "ready", canPlay: playbackEnabled }));
  };

  ws.onclose = () => {
    setStatus("Disconnected (reconnecting...)");
    setTimeout(connect, 800);
  };

  ws.onmessage = async (evt) => {
    let msg;
    try {
      msg = JSON.parse(evt.data);
    } catch {
      return;
    }

    if (msg.type === "trigger360") {
      await triggerClip(msg.clipId);
      ws.send(
        JSON.stringify({ type: "ack", for: "trigger360", clipId: msg.clipId }),
      );
    }

    if (msg.type === "stop360") {
      video.pause();
      video.currentTime = 0;
    }
  };
}

async function enablePlayback() {
  // User gesture handler: unlock playback
  // Load a tiny portion of a default clip or just call play/pause to unlock.
  playbackEnabled = true;

  // Optional: “warm up” with a silent play attempt
  try {
    video.muted = true;
    video.src = ""; // no-op; you can also point to a small warmup mp4
    await video.play();
    video.pause();
  } catch (e) {
    // On some devices you need an actual src to unlock.
  } finally {
    video.muted = false;
  }

  setStatus("Playback enabled (waiting for trigger)");
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "ready", canPlay: true }));
  }
}

async function triggerClip(clipId) {
  // If playback isn't enabled, show UI hint
  if (!playbackEnabled) {
    setStatus(`Trigger ${clipId} received — tap "Enable playback"`);
    return;
  }

  const url = `/media360/${encodeURIComponent(clipId)}.mp4`;
  setStatus(`Playing 360: ${clipId}`);

  // Swap source and play
  try {
    video.pause();
    video.src = url;
    video.currentTime = 0;

    // Wait for enough data to play smoothly
    await video.play();
  } catch (err) {
    setStatus(`Could not autoplay. Tap Enable playback then retry.`);
  }
}

enableBtn.addEventListener("click", enablePlayback);

enterVrBtn.addEventListener("click", () => {
  // A-Frame uses the scene element for entering VR
  const scene = document.querySelector("a-scene");
  if (scene && scene.enterVR) scene.enterVR();
});

connect();
