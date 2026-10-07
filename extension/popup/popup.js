// =============================================================
// popup.js
// Main logic for the Grabit extension popup.
// Orchestrates: platform detection, conversation scraping,
// message list rendering, selective controls, format selection,
// freemium gate, export dispatch, pin nudge, upgrade modal,
// and review ask bar.
//
// Depends on (loaded before this file):
//   utils/export-utils.js  — shared helpers
//   exporters/*.js         — one per format
// =============================================================

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FORMAT_LABELS = {
  markdown: 'Markdown',
  txt:      'Plain Text',
  json:     'JSON',
  csv:      'CSV',
  html:     'HTML',
  pdf:      'PDF',
  docx:     'Word (DOCX)',
  notion:   'Notion'
};

// Formats that require a premium license — shown to free users with an upgrade prompt
const PREMIUM_FORMATS = new Set(['docx', 'notion']);

// Milestone export counts at which the review ask bar is shown
const REVIEW_MILESTONES = [5, 15, 30, 60, 120];

// FREE_SELECTIVE_LIMIT is defined in utils/gate.js

// Replace before publishing: product website URL
const PRODUCT_WEBSITE = 'PRODUCT_WEBSITE';

// Replace before publishing: Chrome Web Store review URL
const CHROME_STORE_REVIEW_URL = 'CHROME_STORE_REVIEW_URL';

// Replace before publishing: Chrome Web Store listing URL (for upgrade modal)
const CHROME_STORE_PRICING_URL = PRODUCT_WEBSITE + '/pricing';

// ---------------------------------------------------------------------------
// Application state
// ---------------------------------------------------------------------------

const state = {
  platform:         null,   // 'chatgpt' | 'claude' | 'gemini' | 'grok' | null
  tabId:            null,
  title:            'Conversation',
  messages:         [],     // full array from scraper
  selectedIndices:  new Set(),
  format:           'markdown',
  isSelective:      false,  // true once user touches any selective control
  isPremium:        false,
  mergeQueue:       [],     // local mirror of chrome.storage merge_queue
  mergeFormat:      'markdown'
};

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const $ = id => document.getElementById(id);

const pinNudge          = $('pin-nudge');
const pinNudgeDismiss   = $('pin-nudge-dismiss');
const platformLabel     = $('platform-label');
const settingsBtn       = $('settings-btn');

const statePanels = {
  loading:     $('state-loading'),
  unsupported: $('state-unsupported'),
  empty:       $('state-empty'),
  error:       $('state-error')
};
const stateErrorText = $('state-error-text');
const retryBtn       = $('retry-btn');
const mainUi         = $('main-ui');

const formatTabs     = $('format-tabs');
const selectAllEl    = $('select-all');
const selectedCount  = $('selected-count');
const messageList    = $('message-list');

const aiOnlyToggle   = $('ai-only-toggle');
const last10Btn      = $('last-10-btn');
const last20Btn      = $('last-20-btn');
const deselectAllBtn = $('deselect-all-btn');

const exportBtn      = $('export-btn');
const queueBtn       = $('queue-btn');
const capMessage     = $('cap-message');

const reviewBar      = $('review-bar');
const reviewBarText  = $('review-bar-text');

const upgradeModal   = $('upgrade-modal');
const upgradeLink    = $('upgrade-link');
const modalDismiss   = $('modal-dismiss');

// Filename & metadata section refs (Step 10)
const filenameToggle    = $('filename-toggle');
const filenameBody      = $('filename-body');
const filenameFieldWrap = $('filename-field-wrap');
const customFilenameEl  = $('custom-filename');

const metadataToggle    = $('metadata-toggle');
const metadataBody      = $('metadata-body');
const metaAuthorWrap    = $('meta-author-wrap');
const metaTagsWrap      = $('meta-tags-wrap');
const metaNotesWrap     = $('meta-notes-wrap');
const metaAuthorEl      = $('meta-author');
const metaTagsEl        = $('meta-tags');
const metaNotesEl       = $('meta-notes');

// Merge UI refs
const mergeModBtn      = $('merge-mode-btn');
const mergeCountBadge  = $('merge-count-badge');
const mergeUi          = $('merge-ui');
const mergeBackBtn     = $('merge-back-btn');
const mergeItemList    = $('merge-item-list');
const mergeFormatTabs  = $('merge-format-tabs');
const mergeExportBtn   = $('merge-export-btn');
const mergePostMsg     = $('merge-post-msg');
const mergeClearYesBtn = $('merge-clear-yes-btn');
const mergeKeepBtn     = $('merge-keep-btn');

