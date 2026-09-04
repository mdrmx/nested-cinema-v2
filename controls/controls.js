// -------------------- Playback controls --------------------
const playBtn = document.getElementById("play");
const pauseBtn = document.getElementById("pause");
const stopBtn = document.getElementById("stop");
const seek = document.getElementById("seek");
const tEl = document.getElementById("t");

const dur = document.getElementById("dur");
const setDurBtn = document.getElementById("setDur");
const openProjectionBtn = document.getElementById("openProjection");

openProjectionBtn.onclick = async () => {
  try {
    await window.op.openProjection();
  } catch (e) {
    console.error(e);
  }
};

setDurBtn.onclick = async () => {
  const d = Number(dur.value);
  if (!Number.isFinite(d) || d <= 0) return;
  try {
    await window.op.setDuration(d);
    seek.max = String(d);
  } catch (e) {
    console.error(e);
  }
};

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

// Live seek while dragging: fires continuously as the thumb moves
seek.addEventListener("input", async () => {
  try {
    await window.op.seek(Number(seek.value));
  } catch (e) {
    console.error(e);
  }
});

// Seek on release: ensures a final accurate seek when the user drops the thumb
seek.addEventListener("change", async () => {
  try {
    await window.op.seek(Number(seek.value));
  } catch (e) {
    console.error(e);
  }
});

window.op.onTick(({ playhead, playing, duration }) => {
  tEl.textContent = `${playhead.toFixed(2)} ${playing ? "(playing)" : "(paused)"}`;
  if (!seek.matches(":active")) {
    if (duration) seek.max = String(duration);
    seek.value = String(playhead);
  }
});

// -------------------- Screen video assignment --------------------
const assignContainer = document.getElementById("screenAssign");

// selects[i] holds the <select> for screen i so refreshWallVideos can repopulate them
const screenSelects = [];

function buildScreenRows(numScreens) {
  assignContainer.innerHTML = "";
  screenSelects.length = 0;

  for (let i = 0; i < numScreens; i++) {
    const row = document.createElement("div");
    row.className = "row";

    const label = document.createElement("label");
    label.textContent = `Screen ${i}:`;
    label.style.minWidth = "70px";

    const select = document.createElement("select");
    select.id = `screenSel${i}`;
    screenSelects.push(select);

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

    // Mute toggle — screen 0 is unmuted by default (primary audio screen)
    let muted = i !== 0;
    const muteBtn = document.createElement("button");
    muteBtn.textContent = muted ? "🔇 Unmute" : "🔊 Mute";
    muteBtn.style.background = muted ? "#6c757d" : "#17a2b8";
    muteBtn.onclick = async () => {
      muted = !muted;
      try {
        await window.op.setMuted(i, muted);
        muteBtn.textContent = muted ? "🔇 Unmute" : "🔊 Mute";
        muteBtn.style.background = muted ? "#6c757d" : "#17a2b8";
      } catch (e) {
        console.error(e);
      }
    };

    row.appendChild(label);
    row.appendChild(select);
    row.appendChild(btn);
    row.appendChild(muteBtn);
    assignContainer.appendChild(row);
  }
}

// Fetches the current file list from main and repopulates all screen selects.
async function refreshWallVideos() {
  let files;
  try {
    files = await window.op.listWallVideos();
  } catch (e) {
    console.error("listWallVideos failed", e);
    return;
  }
  screenSelects.forEach((select, i) => {
    const prev = select.value;
    select.innerHTML = "";
    if (files.length === 0) {
      const opt = document.createElement("option");
      opt.textContent = "(no videos found)";
      opt.disabled = true;
      select.appendChild(opt);
      return;
    }
    files.forEach((f, fi) => {
      const opt = document.createElement("option");
      opt.value = f;
      opt.textContent = f;
      // Re-select previous value if still present, otherwise default to screen-index position
      if (f === prev || (!prev && fi === i)) opt.selected = true;
      select.appendChild(opt);
    });
  });
}

(async () => {
  try {
    const count = await window.op.getScreenCount();
    buildScreenRows(count);
  } catch (e) {
    console.error("getScreenCount failed, falling back to 1", e);
    buildScreenRows(1);
  }
  await refreshWallVideos();
})();

// -------------------- VR Cue editor --------------------
const cueListBody = document.getElementById("cueListBody");
const addCueBtn = document.getElementById("addCueBtn");

const CUE_TYPES = ["trigger360", "stop360"];
let vrClipIds = [];

async function refreshVrVideos() {
  try {
    vrClipIds = await window.op.listVrVideos();
  } catch (e) {
    console.error("listVrVideos failed", e);
    vrClipIds = [];
  }
}

