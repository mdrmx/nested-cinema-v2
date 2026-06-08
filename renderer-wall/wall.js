console.log("wall.js loaded ✅");

// Read which physical screen this window represents from the URL query string
// e.g. wall.html?screen=2 → screenIndex = 2
const params = new URLSearchParams(location.search);
const screenIndex = Number(params.get("screen") || 0);

// The single full-screen video element that fills this wall panel
const video = document.getElementById("vid");
if (!video) throw new Error("No #vid element");

// Load the per-screen video asset served by the local Vite dev server
video.src = `https://localhost:5173/wallmedia/screen${screenIndex}.mp4`;
video.preload = "auto";
video.playsInline = true;
video.autoplay = false;
video.loop = false;
video.muted = true; // must be muted for autoplay policy compliance
video.controls = false;

// Allow operator to hot-swap the video file without restarting the window.
// Preserves the current playhead position and resumes playback if it was running.
window.timeline.onSetVideo(({ videoFile }) => {
  const wasPlaying = !video.paused;
  const t = video.currentTime;
  video.src = `https://localhost:5173/wallmedia/${videoFile}`;
  video.load();
  video.currentTime = t;
  if (wasPlaying) video.play().catch(() => {});
  console.log(`[WALL ${screenIndex}] video swapped to ${videoFile}`);
});

// Drift thresholds for sync correction.
// Drifts larger than HARD_SNAP are corrected by seeking directly to the target.
// Drifts between SOFT_NUDGE and HARD_SNAP are corrected by slightly adjusting playback rate.
const HARD_SNAP = 0.12; // seconds — hard seek threshold
const SOFT_NUDGE = 0.04; // seconds — soft rate-nudge threshold

// Most-recent timeline state received from the main process, plus the
// local timestamp at which it arrived (used to extrapolate the current target).
let lastState = null;
let stateReceivedAt = 0;

// Guard to prevent overlapping video.play() calls, which cause AbortError cascades.
let playPending = false;

// Extrapolates the expected video position from the last known state.
// If paused, returns the fixed offset; if playing, advances by elapsed wall-clock time.
function targetFromState(state) {
  if (!state.playing) return state.offset;
  const dt = (performance.now() - stateReceivedAt) / 1000;
  return state.offset + dt * (state.rate || 1.0);
}

// Synchronises the video element to the current target time derived from `state`.
// Uses three strategies in decreasing aggressiveness:
//   1. Pause/seek when the timeline is stopped.
//   2. Hard seek when drift exceeds HARD_SNAP.
//   3. Rate nudge (±1.5 %) when drift is between SOFT_NUDGE and HARD_SNAP.
async function applyState(state) {
  const target = targetFromState(state);
  if (!Number.isFinite(target)) return;

  if (!state.playing) {
    if (!video.paused) video.pause();
    if (Math.abs(video.currentTime - target) > 0.02) video.currentTime = target;
    video.playbackRate = 1.0;
    return;
  }

  // Ensure the video is playing before measuring drift.
  // Skip if a play() call is already in-flight (AbortError guard) or if the
  // video hasn't buffered enough data yet (NotSupportedError / AbortError guard).
  if (video.paused && !playPending) {
    if (video.readyState < 2 /* HAVE_CURRENT_DATA */) return;
    playPending = true;
    try {
      await video.play();
    } catch (e) {
      console.error("video.play failed", e);
      return; // skip drift correction — video isn't playing
    } finally {
      playPending = false;
    }
  }

  const drift = video.currentTime - target;

  // Hard snap: jump directly to the target position
  if (Math.abs(drift) > HARD_SNAP) {
    video.currentTime = target;
    video.playbackRate = 1.0;
    return;
  }

  // Soft nudge: slow down if ahead, speed up if behind
  if (Math.abs(drift) > SOFT_NUDGE) {
    video.playbackRate = drift > 0 ? 0.985 : 1.015;
  } else {
    video.playbackRate = 1.0;
  }
}

// Diagnostic event listeners for monitoring playback health
video.addEventListener("error", () =>
  console.error("VIDEO ERROR", video.error, video.currentSrc)
);
video.addEventListener("playing", () => console.log("VIDEO playing"));
video.addEventListener("pause", () => console.log("VIDEO paused"));
video.addEventListener("loadedmetadata", () =>
  console.log("metadata duration", video.duration)
);

// Receive timeline state updates pushed from the main process via
// the IPC bridge exposed in renderer-wall/preload.js as window.timeline.onState
window.timeline.onState((state) => {
  lastState = state;
  stateReceivedAt = performance.now();
  applyState(state);
});

// Periodic safety check — re-applies the last known state every 250 ms
// to correct any drift that accumulates between IPC messages
setInterval(() => {
  if (lastState) applyState(lastState);
}, 250);
