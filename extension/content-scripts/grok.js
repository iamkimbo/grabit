// =============================================================
// grok.js
// Content script for grok.com.
// Scrapes the active conversation from the Grok DOM and returns
// normalized Message objects in response to a SCRAPE_MESSAGES request.
//
// Grok's DOM is similar in structure to ChatGPT's, using role attributes
// on message containers as the primary identification mechanism.
//
// Depends on: scraper-utils.js (loaded first via manifest)
// =============================================================

'use strict';

const PLATFORM = 'grok';

// ---------------------------------------------------------------------------
// Scrape entry point
// ---------------------------------------------------------------------------

// Walks the Grok conversation DOM and returns all messages as Message[]
// Throws a user-friendly Error if no conversation is detected
function scrapeMessages() {
  const turns = findConversationTurns();

  if (!turns.length) {
    throw new Error(
      'No conversation found. Open a Grok chat and try again.'
    );
  }

  const messages = [];
  turns.forEach((turn, index) => {
    const msg = extractFromTurn(turn.el, turn.role, index);
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

// Finds all Grok conversation turns, tagged with their role.
// Returns { el: Element, role: 'user'|'assistant' }[]
function findConversationTurns() {
  // Strategy 1: role attribute on message containers (mirrors ChatGPT's pattern)
  const roleEls = Array.from(
    document.querySelectorAll('[data-message-author-role]')
  );
  if (roleEls.length) {
    return roleEls
      .filter(el => {
        const r = el.getAttribute('data-message-author-role');
        return r === 'user' || r === 'assistant';
      })
      .map(el => ({
        el,
        role: el.getAttribute('data-message-author-role') === 'user' ? 'user' : 'assistant'
      }));
  }

  // Strategy 2: Grok's own class naming conventions
  const userByClass = Array.from(
    document.querySelectorAll(
      '[class*="UserMessage"], [class*="user-message"], [class*="humanMessage"]'
    )
  );
  const aiByClass = Array.from(
    document.querySelectorAll(
      '[class*="AssistantMessage"], [class*="grok-message"], [class*="aiMessage"], ' +
      '[class*="BotMessage"], [class*="bot-message"]'
    )
  );

  if (userByClass.length || aiByClass.length) {
    const all = [
      ...userByClass.map(el => ({ el, role: 'user' })),
      ...aiByClass.map(el => ({ el, role: 'assistant' }))
    ];
    return sortByDomOrder(all);
  }

  // Strategy 3: data-testid patterns
  const testIdEls = Array.from(
    document.querySelectorAll('[data-testid*="message"], [data-testid*="turn"]')
  );
  if (testIdEls.length) {
    return testIdEls.map(el => ({
      el,
      role: inferRole(el)
    }));
  }

  // Strategy 4: article or listitem based layout with role inference
  const articleEls = Array.from(
    document.querySelectorAll('article, [role="listitem"]')
  ).filter(el => el.textContent.trim().length > 10);
  if (articleEls.length) {
    return articleEls.map(el => ({
      el,
      role: inferRole(el)
    }));
  }

  // Strategy 5: broad message wrapper sweep — last resort
  const wrappers = Array.from(
    document.querySelectorAll(
      '.message-wrapper, .chat-message, .message-bubble, [class*="Message"]'
    )
  ).filter(el => el.textContent.trim().length > 5);

  return [...new Set(wrappers)].map(el => ({
    el,
    role: inferRole(el)
  }));
}

// Infers the role of a message element from classes, data attributes, and structure.
// Returns 'user' | 'assistant'
function inferRole(el) {
  const signature = [
    el.className || '',
    el.getAttribute('data-role') || '',
    el.getAttribute('data-author') || '',
    el.getAttribute('aria-label') || '',
    el.getAttribute('data-testid') || ''
  ].join(' ').toLowerCase();

  if (/user|human|prompt|you/.test(signature)) return 'user';
  if (/assistant|grok|bot|ai|model/.test(signature)) return 'assistant';

  // Check for user avatar vs AI icon in child structure
  const hasUserAvatar = el.querySelector('[class*="user-avatar"], [class*="userAvatar"], [alt*="user"]');
  if (hasUserAvatar) return 'user';

  return 'assistant';
}

// Sorts an array of { el, role } objects by their DOM position.
// Returns sorted { el, role }[]
function sortByDomOrder(items) {
  return items.sort((a, b) =>
    a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
  );
}

// ---------------------------------------------------------------------------
// Message extraction
// ---------------------------------------------------------------------------

// Extracts a normalized Message from a turn element with a known role.
// Returns a Message object or null if the element is empty
function extractFromTurn(el, role, index) {
  const contentEl = findContentElement(el, role);
  if (!contentEl || !hasContent(contentEl)) return null;

  const contentHtml = contentEl.innerHTML;
  const contentText = role === 'user'
    ? contentEl.textContent.trim()
    : elementToMarkdown(contentEl);

  const timestamp = extractTimestamp(el);

  return normalizeMessage(role, contentText, contentHtml, index, PLATFORM, timestamp);
}

// Finds the innermost element holding the actual message text in Grok.
// Returns an Element
function findContentElement(el, role) {
  if (role === 'user') {
    return (
      el.querySelector('.whitespace-pre-wrap, [class*="messageText"], [class*="queryText"]') ||
      el.querySelector('p') ||
      el
    );
  }

  // AI response: look for the prose/markdown container
  return (
    el.querySelector('[class*="prose"], [class*="markdown"], [class*="responseText"]') ||
    el.querySelector('[class*="content"], [class*="message-content"]') ||
    el.querySelector('p') ||
    el
  );
}

// Attempts to read a timestamp from the turn element.
// Returns an ISO string or null
function extractTimestamp(el) {
  const timeEl = el.querySelector('time[datetime]');
  if (timeEl) return timeEl.getAttribute('datetime');

  const timeEl2 = el.querySelector('time');
  if (timeEl2 && timeEl2.textContent.trim()) return timeEl2.textContent.trim();

  return null;
}

// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------

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
