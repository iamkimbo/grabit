// =============================================================
// content-scripts/sidebar-inject.js
// Injects a persistent "Export conversation" widget into each
// AI platform's sidebar. The widget provides one-click access to
// the extension popup from within the page UI — no need to find
// the toolbar icon.
//
// Works across: ChatGPT, Claude, Gemini, Grok.
// Standalone — no dependency on scraper-utils.js.
// Wrapped in an IIFE to avoid polluting the shared content-script
// scope that the platform scrapers also occupy.
// =============================================================

(function () {
  'use strict';

  // Unique ID for the injected host element.
  // Used to guard against duplicate injections.
  const WIDGET_ID = '__export_ext_sidebar_widget__';

  // ---------------------------------------------------------------------------
  // Platform detection
  // ---------------------------------------------------------------------------

  // Derives the current AI platform from the tab URL.
  // Returns 'chatgpt' | 'claude' | 'gemini' | 'grok' | null
  function getPlatform() {
    const h = location.hostname;
    if (h.includes('chatgpt.com'))       return 'chatgpt';
    if (h.includes('claude.ai'))         return 'claude';
    if (h.includes('gemini.google.com')) return 'gemini';
    if (h.includes('grok.com'))          return 'grok';
    return null;
  }

  // ---------------------------------------------------------------------------
  // Sidebar discovery
  // ---------------------------------------------------------------------------

  // Ordered fallback selector arrays for each platform's sidebar container.
  // Each selector is tried in turn; the first visible match wins.
  // Ordered from most-specific/stable to broadest/fragile.
  const SIDEBAR_SELECTORS = {
    chatgpt: [
      'nav[aria-label="Chat history"]',  // Stable ARIA label — most reliable
      'nav[aria-label*="history"]',
      'nav[aria-label*="chat"]',
      '[data-testid*="navigation"]',
      'nav',
    ],
    claude: [
      '[data-testid="sidebar"]',
      '[data-testid*="sidebar"]',
      'nav[aria-label]',
      '[class*="Sidebar"]:not([class*="content"])',
      'nav',
      'aside',
    ],
    gemini: [
      'bard-sidenav',           // Angular custom element
      'ms-sidenav-v2',          // Alternate Angular element name
      'ms-sidenav',
      'mat-sidenav',            // Angular Material component
      '[class*="sidenav"]',
      '[class*="sidebar"]',
      'aside',
      'nav',
    ],
    grok: [
      'aside',
      '[data-testid*="Sidebar"]',
      '[data-testid*="sidebar"]',
      '[class*="Sidebar"]:not([class*="content"])',
      '[class*="sidebar"]:not([class*="content"])',
      'nav',
    ],
  };

  // Finds the sidebar element for the given platform.
  // Skips elements that are not attached to the layout (offsetParent check).
  // Returns Element | null
  function findSidebar(platform) {
    const selectors = SIDEBAR_SELECTORS[platform] || [];
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        // offsetParent is null for hidden/detached elements
        if (el && el.offsetParent !== null) return el;
      } catch (_) {
        // Silently ignore invalid selectors
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Widget construction (Shadow DOM)
  // ---------------------------------------------------------------------------

  // Returns the complete CSS string for the widget's Shadow DOM.
  // Uses `color: inherit` so the widget adapts to the sidebar's light or dark
  // text color — `color` is an inherited CSS property that crosses the
  // Shadow DOM boundary.
  function buildWidgetCSS() {
    return `
      :host {
        display: block;
        /* Sticky positioning keeps the widget at the visible bottom of the
           sidebar even when the conversation list is long and scrolled. */
        position: sticky;
        bottom: 0;
        width: 100%;
        /* Ensure the widget sits above absolutely positioned sidebar children */
        z-index: 1;
        /* Pointer events on by default — disabled when btn is disabled */
        pointer-events: auto;
      }

      .widget {
        padding: 8px 10px 10px;
        border-top: 1px solid rgba(128, 128, 128, 0.18);
      }

      /* Main button — inherits sidebar's text color via Shadow DOM color cascade */
      .export-btn {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 8px 12px;
        color: inherit;
        background: transparent;
        border: 1px solid rgba(128, 128, 128, 0.28);
        border-radius: 7px;
        cursor: pointer;
        font-family: inherit;
        font-size: 13px;
        font-weight: 500;
        letter-spacing: -0.01em;
        line-height: 1;
        text-align: left;
        outline: none;
        transition: background 0.1s, border-color 0.1s, opacity 0.1s;
        box-sizing: border-box;
      }

      .export-btn:hover:not(:disabled) {
        background: rgba(128, 128, 128, 0.12);
        border-color: rgba(128, 128, 128, 0.42);
      }

      .export-btn:active:not(:disabled) {
        background: rgba(128, 128, 128, 0.2);
      }

      .export-btn:focus-visible {
        outline: 2px solid currentColor;
        outline-offset: 2px;
      }

      .export-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* Export icon — inherits currentColor for stroke */
      .icon {
        flex-shrink: 0;
        width: 14px;
        height: 14px;
        opacity: 0.75;
      }

      .btn-label {
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* Fallback tooltip shown when popup can't be opened programmatically */
      .tooltip {
        display: none;
        margin-top: 6px;
        padding: 5px 8px;
        font-size: 11px;
        font-family: inherit;
        color: inherit;
        opacity: 0.65;
        line-height: 1.4;
        text-align: center;
      }

      .tooltip.visible {
        display: block;
      }
    `;
  }

  // Builds the export icon SVG element (share/upload-arrow icon).
  // Uses currentColor so it inherits the button's text color.
  // Returns SVGElement
  function buildIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('icon');

    // Arrow-up-from-box (export) shape:
    // vertical line up from center, arrow head, then horizontal line + corners
    const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path1.setAttribute('d', 'M12 3v12');  // vertical shaft

    const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path2.setAttribute('d', 'M8 7l4-4 4 4');  // arrowhead

    const path3 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path3.setAttribute('d', 'M20 16v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3');  // tray/box bottom

    svg.appendChild(path1);
    svg.appendChild(path2);
    svg.appendChild(path3);

    return svg;
  }

  // Constructs and returns the Shadow DOM host element with the complete widget.
  // Returns HTMLElement
  function buildWidget() {
    const host = document.createElement('div');
    host.id = WIDGET_ID;

    // Shadow root for complete CSS isolation from platform styles
    const shadow = host.attachShadow({ mode: 'open' });

    // Inject widget CSS
    const style = document.createElement('style');
    style.textContent = buildWidgetCSS();
    shadow.appendChild(style);

    // Outer wrapper
    const widget = document.createElement('div');
    widget.className = 'widget';

    // Export button
    const btn = document.createElement('button');
    btn.className = 'export-btn';
    btn.setAttribute('type', 'button');
    btn.setAttribute('aria-label', 'Export this conversation — opens the export panel');
    btn.setAttribute('title', 'Export conversation');

    btn.appendChild(buildIcon());

    const label = document.createElement('span');
    label.className = 'btn-label';
    label.textContent = 'Export conversation';
    btn.appendChild(label);

    // Fallback tooltip (shown if popup can't be opened programmatically)
    const tooltip = document.createElement('div');
    tooltip.className = 'tooltip';
    tooltip.setAttribute('aria-live', 'polite');
    tooltip.setAttribute('role', 'status');
    tooltip.textContent = 'Click the extension icon in your toolbar to export.';

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      handleExportClick(btn, label, tooltip);
    });

    widget.appendChild(btn);
    widget.appendChild(tooltip);
    shadow.appendChild(widget);

    return host;
  }

  // ---------------------------------------------------------------------------
  // Export click handler
  // ---------------------------------------------------------------------------

  // Handles a click on the export button.
  // Sends a message to the background to open the extension popup.
  // Shows a fallback tip if openPopup() is unavailable or fails.
  function handleExportClick(btn, label, tooltip) {
    // Immediate visual feedback
    btn.disabled = true;
    label.textContent = 'Opening…';
    tooltip.classList.remove('visible');

    chrome.runtime.sendMessage({ action: 'OPEN_POPUP' }, function (response) {
      // Always re-enable the button
      btn.disabled = false;

      if (chrome.runtime.lastError || !response || !response.success) {
        // Popup couldn't be opened via the API — show the fallback tip
        label.textContent = 'Export conversation';
        tooltip.classList.add('visible');
        setTimeout(() => tooltip.classList.remove('visible'), 3000);
        return;
      }

      // Success — popup is opening
      label.textContent = 'Export conversation';
    });
  }

  // ---------------------------------------------------------------------------
  // Injection
  // ---------------------------------------------------------------------------

  // Injects the widget into the sidebar if not already present.
  // No-ops if the sidebar cannot be found or the widget is already there.
  function tryInject(platform) {
    if (document.getElementById(WIDGET_ID)) return;  // Already injected

    const sidebar = findSidebar(platform);
    if (!sidebar) return;

    const widget = buildWidget();

    // Append as last child — combined with position:sticky;bottom:0 this keeps
    // the widget anchored to the visible bottom of the sidebar scroll container.
    sidebar.appendChild(widget);

    // Re-inject if React/Angular removes our widget during a re-render
    watchForRemoval(sidebar, platform);
  }

  // ---------------------------------------------------------------------------
  // MutationObserver: re-injection guard
  // ---------------------------------------------------------------------------

  let _removalObserver = null;
  let _reinjectTimer   = null;

  // Watches the sidebar's direct children for removal of the widget.
  // If the widget disappears, schedules a re-injection (debounced to absorb
  // React's batched DOM updates).
  function watchForRemoval(sidebar, platform) {
    if (_removalObserver) {
      _removalObserver.disconnect();
      _removalObserver = null;
    }

    _removalObserver = new MutationObserver(function () {
      if (!document.getElementById(WIDGET_ID)) {
        clearTimeout(_reinjectTimer);
        // 150ms debounce: absorbs React's multiple synchronous DOM mutations
        _reinjectTimer = setTimeout(function () {
          tryInject(platform);
        }, 150);
      }
    });

    // Only watch direct children (childList:true, subtree:false) — efficient,
    // and the widget is always a direct child of the sidebar container.
    _removalObserver.observe(sidebar, { childList: true });
  }

  // ---------------------------------------------------------------------------
  // SPA navigation detection
  // ---------------------------------------------------------------------------

  // Patches history.pushState to fire a custom 'spa-navigate' event.
  // This is the standard technique for detecting SPA navigation in content scripts.
  function patchHistoryPushState() {
    if (window.__exportExtPushStatePatched__) return;
    window.__exportExtPushStatePatched__ = true;

    const original = history.pushState.bind(history);
    history.pushState = function (...args) {
      original(...args);
      window.dispatchEvent(new Event('spa-navigate'));
    };
  }

  // ---------------------------------------------------------------------------
  // Initialisation
  // ---------------------------------------------------------------------------

  let _pollAttempts = 0;
  let _pollTimer    = null;
  const MAX_POLL_ATTEMPTS = 40;   // 40 × 500ms = 20s max wait for sidebar to appear
  const POLL_INTERVAL_MS  = 500;

  // Polling loop: attempts injection, retries until sidebar appears.
  // Backs off automatically after MAX_POLL_ATTEMPTS.
  function startPolling(platform) {
    clearTimeout(_pollTimer);

    function attempt() {
      if (document.getElementById(WIDGET_ID)) return;  // Done

      tryInject(platform);

      if (document.getElementById(WIDGET_ID)) return;  // Succeeded this attempt

      if (_pollAttempts < MAX_POLL_ATTEMPTS) {
        _pollAttempts++;
        _pollTimer = setTimeout(attempt, POLL_INTERVAL_MS);
      }
    }

    attempt();
  }

  // Handles SPA navigation events: resets the poll counter and retries injection.
  // The sidebar container usually persists across navigation (React keeps it
  // mounted), but occasionally gets re-created — re-polling handles both cases.
  function onNavigation(platform) {
    _pollAttempts = 0;
    clearTimeout(_pollTimer);
    // Small delay to let the framework settle its DOM updates
    setTimeout(function () { startPolling(platform); }, 300);
  }

  // Main entry point.
  function init() {
    const platform = getPlatform();
    if (!platform) return;  // Not on a supported platform

    // Start the initial injection poll
    startPolling(platform);

    // Detect SPA navigation via patched pushState + popstate
    patchHistoryPushState();
    window.addEventListener('popstate',    function () { onNavigation(platform); });
    window.addEventListener('spa-navigate', function () { onNavigation(platform); });

    // Fallback: watch the document <title> for changes — platforms update the
    // title when navigating to a different conversation, providing a reliable
    // secondary signal even on platforms that don't use pushState.
    const titleEl = document.querySelector('title');
    if (titleEl) {
      const titleObserver = new MutationObserver(function () {
        if (!document.getElementById(WIDGET_ID)) {
          onNavigation(platform);
        }
      });
      titleObserver.observe(titleEl, { childList: true });
    }
  }

  // Defer until the DOM is interactive to avoid running before any sidebar exists
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
