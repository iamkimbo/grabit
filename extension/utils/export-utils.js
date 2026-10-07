// =============================================================
// export-utils.js
// Shared utilities used by every exporter (markdown, plaintext,
// json, csv, html, pdf). Loaded by popup.html before any exporter
// script so all functions are globally available.
// =============================================================

'use strict';

// ---------------------------------------------------------------------------
// File download
// ---------------------------------------------------------------------------

// Creates a temporary anchor element to trigger a browser file download.
// content may be a string or a Blob.
// Returns void
function triggerDownload(content, filename, mimeType) {
  const blob = content instanceof Blob
    ? content
    : new Blob([content], { type: mimeType + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Short delay before revoke gives the browser time to start the download
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Filename helpers
// ---------------------------------------------------------------------------

// Strips characters that are illegal in filenames, collapses whitespace,
// and trims to a reasonable length.
// Returns a safe filename string (no extension)
function sanitizeFilename(str) {
  return (str || 'conversation')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'conversation';
}

// Builds a default filename: "{platform}-{sanitized-title}-{YYYY-MM-DD}.{ext}"
// Returns a filename string including extension
function buildFilename(data, ext) {
  const date = data.exportedAt
    ? data.exportedAt.slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const slug = sanitizeFilename(data.title || 'conversation');
  const platform = (data.platform || 'ai').toLowerCase();
  return `${platform}-${slug}-${date}.${ext}`;
}

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

// Formats an ISO 8601 string into a human-readable form: "June 10, 2025"
// Returns a formatted date string
function formatDateDisplay(isoString) {
  try {
    return new Date(isoString).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
  } catch {
    return isoString || '';
  }
}

// ---------------------------------------------------------------------------
// Platform labels
// ---------------------------------------------------------------------------

// Returns the display name of the platform (e.g. "claude" → "Claude").
// Returns a string
function getPlatformLabel(platform) {
  const labels = {
    chatgpt: 'ChatGPT',
    claude:  'Claude',
    gemini:  'Gemini',
    grok:    'Grok'
  };
  return labels[platform] || (platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : 'AI');
}

// Returns the label used for AI messages in documents ("Claude", "Gemini", etc.).
// Returns a string
function getAssistantLabel(platform) {
  return getPlatformLabel(platform);
}

// ---------------------------------------------------------------------------
// HTML sanitization
// ---------------------------------------------------------------------------

// Sanitizes raw inner HTML from platform DOM scrapers.
// Removes all styling classes, event handlers, and script/style/svg elements.
// Keeps semantic structure: headings, paragraphs, lists, code, tables, links.
// Returns a clean HTML string
function sanitizeHtml(htmlString) {
  if (!htmlString) return '';
  const container = document.createElement('div');
  container.innerHTML = htmlString;
  _sanitizeNode(container);
  _addCodeLanguageLabels(container);
  return container.innerHTML;
}

// Recursive node sanitizer — modifies the node in place
function _sanitizeNode(node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const tag = node.tagName.toLowerCase();

  // Remove entire elements that carry no exportable content
  const strip = ['script', 'style', 'noscript', 'template', 'button',
    'form', 'input', 'textarea', 'select', 'nav', 'svg', 'canvas', 'iframe'];
  if (strip.includes(tag)) {
    node.parentNode && node.parentNode.removeChild(node);
    return;
  }

  // Preserve only meaningful attributes per element type
  if (tag === 'code') {
    // Keep the language class so CSS can display the label
    const langClass = Array.from(node.classList).find(
      c => c.startsWith('language-') || c.startsWith('lang-')
    );
    while (node.attributes.length > 0) node.removeAttribute(node.attributes[0].name);
    if (langClass) node.setAttribute('class', langClass);

  } else if (tag === 'a') {
    const href = node.getAttribute('href');
    while (node.attributes.length > 0) node.removeAttribute(node.attributes[0].name);
    if (href && !href.startsWith('javascript:')) {
      node.setAttribute('href', href);
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }

  } else if (tag === 'img') {
    const src = node.getAttribute('src');
    const alt = node.getAttribute('alt') || '';
    while (node.attributes.length > 0) node.removeAttribute(node.attributes[0].name);
    if (src) { node.setAttribute('src', src); node.setAttribute('alt', alt); }

  } else if (tag === 'td' || tag === 'th') {
    const colspan = node.getAttribute('colspan');
    const rowspan = node.getAttribute('rowspan');
    while (node.attributes.length > 0) node.removeAttribute(node.attributes[0].name);
    if (colspan && colspan !== '1') node.setAttribute('colspan', colspan);
    if (rowspan && rowspan !== '1') node.setAttribute('rowspan', rowspan);

  } else {
    // All other elements: strip every attribute
    while (node.attributes.length > 0) node.removeAttribute(node.attributes[0].name);
  }

  // Recurse into remaining children (copy list first; sanitization may remove nodes)
  Array.from(node.childNodes).forEach(child => _sanitizeNode(child));
}

// Post-processing step: adds a <span class="code-lang"> inside every <pre>
// whose child <code> carries a language class.
// Modifies the container DOM in place; returns void
function _addCodeLanguageLabels(container) {
  container.querySelectorAll('pre').forEach(pre => {
    const codeEl = pre.querySelector('code');
    if (!codeEl) return;

    const langClass = Array.from(codeEl.classList).find(
      c => c.startsWith('language-') || c.startsWith('lang-')
    );
    if (!langClass) return;

    const lang = langClass.startsWith('language-')
      ? langClass.slice('language-'.length)
      : langClass.slice('lang-'.length);

    if (!lang) return;

    // Avoid adding a duplicate label if we've already processed this block
    if (pre.querySelector('.code-lang')) return;

    const label = document.createElement('span');
    label.className = 'code-lang';
    label.textContent = lang;
    pre.insertBefore(label, pre.firstChild);
  });
}

// ---------------------------------------------------------------------------
// User message HTML
// ---------------------------------------------------------------------------

// Converts plain text (user messages) to safe HTML, preserving newlines
// as <br> tags and escaping HTML special characters.
// Returns an HTML string
function userTextToHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\n/g, '<br>');
}
