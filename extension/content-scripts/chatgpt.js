// =============================================================
// chatgpt.js
// Content script for chatgpt.com.
// Scrapes the active conversation from the ChatGPT DOM and returns
// an array of normalized Message objects in response to a
// SCRAPE_MESSAGES message from the popup.
//
// Depends on: scraper-utils.js (loaded first via manifest)
// =============================================================

'use strict';

const PLATFORM = 'chatgpt';

// ---------------------------------------------------------------------------
// Scrape entry point
// ---------------------------------------------------------------------------

// Walks the ChatGPT conversation DOM and returns all messages as Message[]
// Throws an Error with a user-friendly message if no conversation is found
function scrapeMessages() {
  const turns = findConversationTurns();

  if (!turns.length) {
    throw new Error(
      'No conversation found. Open a ChatGPT chat and try again.'
    );
  }

  const messages = [];
  turns.forEach((turnEl, index) => {
    const msg = extractFromTurn(turnEl, index);
    if (msg) messages.push(msg);
  });

  if (!messages.length) {
    throw new Error(
      'Conversation found but no messages could be extracted.'
    );
  }

  return messages;
}

// ---------------------------------------------------------------------------
// DOM discovery
// ---------------------------------------------------------------------------

// Finds all conversation turn elements using multiple selector strategies.
// ChatGPT's DOM changes periodically; each strategy is a fallback.
// Returns Element[]
function findConversationTurns() {
  // Strategy 1 (most reliable as of 2024–2025):
  // ChatGPT marks each turn with data-testid="conversation-turn-N"
  let turns = Array.from(
    document.querySelectorAll('[data-testid^="conversation-turn"]')
  );
  if (turns.length) return turns;

  // Strategy 2: article elements that contain role-attributed children
  turns = Array.from(document.querySelectorAll('article.w-full'));
  if (turns.length) return turns;

  // Strategy 3: locate role elements and walk up to a common ancestor
  const roleEls = Array.from(
    document.querySelectorAll('[data-message-author-role]')
  );
  if (roleEls.length) {
    const containers = new Set(
      roleEls.map(el => el.closest('[data-testid], article') || el)
    );
    return [...containers];
  }

  // Strategy 4: any div with a message-id attribute (deep fallback)
  turns = Array.from(document.querySelectorAll('[data-message-id]'))
    .map(el => el.closest('article, [data-testid]') || el);
  return [...new Set(turns)];
}

// ---------------------------------------------------------------------------
// Message extraction
// ---------------------------------------------------------------------------

// Extracts a normalized Message from a single conversation turn element.
// Returns a Message object or null if the turn is empty or unrecognizable.
function extractFromTurn(turnEl, index) {
  // The role element carries data-message-author-role="user"|"assistant"|"tool"
  const roleEl = turnEl.querySelector('[data-message-author-role]');
  if (!roleEl) return null;

  const rawRole = roleEl.getAttribute('data-message-author-role');

  // Skip tool/function/system turns — not meaningful for export
  if (rawRole !== 'user' && rawRole !== 'assistant') return null;

  const role = rawRole === 'user' ? 'user' : 'assistant';
  const contentEl = findContentElement(roleEl, role);

  if (!contentEl || !hasContent(contentEl)) return null;

  const contentHtml = contentEl.innerHTML;
  const contentText = role === 'user'
    ? contentEl.textContent.trim()   // User text is unstyled; plain text is fine
    : elementToMarkdown(contentEl);  // AI responses are rich HTML → convert to MD

  const timestamp = extractTimestamp(turnEl);

  return normalizeMessage(role, contentText, contentHtml, index, PLATFORM, timestamp);
}

// Finds the element containing the actual message text within a role element.
// ChatGPT uses different containers for user vs. assistant messages.
// Returns an Element or null
function findContentElement(roleEl, role) {
  if (role === 'user') {
    // User message: plain text div, usually whitespace-pre-wrap
    return (
      roleEl.querySelector('.whitespace-pre-wrap') ||
      roleEl.querySelector('[data-message-id] > div > div') ||
      roleEl.querySelector('p') ||
      roleEl
    );
  }

  // Assistant message: markdown/prose container
  return (
    roleEl.querySelector('.markdown.prose') ||
    roleEl.querySelector('.markdown') ||
    roleEl.querySelector('[class*="prose"]') ||
    roleEl.querySelector('[class*="markdown"]') ||
    roleEl.querySelector('.group\\/conversation-turn') ||
    roleEl
  );
}

// Attempts to read an ISO timestamp from the turn element.
// Returns an ISO datetime string or null
function extractTimestamp(turnEl) {
  const timeEl = turnEl.querySelector('time[datetime]');
  if (timeEl) return timeEl.getAttribute('datetime');

  const timeEl2 = turnEl.querySelector('time');
  if (timeEl2 && timeEl2.textContent.trim()) return timeEl2.textContent.trim();

  return null;
}

// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------

// Listens for SCRAPE_MESSAGES from the popup and returns the scraped result.
// Returns true to keep the channel open for the async sendResponse call.
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action !== 'SCRAPE_MESSAGES') return false;

  try {
    const messages = scrapeMessages();
    sendScrapeResponse(sendResponse, messages, PLATFORM);
  } catch (err) {
    sendErrorResponse(sendResponse, err, PLATFORM);
  }

  return true;
});
