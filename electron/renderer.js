function msToClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function formatSessionDate(value) {
  if (!value) {
    return "Never";
  }
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) {
    return "Never";
  }
  return dt.toLocaleString();
}

const els = {
  tabMainBtn: document.getElementById("tabMainBtn"),
  tabStatsBtn: document.getElementById("tabStatsBtn"),
  tabMain: document.getElementById("tabMain"),
  tabStats: document.getElementById("tabStats"),
  duration: document.getElementById("duration"),
  workDefinition: document.getElementById("workDefinition"),
  roastMode: document.getElementById("roastMode"),
  gifUrl: document.getElementById("gifUrl"),
  muteBtn: document.getElementById("muteBtn"),
  muteIcon: document.getElementById("muteIcon"),
  muteLabel: document.getElementById("muteLabel"),
  timerRing: document.getElementById("timerRing"),
  ringTime: document.getElementById("ringTime"),
  durationChip: document.getElementById("durationChip"),
  statusDot: document.getElementById("statusDot"),
  startBtn: document.getElementById("startBtn"),
  pauseBtn: document.getElementById("pauseBtn"),
  resumeBtn: document.getElementById("resumeBtn"),
  stopBtn: document.getElementById("stopBtn"),
  statusText: document.getElementById("statusText"),
  timeLeft: document.getElementById("timeLeft"),
  recommendedText: document.getElementById("recommendedText"),
  lastReason: document.getElementById("lastReason"),
  lastRoast: document.getElementById("lastRoast"),
  streakValue: document.getElementById("streakValue"),
  bestStreakValue: document.getElementById("bestStreakValue"),
  avgFocusValue: document.getElementById("avgFocusValue"),
  recommendedValue: document.getElementById("recommendedValue"),
  completedSessionsValue: document.getElementById("completedSessionsValue"),
  freeRateValue: document.getElementById("freeRateValue"),
  distractionEventsValue: document.getElementById("distractionEventsValue"),
  lastSessionValue: document.getElementById("lastSessionValue"),
};

let localTotalDurationMs = Number(els.duration.value || 30) * 60 * 1000;
let muteRoast = false;

