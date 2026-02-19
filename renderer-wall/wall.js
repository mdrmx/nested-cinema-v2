console.log("wall.js loaded ✅");

const params = new URLSearchParams(location.search);
const screenIndex = Number(params.get("screen") || 0);

const video = document.getElementById("vid");
if (!video) throw new Error("No #vid element");

video.src = `http://localhost:5173/wallmedia/screen${screenIndex}.mp4`;
video.preload = "auto";
video.playsInline = true;
video.autoplay = false;
video.loop = false;
video.muted = true;
video.controls = false;

const HARD_SNAP = 0.12;
const SOFT_NUDGE = 0.04;

let lastState = null;
let stateReceivedAt = 0;

function targetFromState(state) {
  if (!state.playing) return state.offset;
  const dt = (performance.now() - stateReceivedAt) / 1000;
  return state.offset + dt * (state.rate || 1.0);
}

async function applyState(state) {
  const target = targetFromState(state);
  if (!Number.isFinite(target)) return;

  if (!state.playing) {
    if (!video.paused) video.pause();
    if (Math.abs(video.currentTime - target) > 0.02) video.currentTime = target;
    video.playbackRate = 1.0;
    return;
  }

  // playing:
  if (video.paused) {
    try {
      await video.play();
    } catch (e) {
      console.error("video.play failed", e);
    }
  }

  const drift = video.currentTime - target;

  if (Math.abs(drift) > HARD_SNAP) {
    video.currentTime = target;
    video.playbackRate = 1.0;
    return;
  }

  if (Math.abs(drift) > SOFT_NUDGE) {
    video.playbackRate = drift > 0 ? 0.985 : 1.015;
  } else {
    video.playbackRate = 1.0;
  }
}

video.addEventListener("error", () =>
  console.error("VIDEO ERROR", video.error, video.currentSrc),
);
video.addEventListener("playing", () => console.log("VIDEO playing"));
video.addEventListener("pause", () => console.log("VIDEO paused"));
video.addEventListener("loadedmetadata", () =>
  console.log("metadata duration", video.duration),
);

// This requires renderer-wall/preload.js exposing window.timeline.onState
window.timeline.onState((state) => {
  lastState = state;
  stateReceivedAt = performance.now();
  applyState(state);
});

// Safety drift corrections
setInterval(() => {
  if (lastState) applyState(lastState);
}, 250);
