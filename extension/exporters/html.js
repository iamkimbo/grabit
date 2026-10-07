// =============================================================
// exporters/html.js
// Converts a scraped conversation to a self-contained HTML (.html)
// file and triggers a browser download.
//
// The output file embeds all CSS inline — no external dependencies.
// Dark mode is supported via @media (prefers-color-scheme: dark).
// Free tier gets a small fixed badge in the bottom-right corner.
// The buildHTMLDocument() function is also called by pdf.js.
//
// Depends on: utils/export-utils.js (loaded before this file)
// =============================================================

'use strict';

// Converts conversation data to a self-contained HTML file and downloads it.
// data: { messages, title, platform, exportedAt, messageCount } OR { isMerge, conversations, exportedAt }
// options: { isPremium, filename?, meta? }
// Returns void
function exportToHTML(data, options) {
  const html     = buildHTMLDocument(data, options || {});
  const filename = (options && options.filename)
    ? options.filename + '.html'
    : data.isMerge
      ? 'merged-conversations-' + new Date().toISOString().slice(0, 10) + '.html'
      : buildFilename(data, 'html');
  triggerDownload(html, filename, 'text/html');
}

// Builds the complete HTML document string.
// options.forPrint: true → adds print CSS and auto-print script (used by pdf.js)
// options.isPremium: true → omits watermarks
// options.meta → adds <meta> tags + visible metadata block when user fields are set
// Returns an HTML string
function buildHTMLDocument(data, options) {
  if (data.isMerge) return _buildMergedHTMLDocument(data, options);

  const { messages, title, platform, exportedAt } = data;
  const { isPremium, forPrint, meta } = options || {};
  const platformLabel  = getPlatformLabel(platform);
  const assistantLabel = getAssistantLabel(platform);
  const dateDisplay    = formatDateDisplay(exportedAt);
  const safeTitle      = escapeHtml(title || 'Conversation');

  const renderedMessages = messages
    .map(msg => renderMessageBlock(msg, assistantLabel))
    .join('\n');

  // Watermark markup comes from watermark/watermark.js — all constants live there.
  // getHTMLBadge() returns '' for premium users; same for getPDFWatermarkElement().
  const freeBadge      = !forPrint ? getHTMLBadge(isPremium) : '';
  const printWatermark = forPrint  ? getPDFWatermarkElement(isPremium) : '';

  // <meta> tags for head (only non-empty user fields)
  const headMeta = _buildHTMLHeadMeta(meta);

  // Visible metadata block above the conversation (only when user fields are set)
  const visibleMeta = _buildHTMLMetaBlock(meta);

  const printScript = forPrint ? `
  <script>
    window.addEventListener('load', function() {
      window.print();
      window.addEventListener('afterprint', function() { window.close(); });
    });
  </script>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>${headMeta}
  <style>${buildStyles(forPrint)}</style>
</head>
<body>
  <div class="page">

    <header class="doc-header">
      <h1 class="doc-title">${safeTitle}</h1>
      <p class="doc-meta">
        <span>${platformLabel}</span>
        <span class="doc-meta-sep">·</span>
        <span>${dateDisplay}</span>
        <span class="doc-meta-sep">·</span>
        <span>${messages.length} messages</span>
      </p>
    </header>
    ${visibleMeta}
    <div class="conversation">
      ${renderedMessages}
    </div>

  </div>
  ${freeBadge}
  ${printWatermark}
  ${printScript}
</body>
</html>`;
}

