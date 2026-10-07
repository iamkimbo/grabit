# Grabbit 

Export AI conversations from ChatGPT, Claude, Gemini, and Grok to PDF, Markdown, HTML, plain text, JSON, CSV, and (paid) DOCX — all client-side, no account required.

---

## Folder Structure

```
/extension
├── manifest.json              — Chrome extension manifest (MV3)
├── README.md                  — This file
│
├── /background
│   └── service-worker.js      — Background service worker; handles platform
│                                detection and popup↔content-script relay
│
├── /content-scripts
│   ├── scraper-utils.js       — Shared DOM utilities: markdown conversion,
│   │                            message normalization, response helpers
│   ├── chatgpt.js             — ChatGPT (chatgpt.com) DOM scraper
│   ├── claude.js              — Claude (claude.ai) DOM scraper
│   ├── gemini.js              — Gemini (gemini.google.com) DOM scraper
│   ├── grok.js                — Grok (grok.com) DOM scraper
│   └── sidebar-inject.js      — Sidebar export widget injected into all 4 platforms
│
├── /exporters
│   ├── markdown.js            — Markdown (.md) export logic
│   ├── plaintext.js           — Plain text (.txt) export logic
│   ├── json.js                — JSON (.json) export logic
│   ├── csv.js                 — CSV (.csv) export logic
│   ├── html.js                — Self-contained HTML (.html) export logic
│   ├── pdf.js                 — PDF export via Chrome print engine
│   ├── docx.js                — DOCX export (paid tier — Step 7)
│   └── notion.js              — Notion sync (paid tier — Step 8)
│
├── /popup
│   ├── popup.html             — Extension popup shell
│   ├── popup.js               — Popup logic: scrape, format select, export
│   └── popup.css              — Popup styles (Inter font, premium design)
│
├── /settings
│   ├── settings.html          — Settings page shell
│   ├── settings.js            — License key entry, tier display, Notion auth
│   └── settings.css           — Settings page styles
│
├── /licensing
│   └── license.js             — LemonSqueezy license key validation logic
│
├── /watermark
│   └── watermark.js           — PDF footer and HTML badge injection (free tier)
│
├── /utils
│   ├── storage.js             — chrome.storage.local wrappers
│   ├── gate.js                — Freemium gate: selective export counter logic
│   └── date-utils.js          — Date helpers: today string, midnight reset check
│
└── /assets
    └── /icons
        ├── icon16.png         — 16×16 toolbar icon
        ├── icon48.png         — 48×48 extensions page icon
        └── icon128.png        — 128×128 Chrome Web Store icon
```

---

## How to Load the Extension Locally in Chrome

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** using the toggle in the top-right corner
3. Click **Load unpacked**
4. Select the `/extension` folder (the folder containing `manifest.json`)
5. The extension icon will appear in your toolbar
6. Navigate to ChatGPT, Claude, Gemini, or Grok and open any conversation
7. Click the extension icon to open the popup

> **Icons:** Chrome requires real `.png` files for the extension icon.
> Placeholder files must be placed at `assets/icons/icon16.png`,
> `assets/icons/icon48.png`, and `assets/icons/icon128.png` before loading.
> Any 16×16, 48×48, and 128×128 PNG will work during development.

---

## How to Swap in Real Credentials Before Publishing

Every placeholder credential in the codebase is marked with a comment block in this exact format:

```js
// ===== LEMONSQUEEZY CONFIG =====
// Replace this value before publishing:
// [description of what this value is]
const LEMONSQUEEZY_API_KEY = "YOUR_API_KEY_HERE";
// ================================
```

Search the entire codebase for `LEMONSQUEEZY CONFIG` to find every location.

**Values to replace:**

| Placeholder | File | What to put there |
|---|---|---|
| `YOUR_API_KEY_HERE` | `licensing/license.js` | Your LemonSqueezy API key |
| `YOUR_STORE_ID_HERE` | `licensing/license.js` | Your LemonSqueezy store ID |
| `YOUR_PRODUCT_ID_HERE` | `licensing/license.js` | Your LemonSqueezy product ID |
| `YOUR_MONTHLY_VARIANT_ID` | `licensing/license.js` | Variant ID for the monthly plan |
| `YOUR_YEARLY_VARIANT_ID` | `licensing/license.js` | Variant ID for the yearly plan |
| `YOUR_NOTION_CLIENT_ID` | `exporters/notion.js` | Notion OAuth app client ID |
| `YOUR_NOTION_CLIENT_SECRET` | `exporters/notion.js` | Notion OAuth app client secret |
| `PRODUCT_NAME` | `manifest.json`, all UI files | Your chosen product name |
| `PRODUCT_WEBSITE` | `watermark/watermark.js`, UI | Your product's website URL |
| `CHROME_STORE_URL` | `watermark/watermark.js` | Your Chrome Web Store listing URL |

