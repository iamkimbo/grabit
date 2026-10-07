// =============================================================
// service-worker.js
// Background service worker for Grabit (Manifest V3).
// Handles platform detection, popup-to-content-script message relay,
// and tab state queries. Has no persistent state — all storage goes
// through chrome.storage.local via the popup or content scripts.
// =============================================================

'use strict';

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

// Maps a tab's URL to a platform identifier string.
// Returns 'chatgpt' | 'claude' | 'gemini' | 'grok' | null
function detectPlatform(url) {
  if (!url) return null;
  if (url.includes('chatgpt.com')) return 'chatgpt';
  if (url.includes('claude.ai')) return 'claude';
  if (url.includes('gemini.google.com')) return 'gemini';
  if (url.includes('grok.com')) return 'grok';
  return null;
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

// Routes messages from the popup to the correct handler.
// Returning true from the listener keeps the channel open for async responses.
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {

  // GET_ACTIVE_TAB_PLATFORM — popup asks which platform is in the active tab
  if (request.action === 'GET_ACTIVE_TAB_PLATFORM') {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      const tab = tabs[0];
      if (!tab) {
        sendResponse({ platform: null, tabId: null, url: null });
        return;
      }
      sendResponse({
        platform: detectPlatform(tab.url),
        tabId: tab.id,
        url: tab.url
      });
    });
    return true;
  }

  // RELAY_SCRAPE — popup asks the service worker to forward a scrape request
  // to the content script running in the specified tab.
  // This exists because the popup cannot directly message content scripts
  // in all Chrome configurations without going through the service worker.
  if (request.action === 'RELAY_SCRAPE' && request.tabId) {
    chrome.tabs.sendMessage(
      request.tabId,
      { action: 'SCRAPE_MESSAGES' },
      function(response) {
        if (chrome.runtime.lastError) {
          sendResponse({
            success: false,
            error: chrome.runtime.lastError.message,
            messages: [],
            messageCount: 0
          });
        } else {
          sendResponse(response);
        }
      }
    );
    return true;
  }

  // OPEN_POPUP — sidebar widget in the content script requests the popup to open.
  // chrome.action.openPopup() requires Chrome 127+ and a user-gesture origin
  // (the click on the sidebar button satisfies this requirement). If the call
  // rejects for any reason the content script will show a fallback tooltip.
  if (request.action === 'OPEN_POPUP') {
    chrome.action.openPopup()
      .then(function () { sendResponse({ success: true }); })
      .catch(function () { sendResponse({ success: false }); });
    return true;
  }

});

// ---------------------------------------------------------------------------
// Installation handler
// ---------------------------------------------------------------------------

// Runs once when the extension is first installed or updated.
// Sets default storage values so the rest of the code never reads undefined.
chrome.runtime.onInstalled.addListener(function(details) {
  if (details.reason === 'install') {
    chrome.storage.local.set({
      isPremium: false,
      licenseKey: null,
      licenseInstanceId: null,
      licenseStatus: 'free',
      licenseTier: null,
      licenseVariantId: null,
      // Selective export usage counter — { date: 'YYYY-MM-DD', count: 0 }
      selectiveExportUsage: { date: getTodayString(), count: 0 },
      // Pin nudge — shown on first open, dismissed forever after the × click
      pin_nudge_dismissed: false,
      // Running total of successful exports across all sessions
      total_export_count: 0,
      // Review ask — true once the user clicks the review bar
      review_ask_shown: false,
      // Index into REVIEW_MILESTONES [5,15,30,60,120] — which milestone to check next
      review_milestone_index: 0,
      // Notion integration
      notionAccessToken:   null,
      notionWorkspaceName: null,
      notionPageId:        null,
      notionPageTitle:     null,
      // Merge queue — array of queued conversation objects
      merge_queue:         []
    });
  }
});

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

// Returns today's date as a YYYY-MM-DD string in local time.
// Used to initialise the export usage counter on fresh install.
// Returns string
function getTodayString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
