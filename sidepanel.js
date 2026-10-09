/**
 * SIDE PANEL LOGIC
 *
 * Handles the UI for TubeInsight: video detection, transcript analysis,
 * rendering results, and export features.
 */

const DEBUG = false;
const debugLog = (...args) => {
  if (DEBUG) console.log(...args);
};

// ============================================================
// STATE
// ============================================================

let currentVideoId = null;
let currentVideoUrl = null;
let currentAnalysis = null;
let currentTranscript = null;
let currentTranscriptText = null; // Plain text (for display/export)
let currentTranscriptTimestamped = null; // With timestamps for AI analysis
let currentTranscriptLanguage = null;
let currentVideoTitle = "";
let currentChannelName = "";
let currentVideoDescription = "";
let currentVideoDuration = 0;
let isAnalysisLoading = false; // Track if analysis is in progress
let currentProductIntelligence = null;
let isProductIntelligenceLoading = false;
let currentPrdContent = null;
let isPrdLoading = false;
let currentIndustryInsights = null;
let isIndustryInsightsLoading = false;
let isKnowledgeExportLoading = false;
let tabCheckGeneration = 0;
let digestGeneration = 0;
let digestInFlight = null;
let analysisInFlight = null;
const COMPARE_LIBRARY_KEY = "ytd_compare_library";
const MAX_COMPARE_VIDEOS = 10;
let compareLibrary = [];
let currentComparisonReport = "";
let isCompareLibraryLoading = false;
let isComparisonReportLoading = false;
let compareAddGeneration = 0;
let compareLibraryRevision = 0;
let youtubeTabId = null; // Store the YouTube tab ID for reliable messaging
let errorAction = null;

// --- Translation state ---
// The universal language control supports original content, Chinese, and an
// aligned bilingual view across Transcript, Overview, and Notes.
let currentTranscriptMode = "original";
const DISPLAY_LANGUAGE_MODE_KEY = "ytd_display_language_modes_by_video";
const DISPLAY_LANGUAGE_MODES = new Set(["original", "zh", "bilingual"]);
let translationGeneration = 0; // Invalidates responses from older UI modes/videos.
let translationWorkCount = 0;
let transcriptScrollObserver = null;
// Stable keys include the video, source mode, language, and semantic segment ID.
let transcriptParagraphCache = new Map();
let interfaceTranslationCache = new Map();
let interfaceTranslationInFlight = new Set();
let interfaceTranslationFailures = new Set();
let currentNotes = [];
let currentNotesFilterVideoId = null;
const TRANSLATION_MESSAGE_TIMEOUT_MS = 130_000;
const TRANSLATION_BATCH_SIZE = 3;

async function waitForCurrentOperation(videoId, isLoading, timeoutMs = 130_000) {
  const startedAt = Date.now();
  while (isLoading()) {
    if (videoId !== currentVideoId) return false;
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error("AI 请求超时，请稍后重试。");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return videoId === currentVideoId;
}

// --- Transcript search state ---
// Matches point to visible marks in the active transcript language mode.
// Search navigation only scrolls the panel. It does not seek the video.
let transcriptSearchMatches = [];
let transcriptSearchIndex = -1;

/**
 * Prevent a stopped service worker or dead message channel from leaving the
 * transcript queue stuck forever. The underlying Chrome message cannot be
 * cancelled, so settled guards deliberately ignore any late response.
 */
function sendTranslationMessage(message) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      callback(value);
    };

    timeoutId = setTimeout(() => {
      finish(
        reject,
        new Error(
          "Translation request timed out after 130 seconds. Please Retry.",
        ),
      );
    }, TRANSLATION_MESSAGE_TIMEOUT_MS);

    let messagePromise;
    try {
      messagePromise = chrome.runtime.sendMessage(message);
    } catch (error) {
      finish(reject, error);
      return;
    }

    Promise.resolve(messagePromise).then(
      (result) => finish(resolve, result),
      (error) => finish(reject, error),
    );
  });
}

// --- Auto-scroll state (follow video playback in transcript) ---
let autoScrollEnabled = true; // True = scroll transcript to follow video playback
let autoScrollInterval = null; // setInterval ID for polling video time
let lastAutoScrollTime = 0; // Timestamp of last programmatic scroll (ignores scroll events within 1s)

// --- Transcript reading position state ---
// Session storage survives a side panel close but clears when Chrome closes.
const TRANSCRIPT_VIEW_STATE_KEY = "ytd_transcript_view_state";
let pendingTranscriptViewState = null;
let transcriptViewStateSaveTimer = null;
let isRestoringTranscriptView = false;
let selectionActionsController = null;
let lastTranscriptScrollTop = 0;

// ============================================================
// TRANSCRIPT GROUPING
// ============================================================

const TRANSCRIPT_SEGMENT_LIMITS = Object.freeze({
  minChars: 60,
  idealChars: 180,
  maxChars: 320,
  maxSeconds: 20,
});

function normalizeCaptionText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/([\u3400-\u9fff])\s+([\u3400-\u9fff])/g, "$1$2")
    .replace(/([，。；：！？])\s+(?=[\u3400-\u9fff])/g, "$1")
    .replace(/\s+([,.;:!?，。；：！？])/g, "$1")
    .trim();
}

/**
 * Splits a single oversized thought at the strongest nearby punctuation.
 * Word boundaries are the final safety valve for captions with no punctuation.
 */
function splitOversizedThought(text, maxChars) {
  const parts = [];
  let rest = normalizeCaptionText(text);

  while (rest.length > maxChars) {
    const windowText = rest.slice(0, maxChars + 1);
    const lowerBound = Math.floor(maxChars * 0.55);
    let cut = -1;

    for (const pattern of [/[;:；：]\s*/g, /[,，]\s*/g, /\s/g]) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(windowText))) {
        if (match.index >= lowerBound) cut = match.index + match[0].length;
      }
      if (cut > 0) break;
    }

    if (cut <= 0) cut = maxChars;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  if (rest) parts.push(rest);
  return parts;
}

/**
 * Reconstructs complete sentences across raw caption boundaries. Each segment
 * keeps the timestamp of the first caption that contributed text. Character
 * and time limits prevent a malformed Supadata entry from becoming one giant
 * row while punctuation remains the preferred boundary.
 */
function groupTranscriptEntries(entries, limits = TRANSCRIPT_SEGMENT_LIMITS) {
  if (!Array.isArray(entries) || entries.length === 0) return [];

  const pieces = [];
  entries.forEach((entry, entryIndex) => {
    const text = normalizeCaptionText(entry?.text);
    if (!text) return;
    const start = Number.isFinite(Number(entry.start)) ? Number(entry.start) : 0;
    const duration = Math.max(0, Number(entry.duration) || 0);
    const sentenceParts =
      text.match(/[^.!?;:,。！？；：，]+(?:[.!?;:,。！？；：，]+["')\]”’）】」』]*|$)/g) ||
      [text];
    let consumedChars = 0;

    sentenceParts.forEach((sentencePart) => {
      const cleanPart = normalizeCaptionText(sentencePart);
      if (!cleanPart) return;
      const oversizedParts = splitOversizedThought(cleanPart, limits.maxChars);
      oversizedParts.forEach((part, partIndex) => {
        const ratio = text.length ? Math.min(1, consumedChars / text.length) : 0;
        pieces.push({
          text: part,
          start: start + duration * ratio,
          semanticEnd:
            /[.!?。！？]["')\]”’）】」』]*$/.test(part) ||
            oversizedParts.length > 1,
          clauseEnd: /[;:,；：，]["')\]”’）】」』]*$/.test(part),
          sourceOrder: `${entryIndex}:${partIndex}`,
        });
        consumedChars += part.length + 1;
      });
    });
  });

  const grouped = [];
  let current = null;

  const flush = () => {
    if (!current || !current.text.trim()) return;
    const index = grouped.length;
    const text = normalizeCaptionText(current.text);
    grouped.push({
      id: `segment-${index}-${Math.round(current.start * 1000)}`,
      start: current.start,
      text,
      texts: [text],
    });
    current = null;
  };

  pieces.forEach((piece) => {
    if (!current) current = { start: piece.start, text: "" };
    current.text = normalizeCaptionText(`${current.text} ${piece.text}`);
    const elapsed = Math.max(0, piece.start - current.start);
    const comfortablySized = current.text.length >= limits.minChars;
    const reachedIdeal = current.text.length >= limits.idealChars;
    const atNaturalBoundary =
      piece.semanticEnd ||
      (piece.clauseEnd &&
        (reachedIdeal ||
          current.text.length >= limits.maxChars ||
          elapsed >= limits.maxSeconds));
    const reachedGuardrail =
      atNaturalBoundary &&
      (current.text.length >= limits.maxChars || elapsed >= limits.maxSeconds);
    const reachedHardGuardrail =
      current.text.length >= Math.round(limits.maxChars * 1.2) ||
      elapsed >= limits.maxSeconds + 5;

    if (
      (atNaturalBoundary && (comfortablySized || elapsed >= 8)) ||
      (atNaturalBoundary && reachedIdeal) ||
      reachedGuardrail ||
      reachedHardGuardrail
    ) {
      flush();
    }
  });
  flush();

  return grouped;
}

// ============================================================
// INITIALIZATION
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
  setTranscriptModeButtons("original");
  setupEventListeners();
  await evictOldCacheEntries(20);
  await loadCompareLibrary();

  const configStatus = await chrome.runtime.sendMessage({
    action: "checkConfig",
  });

  if (!configStatus.hasSupadataKey || !configStatus.hasAiKey) {
    showConfigError(configStatus);
    return;
  }

  await checkCurrentTab();
});

// Listen for messages from the TubeInsight button on YouTube page
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "startDigestFromButton") {
    // Load the digest for the current video. Served from cache when we've
    // seen this video before (no API calls); fetched fresh otherwise.
    // (This used to force-clear the cache on every click, which silently
    // burned a transcript credit + analysis tokens per click.)
    checkCurrentTab();
    sendResponse({ success: true });
  }
  if (message.action === "transcriptProgress") {
    // Background is telling us the transcript fetch status changed
    updateLoading(message.title, message.subtitle);
    sendResponse({ success: true });
  }
  if (message.action === "noteSaved") {
    // Refresh notes list when a new note is saved
    const filterAll = document
      .getElementById("notesFilterAll")
      ?.classList.contains("active");
    loadNotes(filterAll ? null : currentVideoId);
    sendResponse({ success: true });
  }
  return false;
});

// ============================================================
// FOLLOW THE ACTIVE TAB
// ============================================================
// The panel watches which tab is in front of it and reacts:
//   - Front tab is NOT YouTube  -> the panel closes itself (window.close()).
//     We do this OURSELVES rather than relying only on the background
//     script's per-tab enable/disable, because Chrome doesn't reliably
//     apply per-tab panel state to tabs spawned in unusual ways (e.g. a
//     link opened from another app) — which let the panel linger on
//     non-YouTube pages.
//   - Front tab IS YouTube but on a different video -> refresh the digest.
//     YouTube is a single-page app (clicking a video swaps content without
//     a reload), so we track URL changes; startDigest() caches per video,
//     making re-checks instant and free for already-digested videos.
//
// Everything is scoped to the window this panel lives in: tab switches in
// OTHER browser windows must not close this panel or hijack its content.

let navigationRefreshTimer = null;
let panelWindowId = null;
chrome.windows.getCurrent().then((w) => {
  panelWindowId = w.id;
});

function scheduleDigestRefresh() {
  // Small delay lets YouTube finish rendering the new video's title and
  // description before we read them. Also collapses rapid-fire URL events
  // into a single refresh.
  clearTimeout(navigationRefreshTimer);
  navigationRefreshTimer = setTimeout(() => {
    checkCurrentTab();
  }, 600);
}

function panelIsShowingResults() {
  const results = document.getElementById("resultsState");
  return results && results.style.display !== "none";
}

/**
 * Reacts to the URL now in front of the panel: close on non-YouTube,
 * refresh the digest when the video changed.
 */
function handleFrontTabUrl(url) {
  if (!(url || "").startsWith("https://www.youtube.com")) {
    // Start the position save, then close in this same event callback. Chrome
    // does not reliably honor window.close() after an asynchronous wait.
    void saveCurrentTranscriptViewState();
    window.close();
    return;
  }

  const newVideoId = extractVideoId(url);
  // Refresh when the video changed, or when we're not currently showing
  // results (e.g. user went home, then clicked back into the same video).
  if (newVideoId !== currentVideoId || !panelIsShowingResults()) {
    scheduleDigestRefresh();
  }
}

/**
 * Gets the best URL from a tab update that can change the visible page.
 * The status events repeat the close request after Chrome commits the first
 * non-YouTube navigation, when an early URL event alone can be lost.
 */
function getNavigationUrl(changeInfo, tab) {
  if (changeInfo.url) return changeInfo.url;
  if (changeInfo.status !== "loading" && changeInfo.status !== "complete") {
    return "";
  }
  return tab.pendingUrl || tab.url || "";
}

// Fires when a tab starts or completes navigation, including YouTube's
// no-reload navigation. The completion event is a deliberate second close
// attempt for the first non-YouTube page.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab.active) return;
  if (panelWindowId !== null && tab.windowId !== panelWindowId) return;
  const url = getNavigationUrl(changeInfo, tab);
  if (!url) return;
  handleFrontTabUrl(url);
});

// Fires when a different tab comes to the front — switching tabs, or a new
// tab being opened (including ones opened by clicking links in other apps).
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  if (panelWindowId !== null && windowId !== panelWindowId) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    // Brand-new tabs may not have committed their URL yet — fall back to
    // the pending one so we judge where the tab is actually going.
    handleFrontTabUrl(tab.url || tab.pendingUrl || "");
  } catch (e) {
    // Tab closed before we could read it — nothing to do.
  }
});

function setupEventListeners() {
  // Tab switching
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  // Error retry
  document.getElementById("errorBtn").addEventListener("click", () => {
    if (errorAction) {
      errorAction();
      return;
    }
    if (currentVideoId) {
      startDigest(currentVideoId, currentVideoUrl);
    }
  });

  document.getElementById("settingsBtn")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "openOptions" });
  });

  // Transcript actions
  document
    .getElementById("copyTranscriptBtn")
    ?.addEventListener("click", copyTranscript);
  document
    .getElementById("exportTranscriptBtn")
    ?.addEventListener("click", exportTranscript);
  document.querySelectorAll(".transcript-mode-btn").forEach((button) => {
    button.addEventListener("click", () => {
      handleDisplayLanguageModeChange(button.dataset.transcriptMode);
    });
  });
  setupTranscriptSearch();

  // pagehide also covers closing the side panel without a tab change.
  window.addEventListener("pagehide", () => {
    void saveCurrentTranscriptViewState();
  });

  // Follow playback button — re-enables auto-scroll after user scrolled away
  document
    .getElementById("followPlaybackBtn")
    ?.addEventListener("click", () => {
      autoScrollEnabled = true;
      document.getElementById("followPlaybackBtn").style.display = "none";
      // Jump straight back to the line currently being spoken. We scroll
      // directly (not via playbackTrackingTick) because the tick skips
      // entries that are already highlighted — and the current line almost
      // always IS highlighted, which made this button appear to do nothing.
      if (!scrollToActiveEntry()) {
        playbackTrackingTick(); // No highlight yet — let a tick establish one
      }
    });

  // Notes filter buttons
  document.getElementById("notesFilterThis")?.addEventListener("click", () => {
    setNotesFilter(false);
    loadNotes(currentVideoId);
  });
  document.getElementById("notesFilterAll")?.addEventListener("click", () => {
    setNotesFilter(true);
    loadNotes(null); // Load all notes
  });

  document
    .getElementById("refreshIntelligenceBtn")
    ?.addEventListener("click", () => triggerProductIntelligence(true));
  document
    .getElementById("generatePrdBtn")
    ?.addEventListener("click", generatePrdDraft);
  document
    .getElementById("copyPrdBtn")
    ?.addEventListener("click", copyPrdMarkdown);
  document
    .getElementById("exportKnowledgeBtn")
    ?.addEventListener("click", exportKnowledgeMarkdown);
  document
    .getElementById("refreshInsightsBtn")
    ?.addEventListener("click", () => triggerIndustryInsights(true));
  document
    .getElementById("addToCompareBtn")
    ?.addEventListener("click", addCurrentVideoToCompare);
  document
    .getElementById("clearCompareLibraryBtn")
    ?.addEventListener("click", clearCompareLibrary);
  document
    .getElementById("generateCompareReportBtn")
    ?.addEventListener("click", generateComparisonReport);
  document
    .getElementById("copyCompareReportBtn")
    ?.addEventListener("click", copyComparisonReport);
  document.querySelectorAll(".intelligence-copy-btn").forEach((button) => {
    button.addEventListener("click", () => copyIntelligenceCard(button));
  });
}

