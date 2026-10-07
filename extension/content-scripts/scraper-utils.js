// =============================================================
// scraper-utils.js
// Shared DOM scraping utilities loaded before every platform
// content script. Provides message normalization, HTML-to-markdown
// conversion, plain-text extraction, title detection, and response
// helpers. All functions are global within the content-script scope
// so platform scripts can call them directly.
// =============================================================

'use strict';

// ---------------------------------------------------------------------------
// Message shape
// ---------------------------------------------------------------------------
//
// Every scraper returns an array of objects matching this structure:
// {
//   role:        'user' | 'assistant'
//   content:     string   — markdown or plain text
//   contentHtml: string   — raw inner HTML from the DOM
//   index:       number   — zero-based position in the conversation
//   platform:    string   — 'chatgpt' | 'claude' | 'gemini' | 'grok'
//   timestamp:   string | null
// }
//
// The scrape response sent back to the popup is:
// {
//   success:      boolean
//   messages:     Message[]
//   title:        string
//   platform:     string
//   exportedAt:   string  — ISO 8601
//   messageCount: number
//   error?:       string  — only present when success === false
// }

// ---------------------------------------------------------------------------
// Core normalization
// ---------------------------------------------------------------------------

// Creates a normalized message object from its raw parts
// Returns a Message object
function normalizeMessage(role, contentText, contentHtml, index, platform, timestamp) {
  return {
    role,
    content: (contentText || '').trim(),
    contentHtml: contentHtml || '',
    index,
    platform,
    timestamp: timestamp || null
  };
}

// ---------------------------------------------------------------------------
// HTML → Markdown conversion
// ---------------------------------------------------------------------------

// Converts an element's subtree to a Markdown string
// Returns a trimmed markdown-formatted string
function elementToMarkdown(el) {
  if (!el) return '';
  return nodeToMarkdown(el).trim();
}

// Recursively converts a DOM node to Markdown text
// Returns a string; handles elements, text nodes, and comments
function nodeToMarkdown(node) {
  if (!node) return '';

  // Plain text node — return as-is
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent;
  }

  // Skip non-element nodes (comments, processing instructions, etc.)
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const tag = node.tagName.toLowerCase();

  // Skip invisible/non-content elements entirely
  if (tag === 'script' || tag === 'style' || tag === 'svg' ||
      tag === 'noscript' || tag === 'template') {
    return '';
  }

  // Serialize all children into a string helper
  const children = () =>
    Array.from(node.childNodes).map(nodeToMarkdown).join('');

  switch (tag) {
    // --- Block elements ---
    case 'p':
      return children() + '\n\n';

    case 'br':
      return '\n';

    case 'hr':
      return '\n---\n\n';

    case 'blockquote':
      return children()
        .split('\n')
        .map(line => `> ${line}`)
        .join('\n') + '\n\n';

    case 'pre': {
      const codeEl = node.querySelector('code');
      const lang = codeEl ? getCodeLanguage(codeEl) : '';
      const raw = codeEl ? codeEl.textContent : node.textContent;
      return `\`\`\`${lang}\n${raw}\n\`\`\`\n\n`;
    }

    // --- Headings ---
    case 'h1': return `# ${children().trim()}\n\n`;
    case 'h2': return `## ${children().trim()}\n\n`;
    case 'h3': return `### ${children().trim()}\n\n`;
    case 'h4': return `#### ${children().trim()}\n\n`;
    case 'h5': return `##### ${children().trim()}\n\n`;
    case 'h6': return `###### ${children().trim()}\n\n`;

    // --- Lists ---
    case 'ul': {
      const items = Array.from(node.children)
        .filter(c => c.tagName === 'LI')
        .map(li => `- ${nodeToMarkdown(li).trim()}`)
        .join('\n');
      return items + '\n\n';
    }

    case 'ol': {
      const items = Array.from(node.children)
        .filter(c => c.tagName === 'LI')
        .map((li, i) => `${i + 1}. ${nodeToMarkdown(li).trim()}`)
        .join('\n');
      return items + '\n\n';
    }

    case 'li':
      return children();

    // --- Tables ---
    case 'table':
      return tableToMarkdown(node);

    // --- Inline elements ---
    case 'strong':
    case 'b':
      return `**${children()}**`;

    case 'em':
    case 'i':
      return `*${children()}*`;

    case 'del':
    case 's':
      return `~~${children()}~~`;

    case 'code': {
      // A <code> inside a <pre> is already handled by the 'pre' case above;
      // here we only reach inline code elements.
      const isInsidePre = node.parentElement &&
        node.parentElement.tagName.toLowerCase() === 'pre';
      if (isInsidePre) return node.textContent;
      return `\`${node.textContent}\``;
    }

    case 'a': {
      const href = node.getAttribute('href') || '';
      const label = children().trim();
      if (!href || href.startsWith('javascript:')) return label;
      return `[${label}](${href})`;
    }

    case 'img': {
      const alt = node.getAttribute('alt') || '';
      const src = node.getAttribute('src') || '';
      return src ? `![${alt}](${src})` : '';
    }

    case 'mark':
      return `==${children()}==`;

    case 'sup':
      return `^${children()}^`;

    case 'sub':
      return `~${children()}~`;

    // --- Structural wrappers — pass through children ---
    default:
      return children();
  }
}