---

## How Each Export Format Works

**Markdown (.md)**
Converts the conversation to a Markdown document. AI responses are already structured as Markdown (headers, bold, code blocks, lists) because the scraper converts the DOM's rich HTML to Markdown during extraction. User messages are rendered as plain paragraphs. The file begins with a YAML-like header block containing the title, platform, and export date.

**Plain Text (.txt)**
Strips all Markdown syntax from the Markdown output to produce a clean readable transcript. Code block fences are removed but code content is preserved. Useful for pasting into documents or note apps that don't support Markdown.

**JSON (.json)**
Exports the raw normalized message array as a pretty-printed JSON file. Each message includes `role`, `content`, `index`, `platform`, and `timestamp`. Useful for developers or for importing into other tools.

**CSV (.csv)**
Flattens each message to a single row with columns: `index`, `role`, `platform`, `timestamp`, `content`. Multi-line content is quoted per RFC 4180. Useful for analysis in spreadsheets.

**HTML (.html)**
Produces a self-contained single-file HTML document with all CSS inlined. The visual design mirrors the PDF output: user messages have a light grey fill, AI messages have a white background, code blocks use a dark theme. Dark mode is supported via `@media (prefers-color-scheme: dark)`. Free tier includes a small fixed badge in the bottom-right corner.

**PDF**
Opens a hidden `window.print()` dialog pre-styled with print CSS so the output looks like a polished document rather than a raw webpage. User and AI messages are visually distinct, code blocks are monospace on a dark background, and pages include a header (title + date) and page numbers. Free tier adds a small grey footer on every page. No external PDF library is used.

---

## How the Freemium Gate Works

**Export All (no selection changes) = always free, unlimited.**

If the user opens the popup and clicks Export without touching any of the selective controls (checkboxes, AI-only toggle, Last 10/20 filter, Deselect All), the export proceeds with no gate at all — no counter is incremented.

**Selective export = consumes 1 daily credit.**

The moment the user interacts with any selective control, the session is marked as a selective export. Free users get 3 per day. The counter is stored in `chrome.storage.local` as `{ date: 'YYYY-MM-DD', count: N }`. On each export, the stored date is compared to today's date. If they differ, the counter resets to 0 before incrementing. If the count has already reached 3, the export is blocked and an inline message appears below the export button — no modal, no popup, just plain text.

Paid users bypass the gate entirely — the `isPremium` flag in storage short-circuits the check before any counter logic runs.

---

## How License Key Validation Works

1. The user purchases on LemonSqueezy and receives a license key by email.
2. They open the extension settings page and paste the key into the input field.
3. The extension calls the LemonSqueezy `/v1/licenses/validate` API endpoint directly from the browser (no backend needed).
4. If the API returns `valid: true`, the extension writes `{ isPremium: true, licenseKey: key, licenseStatus: 'active' }` to `chrome.storage.local`.
5. From that point forward, every gate check reads `isPremium` from storage and skips all restrictions.
6. The license key is also stored so future sessions can re-validate silently on startup.

---

## Build Order Reference