// Storage helpers are provided by utils/storage.js (storageGet / storageSet / storageRemove).
// Date helpers are provided by utils/date-utils.js (getTodayString / isNewDay).
// Gate logic is provided by utils/gate.js (checkSelectiveGate / getRemainingSelectiveExports).

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

// Entry point — runs when the popup DOM is ready
document.addEventListener('DOMContentLoaded', init);

async function init() {
  // Load premium status + stored metadata values in one shot
  const storage = await storageGet([
    'isPremium',
    'custom_filename_value',
    'meta_author', 'meta_tags', 'meta_notes'
  ]);
  state.isPremium = Boolean(storage.isPremium);

  // Pre-fill filename and metadata inputs from storage
  customFilenameEl.value = storage.custom_filename_value || '';
  metaAuthorEl.value     = storage.meta_author || '';
  metaTagsEl.value       = storage.meta_tags   || '';
  metaNotesEl.value      = storage.meta_notes  || '';

  // Apply locked/unlocked state based on premium status
  applyMetaPremiumState();

  initPinNudge();
  wireStaticListeners();
  await initMergeQueue();
  detectAndScrape();
}

// ---------------------------------------------------------------------------
// Static event listeners (set once, independent of scrape result)
// ---------------------------------------------------------------------------

// Wires up all event listeners that don't depend on the scraped message data
function wireStaticListeners() {
  // Settings
  settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

  // Format tabs
  formatTabs.addEventListener('click', e => {
    const tab = e.target.closest('.format-tab');
    if (!tab) return;
    setFormat(tab.dataset.format);
  });

  // Select all checkbox
  selectAllEl.addEventListener('change', handleSelectAll);

  // Selective controls
  aiOnlyToggle.addEventListener('change',  () => { markSelective(); applyAiOnlyFilter(); });
  last10Btn.addEventListener('click',      () => { markSelective(); applyLastN(10); });
  last20Btn.addEventListener('click',      () => { markSelective(); applyLastN(20); });
  deselectAllBtn.addEventListener('click', () => { markSelective(); deselectAll(); });

  // Export
  exportBtn.addEventListener('click', handleExport);

  // Retry on error
  retryBtn.addEventListener('click', detectAndScrape);

  // Upgrade modal
  upgradeLink.setAttribute('href', CHROME_STORE_PRICING_URL);
  modalDismiss.addEventListener('click', () => {
    hideUpgradeModal();
    showCapMessage();
  });
  // Clicking the backdrop outside the card also dismisses
  upgradeModal.addEventListener('click', e => {
    if (e.target === upgradeModal) {
      hideUpgradeModal();
      showCapMessage();
    }
  });

  // Review bar
  reviewBar.addEventListener('click', handleReviewBarClick);
  reviewBar.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleReviewBarClick();
    }
  });

  // Filename + metadata collapsible toggles
  wireCollapsible(filenameToggle, filenameBody);
  wireCollapsible(metadataToggle, metadataBody);

  // Locked-field click handlers — free users: show upgrade modal
  filenameFieldWrap.addEventListener('click', () => {
    if (!state.isPremium) showUpgradeModal();
  });
  metaAuthorWrap.addEventListener('click', () => {
    if (!state.isPremium) showUpgradeModal();
  });
  metaTagsWrap.addEventListener('click', () => {
    if (!state.isPremium) showUpgradeModal();
  });
  metaNotesWrap.addEventListener('click', () => {
    if (!state.isPremium) showUpgradeModal();
  });

  // Auto-save metadata on input (premium users only; inputs are disabled for free)
  customFilenameEl.addEventListener('input', () => {
    const cleaned = stripInvalidFilenameChars(customFilenameEl.value);
    storageSet({
      custom_filename_value:   cleaned,
      custom_filename_enabled: cleaned.length > 0
    });
  });
  metaAuthorEl.addEventListener('input', () => storageSet({ meta_author: metaAuthorEl.value }));
  metaTagsEl.addEventListener('input',   () => storageSet({ meta_tags:   metaTagsEl.value }));
  metaNotesEl.addEventListener('input',  () => storageSet({ meta_notes:  metaNotesEl.value }));

  // Merge queue
  queueBtn.addEventListener('click', handleAddToQueue);
  mergeModBtn.addEventListener('click', enterMergeMode);
  mergeBackBtn.addEventListener('click', exitMergeMode);
  mergeExportBtn.addEventListener('click', handleMergeExport);

  mergeFormatTabs.addEventListener('click', e => {
    const tab = e.target.closest('.format-tab');
    if (!tab) return;
    setMergeFormat(tab.dataset.format);
  });

  mergeClearYesBtn.addEventListener('click', async () => {
    await clearQueue();
    state.mergeQueue = [];
    exitMergeMode();
  });

  mergeKeepBtn.addEventListener('click', () => {
    mergePostMsg.classList.add('hidden');
    mergeExportBtn.disabled      = false;
    mergeExportBtn.style.opacity = '';
    updateMergeExportBtn();
  });
}

