const statusEl = document.getElementById("status");
const enableBtn = document.getElementById("enable");

let ws;
const wsUrl = `wss://${location.host}`;

function setStatus(msg) {
  statusEl.textContent = msg;
}

function prepareVideos() {
  const v1 = document.querySelector("#vr1");
  const v2 = document.querySelector("#vr2");
  v1.load();
  v2.load();
  v1.addEventListener("canplaythrough", () => console.log("vr1 buffered and ready"));
  v2.addEventListener("canplaythrough", () => console.log("vr2 buffered and ready"));
}

function handlePlayVideo(data = {}) {
  const sphere = document.querySelector("#sphere");
  const v1 = document.querySelector("#vr1");
  const v2 = document.querySelector("#vr2");
  let activeVideo;

  if (data.clipId === "vr2") {
    activeVideo = v2;
    sphere.setAttribute("src", "#vr2");
  } else {
    activeVideo = v1;
    sphere.setAttribute("src", "#vr1");
  }

  activeVideo.currentTime = 0;
  activeVideo.play().catch((err) => console.warn("Play failed:", err));
  setStatus(`Playing: ${data.clipId || "vr1"}`);
}

function handlePauseVideo() {
  const v1 = document.querySelector("#vr1");
  const v2 = document.querySelector("#vr2");
  v1.currentTime = 0;
  v2.currentTime = 0;
  v1.pause();
  v2.pause();
  setStatus("Stopped");
}

enableBtn.addEventListener("click", () => {
  document.querySelector("#vr1").muted = false;
  document.querySelector("#vr2").muted = false;
  enableBtn.textContent = "Audio enabled";
  setStatus("Audio unlocked — waiting for trigger");
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "ready", canPlay: true }));
  }
});

document.getElementById("enterVR").addEventListener("click", () => {
  const scene = document.querySelector("a-scene");
  if (scene && scene.enterVR) scene.enterVR();
});

function connect() {
  ws = new WebSocket(wsUrl);
  ws.onopen = () => {
    setStatus("Connected — tap Enable to unlock audio");
    ws.send(JSON.stringify({ type: "ready", canPlay: false }));
  };
  ws.onclose = () => {
    setStatus("Disconnected (reconnecting...)");
    setTimeout(connect, 800);
  };
  ws.onmessage = (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }
    if (msg.type === "trigger360") {
      handlePlayVideo({ clipId: msg.clipId });
      ws.send(JSON.stringify({ type: "ack", for: "trigger360", clipId: msg.clipId }));
    }
    if (msg.type === "stop360") handlePauseVideo();
  };
}

document.addEventListener("DOMContentLoaded", () => {
  prepareVideos();
  connect();
});
