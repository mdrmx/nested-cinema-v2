// Status display element for showing connection/playback state to the user
const statusEl = document.getElementById("status");

let ws;
// Connect over WSS using the same host as the page (certificate must match)
const wsUrl = `wss://${location.host}`;

// Map of filename → <video> element, populated by initVideos()
const vrVideos = new Map();

// Updates the on-screen status message
function setStatus(msg) {
  statusEl.textContent = msg;
}

// Fetches the VR video list from the server, creates <video> elements for each
// file, injects them into <a-assets>, and begins preloading.
async function initVideos() {
  let files = [];
  try {
    const res = await fetch("/api/vr-videos");
    const data = await res.json();
    files = data.files || [];
  } catch (e) {
    console.warn("Could not fetch VR video list:", e);
  }

  const assets = document.querySelector("a-assets");
  files.forEach((filename) => {
    const video = document.createElement("video");
    // Build a safe DOM id from the filename
    video.id = `vr-${filename.replace(/[^a-z0-9]/gi, "-")}`;
    video.setAttribute("preload", "auto");
    video.muted = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.setAttribute("crossorigin", "anonymous");

    const source = document.createElement("source");
    source.src = `/media360/${filename}`;
    source.type = "video/mp4";
    video.appendChild(source);

    video.addEventListener("canplaythrough", () =>
      console.log(`${filename} ready`),
    );
    assets.appendChild(video);
    vrVideos.set(filename, video);
    video.load();
  });

  console.log(`Loaded ${files.length} VR video(s):`, files);
}

// Returns the <video> element for a given filename, creating and loading it
// on-demand if it was added to the server after the page loaded.
function getOrCreateVideo(filename) {
  if (vrVideos.has(filename)) return Promise.resolve(vrVideos.get(filename));

  const assets = document.querySelector("a-assets");
  const video = document.createElement("video");
  video.id = `vr-${filename.replace(/[^a-z0-9]/gi, "-")}`;
  video.setAttribute("preload", "auto");
  video.muted = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.setAttribute("crossorigin", "anonymous");

  const source = document.createElement("source");
  source.src = `/media360/${filename}`;
  source.type = "video/mp4";
  video.appendChild(source);

  assets.appendChild(video);
  vrVideos.set(filename, video);

  return new Promise((resolve) => {
    video.addEventListener("canplay", () => resolve(video), { once: true });
    // Don't hang forever on a bad filename — resolve anyway and let play() fail
    video.addEventListener("error", () => resolve(video), { once: true });
    video.load();
  });
}

// Plays the requested VR clip and binds it to the A-Frame sphere texture.
async function handlePlayVideo(data = {}) {
  const sphere = document.querySelector("#sphere");
  const filename = data.clipId;

  const video = await getOrCreateVideo(filename);

  // Pause all other videos before switching
  for (const [, v] of vrVideos) {
    if (v !== video) {
      v.pause();
      v.currentTime = 0;
    }
  }

  // Update the sphere texture directly via Three.js — more reliable than
  // setAttribute when videos are injected dynamically after scene init.
  const mesh = sphere.getObject3D("mesh");
  if (mesh && mesh.material) {
    if (mesh.material.map) mesh.material.map.dispose();
    const texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.SRGBColorSpace; // match A-Frame's pipeline; prevents washed-out output
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    mesh.material.map = texture;
    mesh.material.needsUpdate = true;
  } else {
    // Fallback: scene mesh not ready (very early load)
    sphere.setAttribute("src", "#" + video.id);
  }
  video.currentTime = 0;
  video.play().catch((err) => console.warn("Play failed:", err));
  setStatus(`Playing: ${filename}`);
}

// Stops and resets all video elements
function handlePauseVideo() {
  for (const [, video] of vrVideos) {
    video.pause();
    video.currentTime = 0;
  }
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

    // stop360: halt playback and reset all videos
    if (msg.type === "stop360") handlePauseVideo();
  };
}

// Bootstrap: fetch video list then open the WebSocket connection
document.addEventListener("DOMContentLoaded", () => {
  initVideos();
  connect();
});