// ---------------------------------------------------------------------------
// Platform detection & scraping
// ---------------------------------------------------------------------------

// Detects the active tab's platform and requests a message scrape from the content script
async function detectAndScrape() {
  showState('loading');

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tab = tabs[0];
    if (!tab) { showState('unsupported'); return; }

    const platform = detectPlatform(tab.url);
    if (!platform) { showState('unsupported'); return; }

    state.platform  = platform;
    state.tabId     = tab.id;

    showPlatformLabel(platform);

    chrome.tabs.sendMessage(tab.id, { action: 'SCRAPE_MESSAGES' }, response => {
      if (chrome.runtime.lastError) {
        showState('error');
        stateErrorText.textContent =
          'Could not connect to the page. Try reloading the tab, then reopen this popup.';
        return;
      }
      if (!response) {
        showState('error');
        stateErrorText.textContent = 'No response from the page scraper.';
        return;
      }
      if (!response.success) {
        if (response.messages && response.messages.length === 0 &&
            response.error && response.error.includes('No conversation')) {
          showState('empty');
        } else {
          showState('error');
          stateErrorText.textContent = response.error || 'An unknown error occurred.';
        }
        return;
      }
      if (!response.messages || response.messages.length === 0) {
        showState('empty');
        return;
      }
      onScrapeSuccess(response);
    });
  });
}

// Returns the platform key from a tab URL, or null if unsupported
// Returns 'chatgpt' | 'claude' | 'gemini' | 'grok' | null
function detectPlatform(url) {
  if (!url) return null;
  if (url.includes('chatgpt.com'))       return 'chatgpt';
  if (url.includes('claude.ai'))         return 'claude';
  if (url.includes('gemini.google.com')) return 'gemini';
  if (url.includes('grok.com'))          return 'grok';
  return null;
}

// Called when the content script returns a successful scrape
// Populates state and renders the main UI
function onScrapeSuccess(response) {
  state.messages = response.messages;
  state.title    = response.title || 'Conversation';

  // Default: all messages selected
  state.selectedIndices = new Set(response.messages.map(m => m.index));
  state.isSelective     = false;

  renderMessages();
  updateSelectAllState();
  updateSelectedCount();
  updateExportButton(false);
  showMainUi();
}

// ---------------------------------------------------------------------------
// State panel visibility
// ---------------------------------------------------------------------------

// Shows one state panel (loading/unsupported/empty/error) and hides all others
function showState(name) {
  Object.entries(statePanels).forEach(([key, el]) => {
    el.classList.toggle('hidden', key !== name);
  });
  mainUi.classList.add('hidden');
}

// Hides all state panels and shows the main UI
function showMainUi() {
  Object.values(statePanels).forEach(el => el.classList.add('hidden'));
  mainUi.classList.remove('hidden');
}