// Replaces a cue by index: deletes the old entry then inserts the updated values.
async function updateCue(index, newValues) {
  const del = await window.op.deleteCue(index);
  if (!del.ok) return null;
  const cue = { time: newValues.time, type: newValues.type };
  if (newValues.type === "trigger360")
    cue.clipId = String(newValues.clipId || "");
  const set = await window.op.setCue(cue);
  return set.ok ? set.cues : null;
}

// Renders the cues array into the table with inline-editable cells.
function renderCues(cues) {
  cueListBody.innerHTML = "";

  cues.forEach((cue, i) => {
    const tr = document.createElement("tr");
    // Mirror current values on the row so sibling cells can read pending state
    tr.dataset.time = cue.time;
    tr.dataset.type = cue.type;
    tr.dataset.clipId = cue.clipId || vrClipIds[0] || "";

    const getRowValues = () => ({
      time: Number(tr.dataset.time),
      type: tr.dataset.type,
      clipId: tr.dataset.clipId,
    });

    // --- Time cell (click → number input, Enter/blur to commit) ---
    const timeTd = document.createElement("td");
    timeTd.dataset.editable = "1";
    timeTd.textContent = cue.time.toFixed(2);
    timeTd.addEventListener("click", () => {
      if (timeTd.querySelector("input")) return;
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.step = "0.1";
      input.value = tr.dataset.time;
      input.style.width = "70px";
      timeTd.textContent = "";
      timeTd.appendChild(input);
      input.focus();
      input.select();

      async function commitTime() {
        const v = Number(input.value);
        if (Number.isFinite(v) && v >= 0) {
          tr.dataset.time = v;
          const updated = await updateCue(i, getRowValues());
          if (updated) renderCues(updated);
        } else {
          timeTd.textContent = Number(tr.dataset.time).toFixed(2);
        }
      }
      input.addEventListener("blur", commitTime);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          input.blur();
        }
        if (e.key === "Escape") {
          input.removeEventListener("blur", commitTime);
          timeTd.textContent = Number(tr.dataset.time).toFixed(2);
        }
      });
    });

    // --- Type cell (click → select, change to commit) ---
    const typeTd = document.createElement("td");
    typeTd.dataset.editable = "1";
    typeTd.textContent = cue.type;
    typeTd.addEventListener("click", () => {
      if (typeTd.querySelector("select")) return;
      const sel = document.createElement("select");
      CUE_TYPES.forEach((t) => {
        const opt = document.createElement("option");
        opt.value = t;
        opt.textContent = t;
        if (t === tr.dataset.type) opt.selected = true;
        sel.appendChild(opt);
      });
      typeTd.textContent = "";
      typeTd.appendChild(sel);
      sel.focus();

      let committed = false;
      sel.addEventListener("change", async () => {
        committed = true;
        tr.dataset.type = sel.value;
        const updated = await updateCue(i, getRowValues());
        if (updated) renderCues(updated);
      });
      sel.addEventListener("blur", () => {
        if (!committed) typeTd.textContent = tr.dataset.type;
      });
    });

    // --- Clip cell (click → select; hidden for stop360) ---
    const clipTd = document.createElement("td");
    const isStop = cue.type === "stop360";
    clipTd.textContent = isStop ? "—" : cue.clipId || "vr1";
    if (!isStop) {
      clipTd.dataset.editable = "1";
      clipTd.addEventListener("click", () => {
        if (clipTd.querySelector("select")) return;
        const sel = document.createElement("select");
        vrClipIds.forEach((id) => {
          const opt = document.createElement("option");
          opt.value = id;
          opt.textContent = id;
          if (id === tr.dataset.clipId) opt.selected = true;
          sel.appendChild(opt);
        });
        clipTd.textContent = "";
        clipTd.appendChild(sel);
        sel.focus();

        let committed = false;
        sel.addEventListener("change", async () => {
          committed = true;
          tr.dataset.clipId = sel.value;
          const updated = await updateCue(i, getRowValues());
          if (updated) renderCues(updated);
        });
        sel.addEventListener("blur", () => {
          if (!committed)
            clipTd.textContent = tr.dataset.clipId || vrClipIds[0] || "";
        });
      });
    }

    // --- Delete button ---
    const delTd = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.textContent = "Delete";
    delBtn.onclick = async () => {
      const result = await window.op.deleteCue(i);
      if (result.ok) renderCues(result.cues);
    };
    delTd.appendChild(delBtn);

    tr.appendChild(timeTd);
    tr.appendChild(typeTd);
    tr.appendChild(clipTd);
    tr.appendChild(delTd);
    cueListBody.appendChild(tr);
  });
}

// Adds a new default cue row — user can immediately click cells to edit values
addCueBtn.addEventListener("click", async () => {
  const result = await window.op.setCue({
    time: 0,
    type: "trigger360",
    clipId: vrClipIds[0] || "",
  });
  if (result.ok) renderCues(result.cues);
});

// Load VR video list then display cues on startup
refreshVrVideos().then(() => window.op.getCues().then(renderCues));
