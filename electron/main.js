const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, desktopCapturer, ipcMain, screen } = require("electron");

const NORMAL_CHECK_INTERVAL_MS = 30000;
const OFFTASK_CHECK_INTERVAL_MS = 10000;
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const UI_ZOOM_FACTOR = 0.8;
const DEFAULT_RECOMMENDED_MINUTES = 30;
const DEFAULT_ROAST_MODE = "savage";

const ROAST_MODE_PROMPTS = {
  savage:
    "Tone: brutally sassy and savage, like a witty friend with zero patience. Punchy one-liners. PG-13 only.",
  deadpan_corporate:
    "Tone: deadpan corporate snark. Sound like a sarcastic manager writing performance feedback.",
  calm_disappointment:
    "Tone: calm disappointment with subtle sting. Soft delivery, sharp judgment, still respectful.",
  drill_sergeant:
    "Tone: drill sergeant intensity. Commanding, loud, urgent, high-pressure motivation. PG-13.",
  passive_aggressive_coach:
    "Tone: passive-aggressive productivity coach. KPI-heavy sarcasm, efficiency shade, smug encouragement.",
};

let mainWindow;
let overlayWindow;
let endTimeoutId = null;
let tickerId = null;
let isChecking = false;
let checkLoopTimeoutId = null;
let statsPath = null;

const statsData = {
  currentStreak: 0,
  bestStreak: 0,
  completedSessions: 0,
  distractionFreeSessions: 0,
  totalDistractionEvents: 0,
  distractionSpanCount: 0,
  distractionSpanTotalMs: 0,
  lastSessionAt: null,
};

const monitorState = {
  running: false,
  paused: false,
  endsAt: null,
  lastCheckAt: null,
  lastResult: null,
  runId: 0,
  offTaskMode: false,
  totalDurationMs: 0,
  muteRoast: false,
  roastMode: DEFAULT_ROAST_MODE,
  sessionStartAt: null,
  lastFocusStartAt: null,
  sessionHadDistraction: false,
  workDefinition:
    "Coding, reading docs/papers, writing, project planning, email for work, research, and development tools.",
  gifUrl:
    "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExMWg1c3I5bnE4bjdkcGF6ajFkcWpyMXVpdmw0OXRtejQ0dW53aDUxbyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/v01vVloDJbXrZRvEI8/giphy.gif",
};

function sendStateUpdate(extra = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("monitor:update", {
    ...extra,
    state: getPublicState(),
  });
}

function loadStatsData() {
  try {
    if (!statsPath || !fs.existsSync(statsPath)) {
      return;
    }
    const raw = fs.readFileSync(statsPath, "utf8");
    const parsed = JSON.parse(raw);
    Object.assign(statsData, {
      currentStreak: Number(parsed.currentStreak) || 0,
      bestStreak: Number(parsed.bestStreak) || 0,
      completedSessions: Number(parsed.completedSessions) || 0,
      distractionFreeSessions: Number(parsed.distractionFreeSessions) || 0,
      totalDistractionEvents: Number(parsed.totalDistractionEvents) || 0,
      distractionSpanCount: Number(parsed.distractionSpanCount) || 0,
      distractionSpanTotalMs: Number(parsed.distractionSpanTotalMs) || 0,
      lastSessionAt: parsed.lastSessionAt || null,
    });
  } catch (_error) {
    // Ignore parse/read failures; app can continue with fresh stats.
  }
}

function saveStatsData() {
  try {
    if (!statsPath) {
      return;
    }
    fs.writeFileSync(statsPath, JSON.stringify(statsData, null, 2));
  } catch (_error) {
    // Ignore write failures to avoid breaking monitoring flow.
  }
}

function getAverageFocusSpanMs() {
  if (statsData.distractionSpanCount <= 0) {
    return 0;
  }
  return Math.round(statsData.distractionSpanTotalMs / statsData.distractionSpanCount);
}