function setNotesFilter(showAll) {
  const thisVideoButton = document.getElementById("notesFilterThis");
  const allNotesButton = document.getElementById("notesFilterAll");
  thisVideoButton?.classList.toggle("active", !showAll);
  thisVideoButton?.setAttribute("aria-pressed", String(!showAll));
  allNotesButton?.classList.toggle("active", showAll);
  allNotesButton?.setAttribute("aria-pressed", String(showAll));
}

// ============================================================
// VIDEO DETECTION
// ============================================================

async function checkCurrentTab() {
  const checkGeneration = ++tabCheckGeneration;
  try {
    // The panel belongs only to the active tab. Looking for another open
    // YouTube tab here can keep an old transcript visible on a non-YouTube
    // page, so never fall back to background tabs.
    const tabs = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    const tab = tabs[0] || null;
    if (checkGeneration !== tabCheckGeneration) return;

    debugLog("[TubeInsight Panel] Found tab:", tab?.id, tab?.url);

    if (!tab?.url) {
      showState("welcome");
      return;
    }

    if (!tab.url.startsWith("https://www.youtube.com")) {
      handleFrontTabUrl(tab.url);
      return;
    }

    // Store the tab ID for reliable messaging later
    youtubeTabId = tab.id;

    const videoId = extractVideoId(tab.url);

    if (videoId) {
      currentVideoUrl = tab.url;

      try {
        // Route through background script for reliable message passing
        const result = await chrome.runtime.sendMessage({
          action: "relayToContent",
          payload: { action: "getVideoInfo" },
        });
        if (checkGeneration !== tabCheckGeneration) return;
        debugLog("[TubeInsight Panel] getVideoInfo result:", result);
        if (result.success && result.response) {
          currentVideoTitle = result.response.title || "";
          currentChannelName = result.response.channelName || "";
          currentVideoDescription = result.response.description || "";
          currentVideoDuration = result.response.duration || 0;
        }
      } catch (e) {
        console.error("[TubeInsight Panel] getVideoInfo error:", e);
        currentVideoTitle = "";
        currentChannelName = "";
        currentVideoDescription = "";
        currentVideoDuration = 0;
      }

      void startDigest(videoId, tab.url);
    } else {
      showState("welcome");
    }
  } catch (error) {
    if (checkGeneration !== tabCheckGeneration) return;
    console.error("Tab check error:", error);
    showState("welcome");
  }
}

function extractVideoId(url) {
  try {
    const urlObj = new URL(url);

    if (
      urlObj.hostname.includes("youtube.com") &&
      urlObj.searchParams.has("v")
    ) {
      return urlObj.searchParams.get("v");
    }

    if (urlObj.hostname === "youtu.be") {
      return urlObj.pathname.slice(1);
    }

    if (urlObj.pathname.startsWith("/embed/")) {
      return urlObj.pathname.split("/")[2];
    }

    return null;
  } catch {
    return null;
  }
}

// ============================================================
// DIGEST PIPELINE
// ============================================================

function startDigest(videoId, videoUrl) {
  if (digestInFlight?.videoId === videoId) {
    return digestInFlight.promise;
  }

  const generation = ++digestGeneration;
  const request = {
    videoId,
    generation,
    promise: null,
  };
  request.promise = runDigest(videoId, videoUrl, generation).finally(() => {
    if (digestInFlight === request) digestInFlight = null;
  });
  digestInFlight = request;
  return request.promise;
}

async function runDigest(videoId, videoUrl, generation) {
  const requestIsCurrent = () => generation === digestGeneration;

  // Check if we already have this video loaded in memory
  if (videoId === currentVideoId && currentTranscript) {
    showState("results");
    return;
  }

  const videoChanged = videoId !== currentVideoId;

  // Every video change invalidates observer work and in-flight translations.
  if (videoChanged) {
    translationGeneration += 1;
    compareAddGeneration += 1;
    isCompareLibraryLoading = false;
    const addToCompareButton = document.getElementById("addToCompareBtn");
    if (addToCompareButton) addToCompareButton.disabled = false;
    isKnowledgeExportLoading = false;
    setKnowledgeExportStatus("");
    if (transcriptScrollObserver) transcriptScrollObserver.disconnect();
    transcriptScrollObserver = null;
    resetTranscriptSearch();
    lastTranscriptScrollTop = 0;
    const transcriptViewState = await loadTranscriptViewState(videoId);
    if (!requestIsCurrent()) return;
    pendingTranscriptViewState = transcriptViewState;
    // An unseen video always starts in Original, so opening it never spends
    // translation tokens. A saved choice is restored only for this video.
    const displayLanguageMode = await loadDisplayLanguageMode(videoId);
    if (!requestIsCurrent()) return;
    currentTranscriptMode = displayLanguageMode;
    document
      .getElementById("contentArea")
      ?.classList.toggle(
        "restoring-transcript-view",
        Boolean(pendingTranscriptViewState),
      );
  }

  // Check cache for this video
  const cached = await loadFromCache(videoId);
  if (!requestIsCurrent()) return;
  if (cached) {
    debugLog("Loading from cache:", videoId);
    currentVideoId = videoId;
    currentVideoUrl = videoUrl;
    currentAnalysis = cached.analysis || null;
    currentTranscript = cached.transcript;
    currentTranscriptText = cached.transcriptText;
    currentTranscriptTimestamped = cached.transcriptTimestamped;
    currentTranscriptLanguage = cached.transcriptLanguage || null;
    currentProductIntelligence = cached.productIntelligence || null;
    currentPrdContent = cached.prdContent || null;
    currentIndustryInsights = cached.industryInsights || null;
    isAnalysisLoading = false;
    isProductIntelligenceLoading = false;
    isPrdLoading = false;
    isIndustryInsightsLoading = false;

    // Restore semantic-segment translations from persistent storage.
    if (cached.paragraphCache) {
      for (const [key, value] of Object.entries(cached.paragraphCache)) {
        transcriptParagraphCache.set(key, value);
      }
    }
    if (cached.interfaceCache) {
      for (const [key, value] of Object.entries(cached.interfaceCache)) {
        interfaceTranslationCache.set(key, value);
      }
    }

    if (currentVideoTitle || currentChannelName) {
      const videoInfo = document.getElementById("videoInfo");
      document.getElementById("videoTitle").textContent = currentVideoTitle;
      document.getElementById("videoChannel").textContent = currentChannelName;
      videoInfo.style.display = "block";
    }

    // Always render transcript first
    renderTranscript();

    // Render analysis if we have it cached
    if (currentAnalysis) {
      renderAnalysisResults(currentAnalysis);
      highlightMomentsOnPage(currentAnalysis.keyMoments);
    }
    if (currentProductIntelligence) {
      renderProductIntelligence(currentProductIntelligence);
    } else {
      resetProductIntelligencePanel();
    }
    if (currentPrdContent) {
      renderPrdDraft(currentPrdContent);
    } else {
      resetPrdPanel();
    }
    if (currentIndustryInsights) {
      renderIndustryInsights(currentIndustryInsights);
    } else {
      resetIndustryInsightsPanel();
    }

    showState("results");
    document.getElementById("tabsNav").style.display = "flex";
    restorePendingTranscriptViewState(videoId);

    // Load notes for this video
    loadNotes(videoId);

    // Setup explain feature
    setupExplainFeature();
    if (currentTranscriptMode !== "original") translateTranscript();
    return;
  }

  currentVideoId = videoId;
  currentVideoUrl = videoUrl;
  currentAnalysis = null;
  currentTranscript = null;
  currentTranscriptText = null;
  currentTranscriptTimestamped = null;
  currentTranscriptLanguage = null;
  currentProductIntelligence = null;
  currentPrdContent = null;
  currentIndustryInsights = null;
  isAnalysisLoading = false;
  isProductIntelligenceLoading = false;
  isPrdLoading = false;
  isIndustryInsightsLoading = false;
  resetProductIntelligencePanel();
  resetPrdPanel();
  resetIndustryInsightsPanel();

  if (currentVideoTitle || currentChannelName) {
    const videoInfo = document.getElementById("videoInfo");
    document.getElementById("videoTitle").textContent = currentVideoTitle;
    document.getElementById("videoChannel").textContent = currentChannelName;
    videoInfo.style.display = "block";
  }

  showState("loading");
  updateLoading("Fetching transcript", "");

  const transcriptResult = await chrome.runtime.sendMessage({
    action: "fetchTranscript",
    videoId: videoId,
  });
  if (!requestIsCurrent()) return;

  if (!transcriptResult.success) {
    if (transcriptResult.error === "NO_SUPADATA_KEY") {
      showError(
        "API key missing",
        "Add your Supadata API key in TubeInsight Settings.",
      );
      return;
    }
    showError(
      "No transcript found",
      transcriptResult.message || transcriptResult.error,
    );
    return;
  }

  currentTranscript = transcriptResult.transcript;
  currentTranscriptText = transcriptResult.transcriptText;
  currentTranscriptTimestamped = transcriptResult.transcriptTextTimestamped;
  currentTranscriptLanguage = transcriptResult.language || null;

  // Render transcript immediately (no LLM needed)
  renderTranscript();
  showState("results");
  document.getElementById("tabsNav").style.display = "flex";
  restorePendingTranscriptViewState(videoId);

  // Load notes for this video
  loadNotes(videoId);

  // Setup explain feature for text selection
  setupExplainFeature();
  if (currentTranscriptMode !== "original") translateTranscript();

  // Save transcript to cache (without analysis)
  await saveToCache(videoId);

  // DON'T run LLM analysis automatically - wait for user to click Overview tab
  // This saves tokens when user just wants to see the transcript
}

// ============================================================
// RENDERING
// ============================================================

function interfaceTranslationCacheKey(surface, id, text) {
  return `${currentVideoId || "none"}:zh:${surface}:${id}:${text}`;
}

function getInterfaceTranslation(surface, id, text) {
  return interfaceTranslationCache.get(
    interfaceTranslationCacheKey(surface, id, text),
  );
}

function renderLocalizedContent(text, surface, id) {
  const original = String(text || "");
  if (!original) return "";
  const cacheKey = interfaceTranslationCacheKey(surface, id, original);
  const translated = getInterfaceTranslation(surface, id, original);
  if (currentTranscriptMode === "original") return escapeHtml(original);

  const translation = translated
    ? escapeHtml(translated)
    : interfaceTranslationFailures.has(cacheKey)
      ? '<span class="translation-error">Translation unavailable.</span>'
      : '<span class="translation-pending">Translating...</span>';
  if (currentTranscriptMode === "bilingual") {
    return `<span class="localized-copy"><span class="localized-original">${escapeHtml(original)}</span><span class="localized-translation">${translation}</span></span>`;
  }
  return `<span class="localized-copy"><span class="localized-translation">${translation}</span></span>`;
}

function getLocalizedPlainText(text, surface, id) {
  const original = String(text || "");
  const translated = getInterfaceTranslation(surface, id, original);
  if (currentTranscriptMode === "zh") return translated || original;
  if (currentTranscriptMode === "bilingual" && translated) {
    return `${original}\n\n${translated}`;
  }
  return original;
}

async function translateInterfaceSegments(surface, segments, rerender) {
  if (currentTranscriptMode === "original" || !segments.length) return;
  const generation = translationGeneration;
  const videoId = currentVideoId;
  const missing = segments
    .filter((segment) => segment.text)
    .map((segment) => ({
      ...segment,
      cacheKey: interfaceTranslationCacheKey(
        surface,
        segment.id,
        segment.text,
      ),
    }))
    .filter(
      (segment) =>
        !interfaceTranslationCache.has(segment.cacheKey) &&
        !interfaceTranslationFailures.has(segment.cacheKey) &&
        !interfaceTranslationInFlight.has(segment.cacheKey),
    );
  if (!missing.length) return;

  missing.forEach((segment) => interfaceTranslationInFlight.add(segment.cacheKey));
  setTranslatingSpinner(true);
  try {
    for (
      let start = 0;
      start < missing.length;
      start += TRANSLATION_BATCH_SIZE
    ) {
      const batch = missing.slice(start, start + TRANSLATION_BATCH_SIZE);
      let result;
      try {
        result = await sendTranslationMessage({
          action: "translateContent",
          content: {
            segments: batch.map(({ id, text }) => ({ id, text })),
          },
          contentType: "interfaceBatch",
          targetLanguage: "zh",
          videoTitle: currentVideoTitle,
        });
      } catch (error) {
        console.error("[TubeInsight] Interface batch error:", error);
        result = { success: false, error: error.message };
      }
      if (
        generation !== translationGeneration ||
        videoId !== currentVideoId ||
        currentTranscriptMode === "original"
      ) {
        return;
      }
      const aligned = alignTranslatedSegmentBatch(
        batch,
        result?.success ? result.translatedContent?.segments : [],
      );
      aligned.forEach((item, index) => {
        if (item.text) {
          interfaceTranslationCache.set(batch[index].cacheKey, item.text);
        } else {
          interfaceTranslationFailures.add(batch[index].cacheKey);
        }
      });
      // Match the Transcript UX: reveal and persist every small batch as soon
      // as it returns instead of waiting for the full Overview or Notes list.
      rerender();
      await updateCache();
    }
  } catch (error) {
    console.error("[TubeInsight] Interface translation error:", error);
    missing.forEach((segment) =>
      interfaceTranslationFailures.add(segment.cacheKey),
    );
  } finally {
    missing.forEach((segment) => interfaceTranslationInFlight.delete(segment.cacheKey));
    setTranslatingSpinner(false);
  }
}

function getOverviewTranslationSegments() {
  if (!currentAnalysis) return [];
  const segments = [];
  (currentAnalysis.chapters || []).forEach((chapter, index) => {
    if (chapter.title) {
      segments.push({ id: `chapter-${index}-title`, text: chapter.title });
    }
    if (chapter.summary) {
      segments.push({ id: `chapter-${index}-summary`, text: chapter.summary });
    }
  });
  [...(currentAnalysis.keyQuotes || [])]
    .sort((a, b) => (a.timestampSeconds || 0) - (b.timestampSeconds || 0))
    .forEach((quote, index) => {
      if (quote.quote) segments.push({ id: `quote-${index}`, text: quote.quote });
    });
  return segments;
}

function translateOverviewContent() {
  return translateInterfaceSegments(
    "overview",
    getOverviewTranslationSegments(),
    () => {
      const contentArea = document.getElementById("contentArea");
      const scrollTop = contentArea?.scrollTop || 0;
      renderAnalysisResults(currentAnalysis);
      if (contentArea) contentArea.scrollTop = scrollTop;
    },
  );
}

function getNoteTranslationId(note, index) {
  const stablePart = String(note.id || note.createdAt || index)
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .slice(0, 96);
  return `note-${stablePart || index}`;
}

function translateNotesContent() {
  const segments = currentNotes.map((note, index) => ({
    id: getNoteTranslationId(note, index),
    text: note.text || "",
  }));
  return translateInterfaceSegments("notes", segments, () => {
    const contentArea = document.getElementById("contentArea");
    const scrollTop = contentArea?.scrollTop || 0;
    renderNotes(currentNotes, currentNotesFilterVideoId);
    if (contentArea) contentArea.scrollTop = scrollTop;
  });
}

/**
 * Renders the analysis results into the Overview tab.
 * Shows chapters and key quotes only.
 */
