// Status display element for showing connection/playback state to the user
const statusEl = document.getElementById("status");

let ws;
// Connect over WSS using the same host as the page (certificate must match)
const wsUrl = `wss://${location.host}`;

// Updates the on-screen status message
function setStatus(msg) {
  statusEl.textContent = msg;
}

// Pre-loads both VR video elements so playback can start without delay
function prepareVideos() {
  const v1 = document.querySelector("#vr1");
  const v2 = document.querySelector("#vr2");
  v1.load();
  v2.load();
  v1.addEventListener("canplaythrough", () => console.log("vr1 ready"));
  v2.addEventListener("canplaythrough", () => console.log("vr2 ready"));
}

// Plays the requested VR clip and binds it to the A-Frame sphere texture.
// Defaults to vr1 if no clipId is provided.
function handlePlayVideo(data = {}) {
  const sphere = document.querySelector("#sphere");
  const v1 = document.querySelector("#vr1");
  const v2 = document.querySelector("#vr2");
  let activeVideo;

  // Select the appropriate video asset and update the sphere's src
  if (data.clipId === "vr2") {
    activeVideo = v2;
    sphere.setAttribute("src", "#vr2");
  } else {
    activeVideo = v1;
    sphere.setAttribute("src", "#vr1");
  }

  // Reset playhead and start playback
  activeVideo.currentTime = 0;
  activeVideo.play().catch((err) => console.warn("Play failed:", err));
  setStatus(`Playing: ${data.clipId || "vr1"}`);
}

// Stops and resets both video elements
function handlePauseVideo() {
  const v1 = document.querySelector("#vr1");
  const v2 = document.querySelector("#vr2");
  v1.currentTime = 0;
  v2.currentTime = 0;
  v1.pause();
  v2.pause();
  setStatus("Stopped");
}

// Button to enter the browser's native WebXR/VR mode
document.getElementById("enterVR").addEventListener("click", () => {
  const scene = document.querySelector("a-scene");
  if (scene && scene.enterVR) scene.enterVR();
});

// Opens a WebSocket connection to the control server and handles reconnection
function connect() {
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    setStatus("Connected");
    // Announce this client as a VR viewer
    ws.send(JSON.stringify({ type: "ready" }));
  };

  ws.onclose = () => {
    setStatus("Disconnected (reconnecting...)");
    // Auto-reconnect after a short delay
    setTimeout(connect, 800);
  };

  ws.onmessage = (evt) => {
    let msg;
    try {
      msg = JSON.parse(evt.data);
    } catch {
      return;
    }

    // trigger360: play the specified 360 video clip
    if (msg.type === "trigger360") {
      handlePlayVideo({ clipId: msg.clipId });
      // Acknowledge receipt so the controller knows the cue fired
      ws.send(
        JSON.stringify({ type: "ack", for: "trigger360", clipId: msg.clipId }),
      );
    }

    // stop360: halt playback and reset both videos
    if (msg.type === "stop360") handlePauseVideo();
  };
}

// Bootstrap: pre-load videos then open the WebSocket connection
document.addEventListener("DOMContentLoaded", () => {
  prepareVideos();
  connect();
});
