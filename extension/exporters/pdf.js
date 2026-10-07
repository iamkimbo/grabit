// =============================================================
// exporters/pdf.js
// Generates a real PDF file client-side using jsPDF (bundled locally
// at lib/jspdf/jspdf.umd.min.js — no CDN, no remote code, MV3-safe)
// and downloads it the same way every other exporter does: build a
// Blob and hand it to triggerDownload().
//
// No print dialog, no window.print(), no document.write(). jsPDF
// renders the document programmatically (title, metadata, per-message
// text with word wrap and pagination, watermark footer) rather than
// rasterizing the HTML export, so formatting matches the plain-text
// exporter's level of fidelity — role labels + wrapped body text —
// not the HTML export's CSS-styled message bubbles.
//
// Free tier: same watermark *content* as before (WATERMARK_PRODUCT_NAME
// / WATERMARK_PRODUCT_WEBSITE from watermark/watermark.js), now drawn
// as footer text on every page instead of a CSS position:fixed element
// repeated by the print engine.
//
// Depends on (all loaded before this file in popup.html):
//   lib/jspdf/jspdf.umd.min.js  — window.jspdf.jsPDF
//   utils/export-utils.js       — buildFilename, triggerDownload,
//                                  getPlatformLabel, getAssistantLabel,
//                                  formatDateDisplay
//   watermark/watermark.js      — WATERMARK_PRODUCT_NAME, WATERMARK_PRODUCT_WEBSITE
//   exporters/plaintext.js      — stripMarkdown (AI content is markdown;
//                                  user content is already plain text)
// =============================================================

'use strict';

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const PDF_MARGIN_X      = 48;
const PDF_MARGIN_TOP    = 56;
const PDF_MARGIN_BOTTOM = 54;   // leaves room for the watermark footer
const PDF_BODY_LINE_H   = 14.5;
const PDF_PARA_GAP      = 8;

// Colors — matches the palette already used by the HTML/PDF export's CSS
const PDF_COLOR_TITLE     = [17, 17, 17];      // #111111
const PDF_COLOR_META      = [107, 114, 128];   // #6B7280
const PDF_COLOR_BODY      = [31, 41, 55];      // #1F2937
const PDF_COLOR_RULE      = [229, 231, 235];   // #E5E7EB
const PDF_COLOR_WATERMARK = [156, 163, 175];   // #9CA3AF

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

// Converts a conversation data object to a real PDF file and downloads it.
// data: { messages, title, platform, exportedAt, messageCount } OR { isMerge, conversations, exportedAt }
// options: { isPremium, filename?, meta? }
// Returns void
function exportToPDF(data, options) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error('PDF library failed to load (lib/jspdf/jspdf.umd.min.js missing from popup.html).');
  }

  const blob = data.isMerge
    ? _buildMergedPdfBlob(data, options)
    : _buildPdfBlob(data, options);

  const filename = (options && options.filename)
    ? options.filename + '.pdf'
    : data.isMerge
      ? 'merged-conversations-' + new Date().toISOString().slice(0, 10) + '.pdf'
      : buildFilename(data, 'pdf');

  triggerDownload(blob, filename, 'application/pdf');
}

// ---------------------------------------------------------------------------
// Single-conversation PDF
// ---------------------------------------------------------------------------

// Builds the PDF for a single conversation and returns it as a Blob.
function _buildPdfBlob(data, options) {
  const { messages, title, platform, exportedAt } = data;
  const { isPremium, meta } = options || {};

  const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
  const ctx = _newPdfContext(doc);

  _drawTitle(ctx, title || 'Conversation');
  _drawDocMeta(ctx, `${getPlatformLabel(platform)}  ·  ${formatDateDisplay(exportedAt)}  ·  ${messages.length} messages`);
  _drawMetaBlock(ctx, meta);

  const assistantLabel = getAssistantLabel(platform);
  messages.forEach(msg => _drawMessage(ctx, msg, assistantLabel));

  _drawWatermarkOnAllPages(doc, isPremium);

  return doc.output('blob');
}