// Converts a <table> element to a basic Markdown table string
// Returns a formatted Markdown table or an empty string
function tableToMarkdown(tableEl) {
  const rows = Array.from(tableEl.querySelectorAll('tr'));
  if (!rows.length) return '';

  const rowData = rows.map(row =>
    Array.from(row.querySelectorAll('td, th'))
      .map(cell => cell.textContent.trim().replace(/\|/g, '\\|'))
  );

  if (!rowData[0] || !rowData[0].length) return '';

  const toRow = cols => `| ${cols.join(' | ')} |`;
  const header = rowData[0];
  const separator = header.map(() => '---');
  const body = rowData.slice(1);

  return [toRow(header), toRow(separator), ...body.map(toRow)].join('\n') + '\n\n';
}

// ---------------------------------------------------------------------------
// Code language detection
// ---------------------------------------------------------------------------

// Extracts the programming language label from a <code> element's class list
// Returns a string like 'javascript' or '' if none detected
function getCodeLanguage(codeEl) {
  if (!codeEl) return '';
  const classes = Array.from(codeEl.classList);
  for (const cls of classes) {
    if (cls.startsWith('language-')) return cls.slice('language-'.length);
    if (cls.startsWith('lang-')) return cls.slice('lang-'.length);
  }
  // Some platforms use a data attribute instead
  return codeEl.getAttribute('data-code-language') ||
    codeEl.getAttribute('data-language') || '';
}

// ---------------------------------------------------------------------------
// Plain text extraction
// ---------------------------------------------------------------------------

// Strips all Markdown syntax from elementToMarkdown output to produce clean
// plain text, preserving code block contents and line structure
// Returns a plain text string
function elementToText(el) {
  if (!el) return '';
  return elementToMarkdown(el)
    // Remove fenced code fences but keep code content
    .replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
    // Remove inline code backticks
    .replace(/`([^`]+)`/g, '$1')
    // Remove bold/italic markers
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    // Remove heading markers
    .replace(/^#{1,6}\s+/gm, '')
    // Convert markdown links to plain label
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Convert markdown images to alt text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    // Remove blockquote markers
    .replace(/^>\s*/gm, '')
    // Remove HR lines
    .replace(/^---\s*$/gm, '')
    .trim();
}

// ---------------------------------------------------------------------------
// Title detection
// ---------------------------------------------------------------------------

// Attempts to extract a meaningful conversation title from the page
// Returns a string; falls back to 'Conversation' if nothing is found
function getConversationTitle() {
  // Try <h1> first — most platforms put the conversation name there
  const h1 = document.querySelector('h1');
  if (h1 && h1.textContent.trim()) return h1.textContent.trim();

  // Try the document title, stripping the site name suffix (e.g. '- ChatGPT')
  const title = document.title
    .replace(/\s*[-|–—]\s*(ChatGPT|Claude|Gemini|Grok|Google).*$/i, '')
    .trim();
  if (title && title.length > 1) return title;

  return 'Conversation';
}

// ---------------------------------------------------------------------------
// Content guards
// ---------------------------------------------------------------------------

// Returns true if an element has non-whitespace text content
// Returns boolean
function hasContent(el) {
  return Boolean(el && el.textContent.trim().length > 0);
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

// Sends a successful scrape response back through the message channel
// sendResponse is the callback from chrome.runtime.onMessage
function sendScrapeResponse(sendResponse, messages, platform) {
  sendResponse({
    success: true,
    messages,
    title: getConversationTitle(),
    platform,
    exportedAt: new Date().toISOString(),
    messageCount: messages.length
  });
}

// Sends a failure response back through the message channel
// Includes the error message for display in the popup
function sendErrorResponse(sendResponse, error, platform) {
  sendResponse({
    success: false,
    messages: [],
    title: getConversationTitle(),
    platform,
    exportedAt: new Date().toISOString(),
    messageCount: 0,
    error: (error && error.message) ? error.message : String(error)
  });
}