function renderAnalysisResults(analysis) {
  // Chapters
  const chapterList = document.getElementById("chapterList");
  chapterList.innerHTML = "";
  (analysis.chapters || []).forEach((chapter, index) => {
    const li = document.createElement("li");
    li.className = "chapter-item";
    li.dataset.seconds = chapter.timestampSeconds;
    li.innerHTML = `
      <span class="chapter-timestamp">${escapeHtml(chapter.timestamp)}</span>
      <div class="chapter-content">
        <span class="chapter-title">${renderLocalizedContent(chapter.title, "overview", `chapter-${index}-title`)}</span>
        <span class="chapter-summary">${renderLocalizedContent(chapter.summary || "", "overview", `chapter-${index}-summary`)}</span>
      </div>
    `;
    li.addEventListener("click", () => {
      debugLog(
        "[TubeInsight Panel] Chapter clicked:",
        chapter.timestamp,
        chapter.timestampSeconds,
      );
      seekTo(chapter.timestampSeconds);
    });
    chapterList.appendChild(li);
  });

  // Quotes - sort by timestamp (chronological order)
  const quotesList = document.getElementById("quotesList");
  quotesList.innerHTML = "";
  const sortedQuotes = [...(analysis.keyQuotes || [])].sort(
    (a, b) => (a.timestampSeconds || 0) - (b.timestampSeconds || 0),
  );
  sortedQuotes.forEach((quote, index) => {
    const div = document.createElement("div");
    div.className = "quote-item";
    div.dataset.seconds = quote.timestampSeconds;
    div.innerHTML = `
      <div class="quote-text">${renderLocalizedContent(quote.quote, "overview", `quote-${index}`)}</div>
      <div class="quote-meta">
        <span class="quote-timestamp">${escapeHtml(quote.timestamp)}</span>
        <div class="quote-actions">
          <button class="quote-save-note-btn" title="Save this quote as a note">Note</button>
          <button class="quote-copy-btn" title="Copy this quote">Copy</button>
        </div>
      </div>
    `;
    div.addEventListener("click", () => {
      debugLog(
        "[TubeInsight Panel] Quote clicked:",
        quote.timestamp,
        quote.timestampSeconds,
      );
      seekTo(quote.timestampSeconds);
    });

    const quoteCopyBtn = div.querySelector(".quote-copy-btn");
    quoteCopyBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(
          getLocalizedPlainText(quote.quote, "overview", `quote-${index}`),
        );
        quoteCopyBtn.textContent = "Copied";
        setTimeout(() => {
          quoteCopyBtn.textContent = "Copy";
        }, 1500);
      } catch (err) {
        console.error("Copy failed:", err);
      }
    });

    const quoteSaveNoteBtn = div.querySelector(".quote-save-note-btn");
    quoteSaveNoteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await saveQuoteAsNote(quote, quoteSaveNoteBtn);
    });

    quotesList.appendChild(div);
  });

  if (
    currentTranscriptMode !== "original" &&
    resultTabIsActive("overview")
  ) {
    void translateOverviewContent();
  }
}

/**
 * Saves a key quote as a timestamped note.
 */
async function saveQuoteAsNote(quote, btn) {
  if (!currentVideoId) return;

  const originalText = btn.textContent;
  btn.textContent = "Saving...";
  btn.disabled = true;

  try {
    const result = await chrome.runtime.sendMessage({
      action: "saveNote",
      videoId: currentVideoId,
      timestamp: quote.timestampSeconds,
      videoTitle: currentVideoTitle,
      channelName: currentChannelName,
    });

    if (result.success) {
      btn.textContent = "Saved";
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      }, 1500);
      // Refresh notes list if on Notes tab
      loadNotes(currentVideoId);
    } else {
      console.error("[TubeInsight] Save quote as note failed:", result.error);
      btn.textContent = "Error";
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      }, 1500);
    }
  } catch (error) {
    console.error("[TubeInsight] Save quote as note error:", error);
    btn.textContent = "Error";
    setTimeout(() => {
      btn.textContent = originalText;
      btn.disabled = false;
    }, 1500);
  }
}

/**
 * Legacy function for backwards compatibility with cached data.
 * Renders both transcript and analysis.
 */
function renderResults(analysis) {
  renderAnalysisResults(analysis);

  renderTranscript();

  document.getElementById("tabsNav").style.display = "flex";

  // Setup explain feature for text selection
  setupExplainFeature();
}

/**
 * Returns true while the user has a range of text selected.
 * Transcript row clicks must not seek in that state: the click emitted after
 * selection mouseup belongs to the selection/explain interaction, not playback.
 */
function hasNonCollapsedTextSelection() {
  const selection = window.getSelection();
  return Boolean(
    selection && selection.rangeCount > 0 && !selection.isCollapsed,
  );
}

/**
 * Preserves normal row-click seeking while keeping text selection inert.
 */
function seekFromTranscriptEntryClick(event, seconds) {
  if (hasNonCollapsedTextSelection()) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  seekTo(seconds);
}

function renderTranscript() {
  if (!currentTranscript) return;

  const transcriptList = document.getElementById("transcriptList");
  transcriptList.innerHTML = "";

  const existingBadge = document.getElementById("transcriptSourceBadge");
  if (existingBadge) existingBadge.remove();

  // Group entries using smart sentence-boundary + time-guardrail logic
  const grouped = groupTranscriptEntries(currentTranscript);

  grouped.forEach((group) => {
    const div = document.createElement("div");
    div.className = "transcript-entry";
    div.dataset.seconds = group.start;

    const minutes = Math.floor(group.start / 60);
    const seconds = Math.floor(group.start % 60);
    const timestamp = `${minutes}:${String(seconds).padStart(2, "0")}`;

    div.innerHTML = `
      <span class="transcript-time">${timestamp}</span>
      <span class="transcript-text">${renderSubtitleInlineMarkup(group.text)}</span>
    `;

    div.addEventListener("click", (event) =>
      seekFromTranscriptEntryClick(event, group.start),
    );
    transcriptList.appendChild(div);
  });

  // Reapply an active query after a language mode rerenders the transcript.
  refreshTranscriptSearch({ preserveIndex: false, scroll: false });

  // Start tracking video playback for auto-scroll
  startPlaybackTracking();
}

// ============================================================
// TRANSCRIPT SEARCH
// ============================================================

/**
 * Finds separate, case-insensitive literal matches. A literal search is
 * important here because punctuation such as "." must be treated as transcript
 * text, not as a regular expression command.
 */
function findLiteralTranscriptMatches(text, query) {
  const source = String(text || "");
  const needle = String(query || "").trim();
  if (!needle) return [];

  const escapedNeedle = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(escapedNeedle, "giu");
  const matches = [];
  for (const match of source.matchAll(matcher)) {
    matches.push({ start: match.index, end: match.index + match[0].length });
  }

  return matches;
}

/**
 * Removes old marks before a new search. Restoring plain text first prevents
 * nested marks when the user types one more letter into the search field.
 */
function clearTranscriptSearchHighlights() {
  document
    .querySelectorAll("#transcriptList mark.transcript-search-highlight")
    .forEach((mark) => {
      const parent = mark.parentNode;
      mark.replaceWith(document.createTextNode(mark.textContent || ""));
      parent?.normalize();
    });

  document
    .querySelectorAll("#transcriptList .transcript-entry.search-current")
    .forEach((row) => row.classList.remove("search-current"));
}

/**
 * Replaces matching parts of one text node with mark elements. We collect all
 * text nodes before changing the DOM, so each replacement is safe and stable.
 */
function markTranscriptTextNode(textNode, query) {
  const ranges = findLiteralTranscriptMatches(textNode.nodeValue, query);
  if (!ranges.length) return [];

  const fragment = document.createDocumentFragment();
  const marks = [];
  let cursor = 0;

  ranges.forEach(({ start, end }) => {
    if (start > cursor) {
      fragment.appendChild(
        document.createTextNode(textNode.nodeValue.slice(cursor, start)),
      );
    }

    const mark = document.createElement("mark");
    mark.className = "transcript-search-highlight";
    mark.textContent = textNode.nodeValue.slice(start, end);
    fragment.appendChild(mark);
    marks.push(mark);
    cursor = end;
  });

  if (cursor < textNode.nodeValue.length) {
    fragment.appendChild(
      document.createTextNode(textNode.nodeValue.slice(cursor)),
    );
  }

  textNode.parentNode.replaceChild(fragment, textNode);
  return marks;
}

/**
 * Updates the result count and navigation buttons from the current search
 * state. The live output gives the same information to screen reader users.
 */
function updateTranscriptSearchControls(query) {
  const count = document.getElementById("transcriptSearchCount");
  const previous = document.getElementById("transcriptSearchPrevBtn");
  const next = document.getElementById("transcriptSearchNextBtn");
  const hasMatches = transcriptSearchMatches.length > 0;

  if (count) {
    count.textContent = !query
      ? ""
      : hasMatches
        ? `${transcriptSearchIndex + 1} of ${transcriptSearchMatches.length}`
        : "No matches";
  }
  if (previous) previous.disabled = !hasMatches;
  if (next) next.disabled = !hasMatches;
}

/**
 * Shows which match is current. Search navigation pauses automatic transcript
 * following, so playback cannot pull the user away from the result they found.
 */
function revealCurrentTranscriptSearchMatch({ scroll = true } = {}) {
  transcriptSearchMatches.forEach((mark) => mark.classList.remove("current"));
  document
    .querySelectorAll("#transcriptList .transcript-entry.search-current")
    .forEach((row) => row.classList.remove("search-current"));

  const mark = transcriptSearchMatches[transcriptSearchIndex];
  if (!mark) return;

  mark.classList.add("current");
  mark.closest(".transcript-entry")?.classList.add("search-current");

  if (!scroll) return;
  if (autoScrollInterval) {
    autoScrollEnabled = false;
    document.getElementById("followPlaybackBtn").style.display = "block";
  }
  mark.scrollIntoView({ behavior: "smooth", block: "center" });
}

/**
 * Searches the transcript that is visible now. This means Original searches
 * source subtitles, Chinese searches translated text, and Bilingual searches
 * both columns. Translated rows call this again as their text arrives.
 */
function refreshTranscriptSearch({ preserveIndex = false, scroll = true } = {}) {
  const input = document.getElementById("transcriptSearchInput");
  const clearButton = document.getElementById("transcriptSearchClearBtn");
  const query = String(input?.value || "").trim();
  const previousIndex = transcriptSearchIndex;

  clearTranscriptSearchHighlights();
  transcriptSearchMatches = [];
  transcriptSearchIndex = -1;
  if (clearButton) clearButton.hidden = !input?.value;

  if (!query) {
    updateTranscriptSearchControls(query);
    return;
  }

  document
    .querySelectorAll("#transcriptList .transcript-entry")
    .forEach((row) => {
      const content = row.querySelector(".transcript-text, .transcript-copy");
      if (!content) return;

      const textNodes = [];
      const walker = document.createTreeWalker(
        content,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            const parent = node.parentElement;
            if (!node.nodeValue || parent?.closest("button")) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          },
        },
      );
      while (walker.nextNode()) textNodes.push(walker.currentNode);
      textNodes.forEach((node) => {
        transcriptSearchMatches.push(...markTranscriptTextNode(node, query));
      });
    });

  if (transcriptSearchMatches.length) {
    transcriptSearchIndex = preserveIndex
      ? Math.min(Math.max(previousIndex, 0), transcriptSearchMatches.length - 1)
      : 0;
    revealCurrentTranscriptSearchMatch({ scroll });
  }
  updateTranscriptSearchControls(query);
}

/**
 * Moves through results in a loop, like the browser's built-in Find control.
 */
function moveTranscriptSearch(direction) {
  if (!transcriptSearchMatches.length) return;
  transcriptSearchIndex =
    (transcriptSearchIndex + direction + transcriptSearchMatches.length) %
    transcriptSearchMatches.length;
  revealCurrentTranscriptSearchMatch();
  updateTranscriptSearchControls(
    document.getElementById("transcriptSearchInput")?.value.trim(),
  );
}

/**
 * Clears search when the user opens a different video. A query for the old
 * video is unlikely to help and can make the next transcript look empty.
 */
function resetTranscriptSearch({ focus = false } = {}) {
  const input = document.getElementById("transcriptSearchInput");
  if (input) input.value = "";
  refreshTranscriptSearch({ scroll: false });
  if (focus) input?.focus();
}

/**
 * Wires mouse and keyboard controls once when the side panel starts.
 */
function setupTranscriptSearch() {
  const input = document.getElementById("transcriptSearchInput");
  const clearButton = document.getElementById("transcriptSearchClearBtn");
  const previous = document.getElementById("transcriptSearchPrevBtn");
  const next = document.getElementById("transcriptSearchNextBtn");
  if (!input) return;

  input.addEventListener("input", () => refreshTranscriptSearch());
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      moveTranscriptSearch(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape" && input.value) {
      event.preventDefault();
      resetTranscriptSearch({ focus: true });
    }
  });

  clearButton?.addEventListener("click", () => {
    resetTranscriptSearch({ focus: true });
  });
  previous?.addEventListener("click", () => moveTranscriptSearch(-1));
  next?.addEventListener("click", () => moveTranscriptSearch(1));
}

function getDisplayedTranscriptText() {
  if (currentTranscriptMode === "original") return currentTranscriptText || "";
  return getActiveTranscriptSegments()
    .map((segment) => {
      const translated = transcriptParagraphCache.get(
        transcriptTranslationCacheKey(segment),
      );
      if (currentTranscriptMode === "zh") return translated || segment.text;
      return translated ? `${segment.text}\n${translated}` : segment.text;
    })
    .join("\n\n");
}

function copyTranscript() {
  copyToClipboardWithFeedback(getDisplayedTranscriptText(), "copyTranscriptBtn");
}

function exportTranscript() {
  const transcriptContent = getDisplayedTranscriptText();
  const videoUrl = `https://youtube.com/watch?v=${currentVideoId}`;

  let exportText = "";
  exportText += `TRANSCRIPT\n`;
  exportText += `${"=".repeat(60)}\n\n`;
  exportText += `Title: ${currentVideoTitle || "Unknown"}\n`;
  exportText += `Channel: ${currentChannelName || "Unknown"}\n`;
  exportText += `URL: ${videoUrl}\n`;
  exportText += `\n${"—".repeat(60)}\n\n`;

  if (currentVideoDescription) {
    exportText += `DESCRIPTION:\n${currentVideoDescription}\n`;
    exportText += `\n${"—".repeat(60)}\n\n`;
  }

  exportText += `TRANSCRIPT:\n\n${transcriptContent}\n`;
  exportText += `\n${"—".repeat(60)}\n`;
  exportText += `Exported by TubeInsight\n`;

  const filename = `${sanitizeFilename(currentVideoTitle)}-transcript.txt`;
  downloadTextFile(exportText, filename);
}

// ============================================================
// UI STATE MANAGEMENT
// ============================================================

function showState(state) {
  document.getElementById("welcomeState").style.display =
    state === "welcome" ? "flex" : "none";
  document.getElementById("loadingState").style.display =
    state === "loading" ? "block" : "none";
  document.getElementById("errorState").style.display =
    state === "error" ? "block" : "none";
  const uploadEl = document.getElementById("uploadState");
  if (uploadEl) uploadEl.style.display = "none"; // Upload state removed — always hidden
  document.getElementById("resultsState").style.display =
    state === "results" ? "block" : "none";

  // The tab bar only belongs on the results view. We toggle it HERE, in one
  // place, so it tracks the view automatically. Previously each caller had to
  // remember to re-show it after showState("results"), and one path forgot —
  // which is why the tabs could vanish when re-opening an already-analyzed video.
  document.getElementById("tabsNav").style.display =
    state === "results" ? "flex" : "none";
  document.getElementById("transcriptModeControl").style.display =
    state === "results" ? "inline-flex" : "none";

  if (state !== "results") {
    stopPlaybackTracking();
  }
}

function updateLoading(title, subtitle) {
  document.getElementById("loadingText").textContent = title;
  document.getElementById("loadingSubtext").textContent = subtitle;
}

function showError(title, message) {
  errorAction = null;
  showState("error");
  document.getElementById("errorTitle").textContent = title;
  document.getElementById("errorMessage").textContent = message;
  document.getElementById("errorBtn").textContent = "Try Again";
}

function showConfigError(configStatus) {
  const missingKeys = [];
  if (!configStatus.hasSupadataKey) missingKeys.push("Supadata");
  if (!configStatus.hasAiKey) missingKeys.push("AI provider");

  showState("error");
  document.getElementById("errorTitle").textContent = "API Keys Missing";
  document.getElementById("errorMessage").textContent =
    `Add your ${missingKeys.join(" and ")} API key${missingKeys.length === 1 ? "" : "s"} in TubeInsight Settings.`;
  document.getElementById("errorBtn").textContent = "Open Settings";
  errorAction = () => chrome.runtime.sendMessage({ action: "openOptions" });
}

// ============================================================
// TAB SWITCHING
// ============================================================

