console.log("controls.js loaded ✅", window.op);

const playBtn = document.getElementById("play");
const pauseBtn = document.getElementById("pause");
const stopBtn = document.getElementById("stop");
const seek = document.getElementById("seek");
const seekBtn = document.getElementById("seekBtn");
const tEl = document.getElementById("t");

playBtn.onclick = async () => {
  console.log("PLAY click");
  try {
    await window.op.play();
  } catch (e) {
    console.error(e);
  }
};

pauseBtn.onclick = async () => {
  console.log("PAUSE click");
  try {
    await window.op.pause();
  } catch (e) {
    console.error(e);
  }
};

stopBtn.onclick = async () => {
  console.log("STOP click");
  try {
    await window.op.stop();
  } catch (e) {
    console.error(e);
  }
};

seekBtn.onclick = async () => {
  console.log("SEEK click", seek.value);
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