// ---------------------------------------------------------------------------
// Merged-conversations PDF
// ---------------------------------------------------------------------------

// Builds the PDF for a merge export and returns it as a Blob.
function _buildMergedPdfBlob(data, options) {
  const { conversations, exportedAt } = data;
  const { isPremium, meta } = options || {};

  const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
  const ctx = _newPdfContext(doc);

  _drawTitle(ctx, 'Merged Conversations');
  _drawDocMeta(ctx, `${conversations.length} conversations  ·  ${formatDateDisplay(exportedAt)}`);
  _drawMetaBlock(ctx, meta);

  conversations.forEach(conv => {
    _drawRule(ctx);
    ctx.cursorY += PDF_PARA_GAP;
    _drawConvDivider(ctx, conv.title || 'Conversation', getPlatformLabel(conv.platform));

    const assistantLabel = getAssistantLabel(conv.platform);
    conv.messages.forEach(msg => _drawMessage(ctx, msg, assistantLabel));
  });

  _drawWatermarkOnAllPages(doc, isPremium);

  return doc.output('blob');
}

// ---------------------------------------------------------------------------
// Drawing context + pagination
// ---------------------------------------------------------------------------

// Creates a mutable drawing context shared across the helper functions below.
// Returns { doc, pageW, pageH, contentW, cursorY }
function _newPdfContext(doc) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  return {
    doc,
    pageW,
    pageH,
    contentW: pageW - PDF_MARGIN_X * 2,
    cursorY:  PDF_MARGIN_TOP
  };
}

// Adds a new page and resets the cursor if the next block of the given
// height wouldn't fit above the bottom margin.
function _ensureSpace(ctx, neededHeight) {
  if (ctx.cursorY + neededHeight > ctx.pageH - PDF_MARGIN_BOTTOM) {
    ctx.doc.addPage();
    ctx.cursorY = PDF_MARGIN_TOP;
  }
}

// ---------------------------------------------------------------------------
// Block renderers
// ---------------------------------------------------------------------------

function _drawTitle(ctx, title) {
  ctx.doc.setFont('helvetica', 'bold');
  ctx.doc.setFontSize(18);
  ctx.doc.setTextColor(...PDF_COLOR_TITLE);
  const lines = ctx.doc.splitTextToSize(title, ctx.contentW);
  lines.forEach(line => {
    _ensureSpace(ctx, 22);
    ctx.doc.text(line, PDF_MARGIN_X, ctx.cursorY);
    ctx.cursorY += 22;
  });
  ctx.cursorY += 2;
}

function _drawDocMeta(ctx, text) {
  ctx.doc.setFont('helvetica', 'normal');
  ctx.doc.setFontSize(10);
  ctx.doc.setTextColor(...PDF_COLOR_META);
  _ensureSpace(ctx, 16);
  ctx.doc.text(text, PDF_MARGIN_X, ctx.cursorY);
  ctx.cursorY += 22;
}

// Renders the optional author/tags/notes metadata block (custom filename +
// metadata feature) — only when at least one field is set, same condition
// every other exporter uses.
function _drawMetaBlock(ctx, meta) {
  if (!meta || (!meta.author && !meta.tags && !meta.notes)) return;

  const rows = [];
  if (meta.author)    rows.push(['Author', meta.author]);
  if (meta.tags)       rows.push(['Tags', meta.tags]);
  if (meta.notes)      rows.push(['Notes', meta.notes]);
  if (meta.exported)   rows.push(['Exported', meta.exported]);

  ctx.doc.setFontSize(9);
  rows.forEach(([key, value]) => {
    _ensureSpace(ctx, 14);
    ctx.doc.setFont('helvetica', 'bold');
    ctx.doc.setTextColor(...PDF_COLOR_META);
    ctx.doc.text(`${key}:`, PDF_MARGIN_X, ctx.cursorY);
    ctx.doc.setFont('helvetica', 'normal');
    ctx.doc.text(String(value), PDF_MARGIN_X + 52, ctx.cursorY);
    ctx.cursorY += 14;
  });
  ctx.cursorY += 8;
}

