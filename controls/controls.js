// -------------------- Playback controls --------------------
const playBtn = document.getElementById("play");
const pauseBtn = document.getElementById("pause");
const stopBtn = document.getElementById("stop");
const seek = document.getElementById("seek");
const seekBtn = document.getElementById("seekBtn");
const tEl = document.getElementById("t");

playBtn.onclick = async () => {
  try {
    await window.op.play();
  } catch (e) {
    console.error(e);
  }
};

pauseBtn.onclick = async () => {
  try {
    await window.op.pause();
  } catch (e) {
    console.error(e);
  }
};

stopBtn.onclick = async () => {
  try {
    await window.op.stop();
  } catch (e) {
    console.error(e);
  }
};

seekBtn.onclick = async () => {
  try {
    await window.op.seek(Number(seek.value));
  } catch (e) {
    console.error(e);
  }
};

window.op.onTick(({ playhead, playing, duration }) => {
  tEl.textContent = `t=${playhead.toFixed(2)} ${playing ? "(playing)" : "(paused)"}`;
  if (!seek.matches(":active")) {
    if (duration) seek.max = String(duration);
    seek.value = String(playhead);
  }
});

// -------------------- Screen video assignment --------------------
const WALL_VIDEOS = [
  "screen0.mp4",
  "screen1.mp4",
  "screen2.mp4",
  "screen3.mp4",
];
const NUM_SCREENS = 3; // matches createWallWindows slice(0, 3)
const assignContainer = document.getElementById("screenAssign");

for (let i = 0; i < NUM_SCREENS; i++) {
  const row = document.createElement("div");
  row.className = "row";

  const label = document.createElement("label");
  label.textContent = `Screen ${i}:`;
  label.style.minWidth = "70px";

  const select = document.createElement("select");
  select.id = `screenSel${i}`;
  WALL_VIDEOS.forEach((f) => {
    const opt = document.createElement("option");
    opt.value = f;
    opt.textContent = f;
    if (f === `screen${i}.mp4`) opt.selected = true;
    select.appendChild(opt);
  });

  const btn = document.createElement("button");
  btn.textContent = "Assign";
  btn.onclick = async () => {
    const videoFile = select.value;
    try {
      await window.op.setVideo(i, videoFile);
      btn.textContent = "✓ Assigned";
      setTimeout(() => (btn.textContent = "Assign"), 1500);
    } catch (e) {
      console.error(e);
    }
  };

  row.appendChild(label);
  row.appendChild(select);
  row.appendChild(btn);
  assignContainer.appendChild(row);
}
