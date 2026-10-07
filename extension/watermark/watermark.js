// =============================================================
// watermark/watermark.js
// Single source of truth for all watermark configuration,
// HTML markup, and CSS for Grabit exports.
//
// Free tier:
//   HTML exports → fixed badge in bottom-right corner linking to
//                  the Chrome Web Store listing page.
//   PDF exports  → small grey centred footer on every printed page
//                  via CSS position:fixed (repeats in Chrome's
//                  print engine).
//
// Paid tier: no watermarks of any kind. Both functions return ''
// when isPremium is true, so nothing is injected.
//
// To add watermarks to a new export format, call getHTMLBadge()
// or getPDFWatermarkElement() from that exporter.
//
// Depends on: nothing — pure string-returning functions.
// =============================================================

'use strict';

// ---------------------------------------------------------------------------
// Credential placeholders — replace before publishing
// ---------------------------------------------------------------------------

// ===== LEMONSQUEEZY CONFIG =====
// Replace this value before publishing:
// [Your Chrome Web Store listing URL — shown in the free-tier HTML badge]
const WATERMARK_STORE_URL = 'CHROME_STORE_URL';
// ================================

// Replace before publishing: [Your product name shown in both watermarks]
const WATERMARK_PRODUCT_NAME = 'Grabit';

// Replace before publishing: [Your product website shown in the PDF watermark]
const WATERMARK_PRODUCT_WEBSITE = 'PRODUCT_WEBSITE';

// ---------------------------------------------------------------------------
// HTML badge (screen export)
// ---------------------------------------------------------------------------

// Returns the anchor element markup for the free-tier badge embedded in
// exported HTML files. The badge is fixed to the bottom-right corner,
// semi-transparent, and links to the Chrome Web Store listing.
// Returns '' for premium users — no watermark of any kind.
// Returns an HTML string
function getHTMLBadge(isPremium) {
  if (isPremium) return '';
  return `<a class="free-badge"
    href="${WATERMARK_STORE_URL}"
    target="_blank"
    rel="noopener noreferrer"
    title="Exported with ${WATERMARK_PRODUCT_NAME}">Exported with ${WATERMARK_PRODUCT_NAME}</a>`;
}

// ---------------------------------------------------------------------------
// PDF watermark footer (print export)
// ---------------------------------------------------------------------------

// Returns the div element markup for the watermark footer shown on every
// printed page. Uses CSS position:fixed which Chrome repeats across pages
// when printing. Returns '' for premium users.
// Returns an HTML string
function getPDFWatermarkElement(isPremium) {
  if (isPremium) return '';
  return `<div class="print-watermark" aria-hidden="true">` +
    `Exported with ${WATERMARK_PRODUCT_NAME}  •  ${WATERMARK_PRODUCT_WEBSITE}` +
    `</div>`;
}

// ---------------------------------------------------------------------------
// CSS — screen styles
// ---------------------------------------------------------------------------

// Returns the CSS block for both watermark elements in screen (non-print)
// context. Should be included in the exported HTML document's <style> tag
// regardless of tier — the elements simply won't be present for premium users.
// Returns a CSS string
function getWatermarkScreenCSS() {
  return `
    /* ---- Free tier HTML badge (screen) ---- */
    .free-badge {
      position: fixed;
      bottom: 16px;
      right: 16px;
      background: rgba(255, 255, 255, 0.88);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 6px;
      padding: 6px 10px;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      font-size: 11px;
      color: #6B7280;
      text-decoration: none;
      letter-spacing: 0.01em;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
      z-index: 9999;
      transition: opacity 0.15s;
    }
    .free-badge:hover { opacity: 0.75; }

    /* ---- PDF watermark footer (screen preview — hidden when printing) ---- */
    .print-watermark {
      position: fixed;
      bottom: 10px;
      left: 0;
      right: 0;
      text-align: center;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      font-size: 9px;
      color: #9CA3AF;
      pointer-events: none;
      z-index: 9998;
    }`;
}

// ---------------------------------------------------------------------------
// CSS — dark mode overrides
// ---------------------------------------------------------------------------

// Returns the CSS overrides for watermark elements inside a
// @media (prefers-color-scheme: dark) block. Should be placed
// inside the dark-mode media query in the exported document's styles.
// Returns a CSS string
function getWatermarkDarkModeCSS() {
  return `
      .free-badge {
        background: rgba(28, 28, 28, 0.88);
        border-color: rgba(255, 255, 255, 0.08);
        color: #9CA3AF;
      }`;
}

// ---------------------------------------------------------------------------
// CSS — print styles
// ---------------------------------------------------------------------------

// Returns the CSS for watermarks inside @media print.
// The HTML badge is hidden when printing; the footer is shown via
// position:fixed which Chrome's print engine repeats on every page.
// Returns a CSS string
function getWatermarkPrintCSS() {
  return `
      /* Hide screen badge when printing */
      .free-badge { display: none !important; }

      /* Watermark footer: position:fixed repeats on every printed page in Chrome */
      .print-watermark {
        position: fixed;
        bottom: 10px;
        left: 0;
        right: 0;
        text-align: center;
        font-family: 'Inter', system-ui, -apple-system, sans-serif;
        font-size: 9px;
        color: #9CA3AF !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }`;
}