function _drawRule(ctx) {
  _ensureSpace(ctx, 12);
  ctx.doc.setDrawColor(...PDF_COLOR_RULE);
  ctx.doc.setLineWidth(0.75);
  ctx.doc.line(PDF_MARGIN_X, ctx.cursorY, ctx.pageW - PDF_MARGIN_X, ctx.cursorY);
  ctx.cursorY += 16;
}

// Renders a merge-mode conversation divider: title + platform label.
function _drawConvDivider(ctx, title, platformLabel) {
  ctx.doc.setFont('helvetica', 'bold');
  ctx.doc.setFontSize(13);
  ctx.doc.setTextColor(...PDF_COLOR_TITLE);
  _ensureSpace(ctx, 18);
  ctx.doc.text(title, PDF_MARGIN_X, ctx.cursorY);
  ctx.cursorY += 16;

  ctx.doc.setFont('helvetica', 'normal');
  ctx.doc.setFontSize(9);
  ctx.doc.setTextColor(...PDF_COLOR_META);
  _ensureSpace(ctx, 14);
  ctx.doc.text(platformLabel, PDF_MARGIN_X, ctx.cursorY);
  ctx.cursorY += 18;
}

// Renders one message: a leading rule, role label (+ timestamp if the
// scraper captured one), then word-wrapped body text. Hard line breaks
// in the source text are preserved before word-wrapping each of them,
// rather than relying on jsPDF to interpret embedded "\n" characters.
function _drawMessage(ctx, msg, assistantLabel) {
  const roleLabel = msg.role === 'user' ? 'You' : assistantLabel;
  const plainContent = msg.role === 'user'
    ? (msg.content || '').trim()
    : stripMarkdown(msg.content || '');

  _drawRule(ctx);

  ctx.doc.setFont('helvetica', 'bold');
  ctx.doc.setFontSize(9);
  ctx.doc.setTextColor(...PDF_COLOR_META);
  _ensureSpace(ctx, 14);
  const roleHeader = msg.timestamp
    ? `${roleLabel.toUpperCase()}  ·  ${msg.timestamp}`
    : roleLabel.toUpperCase();
  ctx.doc.text(roleHeader, PDF_MARGIN_X, ctx.cursorY);
  ctx.cursorY += 16;

  ctx.doc.setFont('helvetica', 'normal');
  ctx.doc.setFontSize(11);
  ctx.doc.setTextColor(...PDF_COLOR_BODY);

  const paragraphs = plainContent.split(/\n{2,}/);
  paragraphs.forEach((para, pi) => {
    para.split('\n').forEach(hardLine => {
      const wrapped = hardLine.length
        ? ctx.doc.splitTextToSize(hardLine, ctx.contentW)
        : [''];
      wrapped.forEach(line => {
        _ensureSpace(ctx, PDF_BODY_LINE_H);
        if (line) ctx.doc.text(line, PDF_MARGIN_X, ctx.cursorY);
        ctx.cursorY += PDF_BODY_LINE_H;
      });
    });
    if (pi < paragraphs.length - 1) ctx.cursorY += PDF_PARA_GAP;
  });

  ctx.cursorY += PDF_PARA_GAP;
}

// ---------------------------------------------------------------------------
// Watermark footer (free tier only)
// ---------------------------------------------------------------------------

// Draws the free-tier watermark text centered at the bottom of every page.
// Mirrors watermark/watermark.js's getPDFWatermarkElement() content exactly,
// rendered as native PDF text instead of a CSS position:fixed element (there
// is no print engine here — jsPDF draws directly, page by page).
// No-op for premium users, matching every other exporter's watermark logic.
function _drawWatermarkOnAllPages(doc, isPremium) {
  if (isPremium) return;

  const text = `Exported with ${WATERMARK_PRODUCT_NAME}  •  ${WATERMARK_PRODUCT_WEBSITE}`;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const pageCount = doc.internal.getNumberOfPages();

  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...PDF_COLOR_WATERMARK);
    doc.text(text, pageW / 2, pageH - 24, { align: 'center' });
  }
}