function getRecommendedDurationMinutes() {
  const avgMs = getAverageFocusSpanMs();
  if (!avgMs) {
    return DEFAULT_RECOMMENDED_MINUTES;
  }
  const suggested = Math.round((avgMs * 1.1) / 60000);
  return Math.max(5, Math.min(120, suggested));
}

function getStatsSummary() {
  const avgMs = getAverageFocusSpanMs();
  const completed = statsData.completedSessions;
  const free = statsData.distractionFreeSessions;
  return {
    currentStreak: statsData.currentStreak,
    bestStreak: statsData.bestStreak,
    completedSessions: completed,
    distractionFreeSessions: free,
    distractionFreeRate: completed > 0 ? free / completed : 0,
    totalDistractionEvents: statsData.totalDistractionEvents,
    avgFocusSpanMs: avgMs,
    avgFocusSpanMinutes: avgMs ? avgMs / 60000 : 0,
    lastSessionAt: statsData.lastSessionAt,
  };
}

function recordDistractionSpan(spanMs) {
  if (!Number.isFinite(spanMs) || spanMs <= 0) {
    return;
  }
  statsData.totalDistractionEvents += 1;
  statsData.distractionSpanCount += 1;
  statsData.distractionSpanTotalMs += Math.round(spanMs);
  saveStatsData();
}

function sendRoastSpeech(text) {
  if (!mainWindow || mainWindow.isDestroyed() || !text) {
    return;
  }
  mainWindow.webContents.send("monitor:roast", { text: String(text) });
}

function sendStopSpeech() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("monitor:stop-speaking");
}

function getPublicState() {
  const remainingMs = monitorState.paused
    ? Math.max(0, monitorState.remainingOnPause || 0)
    : monitorState.running && monitorState.endsAt
      ? Math.max(0, monitorState.endsAt - Date.now())
      : 0;

  return {
    running: monitorState.running,
    paused: monitorState.paused,
    endsAt: monitorState.endsAt,
    remainingMs,
    lastCheckAt: monitorState.lastCheckAt,
    lastResult: monitorState.lastResult,
    offTaskMode: monitorState.offTaskMode,
    totalDurationMs: monitorState.totalDurationMs,
    muteRoast: monitorState.muteRoast,
    roastMode: monitorState.roastMode,
    recommendedDurationMinutes: getRecommendedDurationMinutes(),
    stats: getStatsSummary(),
    gifUrl: monitorState.gifUrl,
    workDefinition: monitorState.workDefinition,
  };
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setZoomFactor(UI_ZOOM_FACTOR);
  mainWindow.loadFile(path.join(__dirname, "renderer.html"));
}

function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return overlayWindow;
  }

  const primary = screen.getPrimaryDisplay();
  overlayWindow = new BrowserWindow({
    x: primary.bounds.x,
    y: primary.bounds.y,
    width: primary.bounds.width,
    height: primary.bounds.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    movable: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    fullscreenable: false,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setIgnoreMouseEvents(true);
  return overlayWindow;
}

function hideOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
  sendStopSpeech();
}

function showOverlay(roastText) {
  const windowRef = createOverlayWindow();
  const htmlPath = path.join(__dirname, "overlay.html");
  const url = `file://${htmlPath}?gif=${encodeURIComponent(
    monitorState.gifUrl || ""
  )}&roast=${encodeURIComponent(roastText || "Back to work. Right now.")}`;
  windowRef.loadURL(url);
  windowRef.showInactive();
}

function isOverlayVisible() {
  return Boolean(overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function capturePrimaryScreenAsDataUrl() {
  const wasOverlayVisible = isOverlayVisible();
  if (wasOverlayVisible) {
    overlayWindow.hide();
    // Give the compositor a moment so the overlay does not appear in capture.
    await sleep(120);
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: {
        width: Math.max(1280, primaryDisplay.size.width),
        height: Math.max(720, primaryDisplay.size.height),
      },
    });

    const displaySource =
      sources.find((src) => src.display_id === String(primaryDisplay.id)) || sources[0];

    if (!displaySource || displaySource.thumbnail.isEmpty()) {
      throw new Error("Could not capture screen thumbnail.");
    }

    return displaySource.thumbnail.toDataURL();
  } finally {
    if (
      wasOverlayVisible &&
      monitorState.running &&
      !monitorState.paused &&
      monitorState.offTaskMode &&
      overlayWindow &&
      !overlayWindow.isDestroyed()
    ) {
      overlayWindow.showInactive();
    }
  }
}