// Shows the platform label badge in the header
function showPlatformLabel(platform) {
  platformLabel.textContent = getPlatformLabel(platform);
  platformLabel.classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Message list rendering
// ---------------------------------------------------------------------------

// Renders all messages from state.messages as rows with custom checkboxes
function renderMessages() {
  messageList.innerHTML = '';

  if (!state.messages.length) {
    const empty = document.createElement('p');
    empty.className = 'msg-list-empty';
    empty.textContent = 'No messages to show.';
    messageList.appendChild(empty);
    return;
  }

  const assistantLabel = getAssistantLabel(state.platform);

  state.messages.forEach(msg => {
    messageList.appendChild(createMessageRow(msg, assistantLabel));
  });
}

// Creates a single message row element for the given message
// Returns an Element
function createMessageRow(msg, assistantLabel) {
  const label = document.createElement('label');
  label.className = 'msg-row checkbox-label';
  label.setAttribute('role', 'listitem');
  label.dataset.index = msg.index;

  // Hidden native checkbox (drives the custom visual)
  const checkbox = document.createElement('input');
  checkbox.type      = 'checkbox';
  checkbox.className = 'checkbox-input';
  checkbox.checked   = state.selectedIndices.has(msg.index);
  checkbox.setAttribute('aria-label',
    `${msg.role === 'user' ? 'You' : assistantLabel}: ${truncate(msg.content, 40)}`);
  checkbox.addEventListener('change', () => {
    markSelective();
    handleMessageCheckbox(msg.index, checkbox.checked);
  });

  // Custom checkbox visual
  const checkboxVisual = document.createElement('span');
  checkboxVisual.className = 'checkbox-custom';
  checkboxVisual.setAttribute('aria-hidden', 'true');

  // Role badge
  const roleBadge = document.createElement('span');
  roleBadge.className = `msg-role msg-role--${msg.role}`;
  roleBadge.textContent = msg.role === 'user' ? 'You' : assistantLabel;

  // Preview text
  const preview = document.createElement('span');
  preview.className   = 'msg-preview';
  preview.textContent = truncate(msg.content, 55);

  label.appendChild(checkbox);
  label.appendChild(checkboxVisual);
  label.appendChild(roleBadge);
  label.appendChild(preview);

  return label;
}

// Truncates a string to maxLen characters, appending '…' if cut
// Returns a string
function truncate(str, maxLen) {
  if (!str) return '';
  const clean = str.replace(/\n+/g, ' ').trim();
  return clean.length > maxLen ? clean.slice(0, maxLen) + '…' : clean;
}

// ---------------------------------------------------------------------------
// Selection management
// ---------------------------------------------------------------------------

// Sets isSelective to true — called on any interaction with a selective control.
// Never reverts within a popup session.
function markSelective() {
  state.isSelective = true;
}

// Handles a change to an individual message checkbox
function handleMessageCheckbox(index, checked) {
  if (checked) {
    state.selectedIndices.add(index);
  } else {
    state.selectedIndices.delete(index);
  }
  updateSelectAllState();
  updateSelectedCount();
  updateExportButton(true);
}

// Handles the select-all master checkbox change
function handleSelectAll() {
  if (selectAllEl.checked) {
    // Restoring to all-selected — not a selective action
    state.messages.forEach(m => state.selectedIndices.add(m.index));
  } else {
    // Deselecting all — same semantics as the Deselect All button
    markSelective();
    state.selectedIndices.clear();
  }
  syncCheckboxVisuals();
  updateSelectAllState();
  updateSelectedCount();
  updateExportButton(true);
}

// Applies the AI-responses-only filter (hides user messages from selection)
function applyAiOnlyFilter() {
  if (aiOnlyToggle.checked) {
    state.selectedIndices.clear();
    state.messages.forEach(m => {
      if (m.role === 'assistant') state.selectedIndices.add(m.index);
    });
  } else {
    // Restore all selections when toggled off
    state.messages.forEach(m => state.selectedIndices.add(m.index));
  }
  syncCheckboxVisuals();
  updateSelectAllState();
  updateSelectedCount();
  updateExportButton(true);
}

// Selects only the last N messages (by position in the conversation)
function applyLastN(n) {
  state.selectedIndices.clear();
  const slice = state.messages.slice(-n);
  slice.forEach(m => state.selectedIndices.add(m.index));
  syncCheckboxVisuals();
  updateSelectAllState();
  updateSelectedCount();
  updateExportButton(true);
}

// Deselects every message
function deselectAll() {
  state.selectedIndices.clear();
  syncCheckboxVisuals();
  updateSelectAllState();
  updateSelectedCount();
  updateExportButton(true);
}

// Updates the native checkbox elements in the DOM to match selectedIndices.
// Called after bulk selection changes (Last N, AI only, Deselect All).
function syncCheckboxVisuals() {
  messageList.querySelectorAll('.checkbox-input').forEach(cb => {
    const row = cb.closest('[data-index]');
    if (!row) return;
    cb.checked = state.selectedIndices.has(Number(row.dataset.index));
  });
}

// Sets the select-all checkbox to checked / indeterminate / unchecked
// based on how many messages are currently selected
function updateSelectAllState() {
  const total    = state.messages.length;
  const selected = state.selectedIndices.size;

  if (selected === 0) {
    selectAllEl.checked       = false;
    selectAllEl.indeterminate = false;
  } else if (selected === total) {
    selectAllEl.checked       = true;
    selectAllEl.indeterminate = false;
  } else {
    selectAllEl.checked       = false;
    selectAllEl.indeterminate = true;
  }
}

// Updates the "N selected" count label next to the list header
function updateSelectedCount() {
  const n = state.selectedIndices.size;
  selectedCount.textContent = n > 0 ? `${n} selected` : 'None selected';
}

// ---------------------------------------------------------------------------
// Format selection
// ---------------------------------------------------------------------------

// Updates the active format and refreshes the export button label
function setFormat(format) {
  state.format = format;

  formatTabs.querySelectorAll('.format-tab').forEach(tab => {
    const isActive = tab.dataset.format === format;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  });

  updateExportButton(true);
}

// ---------------------------------------------------------------------------
// Export button label
// ---------------------------------------------------------------------------

// Updates the export button text to reflect current selection and format.
// If animate is true, briefly dims the button before updating — prevents
// the text from feeling instant and jarring on rapid changes.
function updateExportButton(animate) {
  const count       = state.selectedIndices.size;
  const formatLabel = FORMAT_LABELS[state.format] || state.format;
  const newText     = count === 0
    ? 'Nothing selected to export'
    : `Export ${count} message${count === 1 ? '' : 's'} to ${formatLabel}`;

  exportBtn.disabled = count === 0;

  if (exportBtn.textContent === newText) return;

  if (animate && count > 0) {
    exportBtn.style.opacity = '0.55';
    requestAnimationFrame(() => {
      exportBtn.textContent  = newText;
      exportBtn.style.opacity = '';
    });
  } else {
    exportBtn.textContent = newText;
  }
}

// Gate logic lives in utils/gate.js → checkSelectiveGate(), getRemainingSelectiveExports()
// Date helpers live in utils/date-utils.js → getTodayString(), isNewDay()

// ---------------------------------------------------------------------------
// Export execution
// ---------------------------------------------------------------------------

// Main export handler — checks the gate, then dispatches to the right exporter
async function handleExport() {
  if (state.selectedIndices.size === 0) return;

  // Premium format gate — DOCX and Notion require a license
  if (!state.isPremium && PREMIUM_FORMATS.has(state.format)) {
    showUpgradeModal();
    return;
  }

  // Notion pre-flight — if token or target page is missing, open settings
  if (state.format === 'notion') {
    const ns = await storageGet(['notionAccessToken', 'notionPageId']);
    if (!ns.notionAccessToken || !ns.notionPageId) {
      chrome.runtime.openOptionsPage();
      return;
    }
  }

  // Gate check only applies to selective exports
  if (state.isSelective) {
    const gate = await checkSelectiveGate();
    if (!gate.allowed) {
      showUpgradeModal();
      return;
    }
  }

  // Build data payload
  const selectedMessages = state.messages.filter(
    m => state.selectedIndices.has(m.index)
  );
  const data = {
    messages:     selectedMessages,
    title:        state.title,
    platform:     state.platform,
    exportedAt:   new Date().toISOString(),
    messageCount: selectedMessages.length
  };
  const options = {
    isPremium: state.isPremium,
    filename:  getCustomFilename(),
    meta:      buildMetaObject(state.platform)
  };

  // Visual: set button to exporting state
  exportBtn.disabled      = true;
  exportBtn.textContent   = 'Exporting…';
  exportBtn.style.opacity = '0.7';

  let exportResult;
  try {
    exportResult = await dispatchExport(data, options);
  } catch (err) {
    console.error('[Grabit] Export error:', err);
    exportBtn.style.opacity = '';
    exportBtn.textContent   = 'Export failed — try again';
    exportBtn.disabled      = false;
    return;
  }

  // Notion: open the created page in a new tab
  if (state.format === 'notion' && exportResult && exportResult.pageUrl) {
    window.open(exportResult.pageUrl, '_blank', 'noopener,noreferrer');
  }

  // Visual: success state, then reset after 1.5s
  exportBtn.textContent  = 'Done ✓';
  exportBtn.style.opacity = '1';
  setTimeout(() => {
    exportBtn.disabled      = false;
    exportBtn.style.opacity = '';
    updateExportButton(false);
  }, 1500);

  await handlePostExport();
}

// Routes the export data to the correct format exporter.
// Returns the exporter's result (only Notion returns a meaningful value).
async function dispatchExport(data, options) {
  switch (state.format) {
    case 'markdown': exportToMarkdown(data, options);                    break;
    case 'txt':      exportToPlainText(data, options);                   break;
    case 'json':     exportToJSON(data, options);                        break;
    case 'csv':      exportToCSV(data, options);                         break;
    case 'html':     exportToHTML(data, options);                        break;
    case 'pdf':      exportToPDF(data, options);                         break;
    case 'docx':     exportToDOCX(data, options);                        break;
    case 'notion':   return await notionExportConversation(data, options);
    default:
      throw new Error(`Unknown format: ${state.format}`);
  }
}

// Runs after a successful export: increments the total count and checks milestones
async function handlePostExport() {
  const storage  = await storageGet(['total_export_count']);
  const newCount = (storage.total_export_count || 0) + 1;
  await storageSet({ total_export_count: newCount });
  await checkReviewAsk(newCount);
}

// ---------------------------------------------------------------------------
// Pin nudge
// ---------------------------------------------------------------------------

// Checks storage and shows the pin nudge if it has never been dismissed
async function initPinNudge() {
  const storage = await storageGet(['pin_nudge_dismissed']);
  if (storage.pin_nudge_dismissed) return;

  pinNudge.classList.remove('hidden');

  pinNudgeDismiss.addEventListener('click', async () => {
    pinNudge.classList.add('dismissing');
    await storageSet({ pin_nudge_dismissed: true });
    setTimeout(() => pinNudge.classList.add('hidden'), 320);
  }, { once: true });
}

// ---------------------------------------------------------------------------
// Upgrade modal
// ---------------------------------------------------------------------------

// Shows the upgrade modal with an entrance animation
function showUpgradeModal() {
  capMessage.classList.add('hidden');
  upgradeModal.classList.remove('hidden');
}

// Hides the upgrade modal
function hideUpgradeModal() {
  upgradeModal.classList.add('hidden');
}

// Shows the inline cap message below the export button
function showCapMessage() {
  capMessage.classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Review ask bar
// ---------------------------------------------------------------------------

// Checks if the current export count matches a milestone and shows the bar if so.
// Advances the milestone index so the same milestone doesn't trigger again.
async function checkReviewAsk(totalCount) {
  const storage = await storageGet(['review_ask_shown', 'review_milestone_index']);

  // Permanently stopped once the user has clicked the bar
  if (storage.review_ask_shown) return;

  const idx = storage.review_milestone_index || 0;

  // All milestones exhausted
  if (idx >= REVIEW_MILESTONES.length) return;

  const milestone = REVIEW_MILESTONES[idx];
  if (totalCount !== milestone) return;

  // Advance to next milestone before showing so this milestone never re-triggers
  await storageSet({ review_milestone_index: idx + 1 });

  showReviewBar(milestone);
}

// Makes the review bar visible with its milestone-specific text
function showReviewBar(milestone) {
  reviewBarText.textContent =
    `You've exported ${milestone} conversations — enjoying it? ⭐ Leave a quick review`;
  reviewBar.setAttribute('aria-hidden', 'false');
  reviewBar.classList.add('visible');
  document.body.classList.add('has-review-bar');
}

// Handles a click on the review bar: opens the review URL and permanently
// stops the bar from ever appearing again
async function handleReviewBarClick() {
  await storageSet({ review_ask_shown: true });
  window.open(CHROME_STORE_REVIEW_URL, '_blank', 'noopener,noreferrer');
  reviewBar.classList.remove('visible');
  reviewBar.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('has-review-bar');
}

// ---------------------------------------------------------------------------
// Merge queue
// ---------------------------------------------------------------------------

// Loads the queue from storage and syncs the header merge button visibility.
async function initMergeQueue() {
  state.mergeQueue = await getQueue();
  updateMergeModeBtn();
}

// Updates the header "Merge (N)" button — shown only when premium + 2+ items.
function updateMergeModeBtn() {
  const n = state.mergeQueue.length;
  if (n >= 2 && state.isPremium) {
    mergeModBtn.classList.remove('hidden');
    mergeCountBadge.textContent = String(n);
  } else {
    mergeModBtn.classList.add('hidden');
  }
  // Keep the queue button label in sync
  queueBtn.textContent = n > 0
    ? `Add to merge queue (${n})`
    : 'Add to merge queue';
}

// Handles the "Add to merge queue" button click.
// Free users see the upgrade modal; premium users queue the current conversation.
async function handleAddToQueue() {
  if (!state.isPremium) {
    showUpgradeModal();
    return;
  }

  const selectedMessages = state.messages.filter(m => state.selectedIndices.has(m.index));
  const result = await addToQueue({
    title:    state.title,
    platform: state.platform,
    messages: selectedMessages,
  });

  if (result.success) {
    state.mergeQueue = await getQueue();
    updateMergeModeBtn();
    queueBtn.textContent = `Added! Queue: ${result.count}`;
    setTimeout(updateMergeModeBtn, 1500);
  } else if (result.reason === 'full') {
    queueBtn.textContent = 'Queue full (max 10)';
    setTimeout(updateMergeModeBtn, 2000);
  } else if (result.reason === 'duplicate') {
    queueBtn.textContent = 'Already in queue';
    setTimeout(updateMergeModeBtn, 2000);
  }
}

// Switches the popup into merge mode: hides main UI, shows merge UI.
function enterMergeMode() {
  Object.values(statePanels).forEach(el => el.classList.add('hidden'));
  mainUi.classList.add('hidden');
  mergeUi.classList.remove('hidden');
  mergePostMsg.classList.add('hidden');
  renderMergeQueue();
  updateMergeExportBtn();
}

// Returns from merge mode to the main UI (or re-scrapes if no messages loaded).
function exitMergeMode() {
  mergeUi.classList.add('hidden');
  mergePostMsg.classList.add('hidden');
  if (state.messages.length > 0) {
    showMainUi();
  } else {
    detectAndScrape();
  }
}

// Renders all queue items into the merge item list with drag-to-reorder.
function renderMergeQueue() {
  mergeItemList.innerHTML = '';
  state.mergeQueue.forEach(item => {
    mergeItemList.appendChild(createMergeItem(item));
  });
}

// Builds a draggable list-item element for a single queue entry.
// Returns an Element
function createMergeItem(item) {
  const div = document.createElement('div');
  div.className = 'merge-item';
  div.dataset.id = item.id;
  div.draggable  = true;
  div.setAttribute('role', 'listitem');

  const handle = document.createElement('span');
  handle.className = 'merge-item-handle';
  handle.setAttribute('aria-hidden', 'true');
  handle.textContent = '⠿';

  const badge = document.createElement('span');
  badge.className   = 'merge-item-badge';
  badge.textContent = getPlatformLabel(item.platform);

  const title = document.createElement('span');
  title.className   = 'merge-item-title';
  title.textContent = item.title || 'Conversation';

  const removeBtn = document.createElement('button');
  removeBtn.className = 'merge-item-remove';
  removeBtn.setAttribute('aria-label', `Remove ${item.title || 'conversation'} from queue`);
  removeBtn.textContent = '×';
  removeBtn.addEventListener('click', async () => {
    await removeFromQueue(item.id);
    state.mergeQueue = await getQueue();
    updateMergeModeBtn();
    renderMergeQueue();
    updateMergeExportBtn();
    if (state.mergeQueue.length === 0) exitMergeMode();
  });

  // Drag-and-drop reordering
  div.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', item.id);
    div.classList.add('merge-item--dragging');
  });
  div.addEventListener('dragend', () => div.classList.remove('merge-item--dragging'));
  div.addEventListener('dragover', e => {
    e.preventDefault();
    div.classList.add('merge-item--dragover');
  });
  div.addEventListener('dragleave', () => div.classList.remove('merge-item--dragover'));
  div.addEventListener('drop', async e => {
    e.preventDefault();
    div.classList.remove('merge-item--dragover');
    const fromId = e.dataTransfer.getData('text/plain');
    if (fromId === item.id) return;

    const fromIdx = state.mergeQueue.findIndex(x => x.id === fromId);
    const toIdx   = state.mergeQueue.findIndex(x => x.id === item.id);
    if (fromIdx === -1 || toIdx === -1) return;

    const newQueue = [...state.mergeQueue];
    const [moved]  = newQueue.splice(fromIdx, 1);
    newQueue.splice(toIdx, 0, moved);
    state.mergeQueue = newQueue;
    await reorderQueue(newQueue);
    renderMergeQueue();
  });

  div.appendChild(handle);
  div.appendChild(badge);
  div.appendChild(title);
  div.appendChild(removeBtn);
  return div;
}

