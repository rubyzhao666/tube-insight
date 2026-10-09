const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sidepanel = fs.readFileSync(path.join(root, "sidepanel.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "sidepanel.css"), "utf8");

test("digest requests are deduplicated and stale generations are discarded", () => {
  assert.match(
    sidepanel,
    /if \(digestInFlight\?\.videoId === videoId\)[\s\S]*return digestInFlight\.promise/,
  );
  assert.match(
    sidepanel,
    /const requestIsCurrent = \(\) => generation === digestGeneration/,
  );
  assert.match(
    sidepanel,
    /const transcriptResult = await chrome\.runtime\.sendMessage\([\s\S]*if \(!requestIsCurrent\(\)\) return;/,
  );
});

test("overview requests are shared and cannot update another video", () => {
  assert.match(
    sidepanel,
    /if \(analysisInFlight\?\.videoId === requestVideoId\)[\s\S]*return analysisInFlight\.promise/,
  );
  assert.match(
    sidepanel,
    /action: "analyzeTranscript"[\s\S]*if \(requestVideoId !== currentVideoId\) return null;[\s\S]*currentAnalysis = analysisResult\.analysis/,
  );
  assert.match(
    sidepanel,
    /if \(!videoId \|\| videoId !== currentVideoId \|\| !currentTranscript\) return;/,
  );
});

test("compare and export wait for active AI work and keep snapshots fresh", () => {
  assert.match(
    sidepanel,
    /if \(isProductIntelligenceLoading\) \{[\s\S]*await waitForCurrentOperation/,
  );
  assert.match(
    sidepanel,
    /await saveToCache\(requestVideoId\);\s+await syncCurrentVideoCompareEntry\(\);/,
  );
  assert.match(
    sidepanel,
    /if \(!currentAnalysis && currentTranscriptTimestamped\) \{\s+await triggerAnalysis\(\);/,
  );
  assert.match(
    sidepanel,
    /product_features: currentProductIntelligence[\s\S]*: previousEntry\.product_features/,
  );
  assert.match(
    sidepanel,
    /const requestedRevision = compareLibraryRevision;[\s\S]*if \(requestedRevision !== compareLibraryRevision\) return;/,
  );
  assert.match(
    sidepanel,
    /compareAddGeneration \+= 1;\s+isCompareLibraryLoading = false;/,
  );
});

test("six side-panel tabs remain reachable on narrow widths", () => {
  assert.match(styles, /\.tabs \{[\s\S]*overflow-x: auto;/);
  assert.match(styles, /\.tab \{[\s\S]*flex: 0 0 auto;/);
});