function switchTab(tabName) {
  // Capture the transcript position before another tab reuses the same scroll
  // area. Scrolling Overview or Notes must not replace this value.
  if (tabName !== "transcript" && transcriptTabIsActive()) {
    captureCurrentTranscriptScrollTop();
    dismissSelectionActions(true);
  }

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === tabName);
  });

  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panel === tabName);
  });

  // Start/stop playback tracking based on which tab is active
  if (tabName === "transcript") {
    // Notes always opens at the top, so restore the independent transcript
    // reading position when the user returns here.
    requestAnimationFrame(() => {
      const contentArea = document.getElementById("contentArea");
      if (!contentArea || !transcriptTabIsActive()) return;
      lastAutoScrollTime = Date.now();
      contentArea.scrollTop = lastTranscriptScrollTop;
    });
    startPlaybackTracking();
  } else {
    stopPlaybackTracking();
  }

  // Saved notes are stored newest first. Open Notes at the top so the note the
  // user just created is the first item they see.
  if (tabName === "notes") {
    requestAnimationFrame(() => {
      const contentArea = document.getElementById("contentArea");
      const notesPanelIsActive = document.querySelector(
        '.tab-panel[data-panel="notes"].active',
      );
      if (contentArea && notesPanelIsActive) contentArea.scrollTop = 0;
    });
  }

  // Translate only the visible tab. This prevents hidden surfaces from using
  // tokens or competing with the batch queue the user is waiting for.
  if (tabName === "overview") {
    if (!currentAnalysis && !isAnalysisLoading) {
      triggerAnalysis();
    } else if (currentAnalysis && currentTranscriptMode !== "original") {
      void translateOverviewContent();
    }
  } else if (tabName === "intelligence") {
    if (!currentProductIntelligence && !isProductIntelligenceLoading) {
      void triggerProductIntelligence();
    }
  } else if (tabName === "insights") {
    if (!currentIndustryInsights && !isIndustryInsightsLoading) {
      void triggerIndustryInsights();
    }
  } else if (tabName === "compare") {
    void loadCompareLibrary();
  } else if (
    tabName === "notes" &&
    currentTranscriptMode !== "original"
  ) {
    void translateNotesContent();
  } else if (
    tabName === "transcript" &&
    currentTranscriptMode !== "original" &&
    !transcriptScrollObserver
  ) {
    void translateTranscript();
  }
}

/**
 * Triggers the LLM analysis (lazy-loaded when user clicks Overview or Quotes tab).
 * This saves tokens by not running analysis until needed.
 */
async function triggerAnalysis() {
  const requestVideoId = currentVideoId;
  if (!currentTranscriptTimestamped || currentAnalysis) return currentAnalysis;
  if (analysisInFlight?.videoId === requestVideoId) {
    return analysisInFlight.promise;
  }

  isAnalysisLoading = true;
  const transcriptText = currentTranscriptTimestamped;
  const videoTitle = currentVideoTitle;
  const channelName = currentChannelName;
  const videoDescription = currentVideoDescription;
  const videoDuration = currentVideoDuration;

  // Show loading indicators in the Overview tab
  const chapterList = document.getElementById("chapterList");
  const quotesList = document.getElementById("quotesList");

  if (chapterList)
    chapterList.innerHTML =
      '<li class="chapter-item" style="color: var(--text-muted); border: none;">Loading chapters...</li>';
  if (quotesList)
    quotesList.innerHTML =
      '<div class="quote-item" style="color: var(--text-muted); border-left-color: var(--border);">Loading quotes...</div>';

  const request = {
    videoId: requestVideoId,
    promise: null,
  };
  request.promise = (async () => {
    try {
      const analysisResult = await chrome.runtime.sendMessage({
        action: "analyzeTranscript",
        transcriptText,
        videoTitle,
        channelName,
        videoDescription,
        videoDuration,
      });
      if (requestVideoId !== currentVideoId) return null;

      if (!analysisResult.success) {
        if (chapterList)
          chapterList.innerHTML = `<li class="chapter-item" style="color: var(--accent); border: none;">Analysis failed: ${escapeHtml(analysisResult.error || "Unknown error")}</li>`;
        return null;
      }

      currentAnalysis = analysisResult.analysis;
      renderAnalysisResults(currentAnalysis);
      highlightMomentsOnPage(currentAnalysis.keyMoments);

      // Save to cache now that we have analysis
      await saveToCache(requestVideoId);
      await syncCurrentVideoCompareEntry();
      return currentAnalysis;
    } catch (error) {
      if (requestVideoId !== currentVideoId) return null;
      console.error("[TubeInsight Panel] Analysis error:", error);
      if (chapterList)
        chapterList.innerHTML = `<li class="chapter-item" style="color: var(--accent); border: none;">Error: ${escapeHtml(error.message)}</li>`;
      return null;
    } finally {
      if (requestVideoId === currentVideoId && analysisInFlight === request) {
        isAnalysisLoading = false;
      }
      if (analysisInFlight === request) analysisInFlight = null;
    }
  })();

  analysisInFlight = request;
  return request.promise;
}

// ============================================================
// PRODUCT INTELLIGENCE
// ============================================================

const PRODUCT_INTELLIGENCE_LISTS = Object.freeze({
  product_features: "productFeaturesList",
  user_pain_points: "userPainPointsList",
  competitor_info: "competitorInfoList",
  business_model_keywords: "businessModelKeywordsList",
});

function setProductIntelligenceStatus(message, type = "") {
  const status = document.getElementById("intelligenceStatus");
  if (!status) return;
  status.textContent = message;
  status.className = `intelligence-status${type ? ` ${type}` : ""}`;
  status.style.display = message ? "block" : "none";
}

function resetProductIntelligencePanel() {
  const results = document.getElementById("intelligenceResults");
  const generatePrdButton = document.getElementById("generatePrdBtn");
  if (results) results.style.display = "none";
  if (generatePrdButton) generatePrdButton.disabled = true;
  setProductIntelligenceStatus(
    "打开此页后，将基于当前视频字幕自动提炼产品情报。",
  );
}

function renderProductIntelligence(intelligence) {
  const results = document.getElementById("intelligenceResults");
  const summary = document.getElementById("intelligenceSummary");
  if (!results || !summary) return;

  summary.textContent =
    intelligence.one_line_summary || "视频中未提炼出明确的产品价值总结。";

  Object.entries(PRODUCT_INTELLIGENCE_LISTS).forEach(([key, elementId]) => {
    const container = document.getElementById(elementId);
    if (!container) return;
    container.innerHTML = "";
    const items = Array.isArray(intelligence[key]) ? intelligence[key] : [];

    if (key === "business_model_keywords") {
      if (!items.length) {
        const empty = document.createElement("span");
        empty.className = "intelligence-empty";
        empty.textContent = "视频中未提及";
        container.appendChild(empty);
      } else {
        items.forEach((item) => {
          const keyword = document.createElement("span");
          keyword.className = "intelligence-keyword";
          keyword.textContent = item;
          container.appendChild(keyword);
        });
      }
      return;
    }

    if (!items.length) {
      const empty = document.createElement("li");
      empty.className = "intelligence-empty";
      empty.textContent = "视频中未提及";
      container.appendChild(empty);
      return;
    }
    items.forEach((item) => {
      const listItem = document.createElement("li");
      listItem.textContent = item;
      container.appendChild(listItem);
    });
  });

  setProductIntelligenceStatus("");
  results.style.display = "block";
  const generatePrdButton = document.getElementById("generatePrdBtn");
  if (generatePrdButton) {
    generatePrdButton.disabled = isProductIntelligenceLoading || isPrdLoading;
  }
}

async function copyIntelligenceCard(button) {
  const key = button.dataset.intelligenceKey;
  const items = currentProductIntelligence?.[key];
  const text =
    Array.isArray(items) && items.length ? items.join("\n") : "视频中未提及";
  const original = button.textContent;
  if (await copyToClipboard(text)) {
    button.textContent = "已复制";
    setTimeout(() => {
      button.textContent = original;
    }, 1500);
  }
}

async function triggerProductIntelligence(force = false) {
  if (isProductIntelligenceLoading) return;
  if (currentProductIntelligence && !force) {
    renderProductIntelligence(currentProductIntelligence);
    return;
  }
  if (!currentTranscriptText?.trim()) {
    setProductIntelligenceStatus(
      "当前视频没有可用字幕，无法生成产品情报。",
      "error",
    );
    return;
  }

  const requestVideoId = currentVideoId;
  isProductIntelligenceLoading = true;
  const refreshButton = document.getElementById("refreshIntelligenceBtn");
  const generatePrdButton = document.getElementById("generatePrdBtn");
  const results = document.getElementById("intelligenceResults");
  if (refreshButton) refreshButton.disabled = true;
  if (generatePrdButton) generatePrdButton.disabled = true;
  if (results) results.style.display = "none";
  setProductIntelligenceStatus("正在分析字幕并提炼产品情报…", "loading");

  try {
    const result = await chrome.runtime.sendMessage({
      action: "analyzeProductIntelligence",
      transcriptText: currentTranscriptText,
    });
    if (!result?.success) {
      throw new Error(
        result?.message || result?.error || "产品情报分析失败，请稍后重试。",
      );
    }
    if (requestVideoId !== currentVideoId) return;

    currentProductIntelligence = result.productIntelligence;
    if (force) {
      currentPrdContent = null;
      resetPrdPanel();
    }
    renderProductIntelligence(currentProductIntelligence);
    await saveToCache(requestVideoId);
    await syncCurrentVideoCompareEntry();
  } catch (error) {
    if (requestVideoId !== currentVideoId) return;
    console.error("[TubeInsight] Product intelligence error:", error);
    setProductIntelligenceStatus(
      error.message || "产品情报分析失败，请稍后重试。",
      "error",
    );
  } finally {
    if (requestVideoId === currentVideoId) {
      isProductIntelligenceLoading = false;
      if (refreshButton) refreshButton.disabled = false;
      if (generatePrdButton) {
        generatePrdButton.disabled =
          !currentProductIntelligence || isPrdLoading;
      }
    }
  }
}

// ============================================================
// INDUSTRY INSIGHTS
// ============================================================

function setIndustryInsightsStatus(message, type = "") {
  const status = document.getElementById("insightsStatus");
  if (!status) return;
  status.textContent = message;
  status.className = `insights-status${type ? ` ${type}` : ""}`;
  status.style.display = message ? "block" : "none";
}

function resetIndustryInsightsPanel() {
  const results = document.getElementById("insightsResults");
  if (results) results.style.display = "none";
  setIndustryInsightsStatus(
    "打开此页后，将自动识别行业术语并提炼核心观点。",
  );
}

function appendInsightsEmpty(container, message) {
  const empty = document.createElement("div");
  empty.className = "insights-empty";
  empty.textContent = message;
  container.appendChild(empty);
}

function renderIndustryInsights(insights) {
  const results = document.getElementById("insightsResults");
  const termsList = document.getElementById("insightTermsList");
  const keyInsightsList = document.getElementById("keyInsightsList");
  const pmRelevanceList = document.getElementById("pmRelevanceList");
  if (!results || !termsList || !keyInsightsList || !pmRelevanceList) return;

  termsList.replaceChildren();
  keyInsightsList.replaceChildren();
  pmRelevanceList.replaceChildren();

  const terms = Array.isArray(insights.terms) ? insights.terms : [];
  if (!terms.length) {
    appendInsightsEmpty(termsList, "视频中未识别到相关行业术语。");
  } else {
    terms.forEach((item) => {
      const details = document.createElement("details");
      details.className = "insight-term";
      const summary = document.createElement("summary");
      const term = document.createElement("span");
      term.className = "insight-term-title";
      term.textContent = item.term;
      const category = document.createElement("span");
      category.className = "insight-category";
      category.textContent = item.category || "其他";
      summary.append(term, category);
      const explanation = document.createElement("p");
      explanation.className = "insight-term-explanation";
      explanation.textContent = item.explanation;
      details.append(summary, explanation);
      termsList.appendChild(details);
    });
  }

  const keyInsights = Array.isArray(insights.key_insights)
    ? insights.key_insights
    : [];
  if (!keyInsights.length) {
    appendInsightsEmpty(keyInsightsList, "视频中未提炼出明确的核心观点。");
  } else {
    keyInsights.forEach((item) => {
      const card = document.createElement("article");
      card.className = "key-insight-item";
      const main = document.createElement("div");
      main.className = "key-insight-main";
      const speaker = document.createElement("span");
      speaker.className = "key-insight-speaker";
      speaker.textContent = item.speaker || "视频作者";
      const arrow = document.createElement("span");
      arrow.className = "key-insight-arrow";
      arrow.textContent = "→";
      const insight = document.createElement("span");
      insight.textContent = item.insight;
      main.append(speaker, arrow, insight);
      card.appendChild(main);

      if (item.quote) {
        const quote = document.createElement("blockquote");
        quote.className = "key-insight-quote";
        quote.textContent = `“${item.quote}”`;
        card.appendChild(quote);
      }
      if (item.timestamp_hint) {
        const meta = document.createElement("div");
        meta.className = "key-insight-meta";
        meta.textContent = `视频阶段：${item.timestamp_hint}`;
        card.appendChild(meta);
      }
      keyInsightsList.appendChild(card);
    });
  }

  const pmRelevance = Array.isArray(insights.pm_relevance)
    ? insights.pm_relevance
    : [];
  if (!pmRelevance.length) {
    const item = document.createElement("li");
    item.textContent = "本次未提炼出 PM 相关洞察。";
    pmRelevanceList.appendChild(item);
  } else {
    pmRelevance.forEach((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      pmRelevanceList.appendChild(item);
    });
  }

  setIndustryInsightsStatus("");
  results.style.display = "block";
}

async function triggerIndustryInsights(force = false) {
  if (isIndustryInsightsLoading) return;
  if (currentIndustryInsights && !force) {
    renderIndustryInsights(currentIndustryInsights);
    return;
  }
  if (!currentTranscriptText?.trim()) {
    setIndustryInsightsStatus(
      "当前视频没有可用字幕，无法生成行业洞察。",
      "error",
    );
    return;
  }

  const requestVideoId = currentVideoId;
  isIndustryInsightsLoading = true;
  const refreshButton = document.getElementById("refreshInsightsBtn");
  const results = document.getElementById("insightsResults");
  if (refreshButton) refreshButton.disabled = true;
  if (results) results.style.display = "none";
  setIndustryInsightsStatus("正在识别术语并提炼核心观点…", "loading");

  try {
    const result = await chrome.runtime.sendMessage({
      action: "extractIndustryInsights",
      transcriptText: currentTranscriptText,
    });
    if (!result?.success) {
      throw new Error(
        result?.message || result?.error || "行业洞察分析失败，请稍后重试。",
      );
    }
    if (requestVideoId !== currentVideoId) return;

    currentIndustryInsights = result.insights;
    renderIndustryInsights(currentIndustryInsights);
    await saveToCache(requestVideoId);
  } catch (error) {
    if (requestVideoId !== currentVideoId) return;
    console.error("[TubeInsight] Industry insight error:", error);
    setIndustryInsightsStatus(
      error.message || "行业洞察分析失败，请稍后重试。",
      "error",
    );
  } finally {
    if (requestVideoId === currentVideoId) {
      isIndustryInsightsLoading = false;
      if (refreshButton) refreshButton.disabled = false;
    }
  }
}

function appendPrdInlineText(parent, text) {
  const source = String(text || "");
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    if (match.index > cursor) {
      parent.appendChild(document.createTextNode(source.slice(cursor, match.index)));
    }
    const token = match[0];
    const element = document.createElement(
      token.startsWith("**") ? "strong" : "code",
    );
    element.textContent = token.startsWith("**")
      ? token.slice(2, -2)
      : token.slice(1, -1);
    parent.appendChild(element);
    cursor = match.index + token.length;
  }
  if (cursor < source.length) {
    parent.appendChild(document.createTextNode(source.slice(cursor)));
  }
}

function parsePrdTableCells(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isPrdTableDivider(line) {
  const cells = parsePrdTableCells(line);
  return (
    cells.length > 0 &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, "")))
  );
}

/**
 * Renders the limited Markdown generated by the PRD prompt without accepting
 * model-provided HTML. Headings, lists, checkboxes, quotes, and tables are
 * constructed with DOM text nodes so generated content cannot execute script.
 */