// Updates the merge export button label to reflect current queue size + format.
function updateMergeExportBtn() {
  const n           = state.mergeQueue.length;
  const formatLabel = FORMAT_LABELS[state.mergeFormat] || state.mergeFormat;
  mergeExportBtn.disabled     = n < 2;
  mergeExportBtn.style.opacity = '';
  mergeExportBtn.textContent  = n < 2
    ? 'Add at least 2 conversations to merge'
    : `Merge ${n} conversations to ${formatLabel}`;
}

// Changes the active format tab in the merge UI.
function setMergeFormat(format) {
  state.mergeFormat = format;

  mergeFormatTabs.querySelectorAll('.format-tab').forEach(tab => {
    const isActive = tab.dataset.format === format;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  });

  updateMergeExportBtn();
}

// Runs the merge export — assembles a merged data object and dispatches to the right exporter.
async function handleMergeExport() {
  if (state.mergeQueue.length < 2) return;

  const format = state.mergeFormat;

  // Notion still needs a pre-flight check even in merge mode
  if (format === 'notion') {
    const ns = await storageGet(['notionAccessToken', 'notionPageId']);
    if (!ns.notionAccessToken || !ns.notionPageId) {
      chrome.runtime.openOptionsPage();
      return;
    }
  }

  mergeExportBtn.disabled      = true;
  mergeExportBtn.textContent   = 'Merging…';
  mergeExportBtn.style.opacity = '0.7';
  mergePostMsg.classList.add('hidden');

  const mergeData = {
    isMerge:       true,
    conversations: state.mergeQueue.map(item => ({
      title:    item.title,
      platform: item.platform,
      messages: item.messages,
    })),
    exportedAt: new Date().toISOString(),
  };

  const mergeOptions = {
    isPremium: true,
    filename:  getCustomFilename(),
    meta:      buildMetaObject('merge')
  };

  let exportResult;
  try {
    exportResult = await _dispatchMergeExport(mergeData, mergeOptions, format);
  } catch (err) {
    console.error('[Grabit] Merge export error:', err);
    mergeExportBtn.textContent   = 'Export failed — try again';
    mergeExportBtn.style.opacity = '';
    mergeExportBtn.disabled      = false;
    return;
  }

  // Notion: open created page
  if (format === 'notion' && exportResult && exportResult.pageUrl) {
    window.open(exportResult.pageUrl, '_blank', 'noopener,noreferrer');
  }

  mergeExportBtn.textContent   = 'Done ✓';
  mergeExportBtn.style.opacity = '1';
  mergePostMsg.classList.remove('hidden');

  await handlePostExport();
}