function parseJsonMaybeWrapped(text) {
  if (!text) {
    throw new Error("Model returned empty response.");
  }

  const cleaned = text.trim();
  if (cleaned.startsWith("{")) {
    return JSON.parse(cleaned);
  }

  const match = cleaned.match(/```json\s*([\s\S]*?)```/i) || cleaned.match(/```([\s\S]*?)```/);
  if (match && match[1]) {
    return JSON.parse(match[1].trim());
  }

  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    return JSON.parse(cleaned.slice(first, last + 1));
  }

  throw new Error("Could not find JSON in model output.");
}

function extractTextFromResponsesPayload(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const chunks = [];
  const outputItems = Array.isArray(data?.output) ? data.output : [];
  for (const item of outputItems) {
    const contentItems = Array.isArray(item?.content) ? item.content : [];
    for (const content of contentItems) {
      if (typeof content?.text === "string" && content.text.trim()) {
        chunks.push(content.text.trim());
      }
    }
  }

  if (chunks.length > 0) {
    return chunks.join("\n");
  }

  const status = data?.status ? `status=${data.status}` : "status=unknown";
  const finishReason =
    data?.incomplete_details?.reason || data?.output?.[0]?.finish_reason || "unknown";
  throw new Error(`Model returned no text (${status}, reason=${finishReason}).`);
}

async function classifyScreenshot(imageDataUrl) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing.");
  }

  const systemPrompt = "You classify whether a screenshot is work related for a productivity app.";

  const userPrompt = [
    "Evaluate this screenshot.",
    `Work context: ${monitorState.workDefinition}`,
    "Rules:",
    '- "is_work_related": true if clearly work/study/productive, otherwise false.',
    '- "confidence": number between 0 and 1.',
    '- "reason": max 18 words.',
    '- "evidence": max 18 words, mention specific visible apps/sites/activities from the screenshot.',
    "Return exactly this JSON schema:",
    '{"is_work_related": boolean, "confidence": number, "reason": string, "evidence": string}',
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: systemPrompt }],
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: userPrompt },
            { type: "input_image", image_url: imageDataUrl },
          ],
        },
      ],
      max_output_tokens: 180,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const outputText = extractTextFromResponsesPayload(data);
  const parsed = parseJsonMaybeWrapped(outputText);

  return {
    is_work_related: Boolean(parsed.is_work_related),
    confidence:
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0,
    reason: String(parsed.reason || ""),
    evidence: String(parsed.evidence || ""),
    roast: "",
  };
}

async function generateRoast(imageDataUrl, reason, evidence) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing.");
  }

  const roastModePrompt =
    ROAST_MODE_PROMPTS[monitorState.roastMode] || ROAST_MODE_PROMPTS[DEFAULT_ROAST_MODE];

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "You write short roast lines for off-task screenshots.\n" +
                roastModePrompt,
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "The screenshot was classified as not work-related. " +
                `Reason: ${reason || "No reason provided."}\n` +
                `Evidence from screen: ${evidence || "No evidence provided."}\n` +
                `Mode: ${monitorState.roastMode}\n` +
                "Write one roast line only. Max 20 words. Make it sassy, specific, and funny. Must reference evidence. No slurs, hate, threats, or profanity.",
            },
            { type: "input_image", image_url: imageDataUrl },
          ],
        },
      ],
      max_output_tokens: 60,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI roast API failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const text = extractTextFromResponsesPayload(data);
  return String(text).replace(/\s+/g, " ").trim().slice(0, 180);
}