function speakRoast(text) {
  if (!("speechSynthesis" in window) || !text || muteRoast) {
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.volume = 1;
  window.speechSynthesis.speak(utterance);
}

function stopSpeaking() {
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

function renderMuteState() {
  els.muteBtn.classList.toggle("active", muteRoast);
  els.muteIcon.textContent = muteRoast ? "\uD83D\uDD07" : "\uD83D\uDD0A";
  els.muteLabel.textContent = muteRoast ? "Voice Off" : "Voice On";
}

function updateTimerProgress(state, event) {
  if (state.running && state.totalDurationMs > 0) {
    localTotalDurationMs = state.totalDurationMs;
  } else if (event === "started") {
    localTotalDurationMs = Number(els.duration.value || 30) * 60 * 1000;
  }

  const remaining = Math.max(0, state.remainingMs || 0);
  const total = Math.max(1, localTotalDurationMs || 1);
  const progress = Math.max(0, Math.min(100, (remaining / total) * 100));

  els.timerRing.style.setProperty("--progress", String(progress));
  const timeText = msToClock(remaining);
  els.timeLeft.textContent = timeText;
  els.ringTime.textContent = timeText;
  els.durationChip.textContent = `${Math.max(1, Math.round(total / 60000))} min`;
}

function renderStats(state) {
  const stats = state.stats || {};
  const recommended = Number(state.recommendedDurationMinutes) || 30;
  const avgMin = Number(stats.avgFocusSpanMinutes) || 0;
  const freeRate = Math.round((Number(stats.distractionFreeRate) || 0) * 100);

  els.recommendedText.textContent = `Recommended: ${recommended} min`;
  els.recommendedValue.textContent = String(recommended);
  els.streakValue.textContent = String(stats.currentStreak || 0);
  els.bestStreakValue.textContent = String(stats.bestStreak || 0);
  els.avgFocusValue.textContent = avgMin.toFixed(1);
  els.completedSessionsValue.textContent = String(stats.completedSessions || 0);
  els.freeRateValue.textContent = String(freeRate);
  els.distractionEventsValue.textContent = String(stats.totalDistractionEvents || 0);
  els.lastSessionValue.textContent = formatSessionDate(stats.lastSessionAt);
}

function renderState(state, event = "") {
  if (!state.running) {
    els.statusText.textContent = event === "timer-finished" ? "Finished" : "Idle";
    els.statusDot.className = "dot status-dot idle";
    els.startBtn.disabled = false;
    els.pauseBtn.disabled = true;
    els.resumeBtn.disabled = true;
    els.stopBtn.disabled = true;
    if (event !== "timer-finished") {
      localTotalDurationMs = Number(els.duration.value || 30) * 60 * 1000;
    }
  } else if (state.paused) {
    els.statusText.textContent = "Paused";
    els.statusDot.className = "dot status-dot paused";
    els.startBtn.disabled = true;
    els.pauseBtn.disabled = true;
    els.resumeBtn.disabled = false;
    els.stopBtn.disabled = false;
  } else {
    els.statusText.textContent = "Running";
    els.statusDot.className = "dot status-dot running";
    els.startBtn.disabled = true;
    els.pauseBtn.disabled = false;
    els.resumeBtn.disabled = true;
    els.stopBtn.disabled = false;
  }

  updateTimerProgress(state, event);

  const result = state.lastResult;
  els.lastReason.textContent = result?.reason || "None yet.";
  els.lastRoast.textContent =
    result && result.is_work_related
      ? "None (you were working)."
      : result?.roast || "None yet.";
  muteRoast = Boolean(state.muteRoast);
  if (state.roastMode) {
    els.roastMode.value = state.roastMode;
  }
  renderMuteState();
  renderStats(state);
}

async function refreshState() {
  const state = await window.monitorApi.getState();
  renderState(state);
}

els.startBtn.addEventListener("click", async () => {
  try {
    const durationMinutes = Number(els.duration.value);
    localTotalDurationMs = durationMinutes * 60 * 1000;
    const payload = {
      durationMinutes,
      workDefinition: els.workDefinition.value,
      roastMode: els.roastMode.value,
      gifUrl: els.gifUrl.value,
      muteRoast,
    };
    const state = await window.monitorApi.start(payload);
    renderState(state, "started");
  } catch (error) {
    els.statusText.textContent = `Error: ${error.message}`;
  }
});

els.pauseBtn.addEventListener("click", async () => {
  const state = await window.monitorApi.pause();
  renderState(state, "paused");
});

els.resumeBtn.addEventListener("click", async () => {
  const state = await window.monitorApi.resume();
  renderState(state, "resumed");
});

els.stopBtn.addEventListener("click", async () => {
  const state = await window.monitorApi.stop();
  renderState(state, "stopped");
});

window.monitorApi.onUpdate((payload) => {
  renderState(payload.state, payload.event);
});

window.monitorApi.onRoast((payload) => {
  speakRoast(payload?.text || "");
});

window.monitorApi.onStopSpeaking(() => {
  stopSpeaking();
});

els.muteBtn.addEventListener("click", () => {
  muteRoast = !muteRoast;
  renderMuteState();
});

els.tabMainBtn.addEventListener("click", () => {
  els.tabMainBtn.classList.add("active");
  els.tabStatsBtn.classList.remove("active");
  els.tabMain.classList.remove("hidden");
  els.tabStats.classList.add("hidden");
});

els.tabStatsBtn.addEventListener("click", () => {
  els.tabStatsBtn.classList.add("active");
  els.tabMainBtn.classList.remove("active");
  els.tabStats.classList.remove("hidden");
  els.tabMain.classList.add("hidden");
});

void refreshState();