function renderPrdMarkdown(markdown, container) {
  container.replaceChildren();
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const element = document.createElement(`h${heading[1].length}`);
      appendPrdInlineText(element, heading[2]);
      container.appendChild(element);
      index += 1;
      continue;
    }

    if (/^---+$/.test(line)) {
      container.appendChild(document.createElement("hr"));
      index += 1;
      continue;
    }

    if (
      line.startsWith("|") &&
      index + 1 < lines.length &&
      isPrdTableDivider(lines[index + 1])
    ) {
      const wrap = document.createElement("div");
      wrap.className = "prd-table-wrap";
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const headerRow = document.createElement("tr");
      parsePrdTableCells(line).forEach((cell) => {
        const th = document.createElement("th");
        appendPrdInlineText(th, cell);
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);
      index += 2;

      const tbody = document.createElement("tbody");
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        const row = document.createElement("tr");
        parsePrdTableCells(lines[index]).forEach((cell) => {
          const td = document.createElement("td");
          appendPrdInlineText(td, cell);
          row.appendChild(td);
        });
        tbody.appendChild(row);
        index += 1;
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      container.appendChild(wrap);
      continue;
    }

    const listMatch = line.match(/^(\d+\.\s+|-\s+)(.+)$/);
    if (listMatch) {
      const ordered = /^\d+\./.test(listMatch[1]);
      const list = document.createElement(ordered ? "ol" : "ul");
      while (index < lines.length) {
        const itemMatch = lines[index]
          .trim()
          .match(/^(\d+\.\s+|-\s+)(.+)$/);
        if (!itemMatch || /^\d+\./.test(itemMatch[1]) !== ordered) break;
        const item = document.createElement("li");
        const checkbox = itemMatch[2].match(/^\[([ xX])\]\s*(.*)$/);
        if (checkbox) {
          const marker = document.createElement("span");
          marker.className = "prd-checkbox";
          marker.setAttribute("aria-hidden", "true");
          item.appendChild(marker);
          appendPrdInlineText(item, checkbox[2]);
        } else {
          appendPrdInlineText(item, itemMatch[2]);
        }
        list.appendChild(item);
        index += 1;
      }
      container.appendChild(list);
      continue;
    }

    if (line.startsWith(">")) {
      const quote = document.createElement("blockquote");
      const quoteLines = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      appendPrdInlineText(quote, quoteLines.join(" "));
      container.appendChild(quote);
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (index < lines.length) {
      const next = lines[index].trim();
      if (
        !next ||
        /^(#{1,3})\s+/.test(next) ||
        /^---+$/.test(next) ||
        /^(\d+\.\s+|-\s+|>)/.test(next) ||
        (next.startsWith("|") &&
          index + 1 < lines.length &&
          isPrdTableDivider(lines[index + 1]))
      ) {
        break;
      }
      paragraphLines.push(next);
      index += 1;
    }
    const paragraph = document.createElement("p");
    appendPrdInlineText(paragraph, paragraphLines.join(" "));
    container.appendChild(paragraph);
  }
}

function setPrdStatus(message, type = "") {
  const status = document.getElementById("prdStatus");
  if (!status) return;
  status.textContent = message;
  status.className = `intelligence-status${type ? ` ${type}` : ""}`;
  status.style.display = message ? "block" : "none";
}

function resetPrdPanel() {
  const section = document.getElementById("prdSection");
  const content = document.getElementById("prdContent");
  if (section) section.style.display = "none";
  if (content) content.replaceChildren();
  setPrdStatus("");
}

function renderPrdDraft(markdown) {
  const section = document.getElementById("prdSection");
  const content = document.getElementById("prdContent");
  if (!section || !content) return;
  section.style.display = "block";
  setPrdStatus("");
  renderPrdMarkdown(markdown, content);
}

async function copyPrdMarkdown() {
  if (!currentPrdContent) return;
  const button = document.getElementById("copyPrdBtn");
  const original = button?.textContent;
  if (await copyToClipboard(currentPrdContent)) {
    if (button) button.textContent = "已复制";
    setTimeout(() => {
      if (button) button.textContent = original;
    }, 1500);
  }
}

async function generatePrdDraft() {
  if (isPrdLoading) return;
  if (!currentTranscriptText?.trim()) {
    const section = document.getElementById("prdSection");
    if (section) section.style.display = "block";
    setPrdStatus("当前视频没有可用字幕，无法生成 PRD 草稿。", "error");
    return;
  }
  if (!currentProductIntelligence) {
    const section = document.getElementById("prdSection");
    if (section) section.style.display = "block";
    setPrdStatus("请先完成产品情报分析。", "error");
    return;
  }

  const requestVideoId = currentVideoId;
  isPrdLoading = true;
  const generateButton = document.getElementById("generatePrdBtn");
  const section = document.getElementById("prdSection");
  const content = document.getElementById("prdContent");
  if (generateButton) generateButton.disabled = true;
  if (section) section.style.display = "block";
  if (content && !currentPrdContent) content.replaceChildren();
  setPrdStatus("正在生成 PRD 草稿…", "loading");

  try {
    const result = await chrome.runtime.sendMessage({
      action: "generatePrdDraft",
      transcriptText: currentTranscriptText,
      productIntelligence: currentProductIntelligence,
      videoTitle: currentVideoTitle,
    });
    if (!result?.success) {
      throw new Error(
        result?.message || result?.error || "PRD 草稿生成失败，请稍后重试。",
      );
    }
    if (requestVideoId !== currentVideoId) return;

    currentPrdContent = result.prdContent;
    renderPrdDraft(currentPrdContent);
    await saveToCache(requestVideoId);
  } catch (error) {
    if (requestVideoId !== currentVideoId) return;
    console.error("[TubeInsight] PRD generation error:", error);
    setPrdStatus(
      error.message || "PRD 草稿生成失败，请稍后重试。",
      "error",
    );
  } finally {
    if (requestVideoId === currentVideoId) {
      isPrdLoading = false;
      if (generateButton) {
        generateButton.disabled = !currentProductIntelligence;
      }
    }
  }
}

// ============================================================
// TIMESTAMP / SEEK
// ============================================================

async function seekTo(seconds) {
  debugLog("[TubeInsight Panel] seekTo called with:", seconds);
  if (seconds === undefined || seconds === null) {
    debugLog("[TubeInsight Panel] seekTo aborted - no seconds value");
    return;
  }

  const payload = {
    action: "seekTo",
    seconds: Number(seconds),
  };

  try {
    // Try direct messaging to the stored YouTube tab first (fastest/reliable)
    if (youtubeTabId) {
      try {
        await chrome.tabs.sendMessage(youtubeTabId, payload);
        debugLog("[TubeInsight Panel] seekTo direct success");
        return;
      } catch (directErr) {
        debugLog(
          "[TubeInsight Panel] Direct seekTo failed, falling back to relay:",
          directErr.message,
        );
      }
    }

    // Fallback: route through background script
    const result = await chrome.runtime.sendMessage({
      action: "relayToContent",
      payload,
    });
    debugLog("[TubeInsight Panel] seekTo relay result:", result);
  } catch (error) {
    console.error("[TubeInsight Panel] seekTo error:", error);
  }
}

/**
 * Plays a saved note at its timestamp.
 * - If the note belongs to the video currently open, we seek the player in place.
 * - If it belongs to a DIFFERENT video (e.g. viewing "All Notes"), seeking the
 *   current player would jump to the wrong content, so we open that video in a
 *   new tab at the right timestamp instead.
 */
function playNote(note) {
  if (note.videoId && note.videoId === currentVideoId) {
    seekTo(note.timestampSeconds);
  } else {
    // note.timestampedUrl already includes the &t=<seconds>s anchor
    chrome.tabs.create({ url: note.timestampedUrl });
  }
}

async function highlightMomentsOnPage(moments) {
  if (!moments || !moments.length) return;

  try {
    // Route through background script for reliable message passing
    await chrome.runtime.sendMessage({
      action: "relayToContent",
      payload: {
        action: "highlightMoments",
        moments: moments,
        videoDuration: currentVideoDuration,
      },
    });
  } catch (error) {
    console.error("Highlight error:", error);
  }
}

// ============================================================
// UTILITY
// ============================================================

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

/**
 * Renders the small subset of inline formatting commonly present in subtitle
 * tracks and model translations. Everything is escaped first; only exact,
 * attribute-free allowlisted tags are restored as markup afterwards.
 */
function renderSubtitleInlineMarkup(text) {
  return escapeHtml(text).replace(
    /&lt;(\/?)(i|em|b|strong|u)&gt;|&lt;br(?:\s*\/)?&gt;/gi,
    (_match, closing, tagName) =>
      tagName ? `<${closing}${tagName.toLowerCase()}>` : "<br>",
  );
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error("Copy failed:", error);
    return false;
  }
}

async function copyToClipboardWithFeedback(text, buttonId) {
  const btn = document.getElementById(buttonId);
  const original = btn.textContent;

  const success = await copyToClipboard(text);
  if (success) {
    btn.textContent = "Copied";
    setTimeout(() => {
      btn.textContent = original;
    }, 2000);
  }
}

function downloadTextFile(text, filename) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function sanitizeFilename(str) {
  return (str || "untitled")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .substring(0, 50)
    .toLowerCase();
}

// ============================================================
// TEXT SELECTION ACTIONS
// ============================================================

/**
 * Hides actions that belong only to a live transcript selection. Clearing the
 * browser range also prevents the toolbar from returning on another tab.
 */
function dismissSelectionActions(clearSelection = false) {
  const tooltip = document.getElementById("explainTooltip");
  if (tooltip) tooltip.style.display = "none";
  if (clearSelection) window.getSelection()?.removeAllRanges();
}

/**
 * Sets up text selection handling in the transcript.
 * When the user selects text, shows Explain and Note actions.
 */
function setupExplainFeature() {
  const transcriptList = document.getElementById("transcriptList");
  if (!transcriptList) return;

  // This setup can run again after a cached transcript render. Abort old
  // document listeners so one selection creates only one action toolbar.
  selectionActionsController?.abort();
  selectionActionsController = new AbortController();
  const selectionSignal = selectionActionsController.signal;

  // Remove existing tooltip if any
  const existingTooltip = document.getElementById("explainTooltip");
  if (existingTooltip) existingTooltip.remove();

  // Create one small toolbar for actions on the selected transcript text.
  const tooltip = document.createElement("div");
  tooltip.id = "explainTooltip";
  tooltip.className = "explain-tooltip";
  tooltip.setAttribute("role", "toolbar");
  tooltip.setAttribute("aria-label", "Selected transcript actions");
  tooltip.innerHTML = `
    <button class="explain-btn" type="button">Explain</button>
    <button class="selection-note-btn" type="button">Note</button>
  `;
  tooltip.style.display = "none";
  document.body.appendChild(tooltip);

  let selectedText = "";
  let selectedTimestamp = 0;

  // Interacting with either action must preserve the transcript selection and
  // stay isolated from document and row click behavior.
  tooltip.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  tooltip.addEventListener("mouseup", (event) => {
    event.stopPropagation();
  });
  tooltip.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  // Listen for text selection
  document.addEventListener(
    "mouseup",
    () => {
      const selection = window.getSelection();
      const text = selection?.toString().trim() || "";
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;

      // Both ends must be inside the transcript. The first selected row
      // supplies the timestamp when the selection spans more than one row.
      const isInTranscript = Boolean(
        range &&
          transcriptList.contains(range.startContainer) &&
          transcriptList.contains(range.endContainer),
      );

      // Allow any selection length.
      if (text.length > 0 && isInTranscript) {
        selectedText = text;
        const startElement =
          range.startContainer.nodeType === 1
            ? range.startContainer
            : range.startContainer.parentElement;
        const selectedRow = startElement?.closest(".transcript-entry");
        const rowSeconds = Number(selectedRow?.dataset.seconds);
        selectedTimestamp = Number.isFinite(rowSeconds) ? rowSeconds : 0;

        // Set the final coordinates while the toolbar is still hidden. If it
        // becomes visible first, Chrome paints it at its default left edge for
        // one frame before moving it to the selection center.
        const rect = range.getBoundingClientRect();
        tooltip.style.top = `${rect.bottom + window.scrollY + 8}px`;
        tooltip.style.left = `${rect.left + rect.width / 2}px`;
        tooltip.style.display = "flex";
      } else {
        tooltip.style.display = "none";
      }
    },
    { signal: selectionSignal },
  );

  // Hide tooltip when clicking elsewhere
  document.addEventListener(
    "mousedown",
    (event) => {
      if (!tooltip.contains(event.target)) {
        tooltip.style.display = "none";
      }
    },
    { signal: selectionSignal },
  );

  // Handle explain button click
  tooltip
    .querySelector(".explain-btn")
    .addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!selectedText) return;

      tooltip.style.display = "none";
      await showExplanation(selectedText);
    });

  // Save the exact selected words at the first selected transcript row. This
  // action does not move playback and does not ask the AI to rewrite the text.
  tooltip
    .querySelector(".selection-note-btn")
    .addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!selectedText || !currentVideoId) return;

      const button = event.currentTarget;
      const originalText = button.textContent;
      button.textContent = "Saving...";
      button.disabled = true;

      try {
        const result = await chrome.runtime.sendMessage({
          action: "saveNote",
          videoId: currentVideoId,
          timestamp: selectedTimestamp,
          videoTitle: currentVideoTitle,
          channelName: currentChannelName,
          selectedText,
        });

        if (!result?.success) {
          throw new Error(result?.error || "Could not save note");
        }

        button.textContent = "Saved";
        loadNotes(currentVideoId);
        setTimeout(() => {
          tooltip.style.display = "none";
          button.textContent = originalText;
          button.disabled = false;
        }, 900);
      } catch (error) {
        console.error("[TubeInsight] Save selected note error:", error);
        button.textContent = "Error";
        setTimeout(() => {
          button.textContent = originalText;
          button.disabled = false;
        }, 1500);
      }
    });
}

/**
 * Shows the explanation modal and fetches it from the configured AI provider.
 */