async function analyzeWithOpenAI(imageDataUrl) {
  const classification = await classifyScreenshot(imageDataUrl);

  if (!classification.is_work_related) {
    try {
      classification.roast = await generateRoast(
        imageDataUrl,
        classification.reason,
        classification.evidence
      );
    } catch (_error) {
      classification.roast = "Nice detour. Now get back to work.";
    }
  }

  return classification;
}

function scheduleNextCheck(intervalMs) {
  if (checkLoopTimeoutId) {
    clearTimeout(checkLoopTimeoutId);
    checkLoopTimeoutId = null;
  }
  checkLoopTimeoutId = setTimeout(() => {
    void performCheck();
  }, intervalMs);
}

async function performCheck() {
  if (!monitorState.running || monitorState.paused || isChecking) {
    return;
  }

  const runIdAtStart = monitorState.runId;
  isChecking = true;
  monitorState.lastCheckAt = Date.now();
  sendStateUpdate({ event: "check-started" });

  try {
    const screenshotDataUrl = await capturePrimaryScreenAsDataUrl();
    const analysis = await analyzeWithOpenAI(screenshotDataUrl);

    if (
      runIdAtStart !== monitorState.runId ||
      !monitorState.running ||
      monitorState.paused
    ) {
      return;
    }

    monitorState.lastResult = analysis;

    if (analysis.is_work_related) {
      if (monitorState.offTaskMode) {
        monitorState.lastFocusStartAt = Date.now();
      }
      monitorState.offTaskMode = false;
      hideOverlay();
      scheduleNextCheck(NORMAL_CHECK_INTERVAL_MS);
    } else {
      if (!monitorState.offTaskMode) {
        monitorState.sessionHadDistraction = true;
        const startRef = monitorState.lastFocusStartAt || monitorState.sessionStartAt;
        if (startRef) {
          recordDistractionSpan(Date.now() - startRef);
        }
      }
      monitorState.offTaskMode = true;
      showOverlay(analysis.roast);
      if (!monitorState.muteRoast) {
        sendRoastSpeech(analysis.roast);
      }
      scheduleNextCheck(OFFTASK_CHECK_INTERVAL_MS);
    }

    sendStateUpdate({ event: "check-finished" });
  } catch (error) {
    if (
      runIdAtStart !== monitorState.runId ||
      !monitorState.running ||
      monitorState.paused
    ) {
      return;
    }

    monitorState.lastResult = {
      is_work_related: true,
      confidence: 0,
      reason: `Check error: ${error.message}`,
      evidence: "",
      roast: "",
    };
    monitorState.offTaskMode = false;
    hideOverlay();
    sendStateUpdate({ event: "check-error", error: error.message });
    scheduleNextCheck(NORMAL_CHECK_INTERVAL_MS);
  } finally {
    isChecking = false;
  }
}

function clearTimers() {
  if (endTimeoutId) {
    clearTimeout(endTimeoutId);
    endTimeoutId = null;
  }
  if (tickerId) {
    clearInterval(tickerId);
    tickerId = null;
  }
  if (checkLoopTimeoutId) {
    clearTimeout(checkLoopTimeoutId);
    checkLoopTimeoutId = null;
  }
}

function stopMonitoring(reason = "stopped") {
  const wasRunning = monitorState.running;
  monitorState.runId += 1;
  clearTimers();
  monitorState.running = false;
  monitorState.paused = false;
  monitorState.offTaskMode = false;
  monitorState.totalDurationMs = 0;
  if (reason === "timer-finished" && wasRunning) {
    statsData.completedSessions += 1;
    statsData.lastSessionAt = new Date().toISOString();
    if (!monitorState.sessionHadDistraction) {
      statsData.distractionFreeSessions += 1;
      statsData.currentStreak += 1;
      if (statsData.currentStreak > statsData.bestStreak) {
        statsData.bestStreak = statsData.currentStreak;
      }
    } else {
      statsData.currentStreak = 0;
    }
    saveStatsData();
  }
  monitorState.endsAt = null;
  monitorState.remainingOnPause = 0;
  monitorState.sessionStartAt = null;
  monitorState.lastFocusStartAt = null;
  monitorState.sessionHadDistraction = false;
  hideOverlay();
  sendStateUpdate({ event: reason });
}