// Routes merged data to the correct exporter.
// Returns the exporter's result (only Notion returns a meaningful value).
async function _dispatchMergeExport(data, options, format) {
  switch (format) {
    case 'markdown': exportToMarkdown(data, options);                   break;
    case 'txt':      exportToPlainText(data, options);                  break;
    case 'json':     exportToJSON(data, options);                       break;
    case 'csv':      exportToCSV(data, options);                        break;
    case 'html':     exportToHTML(data, options);                       break;
    case 'pdf':      exportToPDF(data, options);                        break;
    case 'docx':     exportToDOCX(data, options);                       break;
    case 'notion':   return await notionExportConversation(data, options);
    default: throw new Error(`Unknown format: ${format}`);
  }
}

// ---------------------------------------------------------------------------
// Filename & metadata helpers (Step 10)
// ---------------------------------------------------------------------------

// Wires a collapsible section's toggle button to show/hide its body.
// Toggles aria-expanded and the chevron character.
function wireCollapsible(header, body) {
  const toggle = () => {
    const isOpen   = header.getAttribute('aria-expanded') === 'true';
    const chevron  = header.querySelector('.collapsible-chevron');
    header.setAttribute('aria-expanded', String(!isOpen));
    body.classList.toggle('hidden', isOpen);
    // ▸ = U+25B8 collapsed, ▾ = U+25BE expanded
    if (chevron) chevron.textContent = isOpen ? '▸' : '▾';
  };
  header.addEventListener('click', toggle);
  header.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  });
}

