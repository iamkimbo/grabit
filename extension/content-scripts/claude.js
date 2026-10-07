// =============================================================
// claude.js
// Content script for claude.ai.
// Scrapes the active conversation from the Claude DOM and returns
// normalized Message objects in response to a SCRAPE_MESSAGES request.
//
// Claude's DOM uses data-testid="human-turn" / "ai-turn" attributes
// as the primary discovery mechanism, with class-based fallbacks.
//
// Depends on: scraper-utils.js (loaded first via manifest)
// =============================================================

'use strict';

const PLATFORM = 'claude';

// ---------------------------------------------------------------------------
// Scrape entry point
// ---------------------------------------------------------------------------

// Walks the Claude conversation DOM and returns all messages as Message[]
// Throws a user-friendly Error if no conversation is detected
function scrapeMessages() {
  const turns = findConversationTurns();

  if (!turns.length) {
    throw new Error(
      'No conversation found. Open a Claude chat and try again.'
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

// Finds all Claude conversation turns, each tagged with their role.
// Returns { el: Element, role: 'user'|'assistant' }[]
function findConversationTurns() {
  // Strategy 1: data-testid attributes — Claude's most stable selectors
  const humanEls = Array.from(
    document.querySelectorAll('[data-testid="human-turn"]')
  );
  const aiEls = Array.from(
    document.querySelectorAll('[data-testid="ai-turn"]')
  );

  if (humanEls.length || aiEls.length) {
    const all = [
      ...humanEls.map(el => ({ el, role: 'user' })),
      ...aiEls.map(el => ({ el, role: 'assistant' }))
    ];
    return sortByDomOrder(all);
  }

  // Strategy 2: Claude sometimes uses role="presentation" + aria labels,
  // or specific class names for the message wrappers
  const humanByClass = Array.from(
    document.querySelectorAll(
      '[class*="HumanTurn"], [class*="human-turn"], .human-turn'
    )
  );
  const aiByClass = Array.from(
    document.querySelectorAll(
      '[class*="AssistantTurn"], [class*="ai-turn"], [class*="assistant-turn"]'
    )
  );

  if (humanByClass.length || aiByClass.length) {
    const all = [
      ...humanByClass.map(el => ({ el, role: 'user' })),
      ...aiByClass.map(el => ({ el, role: 'assistant' }))
    ];
    return sortByDomOrder(all);
  }

  // Strategy 3: Claude's response content uses font-claude-message class.
  // Walk up from those elements to find message containers, then locate
  // adjacent human messages by DOM structure.
  const claudeMsgEls = Array.from(
    document.querySelectorAll('.font-claude-message, [class*="font-claude"]')
  );

  if (claudeMsgEls.length) {
    return inferTurnsFromClaudeMessages(claudeMsgEls);
  }

  // Strategy 4: Generic alternating message pattern — last resort
  return inferTurnsFromAlternatingPattern();
}

// Given elements containing Claude's AI response text, walk the ancestor tree
// to find message turn containers and infer paired human turns.
// Returns { el, role }[]
function inferTurnsFromClaudeMessages(claudeEls) {
  const result = [];
  const seen = new Set();

  claudeEls.forEach(el => {
    // Walk up to find a meaningful container
    let container = el.closest('[data-testid], article, section, .group') ||
      el.parentElement;
    if (!container || seen.has(container)) return;
    seen.add(container);

    // The human message is typically the previous sibling container
    const prev = container.previousElementSibling;
    if (prev && !seen.has(prev)) {
      seen.add(prev);
      result.push({ el: prev, role: 'user' });
    }

    result.push({ el: container, role: 'assistant' });
  });

  return result;
}

// Attempts to find messages by looking for any alternating conversation pattern.
// Used as a last resort when no reliable selectors are available.
// Returns { el, role }[]
function inferTurnsFromAlternatingPattern() {
  // Look for grid rows or flex children that contain message-like content
  const candidates = Array.from(
    document.querySelectorAll(
      '.grid > div, [class*="conversation"] > div, main > div > div > div'
    )
  ).filter(el => el.textContent.trim().length > 20);

  if (!candidates.length) return [];

  // Heuristic: Claude's response divs tend to be larger and contain more markup
  return candidates.map((el, i) => ({
    el,
    role: i % 2 === 0 ? 'user' : 'assistant'
  }));
}

// Sorts an array of { el, role } objects by their position in the DOM.
// Uses compareDocumentPosition for a reliable ordering.
// Returns sorted { el, role }[]
function sortByDomOrder(items) {
  return items.sort((a, b) =>
    a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
  );
}

// ---------------------------------------------------------------------------
// Message extraction
// ---------------------------------------------------------------------------

// Extracts a normalized Message from a turn element given its pre-determined role.
// Returns a Message object or null if the element is empty
function extractFromTurn(el, role, index) {
  const contentEl = findContentElement(el, role);
  if (!contentEl || !hasContent(contentEl)) return null;

  const contentHtml = contentEl.innerHTML;
  const contentText = role === 'user'
    ? contentEl.textContent.trim()
    : elementToMarkdown(contentEl);

  return normalizeMessage(role, contentText, contentHtml, index, PLATFORM, null);
}

// Finds the innermost element with the actual message text.
// Claude's human turns use a simple text div; AI turns use a rich content area.
// Returns an Element
function findContentElement(el, role) {
  if (role === 'user') {
    return (
      el.querySelector('.whitespace-pre-wrap') ||
      el.querySelector('p') ||
      el.querySelector('[class*="text"]') ||
      el
    );
  }

  // AI: the rich text prose container
  return (
    el.querySelector('.font-claude-message') ||
    el.querySelector('[class*="prose"]') ||
    el.querySelector('[class*="markdown"]') ||
    el.querySelector('[class*="claude-message"]') ||
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