| Step | What was added |
|------|----------------|
| **1** | `manifest.json`, `background/service-worker.js`, `content-scripts/` — DOM scrapers for ChatGPT, Claude, Gemini, Grok, plus shared `scraper-utils.js` |
| **2** | `exporters/` — Markdown, plain text, JSON, CSV, HTML, and PDF export logic |
| **3** | `popup/` — Popup UI: format selector, message list with checkboxes, live export button label, selective controls |
| **4** | `utils/gate.js`, `utils/storage.js`, `utils/date-utils.js` — Freemium gate logic and daily counter |
| **5** | `watermark/watermark.js` — PDF footer and HTML badge for free tier |
| **6** | `licensing/license.js`, `settings/` — LemonSqueezy license key validation, settings page, premium unlock |
| **7** | `exporters/docx.js` — DOCX (Microsoft Word) export for paid tier |
| **8** | `exporters/notion.js` — Notion OAuth + one-click page export for paid tier |
| **9** | `utils/merge-queue.js` — Queue model (max 10). "Add to merge queue" button + merge mode in popup. All 8 exporters produce merged output with section dividers. Paid tier. |
| **10** | Custom filename + metadata panels in popup. Collapsible sections (locked for free users). All 8 exporters embed metadata in their native format. New storage keys: `custom_filename_enabled`, `custom_filename_value`, `meta_author`, `meta_tags`, `meta_notes`. |
| **11** | `content-scripts/sidebar-inject.js` — persistent "Export conversation" widget injected into each platform's sidebar. Shadow DOM isolation, `position:sticky` bottom anchor, MutationObserver re-injection guard, SPA navigation detection via `pushState` patch + `popstate` + `<title>` observer. Clicking opens the extension popup via `chrome.action.openPopup()` with a toolbar-icon fallback tooltip. |

---

## Design System Reference

All UI surfaces (popup, settings, exported HTML) share these values.

**Colors**

| Token | Value | Usage |
|-------|-------|-------|
| `--color-bg` | `#FAFAFA` | Popup and settings background |
| `--color-surface` | `#FFFFFF` | Cards, message rows |
| `--color-text-primary` | `#111111` | Body text, labels |
| `--color-text-secondary` | `#6B7280` | Captions, secondary labels |
| `--color-accent` | `#111111` | Primary button fill |
| `--color-accent-text` | `#FFFFFF` | Text on primary button |
| `--color-border` | `#E5E7EB` | Dividers, input outlines |
| `--color-hover` | `#F9FAFB` | Row hover state |
| `--color-user-bg` | `#F3F4F6` | User message fill in PDF/HTML |
| `--color-user-border` | `#D1D5DB` | User message left border |
| `--color-code-bg` | `#1E1E1E` | Code block background |
| `--color-code-text` | `#D4D4D4` | Code block text |
| `--color-watermark` | `#9CA3AF` | Free tier watermark text |
| `--color-gate-msg` | `#6B7280` | Daily cap inline message |

**Typography**

| Usage | Font | Size | Weight |
|-------|------|------|--------|
| Body | Inter, system-ui | 13px | 400 |
| Labels | Inter, system-ui | 11px | 500 |
| Export button | Inter, system-ui | 15px | 500 |
| Code | 'JetBrains Mono', 'Fira Code', monospace | 13px | 400 |
| Watermark | Inter, system-ui | 9px | 400 |

**Spacing**

| Token | Value | Usage |
|-------|-------|-------|
| `--space-outer` | 16px | Popup outer padding |
| `--space-section` | 12px | Between sections |
| `--space-row` | 10px | Message row vertical padding |
| `--page-margin-v` | 48px | PDF page top/bottom margin |
| `--page-margin-h` | 40px | PDF page left/right margin |

**Border Radius**

Maximum 10px. Inputs and buttons: 6px. Cards: 8px. Pills/tags: 999px.

**Shadows**

Avoided unless necessary. When used: `0 1px 3px rgba(0,0,0,0.08)` only.

---

## chrome.storage.local Key Reference

All keys are initialised in `background/service-worker.js` on first install.