function startMonitoring({ durationMinutes, workDefinition, gifUrl, muteRoast, roastMode }) {
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    throw new Error("Duration must be a positive number of minutes.");
  }

  monitorState.runId += 1;
  monitorState.running = true;
  monitorState.paused = false;
  monitorState.offTaskMode = false;
  monitorState.totalDurationMs = durationMinutes * 60 * 1000;
  monitorState.muteRoast = Boolean(muteRoast);
  monitorState.roastMode = ROAST_MODE_PROMPTS[roastMode] ? roastMode : DEFAULT_ROAST_MODE;
  monitorState.endsAt = Date.now() + durationMinutes * 60 * 1000;
  monitorState.remainingOnPause = 0;
  monitorState.lastResult = null;
  monitorState.sessionStartAt = Date.now();
  monitorState.lastFocusStartAt = monitorState.sessionStartAt;
  monitorState.sessionHadDistraction = false;
  monitorState.workDefinition =
    workDefinition && workDefinition.trim()
      ? workDefinition.trim()
      : monitorState.workDefinition;
  monitorState.gifUrl = gifUrl && gifUrl.trim() ? gifUrl.trim() : monitorState.gifUrl;

  clearTimers();
  tickerId = setInterval(() => {
    if (monitorState.running && !monitorState.paused) {
      sendStateUpdate({ event: "tick" });
    }
  }, 1000);

  endTimeoutId = setTimeout(() => {
    stopMonitoring("timer-finished");
  }, durationMinutes * 60 * 1000);

  sendStateUpdate({ event: "started" });
  void performCheck();
}

function pauseMonitoring() {
  if (!monitorState.running || monitorState.paused) {
    return;
  }

  monitorState.paused = true;
  monitorState.runId += 1;
  if (monitorState.endsAt) {
    monitorState.remainingOnPause = Math.max(0, monitorState.endsAt - Date.now());
  }
  monitorState.offTaskMode = false;
  clearTimers();
  hideOverlay();
  sendStopSpeech();
  sendStateUpdate({ event: "paused" });
}

function resumeMonitoring() {
  if (!monitorState.running || !monitorState.paused) {
    return;
  }

  const remaining = monitorState.remainingOnPause || 0;
  monitorState.runId += 1;
  monitorState.paused = false;
  monitorState.offTaskMode = false;
  monitorState.endsAt = Date.now() + remaining;
  monitorState.lastFocusStartAt = Date.now();

  clearTimers();
  tickerId = setInterval(() => {
    if (monitorState.running && !monitorState.paused) {
      sendStateUpdate({ event: "tick" });
    }
  }, 1000);

  endTimeoutId = setTimeout(() => {
    stopMonitoring("timer-finished");
  }, remaining);

  sendStateUpdate({ event: "resumed" });
  void performCheck();
}

app.whenReady().then(() => {
  statsPath = path.join(app.getPath("userData"), "stats.json");
  loadStatsData();
  createMainWindow();

  ipcMain.handle("monitor:get-state", () => getPublicState());
  ipcMain.handle("monitor:start", (_event, payload) => {
    startMonitoring(payload || {});
    return getPublicState();
  });
  ipcMain.handle("monitor:pause", () => {
    pauseMonitoring();
    return getPublicState();
  });
  ipcMain.handle("monitor:resume", () => {
    resumeMonitoring();
    return getPublicState();
  });
  ipcMain.handle("monitor:stop", () => {
    stopMonitoring("stopped");
    return getPublicState();
  });
});

app.on("window-all-closed", () => {
  stopMonitoring("app-closed");
  app.quit();
});