// Builds a merged HTML document — one page with styled dividers between conversations.
// Returns an HTML string
function _buildMergedHTMLDocument(data, options) {
  const { isPremium, forPrint, meta } = options || {};
  const dateDisplay  = formatDateDisplay(data.exportedAt);
  const headMeta     = _buildHTMLHeadMeta(meta);
  const visibleMeta  = _buildHTMLMetaBlock(meta);

  const convSections = data.conversations.map(conv => {
    const platformLabel  = getPlatformLabel(conv.platform);
    const assistantLabel = getAssistantLabel(conv.platform);
    const renderedMsgs   = conv.messages
      .map(msg => renderMessageBlock(msg, assistantLabel))
      .join('\n');

    return `
    <div class="conv-section">
      <div class="conv-divider">
        <span class="conv-divider-title">${escapeHtml(conv.title || 'Conversation')}</span>
        <span class="conv-divider-platform">${escapeHtml(platformLabel)}</span>
      </div>
      <div class="conversation">${renderedMsgs}</div>
    </div>`;
  }).join('\n');

  const freeBadge      = !forPrint ? getHTMLBadge(isPremium) : '';
  const printWatermark = forPrint  ? getPDFWatermarkElement(isPremium) : '';

  const printScript = forPrint ? `
  <script>
    window.addEventListener('load', function() {
      window.print();
      window.addEventListener('afterprint', function() { window.close(); });
    });
  </script>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Merged Conversations</title>${headMeta}
  <style>${buildStyles(forPrint)}</style>
</head>
<body>
  <div class="page">
    <header class="doc-header">
      <h1 class="doc-title">Merged Conversations</h1>
      <p class="doc-meta">
        <span>${data.conversations.length} conversations</span>
        <span class="doc-meta-sep">·</span>
        <span>${dateDisplay}</span>
      </p>
    </header>
    ${visibleMeta}
    ${convSections}
  </div>
  ${freeBadge}
  ${printWatermark}
  ${printScript}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Metadata helpers
// ---------------------------------------------------------------------------

// Returns <meta> tag string(s) for the HTML <head> based on user-set meta fields.
// Only includes tags for non-empty fields.
// Returns an HTML string (empty string if nothing to add)
function _buildHTMLHeadMeta(meta) {
  if (!meta || (!meta.author && !meta.tags && !meta.notes)) return '';
  const parts = [];
  if (meta.author) parts.push(`\n  <meta name="author" content="${escapeHtml(meta.author)}">`);
  if (meta.tags)   parts.push(`\n  <meta name="keywords" content="${escapeHtml(meta.tags)}">`);
  if (meta.notes)  parts.push(`\n  <meta name="description" content="${escapeHtml(meta.notes)}">`);
  return parts.join('');
}

// Returns a visible metadata block for the document body.
// Styled in grey small text, mirroring PDF header style.
// Only renders when at least one user field is set.
// Returns an HTML string
function _buildHTMLMetaBlock(meta) {
  if (!meta || (!meta.author && !meta.tags && !meta.notes)) return '';
  const rows = [];
  if (meta.author) rows.push(`<span class="meta-block-row"><span class="meta-block-key">Author</span>${escapeHtml(meta.author)}</span>`);
  if (meta.tags)   rows.push(`<span class="meta-block-row"><span class="meta-block-key">Tags</span>${escapeHtml(meta.tags)}</span>`);
  if (meta.notes)  rows.push(`<span class="meta-block-row"><span class="meta-block-key">Notes</span>${escapeHtml(meta.notes)}</span>`);
  if (meta.exported) rows.push(`<span class="meta-block-row"><span class="meta-block-key">Exported</span>${escapeHtml(meta.exported)}</span>`);
  return `\n    <div class="meta-block">${rows.join('')}</div>`;
}

// ---------------------------------------------------------------------------
// Message rendering
// ---------------------------------------------------------------------------

// Builds the HTML block for a single message.
// Returns an HTML string
function renderMessageBlock(msg, assistantLabel) {
  const isUser     = msg.role === 'user';
  const roleClass  = isUser ? 'message--user' : 'message--assistant';
  const roleLabel  = isUser ? 'You' : assistantLabel;
  const bodyHtml   = isUser
    ? `<p>${userTextToHtml(msg.content)}</p>`
    : buildAssistantContent(msg);

  return `
    <div class="message ${roleClass}">
      <div class="message-role">${escapeHtml(roleLabel)}</div>
      <div class="message-body">${bodyHtml}</div>
    </div>`;
}

// Builds the content HTML for an AI response message.
// Uses sanitized DOM HTML when available; falls back to a plain text block.
// Returns an HTML string
function buildAssistantContent(msg) {
  if (msg.contentHtml && msg.contentHtml.trim()) {
    return sanitizeHtml(msg.contentHtml);
  }
  // Fallback: plain content in a paragraph
  return `<p>${userTextToHtml(msg.content)}</p>`;
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

// Returns the complete embedded CSS for the HTML/PDF document.
// forPrint: true → adds @media print rules and hides screen-only elements
// Returns a CSS string
function buildStyles(forPrint) {
  return `
    /* ---- Reset & base ---- */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont,
        'Segoe UI', Helvetica, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #111111;
      background: #F5F5F4;
      -webkit-font-smoothing: antialiased;
    }

    /* ---- Page container ---- */
    .page {
      max-width: 760px;
      margin: 0 auto;
      padding: 48px 40px;
      background: #FFFFFF;
      min-height: 100vh;
    }

    /* ---- Document header ---- */
    .doc-header {
      margin-bottom: 36px;
      padding-bottom: 24px;
      border-bottom: 1px solid #E5E7EB;
    }

    .doc-title {
      font-size: 22px;
      font-weight: 600;
      color: #111111;
      letter-spacing: -0.02em;
      margin-bottom: 6px;
    }

    .doc-meta {
      font-size: 12px;
      color: #6B7280;
    }

    .doc-meta-sep {
      margin: 0 6px;
      opacity: 0.4;
    }

    /* ---- Conversation ---- */
    .conversation {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    /* ---- Messages ---- */
    .message {
      padding: 18px 20px;
      border-radius: 0;
    }

    .message--user {
      background: #F3F4F6;
      border-left: 3px solid #D1D5DB;
    }

    .message--assistant {
      background: #FFFFFF;
      border-left: 3px solid transparent;
    }

    .message-role {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: #6B7280;
      margin-bottom: 10px;
    }

    .message-body {
      font-size: 14px;
      line-height: 1.75;
      color: #1F2937;
    }

    /* ---- Body element typography ---- */
    .message-body p { margin-bottom: 12px; }
    .message-body p:last-child { margin-bottom: 0; }

    .message-body h1, .message-body h2, .message-body h3,
    .message-body h4, .message-body h5, .message-body h6 {
      font-weight: 600;
      color: #111111;
      margin: 20px 0 8px;
      letter-spacing: -0.01em;
    }
    .message-body h1 { font-size: 20px; }
    .message-body h2 { font-size: 18px; }
    .message-body h3 { font-size: 16px; }
    .message-body h4, .message-body h5, .message-body h6 { font-size: 14px; }

    .message-body ul, .message-body ol {
      padding-left: 22px;
      margin-bottom: 12px;
    }
    .message-body li { margin-bottom: 4px; }
    .message-body li:last-child { margin-bottom: 0; }

    .message-body strong, .message-body b { font-weight: 600; color: #111111; }
    .message-body em, .message-body i { font-style: italic; }

    .message-body a {
      color: #2563EB;
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    .message-body blockquote {
      border-left: 3px solid #D1D5DB;
      padding-left: 14px;
      margin: 12px 0;
      color: #4B5563;
      font-style: italic;
    }

    .message-body hr {
      border: none;
      border-top: 1px solid #E5E7EB;
      margin: 16px 0;
    }

    /* ---- Tables ---- */
    .message-body table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      margin-bottom: 16px;
      overflow-x: auto;
      display: block;
    }
    .message-body th {
      background: #F9FAFB;
      font-weight: 600;
      color: #374151;
      text-align: left;
      padding: 8px 12px;
      border: 1px solid #E5E7EB;
    }
    .message-body td {
      padding: 8px 12px;
      border: 1px solid #E5E7EB;
      color: #374151;
      vertical-align: top;
    }
    .message-body tr:nth-child(even) td { background: #F9FAFB; }

    /* ---- Code blocks ---- */
    .message-body pre {
      background: #1E1E1E;
      color: #D4D4D4;
      border-radius: 6px;
      padding: 16px;
      margin: 14px 0;
      overflow-x: auto;
      position: relative;
      font-size: 12.5px;
      line-height: 1.6;
    }

    .message-body pre code {
      font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code',
        'Source Code Pro', Menlo, Monaco, Consolas, monospace;
      font-size: inherit;
      color: inherit;
      background: none;
      padding: 0;
    }

    /* Language label — top-right corner of code block */
    .message-body .code-lang {
      position: absolute;
      top: 8px;
      right: 12px;
      font-family: 'Inter', system-ui, sans-serif;
      font-size: 10px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #6B7280;
      user-select: none;
      pointer-events: none;
    }

    /* ---- Inline code ---- */
    .message-body code {
      font-family: 'JetBrains Mono', 'Fira Code', Menlo, Monaco, Consolas, monospace;
      font-size: 12.5px;
      background: #F3F4F6;
      color: #EB5757;
      padding: 1px 5px;
      border-radius: 3px;
    }

    /* ---- Metadata block (above conversation, premium exports) ---- */
    .meta-block {
      display: flex;
      flex-direction: column;
      gap: 3px;
      margin-bottom: 24px;
      padding: 10px 14px;
      background: #F9FAFB;
      border-left: 3px solid #E5E7EB;
      border-radius: 0 4px 4px 0;
      font-size: 12px;
      color: #6B7280;
    }

    .meta-block-row {
      display: block;
      line-height: 1.5;
    }

    .meta-block-key {
      display: inline-block;
      min-width: 68px;
      font-weight: 600;
      color: #9CA3AF;
      letter-spacing: 0.02em;
    }

    /* ---- Merge: conversation section divider ---- */
    .conv-section { margin-bottom: 48px; }

    .conv-divider {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 36px 0 20px;
      padding-bottom: 12px;
      border-bottom: 2px solid #E5E7EB;
    }

    .conv-divider-title {
      font-size: 16px;
      font-weight: 600;
      color: #111111;
      letter-spacing: -0.01em;
    }

    .conv-divider-platform {
      font-size: 11px;
      font-weight: 500;
      color: #6B7280;
      background: #F3F4F6;
      padding: 2px 8px;
      border-radius: 999px;
    }

    ${getWatermarkScreenCSS()}

    /* ---- Dark mode ---- */
    @media (prefers-color-scheme: dark) {
      body { background: #141414; color: #E5E7EB; }
      .page { background: #1C1C1C; }
      .doc-header { border-bottom-color: #2D2D2D; }
      .doc-title { color: #F9FAFB; }
      .message--user { background: #242424; border-left-color: #374151; }
      .message--assistant { background: #1C1C1C; }
      .message-body { color: #D1D5DB; }
      .message-body h1, .message-body h2, .message-body h3,
      .message-body h4, .message-body h5, .message-body h6 { color: #F9FAFB; }
      .message-body strong, .message-body b { color: #F9FAFB; }
      .message-body a { color: #60A5FA; }
      .message-body blockquote { color: #9CA3AF; border-left-color: #374151; }
      .message-body hr { border-top-color: #2D2D2D; }
      .message-body th { background: #242424; color: #D1D5DB; border-color: #2D2D2D; }
      .message-body td { border-color: #2D2D2D; color: #D1D5DB; }
      .message-body tr:nth-child(even) td { background: #212121; }
      .message-body code { background: #2A2A2A; color: #F87171; }
      ${getWatermarkDarkModeCSS()}
    }

    ${forPrint ? buildPrintStyles() : ''}
  `;
}

// Returns the @media print CSS block — added only for PDF exports.
// Returns a CSS string
function buildPrintStyles() {
  return `
    /* ---- Print / PDF styles ---- */
    @page {
      margin: 48px 40px;
      size: A4;
    }

    @media print {
      body {
        background: #FFFFFF !important;
        color: #111111 !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      .page {
        max-width: 100%;
        padding: 0;
        background: #FFFFFF !important;
        box-shadow: none;
        min-height: unset;
      }

      .message--user {
        background: #F3F4F6 !important;
        border-left-color: #D1D5DB !important;
        break-inside: avoid;
      }

      .message--assistant {
        background: #FFFFFF !important;
        break-inside: avoid;
      }

      /* Keep code blocks from splitting across pages where possible */
      .message-body pre {
        break-inside: avoid;
        background: #1E1E1E !important;
        color: #D4D4D4 !important;
      }

      ${getWatermarkPrintCSS()}

      /* Page numbers via CSS Paged Media */
      @page {
        @bottom-right {
          content: counter(page);
          font-family: 'Inter', system-ui, sans-serif;
          font-size: 10px;
          color: #9CA3AF;
        }
      }
    }
  `;
}

// ---------------------------------------------------------------------------
// HTML escape
// ---------------------------------------------------------------------------

// Escapes HTML special characters in a plain text string.
// Returns a safe HTML string
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
