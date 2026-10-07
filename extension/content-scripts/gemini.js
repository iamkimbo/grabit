// =============================================================
// gemini.js
// Content script for gemini.google.com.
// Scrapes the active conversation from the Gemini DOM and returns
// normalized Message objects in response to a SCRAPE_MESSAGES request.
//
// Gemini uses Angular custom elements (<user-query>, <model-response>)
// as its primary structure, with class-based fallbacks.
//
// Depends on: scraper-utils.js (loaded first via manifest)
// =============================================================

'use strict';

const PLATFORM = 'gemini';

// ---------------------------------------------------------------------------
// Scrape entry point
// ---------------------------------------------------------------------------

// Walks the Gemini conversation DOM and returns all messages as Message[]
// Throws a user-friendly Error if no conversation is detected
function scrapeMessages() {
  const turns = findConversationTurns();

  if (!turns.length) {
    throw new Error(
      'No conversation found. Open a Gemini chat and try again.'
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

// Finds all Gemini conversation turns, tagged with their role.
// Gemini uses Angular custom elements which are the most reliable selectors.
// Returns { el: Element, role: 'user'|'assistant' }[]
function findConversationTurns() {
  // Strategy 1: Gemini's Angular custom elements — extremely reliable
  const userEls = Array.from(document.querySelectorAll('user-query'));
  const aiEls = Array.from(document.querySelectorAll('model-response'));

  if (userEls.length || aiEls.length) {
    const all = [
      ...userEls.map(el => ({ el, role: 'user' })),
      ...aiEls.map(el => ({ el, role: 'assistant' }))
    ];
    return sortByDomOrder(all);
  }

  // Strategy 2: class-based selectors Gemini has used historically
  const userByClass = Array.from(
    document.querySelectorAll(
      '.user-query, .query-bubble, [class*="userQuery"], [class*="user-query"]'
    )
  );
  const aiByClass = Array.from(
    document.querySelectorAll(
      '.model-response, .response-container, [class*="modelResponse"], [class*="model-response"]'
    )
  );

  if (userByClass.length || aiByClass.length) {
    const all = [
      ...userByClass.map(el => ({ el, role: 'user' })),
      ...aiByClass.map(el => ({ el, role: 'assistant' }))
    ];
    return sortByDomOrder(all);
  }

  // Strategy 3: conversation-turn wrappers with embedded role markers
  const turns = Array.from(
    document.querySelectorAll(
      '.conversation-turn, [data-chunk-id], .exchange, [class*="conversationTurn"]'
    )
  );
  if (turns.length) {
    return turns.map(el => ({
      el,
      role: inferRole(el)
    }));
  }

  // Strategy 4: any mat-card or Angular Material components in a chat layout
  const cards = Array.from(document.querySelectorAll('mat-card, [class*="card"]'))
    .filter(el => el.textContent.trim().length > 10);
  if (cards.length) {
    return cards.map((el, i) => ({
      el,
      role: i % 2 === 0 ? 'user' : 'assistant'
    }));
  }

  return [];
}

// Infers the role of a message element from its class names and attributes.
// Returns 'user' | 'assistant'
function inferRole(el) {
  const signature = [
    el.className,
    el.getAttribute('data-role') || '',
    el.getAttribute('aria-label') || ''
  ].join(' ').toLowerCase();

  if (/user|human|query|prompt/.test(signature)) return 'user';
  if (/model|assistant|response|gemini/.test(signature)) return 'assistant';

  // Check child elements for role-bearing attributes
  if (el.querySelector('[class*="user"], [class*="query"], [class*="human"]')) return 'user';
  return 'assistant';
}

// Sorts an array of { el, role } objects by their position in the DOM.
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
// Returns a Message object or null if the element has no content
function extractFromTurn(el, role, index) {
  const contentEl = findContentElement(el, role);
  if (!contentEl || !hasContent(contentEl)) return null;

  const contentHtml = contentEl.innerHTML;
  const contentText = role === 'user'
    ? contentEl.textContent.trim()
    : elementToMarkdown(contentEl);

  return normalizeMessage(role, contentText, contentHtml, index, PLATFORM, null);
}

// Finds the innermost element holding the actual message text in Gemini.
// Gemini wraps content differently depending on the message type.
// Returns an Element
function findContentElement(el, role) {
  if (role === 'user') {
    return (
      el.querySelector('.query-text, .user-query-text, [class*="queryText"]') ||
      el.querySelector('p') ||
      el.querySelector('[class*="text"]') ||
      el
    );
  }

  // AI response: Gemini renders markdown inside a response-content container
  return (
    el.querySelector('.response-content, .model-response-text, [class*="responseText"]') ||
    el.querySelector('[class*="markdown"], [class*="prose"], [class*="content"]') ||
    // Angular generates .ng-star-inserted wrappers around content paragraphs
    el.querySelector('.ng-star-inserted') ||
    el
  );
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
