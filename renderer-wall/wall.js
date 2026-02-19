console.log("wall.js loaded ✅");

const params = new URLSearchParams(location.search);
const screenIndex = Number(params.get("screen") || 0);

const video = document.getElementById("vid");
if (!video) throw new Error("No #vid element");

const base = "http://localhost:5173/wallmedia";
const src = `${base}/screen${screenIndex}.mp4`;

console.log("Screen", screenIndex, "src =", src);

video.src = src;
video.preload = "auto";
video.playsInline = true;
video.autoplay = true;
video.loop = false;
video.muted = true; // set false if you want audio
video.controls = false;

video.addEventListener("error", () => {
  console.error("VIDEO ERROR", video.error, "currentSrc:", video.currentSrc);
});
video.addEventListener("loadedmetadata", () => {
  console.log(
    "loadedmetadata",
    video.duration,
    video.videoWidth,
    video.videoHeight,
  );
});

video.play().catch((err) => console.error("play() failed:", err));