// Applies locked (free) or active (premium) state to all filename + metadata fields.
// Free users: inputs disabled, lock icon shown, wrapper cursor is not-allowed.
function applyMetaPremiumState() {
  const locked = !state.isPremium;
  _applyFieldLock(filenameFieldWrap, customFilenameEl, locked);
  _applyFieldLock(metaAuthorWrap,    metaAuthorEl,    locked);
  _applyFieldLock(metaTagsWrap,      metaTagsEl,      locked);
  _applyFieldLock(metaNotesWrap,     metaNotesEl,     locked);
}

// Locks or unlocks a single meta input wrapper.
function _applyFieldLock(wrap, input, locked) {
  wrap.classList.toggle('meta-field-wrap--locked', locked);
  input.disabled = locked;
}

// Strips characters that are invalid in file names from a user string.
// Returns a safe filename string (no extension, max 150 chars)
function stripInvalidFilenameChars(str) {
  return (str || '')
    .replace(/[/\\:*?"<>|]/g, '')
    .trim()
    .slice(0, 150);
}

// Returns the custom filename to pass to exporters, or null to use the auto-generated name.
// Returns string | null
function getCustomFilename() {
  if (!state.isPremium) return null;
  const val = stripInvalidFilenameChars(customFilenameEl.value.trim());
  return val || null;
}

// Builds the metadata object passed to exporters.
// Only author/tags/notes fields that are non-empty are included.
// exported and platform are always set.
// Returns { author?, tags?, notes?, exported, platform }
function buildMetaObject(platform) {
  const meta = {
    exported: new Date().toLocaleString(),
    platform: platform || ''
  };
  if (!state.isPremium) return meta;

  const author = metaAuthorEl.value.trim();
  const tags   = metaTagsEl.value.trim();
  const notes  = metaNotesEl.value.trim();
  if (author) meta.author = author;
  if (tags)   meta.tags   = tags;
  if (notes)  meta.notes  = notes;
  return meta;
}