async function showExplanation(selectedText) {
  // Create modal
  const modal = document.createElement("div");
  modal.id = "explainModal";
  modal.className = "explain-modal-overlay";
  modal.innerHTML = `
    <div class="explain-modal">
      <div class="explain-modal-header">
        <div class="explain-modal-title">Explain</div>
        <button class="explain-modal-close" id="closeExplain">Close</button>
      </div>
      <div class="explain-selected-text">"${escapeHtml(selectedText.substring(0, 200))}${selectedText.length > 200 ? "..." : ""}"</div>
      <div class="explain-modal-content" id="explanationContent">
        <div class="explain-loading">
          <div class="loading-bar"></div>
          <span>Analyzing...</span>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Close handlers
  document
    .getElementById("closeExplain")
    .addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });

  // Get some context around the selection from the transcript
  const transcriptContext = getTranscriptContext(selectedText);

  // Fetch explanation
  try {
    const result = await chrome.runtime.sendMessage({
      action: "explainSelection",
      selectedText: selectedText,
      transcriptContext: transcriptContext,
      videoTitle: currentVideoTitle,
    });

    const contentDiv = document.getElementById("explanationContent");
    if (result.success) {
      contentDiv.innerHTML = `<div class="explain-text">${escapeHtml(result.explanation).replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</div>`;
    } else {
      contentDiv.innerHTML = `<div class="explain-error">Failed to get explanation: ${escapeHtml(result.error)}</div>`;
    }
  } catch (error) {
    const contentDiv = document.getElementById("explanationContent");
    contentDiv.innerHTML = `<div class="explain-error">Error: ${escapeHtml(error.message)}</div>`;
  }
}

/**
 * Gets surrounding context from the transcript for the selected text.
 */
function getTranscriptContext(selectedText) {
  const fullText = currentTranscriptText || "";
  const index = fullText.indexOf(selectedText);

  if (index === -1) return "";

  // Get 200 chars before and after
  const start = Math.max(0, index - 200);
  const end = Math.min(fullText.length, index + selectedText.length + 200);

  return fullText.substring(start, end);
}

// ============================================================
// CACHING
// ============================================================

/**
 * Saves the current digest results to persistent local storage.
 * Results survive browser restarts — reopening the same video loads from cache
 * without consuming API tokens or Supadata calls.
 * Cache expires after 30 days. Oldest entries evicted when > 20 videos cached.
 */
async function saveToCache(videoId) {
  // All payload fields below come from the active in-memory video. Refuse a
  // stale async caller so one video's data can never be written under another
  // video's cache key.
  if (!videoId || videoId !== currentVideoId || !currentTranscript) return;

  try {
    // Persist semantic-segment translations for this video.
    const paragraphCacheForVideo = {};
    for (const [key, value] of transcriptParagraphCache.entries()) {
      if (key.startsWith(`${videoId}:`)) {
        paragraphCacheForVideo[key] = value;
      }
    }
    const interfaceCacheForVideo = {};
    for (const [key, value] of interfaceTranslationCache.entries()) {
      if (key.startsWith(`${videoId}:`)) {
        interfaceCacheForVideo[key] = value;
      }
    }

    const cacheData = {
      analysis: currentAnalysis, // May be null if not yet analyzed
      productIntelligence: currentProductIntelligence,
      prdContent: currentPrdContent,
      industryInsights: currentIndustryInsights,
      transcript: currentTranscript,
      transcriptText: currentTranscriptText,
      transcriptTimestamped: currentTranscriptTimestamped,
      transcriptLanguage: currentTranscriptLanguage,
      videoTitle: currentVideoTitle,
      channelName: currentChannelName,
      paragraphCache: paragraphCacheForVideo,
      interfaceCache: interfaceCacheForVideo,
      timestamp: Date.now(),
    };

    await chrome.storage.local.set({ [`digest_${videoId}`]: cacheData });
    debugLog(
      "Saved to cache:",
      videoId,
      currentAnalysis ? "(with analysis)" : "(transcript only)",
    );

    // Evict old entries if we have more than 20 videos cached
    await evictOldCacheEntries(20);
  } catch (error) {
    console.error("Cache save error:", error);
  }
}

/**
 * Keeps the cache from growing unbounded.
 * Removes the oldest entries when we exceed maxEntries videos.
 *
 * @param {number} maxEntries - Maximum number of cached videos to keep
 */
async function evictOldCacheEntries(maxEntries) {
  try {
    const allData = await chrome.storage.local.get(null);
    let digestKeys = Object.keys(allData).filter((k) =>
      k.startsWith("digest_"),
    );
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    const expired = digestKeys.filter((key) => {
      const timestamp = Number(allData[key]?.timestamp) || 0;
      return Date.now() - timestamp > THIRTY_DAYS;
    });
    if (expired.length) {
      await chrome.storage.local.remove(expired);
      const expiredSet = new Set(expired);
      digestKeys = digestKeys.filter((key) => !expiredSet.has(key));
    }

    if (digestKeys.length <= maxEntries) return;

    // Sort by timestamp (oldest first) and remove excess
    const sorted = digestKeys
      .map((k) => ({ key: k, ts: allData[k]?.timestamp || 0 }))
      .sort((a, b) => a.ts - b.ts);

    const toRemove = sorted
      .slice(0, sorted.length - maxEntries)
      .map((e) => e.key);
    if (toRemove.length > 0) {
      await chrome.storage.local.remove(toRemove);
      debugLog(`[TubeInsight] Evicted ${toRemove.length} old cache entries`);
    }
  } catch (error) {
    console.error("Cache eviction error:", error);
  }
}

/**
 * Loads digest results from persistent local storage.
 * Returns null if not cached or expired (30-day expiry).
 */
async function loadFromCache(videoId) {
  if (!videoId) return null;

  try {
    const result = await chrome.storage.local.get(`digest_${videoId}`);
    const cached = result[`digest_${videoId}`];

    if (!cached) return null;

    // Cache expires after 30 days
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    if (Date.now() - cached.timestamp > THIRTY_DAYS) {
      await chrome.storage.local.remove(`digest_${videoId}`);
      return null;
    }

    return cached;
  } catch (error) {
    console.error("Cache load error:", error);
    return null;
  }
}

/**
 * Updates the cache after enhance or translation operations.
 */
async function updateCache() {
  if (currentVideoId) {
    await saveToCache(currentVideoId);
  }
}

// ============================================================
// NOTES
// ============================================================

/**
 * Loads and renders notes from storage.
 * @param {string|null} videoId - Filter by video ID, or null for all notes
 */
async function loadNotes(videoId) {
  try {
    const result = await chrome.runtime.sendMessage({
      action: "getNotes",
      videoId: videoId,
    });

    if (result.success) {
      currentNotes = result.notes || [];
      currentNotesFilterVideoId = videoId;
      renderNotes(result.notes, videoId);
    }
  } catch (error) {
    console.error("[TubeInsight Panel] Load notes error:", error);
  }
}

/**
 * Renders the notes list in the Notes tab.
 */
function renderNotes(notes, filteredVideoId) {
  const notesList = document.getElementById("notesList");
  const notesIntro = document.getElementById("notesIntro");

  if (!notesList) return;

  notesList.innerHTML = "";

  if (!notes || notes.length === 0) {
    notesIntro.style.display = "block";
    notesIntro.textContent = filteredVideoId
      ? "No notes for this video yet. Hover over the video and click Note to save."
      : "No notes saved yet. Hover over a video and click Note to save.";
    return;
  }

  notesIntro.style.display = "none";

  notes.forEach((note, index) => {
    const translationId = getNoteTranslationId(note, index);
    const noteEl = document.createElement("div");
    noteEl.className = "note-item";
    noteEl.innerHTML = `
      <div class="note-header">
        <span class="note-timestamp" data-url="${escapeHtml(note.timestampedUrl)}" data-seconds="${Number(note.timestampSeconds) || 0}">${escapeHtml(note.timestamp)}</span>
        ${!filteredVideoId ? `<span class="note-video-title">${escapeHtml(note.videoTitle)}</span>` : ""}
      </div>
      <div class="note-text">${renderLocalizedContent(note.text, "notes", translationId)}</div>
      <div class="note-actions">
        <button class="note-action-btn note-copy-text">Copy text</button>
        <button class="note-action-btn note-copy-link" data-url="${escapeHtml(note.timestampedUrl)}">Copy timestamp</button>
        <button class="note-action-btn note-play" data-seconds="${Number(note.timestampSeconds) || 0}">Play</button>
        <button class="note-delete" data-id="${escapeHtml(note.id)}" type="button" aria-label="Delete note" title="Delete note">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 6h18"></path>
            <path d="M8 6V4h8v2"></path>
            <path d="m19 6-1 14H6L5 6"></path>
            <path d="M10 11v5"></path>
            <path d="M14 11v5"></path>
          </svg>
        </button>
      </div>
    `;

    // Timestamp click - play from this point (in this tab or a new one)
    noteEl.querySelector(".note-timestamp").addEventListener("click", () => {
      playNote(note);
    });

    // Delete button
    noteEl
      .querySelector(".note-delete")
      .addEventListener("click", async (e) => {
        e.stopPropagation();
        await deleteNote(note.id);
        loadNotes(filteredVideoId);
      });

    // Copy text button — copies just the note's text
    noteEl
      .querySelector(".note-copy-text")
      .addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(
            getLocalizedPlainText(note.text, "notes", translationId),
          );
          const btn = noteEl.querySelector(".note-copy-text");
          btn.textContent = "Copied";
          setTimeout(() => {
            btn.textContent = "Copy text";
          }, 2000);
        } catch (err) {
          console.error("Copy failed:", err);
        }
      });

    // Copy timestamp button — copies the timestamped YouTube link
    noteEl
      .querySelector(".note-copy-link")
      .addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(note.timestampedUrl);
          const btn = noteEl.querySelector(".note-copy-link");
          btn.textContent = "Copied";
          setTimeout(() => {
            btn.textContent = "Copy timestamp";
          }, 2000);
        } catch (err) {
          console.error("Copy failed:", err);
        }
      });

    // Play button (in this tab if it's the current video, else a new tab)
    noteEl.querySelector(".note-play").addEventListener("click", () => {
      playNote(note);
    });

    notesList.appendChild(noteEl);
  });

  if (currentTranscriptMode !== "original" && resultTabIsActive("notes")) {
    void translateNotesContent();
  }
}

/**
 * Deletes a note by ID.
 */
async function deleteNote(noteId) {
  try {
    await chrome.runtime.sendMessage({
      action: "deleteNote",
      noteId: noteId,
    });
  } catch (error) {
    console.error("[TubeInsight Panel] Delete note error:", error);
  }
}

// ============================================================
// MULTI-VIDEO COMPARE
// ============================================================

function normalizeStoredCompareLibrary(value) {
  if (!Array.isArray(value)) return [];
  const normalizeList = (items) =>
    Array.isArray(items)
      ? items
          .filter((item) => typeof item === "string" && item.trim())
          .map((item) => item.trim().slice(0, 1000))
          .slice(0, 5)
      : [];
  const seenVideoIds = new Set();
  return value
    .filter((item) => {
      const isValid =
        item &&
        typeof item === "object" &&
        typeof item.videoId === "string" &&
        item.videoId &&
        !seenVideoIds.has(item.videoId);
      if (isValid) seenVideoIds.add(item.videoId);
      return isValid;
    })
    .slice(0, MAX_COMPARE_VIDEOS)
    .map((item) => ({
      videoId: item.videoId.slice(0, 50),
      title:
        typeof item.title === "string" && item.title.trim()
          ? item.title.trim().slice(0, 500)
          : "未命名视频",
      url:
        typeof item.url === "string"
          ? item.url.slice(0, 2000)
          : "",
      summary:
        typeof item.summary === "string"
          ? item.summary.slice(0, 20_000)
          : "",
      product_features: normalizeList(item.product_features),
      user_pain_points: normalizeList(item.user_pain_points),
      business_model_keywords: normalizeList(item.business_model_keywords),
      addedAt: Number.isFinite(Number(item.addedAt))
        ? Number(item.addedAt)
        : Date.now(),
    }));
}

function formatCompareAddedAt(timestamp) {
  const date = new Date(Number(timestamp));
  if (Number.isNaN(date.getTime())) return "加入时间未知";
  const day = formatLocalDate(date);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${day} ${hours}:${minutes}`;
}

function setCompareStatus(message, type = "") {
  const status = document.getElementById("compareStatus");
  if (!status) return;
  status.textContent = message;
  status.className = `compare-status${type ? ` ${type}` : ""}`;
  status.style.display = message ? "block" : "none";
}

function invalidateComparisonReport() {
  currentComparisonReport = "";
  const section = document.getElementById("compareReportSection");
  const content = document.getElementById("compareReportContent");
  if (section) section.style.display = "none";
  if (content) content.replaceChildren();
}

function renderCompareLibrary() {
  const list = document.getElementById("compareLibraryList");
  const count = document.getElementById("compareLibraryCount");
  const clearButton = document.getElementById("clearCompareLibraryBtn");
  const generateButton = document.getElementById("generateCompareReportBtn");
  if (!list || !count) return;

  list.replaceChildren();
  count.textContent = `对比库 ${compareLibrary.length}/${MAX_COMPARE_VIDEOS}`;
  if (clearButton) clearButton.disabled = compareLibrary.length === 0;
  if (generateButton) {
    generateButton.disabled =
      compareLibrary.length < 2 || isComparisonReportLoading;
  }

  if (!compareLibrary.length) {
    appendInsightsEmpty(
      list,
      "对比库为空。将当前视频加入后，可与其他视频横向分析。",
    );
    return;
  }

  compareLibrary.forEach((video) => {
    const item = document.createElement("article");
    item.className = "compare-library-item";
    const info = document.createElement("div");
    info.className = "compare-library-info";
    const title = document.createElement("div");
    title.className = "compare-library-title";
    title.textContent = video.title;
    title.title = video.title;
    const time = document.createElement("div");
    time.className = "compare-library-time";
    time.textContent = `加入于 ${formatCompareAddedAt(video.addedAt)}`;
    info.append(title, time);

    const removeButton = document.createElement("button");
    removeButton.className = "compare-remove-btn";
    removeButton.type = "button";
    removeButton.textContent = "×";
    removeButton.title = "从对比库删除";
    removeButton.setAttribute("aria-label", `删除 ${video.title}`);
    removeButton.addEventListener("click", () =>
      removeCompareVideo(video.videoId),
    );
    item.append(info, removeButton);
    list.appendChild(item);
  });
}

async function loadCompareLibrary() {
  const requestedRevision = compareLibraryRevision;
  try {
    const stored = await chrome.storage.local.get(COMPARE_LIBRARY_KEY);
    if (requestedRevision !== compareLibraryRevision) return;
    compareLibrary = normalizeStoredCompareLibrary(
      stored?.[COMPARE_LIBRARY_KEY],
    );
    renderCompareLibrary();
  } catch (error) {
    console.error("[TubeInsight] Compare library load error:", error);
    setCompareStatus("读取对比库失败，请稍后重试。", "error");
  }
}

async function saveCompareLibrary() {
  await chrome.storage.local.set({
    [COMPARE_LIBRARY_KEY]: compareLibrary,
  });
}

async function syncCurrentVideoCompareEntry() {
  if (!currentVideoId) return;
  const index = compareLibrary.findIndex(
    (video) => video.videoId === currentVideoId,
  );
  if (index < 0) return;

  const intelligence = currentProductIntelligence || {};
  const previousEntry = compareLibrary[index];
  const previousLibrary = compareLibrary;
  compareLibraryRevision += 1;
  const updatedEntry = {
    ...previousEntry,
    title: currentVideoTitle || previousEntry.title,
    summary: currentAnalysis
      ? formatAnalysisForExport(currentAnalysis)
      : previousEntry.summary,
    product_features: currentProductIntelligence
      ? intelligence.product_features || []
      : previousEntry.product_features,
    user_pain_points: currentProductIntelligence
      ? intelligence.user_pain_points || []
      : previousEntry.user_pain_points,
    business_model_keywords: currentProductIntelligence
      ? intelligence.business_model_keywords || []
      : previousEntry.business_model_keywords,
  };
  compareLibrary = compareLibrary.map((entry, entryIndex) =>
    entryIndex === index ? updatedEntry : entry,
  );
  compareLibrary = normalizeStoredCompareLibrary(compareLibrary);
  try {
    await saveCompareLibrary();
    invalidateComparisonReport();
    renderCompareLibrary();
  } catch (error) {
    compareLibrary = previousLibrary;
    renderCompareLibrary();
    console.error("[TubeInsight] Compare library sync error:", error);
  }
}

async function addCurrentVideoToCompare() {
  if (isCompareLibraryLoading || !currentVideoId) return;
  if (compareLibrary.some((video) => video.videoId === currentVideoId)) {
    setCompareStatus("当前视频已在对比库中。", "error");
    return;
  }
  if (compareLibrary.length >= MAX_COMPARE_VIDEOS) {
    setCompareStatus("对比库最多保存 10 个视频，请先删除一条。", "error");
    return;
  }

  const requestVideoId = currentVideoId;
  const addGeneration = ++compareAddGeneration;
  const previousLibrary = compareLibrary;
  let libraryWasMutated = false;
  const addButton = document.getElementById("addToCompareBtn");
  isCompareLibraryLoading = true;
  if (addButton) addButton.disabled = true;
  setCompareStatus("正在准备当前视频摘要…", "loading");

  try {
    if (!currentAnalysis) {
      await triggerAnalysis();
    }
    if (requestVideoId !== currentVideoId) return;
    if (!currentAnalysis) {
      throw new Error("当前视频的 AI 摘要生成失败，暂时无法加入对比库。");
    }

    // Product intelligence enriches the matrix but is not required for saving.
    if (!currentProductIntelligence) {
      if (isProductIntelligenceLoading) {
        await waitForCurrentOperation(
          requestVideoId,
          () => isProductIntelligenceLoading,
        );
      } else {
        await triggerProductIntelligence();
      }
    }
    if (requestVideoId !== currentVideoId) return;

    const intelligence = currentProductIntelligence || {};
    compareLibraryRevision += 1;
    compareLibrary = [...compareLibrary, {
      videoId: requestVideoId,
      title: currentVideoTitle || "未命名视频",
      url: `https://www.youtube.com/watch?v=${requestVideoId}`,
      summary: formatAnalysisForExport(currentAnalysis),
      product_features: intelligence.product_features || [],
      user_pain_points: intelligence.user_pain_points || [],
      business_model_keywords: intelligence.business_model_keywords || [],
      addedAt: Date.now(),
    }];
    libraryWasMutated = true;
    await saveCompareLibrary();
    if (requestVideoId !== currentVideoId) return;
    invalidateComparisonReport();
    renderCompareLibrary();
    setCompareStatus("已加入对比库。", "success");
  } catch (error) {
    if (libraryWasMutated) {
      compareLibrary = previousLibrary;
      renderCompareLibrary();
    }
    if (requestVideoId !== currentVideoId) return;
    console.error("[TubeInsight] Add to compare error:", error);
    setCompareStatus(error.message || "加入对比库失败，请重试。", "error");
  } finally {
    if (addGeneration === compareAddGeneration) {
      isCompareLibraryLoading = false;
      if (addButton) addButton.disabled = false;
    }
  }
}

async function removeCompareVideo(videoId) {
  const previousLibrary = compareLibrary;
  compareLibraryRevision += 1;
  compareLibrary = compareLibrary.filter(
    (video) => video.videoId !== videoId,
  );
  try {
    await saveCompareLibrary();
    invalidateComparisonReport();
    renderCompareLibrary();
    setCompareStatus("已从对比库删除。", "success");
  } catch (error) {
    compareLibrary = previousLibrary;
    renderCompareLibrary();
    setCompareStatus("删除失败，请稍后重试。", "error");
  }
}

async function clearCompareLibrary() {
  if (!compareLibrary.length) return;
  if (!window.confirm("确定清空全部对比视频吗？")) return;
  const previousLibrary = compareLibrary;
  compareLibraryRevision += 1;
  try {
    compareLibrary = [];
    await chrome.storage.local.remove(COMPARE_LIBRARY_KEY);
    invalidateComparisonReport();
    renderCompareLibrary();
    setCompareStatus("对比库已清空。", "success");
  } catch (error) {
    compareLibrary = previousLibrary;
    renderCompareLibrary();
    setCompareStatus("清空失败，请稍后重试。", "error");
  }
}

function renderComparisonReport(markdown) {
  const section = document.getElementById("compareReportSection");
  const content = document.getElementById("compareReportContent");
  if (!section || !content) return;
  section.style.display = "block";
  renderPrdMarkdown(markdown, content);
}

async function generateComparisonReport() {
  if (isComparisonReportLoading) return;
  if (compareLibrary.length < 2) {
    setCompareStatus("至少需要 2 个视频才能进行对比分析。", "error");
    return;
  }

  isComparisonReportLoading = true;
  const generateButton = document.getElementById("generateCompareReportBtn");
  if (generateButton) generateButton.disabled = true;
  setCompareStatus("正在生成多视频对比报告…", "loading");

  try {
    const result = await chrome.runtime.sendMessage({
      action: "generateMultiVideoComparison",
      date: formatLocalDate(),
      videos: compareLibrary,
    });
    if (!result?.success) {
      throw new Error(
        result?.message || result?.error || "对比报告生成失败，请稍后重试。",
      );
    }
    currentComparisonReport = result.report;
    renderComparisonReport(currentComparisonReport);
    setCompareStatus("对比报告已生成。", "success");
  } catch (error) {
    console.error("[TubeInsight] Comparison report error:", error);
    setCompareStatus(
      error.message || "对比报告生成失败，请稍后重试。",
      "error",
    );
  } finally {
    isComparisonReportLoading = false;
    renderCompareLibrary();
  }
}

async function copyComparisonReport() {
  if (!currentComparisonReport) return;
  const button = document.getElementById("copyCompareReportBtn");
  const original = button?.textContent;
  if (await copyToClipboard(currentComparisonReport)) {
    if (button) button.textContent = "已复制";
    setTimeout(() => {
      if (button) button.textContent = original;
    }, 1500);
  }
}

// ============================================================
// KNOWLEDGE EXPORT
// ============================================================

function formatLocalDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sanitizeMarkdownFilename(title) {
  const safeTitle = String(title || "untitled")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/g, "")
    .trim()
    .slice(0, 120);
  return safeTitle || "untitled";
}