| Key | Type | Description |
|-----|------|-------------|
| `isPremium` | boolean | `true` once a valid license key is verified. Gates selective export limit and watermarks. |
| `licenseKey` | string \| null | The raw license key string entered by the user. |
| `licenseStatus` | `'free'` \| `'active'` \| `'expired'` | Status returned by the last LemonSqueezy validation call. |
| `selectiveExportUsage` | `{ date: string, count: number }` | Daily selective export counter. `date` is `'YYYY-MM-DD'` in local time; resets to 0 when the date changes. |
| `pin_nudge_dismissed` | boolean | Set to `true` when the user clicks × on the first-open pin nudge. Never shown again after that. |
| `total_export_count` | integer | Running total of successful exports across all sessions. Increments on every successful export regardless of format or tier. Used for review ask milestones. |
| `review_ask_shown` | boolean | Set to `true` the moment the user clicks the review ask bar. After that, the bar never appears again, even at future milestones. |
| `review_milestone_index` | integer 0–5 | Index into the `[5, 15, 30, 60, 120]` milestones array. Advances each time a milestone fires (whether or not the user clicks). When it reaches 5 (past the 120th milestone), the review ask is permanently retired. |
| `notionAccessToken` | string \| null | OAuth access token from the Notion API. Set by `notionConnect()` after the user completes the OAuth flow. |
| `notionWorkspaceName` | string \| null | Workspace name returned during Notion token exchange. Displayed in settings. |
| `notionPageId` | string \| null | 32-char hex Notion page ID where new export pages are created as children. |
| `notionPageTitle` | string \| null | Cached title of the target Notion page. Displayed in settings so the user can see which page is selected. |
| `merge_queue` | array | Serialised queue of up to 10 conversations waiting to be merged. Each entry: `{ id, title, platform, messages }`. |
| `custom_filename_enabled` | boolean | `true` when the user has typed a custom filename that overrides the auto-generated name. |
| `custom_filename_value` | string | The custom filename string entered by the user (no extension). Stripped of invalid filename characters. Pre-fills the filename input on popup open. |
| `meta_author` | string | Author field value typed by the user. Persists across exports so it does not need to be re-entered. Injected into exported files when non-empty. |
| `meta_tags` | string | Tags field value (comma-separated). Same persistence and injection behaviour as `meta_author`. |
| `meta_notes` | string | Free-text notes field. Same persistence and injection behaviour as `meta_author`. |

---

## How the Sidebar Widget Works (Step 11)

A small "Export conversation" button is injected into the sidebar of every supported AI platform. It appears as the last item in the sidebar, pinned to the visible bottom edge via `position:sticky; bottom:0`, so it stays in view even when the conversation list is long.

**CSS isolation**: the widget lives inside a Shadow DOM root. The platform's stylesheet cannot reach inside it, and the widget's styles cannot leak out. The one deliberate exception is the `color` CSS property, which is inherited across Shadow DOM boundaries by spec — this means the widget's text and icon automatically inherit whatever text colour the sidebar uses, adapting to light and dark themes without any JS theme detection.

**Resilience against framework re-renders**: React and Angular re-render sidebar content frequently. A `MutationObserver` watches the sidebar's direct children; if the widget is removed it is re-injected within 150ms.

**SPA navigation detection**: these platforms are single-page apps. Navigating between conversations does not reload the page. The widget patches `history.pushState` to fire a custom `spa-navigate` event, listens on `popstate`, and also watches the document `<title>` for changes — three independent signals that together catch every navigation pattern across all four platforms.

**Opening the popup**: clicking the widget sends `{ action: 'OPEN_POPUP' }` to the service worker, which calls `chrome.action.openPopup()` (requires Chrome 127+). If the call rejects — because the browser version is older, or the popup is already open — the widget shows a brief "Click the extension icon in your toolbar to export." tooltip for 3 seconds, then resets.

---

## How Custom Filename Works (Step 10)

The popup shows a collapsible **Filename** section below the export button, visible to all users but locked (greyed out, lock icon) for free users. Clicking a locked field opens the upgrade modal. Premium users can type any string into the input; on each keystroke the value is saved to `custom_filename_value` in `chrome.storage.local` so it persists across popup opens. The extension strips any characters that are illegal in file names (`/ \ : * ? " < > |`) before using the string. If the field is left empty the auto-generated filename (`platform-title-YYYY-MM-DD`) is used instead. The file extension (`.md`, `.pdf`, etc.) is always appended automatically based on the selected format — users do not type it.

## How Metadata Works (Step 10)

The popup shows a collapsible **Metadata** section with three fields: **Author**, **Tags**, and **Notes**. Like the filename section it is visible but locked for free users. All three values are persisted in `chrome.storage.local` (`meta_author`, `meta_tags`, `meta_notes`) so they do not need to be re-entered between exports. When an export runs, a metadata object is assembled from the stored values and passed to the active exporter alongside the conversation data. Each exporter embeds the metadata in its native format: YAML frontmatter for Markdown; a header block for Plain Text; a top-level `"metadata"` object for JSON; comment rows (`# Author:`, `# Tags:`) for CSV; `<meta>` tags plus a visible summary block for HTML and PDF; document core properties (`docProps/core.xml`) plus a visible block for DOCX; and labelled paragraph blocks at the top of the page for Notion. Only fields that have a non-empty value are written — no "Author: " lines with nothing after them.