function formatAnalysisForExport(analysis) {
  if (!analysis) return "";
  const sections = [];
  if (Array.isArray(analysis.chapters) && analysis.chapters.length) {
    sections.push(
      "章节摘要：",
      ...analysis.chapters.map(
        (chapter) =>
          `- [${chapter.timestamp || "0:00"}] ${chapter.title || ""}：${chapter.summary || ""}`,
      ),
    );
  }
  if (Array.isArray(analysis.keyQuotes) && analysis.keyQuotes.length) {
    sections.push(
      "",
      "重点引用：",
      ...analysis.keyQuotes.map(
        (quote) =>
          `- [${quote.timestamp || "0:00"}] ${quote.quote || ""}`,
      ),
    );
  }
  return sections.join("\n").trim();
}

function formatIndustryInsightsForExport(insights) {
  if (!insights) return "";
  const sections = [];
  if (Array.isArray(insights.terms) && insights.terms.length) {
    sections.push(
      "行业术语：",
      ...insights.terms.map(
        (item) =>
          `- ${item.term}（${item.category || "其他"}）：${item.explanation}`,
      ),
    );
  }
  if (Array.isArray(insights.key_insights) && insights.key_insights.length) {
    sections.push(
      "",
      "核心观点：",
      ...insights.key_insights.map(
        (item) => `- ${item.speaker || "视频作者"} → ${item.insight}`,
      ),
    );
  }
  if (Array.isArray(insights.pm_relevance) && insights.pm_relevance.length) {
    sections.push(
      "",
      "对 PM 最相关：",
      ...insights.pm_relevance.map((item) => `- ${item}`),
    );
  }
  return sections.join("\n").trim();
}

function formatNotesForExport(notes) {
  if (!Array.isArray(notes) || !notes.length) return "";
  return notes
    .map((note) => {
      const timestamp = note.timestamp || "0:00";
      const link = note.timestampedUrl || currentVideoUrl || "";
      return `- [${timestamp}](${link}) ${note.text || ""}`;
    })
    .join("\n");
}

function setKnowledgeExportStatus(message, type = "") {
  const status = document.getElementById("knowledgeExportStatus");
  if (!status) return;
  status.textContent = message;
  status.className = `knowledge-export-status${type ? ` ${type}` : ""}`;
  status.style.display = message ? "block" : "none";
}

async function downloadMarkdownWithChrome(markdown, filename) {
  const blob = new Blob([markdown], {
    type: "text/markdown;charset=utf-8",
  });
  const objectUrl = URL.createObjectURL(blob);
  try {
    if (!chrome.downloads?.download) {
      throw new Error("Chrome Downloads API is unavailable.");
    }
    return await chrome.downloads.download({
      url: objectUrl,
      filename,
      saveAs: false,
      conflictAction: "uniquify",
    });
  } finally {
    // Chrome consumes the Blob URL asynchronously after accepting the request.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
  }
}

function buildLocalKnowledgeMarkdown({
  videoTitle,
  videoUrl,
  date,
  aiSummary,
  productIntelligence,
  prdContent,
  insights,
  myNotes,
}) {
  const missing = "（本次未生成）";
  const intelligence = productIntelligence || {};
  const list = (items) =>
    Array.isArray(items) && items.length
      ? items.map((item) => `- ${item}`).join("\n")
      : missing;
  const keywords =
    Array.isArray(intelligence.business_model_keywords) &&
    intelligence.business_model_keywords.length
      ? intelligence.business_model_keywords
          .map((keyword) => `#${String(keyword).replace(/\s+/g, "")}`)
          .join(" ")
      : missing;

  return `# ${videoTitle || "未命名视频"}

**来源**：${videoUrl}
**整理日期**：${date}

---

## 核心价值
${intelligence.one_line_summary || missing}

## 内容摘要
${aiSummary || missing}

## 产品情报
### 核心功能点
${list(intelligence.product_features)}

### 用户痛点
${list(intelligence.user_pain_points)}

### 竞品信息
${list(intelligence.competitor_info)}

### 商业关键词
${keywords}

## PRD 草稿
${prdContent || missing}

## 行业洞察
${insights || missing}

## 我的笔记
${myNotes || missing}

---
*由 TubeInsight 自动生成 · ${date}*
`;
}

async function downloadMarkdownWithFallback(markdown, filename) {
  try {
    await downloadMarkdownWithChrome(markdown, filename);
    return "chrome";
  } catch (error) {
    console.warn(
      "[TubeInsight] Chrome Downloads API failed; using browser download:",
      error,
    );
    const blob = new Blob([markdown], {
      type: "text/markdown;charset=utf-8",
    });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    return "browser";
  }
}

async function exportKnowledgeMarkdown() {
  if (isKnowledgeExportLoading) return;
  if (!currentVideoId) {
    setKnowledgeExportStatus("当前没有可导出的视频。", "error");
    return;
  }

  isKnowledgeExportLoading = true;
  const requestVideoId = currentVideoId;
  const exportButton = document.getElementById("exportKnowledgeBtn");
  if (exportButton) exportButton.disabled = true;
  setKnowledgeExportStatus("正在整理知识卡片…", "loading");

  try {
    // Generate the existing AI overview on demand so the export contains an
    // actual summary even when the user has not opened Overview yet.
    if (!currentAnalysis && currentTranscriptTimestamped) {
      await triggerAnalysis();
    }
    if (requestVideoId !== currentVideoId) return;
    if (!currentAnalysis) {
      throw new Error("AI 摘要生成失败，暂时无法导出完整知识卡片。");
    }

    const notesResult = await chrome.runtime.sendMessage({
      action: "getNotes",
      videoId: requestVideoId,
    });
    if (!notesResult?.success) {
      throw new Error(notesResult?.error || "读取当前视频笔记失败。");
    }

    const date = formatLocalDate();
    const videoUrl = `https://www.youtube.com/watch?v=${requestVideoId}`;
    const exportData = {
      videoTitle: currentVideoTitle || "未命名视频",
      videoUrl,
      date,
      aiSummary: formatAnalysisForExport(currentAnalysis),
      productIntelligence: currentProductIntelligence
        ? JSON.stringify(currentProductIntelligence, null, 2)
        : "",
      prdContent: currentPrdContent || "",
      insights: formatIndustryInsightsForExport(currentIndustryInsights),
      myNotes: formatNotesForExport(notesResult.notes),
    };
    let markdown = buildLocalKnowledgeMarkdown({
      ...exportData,
      productIntelligence: currentProductIntelligence,
    });
    let usedLocalFallback = false;
    try {
      const result = await chrome.runtime.sendMessage({
        action: "generateKnowledgeExport",
        exportData,
      });
      if (result?.success && result.markdown) {
        markdown = result.markdown;
      } else {
        usedLocalFallback = true;
        console.warn(
          "[TubeInsight] AI knowledge organization unavailable:",
          result?.message || result?.error || "No response",
        );
      }
    } catch (error) {
      usedLocalFallback = true;
      console.warn("[TubeInsight] AI knowledge organization failed:", error);
    }
    if (requestVideoId !== currentVideoId) return;

    const filename = `${sanitizeMarkdownFilename(currentVideoTitle)}_${date}.md`;
    await downloadMarkdownWithFallback(markdown, filename);
    setKnowledgeExportStatus(
      usedLocalFallback
        ? `AI 整理不可用，已下载本地完整版本：${filename}`
        : `已下载：${filename}`,
      "success",
    );
  } catch (error) {
    if (requestVideoId !== currentVideoId) return;
    console.error("[TubeInsight] Knowledge export error:", error);
    setKnowledgeExportStatus(
      error.message || "知识库导出失败，请稍后重试。",
      "error",
    );
  } finally {
    if (requestVideoId === currentVideoId) {
      isKnowledgeExportLoading = false;
      if (exportButton) exportButton.disabled = false;
    }
  }
}

// ============================================================
// AUTO-SCROLL — Follow video playback in transcript
// ============================================================
// While a video plays, the transcript automatically scrolls to show which
// 30-second chunk is currently being spoken. If the user manually scrolls
// (e.g., to read ahead), auto-scroll pauses and a "Follow playback" button
// appears so they can resume it. Highlight always stays active regardless.

/**
 * Starts polling the video's current time and highlighting/scrolling
 * to the matching transcript entry.
 */
function startPlaybackTracking() {
  if (!currentTranscript || !currentTranscript.length) return;

  // Don't restart if already tracking (preserves user's auto-scroll state)
  if (autoScrollInterval) return;

  const willRestoreReadingPosition =
    pendingTranscriptViewState?.videoId === currentVideoId;
  autoScrollEnabled = !willRestoreReadingPosition;
  document.getElementById("followPlaybackBtn").style.display =
    willRestoreReadingPosition ? "block" : "none";

  // Poll video time every 500ms
  autoScrollInterval = setInterval(() => playbackTrackingTick(), 500);

  // Listen for manual scrolls on the content area
  const contentArea = document.getElementById("contentArea");
  contentArea.removeEventListener("scroll", onContentAreaScroll);
  contentArea.addEventListener("scroll", onContentAreaScroll);
}

/**
 * Stops playback tracking entirely. Called when leaving transcript tab,
 * starting a new digest, or leaving results state.
 */
function stopPlaybackTracking() {
  if (autoScrollInterval) {
    clearInterval(autoScrollInterval);
    autoScrollInterval = null;
  }
  autoScrollEnabled = true; // Reset for next time
  lastAutoScrollTime = 0;
  document.getElementById("followPlaybackBtn").style.display = "none";

  // Remove active highlights
  document
    .querySelectorAll(".transcript-entry.active-playback")
    .forEach((el) => {
      el.classList.remove("active-playback");
    });
}

/**
 * One tick of the playback tracker. Gets current video time from the
 * YouTube tab and highlights + scrolls to the matching transcript entry.
 */
async function playbackTrackingTick() {
  try {
    const result = await chrome.runtime.sendMessage({
      action: "relayToContent",
      payload: { action: "getCurrentTime" },
    });

    if (!result.success || !result.response) return;

    const currentTime = result.response.currentTime || 0;
    highlightActiveEntry(currentTime);
  } catch (error) {
    // Silently ignore — YouTube tab might be closed or navigated away
  }
}

/**
 * Scrolls the transcript to the entry currently being spoken (the one
 * carrying the active-playback highlight). Returns false if nothing is
 * highlighted yet. Stamps lastAutoScrollTime BEFORE scrolling so the scroll
 * events from our own smooth animation aren't mistaken for the user
 * scrolling away (which would re-disable auto-scroll immediately).
 */
function scrollToActiveEntry() {
  const activeEntry = document.querySelector(
    "#transcriptList .transcript-entry.active-playback",
  );
  if (!activeEntry) return false;

  lastAutoScrollTime = Date.now();
  activeEntry.scrollIntoView({ behavior: "smooth", block: "center" });
  return true;
}

/**
 * Finds the transcript entry matching the current playback time,
 * highlights it, and scrolls to it (if auto-scroll is enabled).
 *
 * @param {number} currentSeconds - Current video playback time in seconds
 */
function highlightActiveEntry(currentSeconds) {
  const transcriptList = document.getElementById("transcriptList");
  if (!transcriptList) return;

  const entries = transcriptList.querySelectorAll(".transcript-entry");
  if (entries.length === 0) return;

  // Find the entry whose time range contains the current playback time
  let activeEntry = null;
  entries.forEach((entry, index) => {
    const entrySeconds = parseInt(entry.dataset.seconds);
    const nextEntry = entries[index + 1];
    const nextSeconds = nextEntry
      ? parseInt(nextEntry.dataset.seconds)
      : Infinity;

    if (currentSeconds >= entrySeconds && currentSeconds < nextSeconds) {
      activeEntry = entry;
    }
  });

  if (!activeEntry) return;

  // Skip if this entry is already highlighted (no DOM thrashing)
  if (activeEntry.classList.contains("active-playback")) return;

  // Remove old highlight, add new one
  entries.forEach((e) => e.classList.remove("active-playback"));
  activeEntry.classList.add("active-playback");

  // Only scroll if auto-scroll is enabled
  if (autoScrollEnabled) {
    lastAutoScrollTime = Date.now();
    activeEntry.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

/**
 * Scroll event handler for the content area.
 * Detects manual scrolling and disables auto-scroll so the user
 * can read at their own pace without being yanked back.
 */
function onContentAreaScroll() {
  scheduleTranscriptViewStateSave();

  // Ignore scroll events within 1 second of a programmatic scroll
  // (smooth scroll animations can last longer than a simple boolean flag)
  if (Date.now() - lastAutoScrollTime < 1000) return;

  // User scrolled manually — disable auto-scroll and show the button
  if (autoScrollEnabled && autoScrollInterval) {
    autoScrollEnabled = false;
    document.getElementById("followPlaybackBtn").style.display = "block";
  }
}

/**
 * Uses session storage when it is available. Local storage is a safe fallback
 * for older test or browser environments that do not expose session storage.
 */
function getTranscriptViewStateStorage() {
  return chrome.storage.session || chrome.storage.local;
}

/**
 * Reads one video's last visible transcript position.
 */
async function loadTranscriptViewState(videoId) {
  if (!videoId) return null;
  try {
    const result = await getTranscriptViewStateStorage().get(
      TRANSCRIPT_VIEW_STATE_KEY,
    );
    const state = result?.[TRANSCRIPT_VIEW_STATE_KEY]?.[videoId];
    const scrollTop = Number(state?.scrollTop);
    if (!Number.isFinite(scrollTop) || scrollTop < 0) return null;
    return { videoId, scrollTop };
  } catch (error) {
    console.error("[TubeInsight] Reading position load error:", error);
    return null;
  }
}

/**
 * Stores positions for a small recent set of videos. This prevents one value
 * from growing without a limit during a long Chrome session.
 */
async function saveTranscriptViewState(videoId, scrollTop) {
  if (!videoId || !Number.isFinite(scrollTop) || scrollTop < 0) return;
  try {
    const storage = getTranscriptViewStateStorage();
    const result = await storage.get(TRANSCRIPT_VIEW_STATE_KEY);
    const states = result?.[TRANSCRIPT_VIEW_STATE_KEY] || {};
    states[videoId] = { scrollTop, updatedAt: Date.now() };

    const recentStates = Object.fromEntries(
      Object.entries(states)
        .sort(([, a], [, b]) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, 20),
    );
    await storage.set({ [TRANSCRIPT_VIEW_STATE_KEY]: recentStates });
  } catch (error) {
    console.error("[TubeInsight] Reading position save error:", error);
  }
}

/**
 * Saves the visible position after scrolling stops. Capturing the video ID and
 * position now prevents a later video change from writing the wrong state.
 */
function scheduleTranscriptViewStateSave() {
  if (
    isRestoringTranscriptView ||
    !currentVideoId ||
    !transcriptTabIsActive()
  ) {
    return;
  }
  const contentArea = document.getElementById("contentArea");
  if (!contentArea) return;

  const videoId = currentVideoId;
  const scrollTop = contentArea.scrollTop;
  lastTranscriptScrollTop = scrollTop;
  clearTimeout(transcriptViewStateSaveTimer);
  transcriptViewStateSaveTimer = setTimeout(() => {
    void saveTranscriptViewState(videoId, scrollTop);
  }, 150);
}

/**
 * Saves immediately before the panel closes.
 */
function saveCurrentTranscriptViewState() {
  clearTimeout(transcriptViewStateSaveTimer);
  const contentArea = document.getElementById("contentArea");
  if (!currentVideoId || !contentArea) return Promise.resolve();
  if (transcriptTabIsActive()) captureCurrentTranscriptScrollTop();
  return saveTranscriptViewState(currentVideoId, lastTranscriptScrollTop);
}

/**
 * Returns true only while the Transcript tab is the visible results panel.
 */
function transcriptTabIsActive() {
  return resultTabIsActive("transcript");
}

function resultTabIsActive(tabName) {
  return Boolean(
    document.querySelector(
      `.tab-panel[data-panel="${CSS.escape(tabName)}"].active`,
    ),
  );
}

/**
 * Copies the shared scroll area's current value into transcript-only state.
 */
function captureCurrentTranscriptScrollTop() {
  const contentArea = document.getElementById("contentArea");
  if (contentArea) lastTranscriptScrollTop = contentArea.scrollTop;
}

/**
 * Restores the saved position after the transcript becomes visible. Follow
 * Playback stays paused, so the next timer tick cannot move the panel again.
 */
function restorePendingTranscriptViewState(videoId) {
  const state = pendingTranscriptViewState;
  pendingTranscriptViewState = null;
  const contentArea = document.getElementById("contentArea");
  if (!state || state.videoId !== videoId) {
    contentArea?.classList.remove("restoring-transcript-view");
    return;
  }

  requestAnimationFrame(() => {
    if (currentVideoId !== videoId || !contentArea) {
      contentArea?.classList.remove("restoring-transcript-view");
      return;
    }

    isRestoringTranscriptView = true;
    lastAutoScrollTime = Date.now();
    autoScrollEnabled = false;
    contentArea.scrollTop = state.scrollTop;
    lastTranscriptScrollTop = state.scrollTop;
    document.getElementById("followPlaybackBtn").style.display = "block";
    contentArea.classList.remove("restoring-transcript-view");
    requestAnimationFrame(() => {
      isRestoringTranscriptView = false;
    });
  });
}

// ============================================================
// UNIVERSAL DISPLAY LANGUAGE — Original / Chinese / aligned bilingual
// ============================================================

async function loadDisplayLanguageMode(videoId) {
  if (!videoId) {
    setTranscriptModeButtons("original");
    return "original";
  }
  try {
    const stored = await chrome.storage.local.get(DISPLAY_LANGUAGE_MODE_KEY);
    const mode = stored?.[DISPLAY_LANGUAGE_MODE_KEY]?.[videoId]?.mode;
    currentTranscriptMode = DISPLAY_LANGUAGE_MODES.has(mode)
      ? mode
      : "original";
  } catch (error) {
    currentTranscriptMode = "original";
  }
  setTranscriptModeButtons(currentTranscriptMode);
  return currentTranscriptMode;
}

async function saveDisplayLanguageMode(videoId, mode) {
  if (!videoId || !DISPLAY_LANGUAGE_MODES.has(mode)) return;
  const stored = await chrome.storage.local.get(DISPLAY_LANGUAGE_MODE_KEY);
  const modes = stored?.[DISPLAY_LANGUAGE_MODE_KEY] || {};
  modes[videoId] = { mode, updatedAt: Date.now() };
  const recentModes = Object.fromEntries(
    Object.entries(modes)
      .sort(([, a], [, b]) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 50),
  );
  await chrome.storage.local.set({
    [DISPLAY_LANGUAGE_MODE_KEY]: recentModes,
  });
}

function getActiveTranscriptSegments() {
  return groupTranscriptEntries(currentTranscript || []);
}

function transcriptTranslationCacheKey(segment) {
  return `${currentVideoId}:zh:semantic:${segment.id}`;
}

function setTranscriptModeButtons(mode) {
  document.querySelectorAll(".transcript-mode-btn").forEach((button) => {
    const active = button.dataset.transcriptMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

async function handleDisplayLanguageModeChange(mode) {
  if (!DISPLAY_LANGUAGE_MODES.has(mode)) return;
  if (mode === currentTranscriptMode) return;

  currentTranscriptMode = mode;
  await saveDisplayLanguageMode(currentVideoId, mode);
  if (mode !== "original") interfaceTranslationFailures.clear();
  translationGeneration += 1;
  translationWorkCount = 0;
  setTranslatingSpinner(false);
  if (transcriptScrollObserver) transcriptScrollObserver.disconnect();
  transcriptScrollObserver = null;
  setTranscriptModeButtons(mode);
  const activeTabName =
    document.querySelector(".tab.active")?.dataset.tab || "transcript";

  if (mode === "original") {
    renderTranscript();
    if (currentAnalysis) renderAnalysisResults(currentAnalysis);
    if (currentNotes.length) renderNotes(currentNotes, currentNotesFilterVideoId);
    return;
  }

  if (currentAnalysis) {
    renderAnalysisResults(currentAnalysis);
  }
  if (currentNotes.length) {
    renderNotes(currentNotes, currentNotesFilterVideoId);
  }
  if (activeTabName === "overview" && currentAnalysis) {
    await translateOverviewContent();
  } else if (activeTabName === "notes" && currentNotes.length) {
    await translateNotesContent();
  } else if (activeTabName === "transcript") {
    await translateTranscript();
  }
}

function renderTranscriptSegmentContent(segment, mode, translated, error) {
  const original = renderSubtitleInlineMarkup(segment.text);
  let translationHtml = "";
  if (translated) {
    translationHtml = renderSubtitleInlineMarkup(translated);
  } else if (error) {
    translationHtml = `${escapeHtml(error)}<button class="translation-retry-btn" type="button">Retry</button>`;
  } else {
    translationHtml = "Waiting for translation…";
  }

  if (mode === "bilingual") {
    return `<span class="transcript-copy"><span class="transcript-original">${original}</span><span class="transcript-translation ${translated ? "" : error ? "translation-error" : "translation-pending"}">${translationHtml}</span></span>`;
  }

  return `<span class="transcript-copy"><span class="transcript-translation ${translated ? "" : error ? "translation-error" : "translation-pending"}">${translationHtml}</span></span>`;
}

function renderTranscriptModeRows(segments, mode) {
  const transcriptList = document.getElementById("transcriptList");
  if (!transcriptList) return [];
  transcriptList.innerHTML = "";

  const existingBadge = document.getElementById("transcriptSourceBadge");
  if (existingBadge) existingBadge.remove();

  const rows = [];
  segments.forEach((segment, index) => {
    const div = document.createElement("div");
    const cached = transcriptParagraphCache.get(
      transcriptTranslationCacheKey(segment),
    );
    div.className = `transcript-entry ${cached ? "translated" : "translating"}`;
    div.dataset.seconds = segment.start;
    div.dataset.segmentId = segment.id;
    div.dataset.segmentIndex = index;

    const minutes = Math.floor(segment.start / 60);
    const seconds = Math.floor(segment.start % 60);
    const timestamp = `${minutes}:${String(seconds).padStart(2, "0")}`;
    div.innerHTML = `
      <span class="transcript-time">${timestamp}</span>
      ${renderTranscriptSegmentContent(segment, mode, cached, "")}
    `;
    div.addEventListener("click", (event) =>
      seekFromTranscriptEntryClick(event, segment.start),
    );
    transcriptList.appendChild(div);
    rows.push(div);
  });

  // Bilingual mode can find source text before each translation arrives.
  refreshTranscriptSearch({ preserveIndex: false, scroll: false });

  startPlaybackTracking();
  return rows;
}

/**
 * Rebuilds a provider response in source order. Unknown IDs are ignored and
 * missing IDs remain explicit errors, never positional guesses.
 */
function alignTranslatedSegmentBatch(sourceSegments, responseSegments) {
  const translatedById = new Map();
  if (Array.isArray(responseSegments)) {
    responseSegments.forEach((item) => {
      if (!item || typeof item.id !== "string" || typeof item.text !== "string")
        return;
      const text = item.text.trim();
      if (text && !translatedById.has(item.id)) {
        translatedById.set(item.id, text);
      }
    });
  }

  return sourceSegments.map((segment) => ({
    id: segment.id,
    text: translatedById.get(segment.id) || "",
    error: translatedById.has(segment.id) ? "" : "Translation unavailable.",
  }));
}

function updateTranslatedRow(segment, index, alignedItem, generation) {
  if (generation !== translationGeneration) return;
  const row = document.querySelector(
    `.transcript-entry[data-segment-id="${CSS.escape(segment.id)}"]`,
  );
  if (!row) return;

  if (alignedItem.text) {
    transcriptParagraphCache.set(
      transcriptTranslationCacheKey(segment),
      alignedItem.text,
    );
  }

  const copy = row.querySelector(".transcript-copy");
  if (copy) {
    copy.outerHTML = renderTranscriptSegmentContent(
      segment,
      currentTranscriptMode,
      alignedItem.text,
      alignedItem.error,
    );
  }
  row.classList.toggle("translated", !!alignedItem.text);
  row.classList.toggle("translating", false);
  row.classList.toggle("translation-failed", !alignedItem.text);

  const retry = row.querySelector(".translation-retry-btn");
  if (retry) {
    ["mousedown", "mouseup"].forEach((eventName) => {
      retry.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    });
    retry.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      retryTranslationSegment(index, generation);
    });
  }
}

let activeTranslationQueue = null;

async function requestTranscriptTranslationBatch(
  indices,
  segments,
  generation,
  videoId,
  mode,
) {
  const sourceBatch = indices.map((index) => segments[index]);
  setTranslatingSpinner(true);
  try {
    const result = await sendTranslationMessage({
      action: "translateContent",
      content: {
        segments: sourceBatch.map(({ id, text }) => ({ id, text })),
      },
      contentType: "transcriptBatch",
      targetLanguage: "zh",
      videoTitle: currentVideoTitle,
    });

    const isStale =
      generation !== translationGeneration ||
      videoId !== currentVideoId ||
      mode !== currentTranscriptMode;
    if (isStale) return;

    const responseSegments = result?.success
      ? result.translatedContent?.segments
      : [];
    const aligned = alignTranslatedSegmentBatch(sourceBatch, responseSegments);
    aligned.forEach((item, batchIndex) => {
      if (!result?.success) {
        item.error = result?.error || "Translation failed.";
      }
      updateTranslatedRow(
        sourceBatch[batchIndex],
        indices[batchIndex],
        item,
        generation,
      );
    });
    refreshTranscriptSearch({ preserveIndex: true, scroll: false });
    await updateCache();
  } catch (error) {
    if (generation !== translationGeneration) return;
    sourceBatch.forEach((segment, batchIndex) => {
      updateTranslatedRow(
        segment,
        indices[batchIndex],
        { id: segment.id, text: "", error: error.message || "Translation failed." },
        generation,
      );
    });
    refreshTranscriptSearch({ preserveIndex: true, scroll: false });
  } finally {
    setTranslatingSpinner(false);
  }
}

function retryTranslationSegment(index, generation) {
  if (generation !== translationGeneration || !activeTranslationQueue) return;
  const row = document.querySelector(
    `.transcript-entry[data-segment-index="${index}"]`,
  );
  if (row) {
    row.classList.add("translating");
    row.classList.remove("translation-failed");
    const translation = row.querySelector(".transcript-translation");
    if (translation) {
      translation.className = "transcript-translation translation-pending";
      translation.textContent = "Retrying…";
    }
  }
  activeTranslationQueue.enqueue(index, true);
}

/**
 * Renders immediately, translates the first small batch, then observes the
 * remaining rows. Batches are sequential so the provider is never flooded.
 */
async function translateTranscript() {
  const segments = getActiveTranscriptSegments();
  if (!segments.length || currentTranscriptMode === "original") return;

  const generation = translationGeneration;
  const videoId = currentVideoId;
  const mode = currentTranscriptMode;
  if (transcriptScrollObserver) transcriptScrollObserver.disconnect();

  const rows = renderTranscriptModeRows(segments, mode);
  const queue = [];
  const queued = new Set();
  let processing = false;

  const processNext = async () => {
    if (processing || queue.length === 0 || generation !== translationGeneration)
      return;
    processing = true;
    const indices = queue.splice(0, TRANSLATION_BATCH_SIZE);
    indices.forEach((index) => queued.delete(index));
    try {
      await requestTranscriptTranslationBatch(
        indices,
        segments,
        generation,
        videoId,
        mode,
      );
    } finally {
      processing = false;
      if (queue.length && generation === translationGeneration) processNext();
    }
  };

  const enqueue = (index, force = false) => {
    if (!Number.isInteger(index) || !segments[index]) return;
    const cached = transcriptParagraphCache.has(
      transcriptTranslationCacheKey(segments[index]),
    );
    if ((!force && cached) || queued.has(index)) return;
    queue.push(index);
    queued.add(index);
    // Let all entries reported in the same viewport turn collect before the
    // worker starts, producing one small contextual multi-segment request.
    Promise.resolve().then(processNext);
  };
  activeTranslationQueue = { enqueue };

  transcriptScrollObserver = new IntersectionObserver(
    (observerEntries) => {
      observerEntries
        .filter((entry) => entry.isIntersecting)
        .sort(
          (a, b) =>
            Number(a.target.dataset.segmentIndex) -
            Number(b.target.dataset.segmentIndex),
        )
        .forEach((entry) => enqueue(Number(entry.target.dataset.segmentIndex)));
    },
    {
      root: document.getElementById("contentArea"),
      rootMargin: "320px 0px",
      threshold: 0,
    },
  );

  rows.forEach((row, index) => {
    if (!row.classList.contains("translated")) transcriptScrollObserver.observe(row);
    if (index < TRANSLATION_BATCH_SIZE) enqueue(index);
  });
}

function setTranslatingSpinner(show) {
  if (show) translationWorkCount += 1;
  else translationWorkCount = Math.max(0, translationWorkCount - 1);
  const isTranslating = translationWorkCount > 0;
  const spinner = document.getElementById("langSpinner");
  if (spinner) spinner.classList.toggle("visible", isTranslating);
}

// Pure helpers are exposed for the repository's Node tests. The extension does
// not read this object at runtime.
globalThis.__YTD_TRANSCRIPT_TESTING__ = {
  sendTranslationMessage,
  groupTranscriptEntries,
  splitOversizedThought,
  alignTranslatedSegmentBatch,
  findLiteralTranscriptMatches,
  loadTranscriptViewState,
  saveTranscriptViewState,
  loadDisplayLanguageMode,
  saveDisplayLanguageMode,
  getNavigationUrl,
  renderSubtitleInlineMarkup,
  renderTranscriptSegmentContent,
  formatLocalDate,
  sanitizeMarkdownFilename,
  formatAnalysisForExport,
  formatIndustryInsightsForExport,
  buildLocalKnowledgeMarkdown,
  normalizeStoredCompareLibrary,
  formatCompareAddedAt,
};
