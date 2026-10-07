// =============================================================
// settings/settings.js
// Logic for the Grabit settings page.
// Reads license state on load and renders the appropriate UI.
// Handles license activation, deactivation, and plan card links.
//
// Depends on (loaded before this file):
//   utils/storage.js    — storageGet / storageSet
//   licensing/license.js — activateLicense / deactivateLicense /
//                          getLicenseStatus / validateLicense /
//                          getCheckoutUrl / getTierLabel
// =============================================================

'use strict';

// ---------------------------------------------------------------------------
// DOM references — license
// ---------------------------------------------------------------------------

const statusDot       = document.getElementById('status-dot');
const statusText      = document.getElementById('status-text');
const licenseInputArea = document.getElementById('license-input-area');
const keyInput        = document.getElementById('license-key-input');
const activateBtn     = document.getElementById('activate-btn');
const feedback        = document.getElementById('license-feedback');
const manageArea      = document.getElementById('manage-area');
const removeLicenseBtn = document.getElementById('remove-license-btn');
const plansSection    = document.getElementById('plans-section');
const monthlyLink     = document.getElementById('monthly-link');
const yearlyLink      = document.getElementById('yearly-link');
const extVersion      = document.getElementById('ext-version');

// ---------------------------------------------------------------------------
// DOM references — Notion
// ---------------------------------------------------------------------------

const notionStatusDot    = document.getElementById('notion-status-dot');
const notionStatusText   = document.getElementById('notion-status-text');
const notionConnectArea  = document.getElementById('notion-connect-area');
const notionManageArea   = document.getElementById('notion-manage-area');
const notionConnectBtn   = document.getElementById('notion-connect-btn');
const notionWorkspaceName = document.getElementById('notion-workspace-name');
const notionPageInput    = document.getElementById('notion-page-input');
const notionPageSaveBtn  = document.getElementById('notion-page-save-btn');
const notionPageFeedback = document.getElementById('notion-page-feedback');
const notionDisconnectBtn = document.getElementById('notion-disconnect-btn');

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

// Entry point — runs when the settings page DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
  loadVersion();
  setCheckoutLinks();
  wireListeners();
  wireNotionListeners();
  await renderLicenseState();
  await renderNotionState();
});

// Reads the extension version from the manifest and displays it
function loadVersion() {
  try {
    const manifest = chrome.runtime.getManifest();
    extVersion.textContent = `v${manifest.version}`;
  } catch {
    extVersion.textContent = '—';
  }
}

// Applies the correct checkout URLs to the plan card buttons
function setCheckoutLinks() {
  monthlyLink.href = getCheckoutUrl('monthly');
  yearlyLink.href  = getCheckoutUrl('yearly');
}

// Wires all interactive element listeners
function wireListeners() {
  // Enable the activate button only when the input has content
  keyInput.addEventListener('input', () => {
    // Auto-uppercase and strip non-licence characters as the user types
    const cleaned = keyInput.value.replace(/[^A-Za-z0-9-]/g, '').toUpperCase();
    if (cleaned !== keyInput.value) keyInput.value = cleaned;
    activateBtn.disabled = cleaned.trim().length === 0;
    clearFeedback();
  });

  // Enter key in the input field triggers activation
  keyInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !activateBtn.disabled) handleActivate();
  });

  activateBtn.addEventListener('click', handleActivate);
  removeLicenseBtn.addEventListener('click', handleRemoveLicense);
}

// ---------------------------------------------------------------------------
// License state rendering
// ---------------------------------------------------------------------------

// Reads the stored license status and updates all UI sections to match.
// Also triggers a background re-validation so the status stays fresh.
async function renderLicenseState() {
  const status = await getLicenseStatus();
  applyStatusUI(status);

  // Re-validate in the background if a key is stored — keeps state fresh
  // without blocking the initial page render
  if (status.hasKey) {
    validateLicense().then(result => {
      // Only re-render if the validity changed to avoid unnecessary flicker
      if (result.valid !== status.isPremium) {
        applyStatusUI({
          isPremium: result.valid,
          hasKey:    status.hasKey,
          key:       status.key,
          status:    result.status,
          tier:      result.tier
        });
      }
    }).catch(() => { /* offline — ignore */ });
  }
}

// Updates every UI element to reflect the given license status object
function applyStatusUI(status) {
  // --- Status dot + label ---
  const dotClasses = statusDot.className.split(' ')
    .filter(c => !c.startsWith('status-dot--'));

  if (status.isPremium) {
    const tierLabel = getTierLabel(status.tier);
    statusDot.className  = [...dotClasses, 'status-dot--active'].join(' ');
    statusText.textContent = `Active — ${tierLabel}`;
  } else if (status.status === 'expired') {
    statusDot.className  = [...dotClasses, 'status-dot--expired'].join(' ');
    statusText.textContent = 'Expired — renew to restore access';
  } else if (status.status === 'disabled') {
    statusDot.className  = [...dotClasses, 'status-dot--disabled'].join(' ');
    statusText.textContent = 'Disabled — contact support';
  } else {
    statusDot.className  = [...dotClasses, 'status-dot--free'].join(' ');
    statusText.textContent = 'Free plan';
  }

  // --- Input vs manage area ---
  if (status.isPremium) {
    licenseInputArea.classList.add('hidden');
    manageArea.classList.remove('hidden');
    plansSection.classList.add('hidden');
  } else {
    licenseInputArea.classList.remove('hidden');
    manageArea.classList.add('hidden');
    plansSection.classList.remove('hidden');
    // Pre-fill input if a key is stored (e.g. expired key so user can see it)
    if (status.key && !keyInput.value) {
      keyInput.value = status.key;
      activateBtn.disabled = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Activate handler
// ---------------------------------------------------------------------------

// Handles the "Activate" button click — calls the LemonSqueezy API
// and updates the UI based on the result
async function handleActivate() {
  const key = keyInput.value.trim();
  if (!key) return;

  setActivatingState(true);
  clearFeedback();

  const result = await activateLicense(key);

  setActivatingState(false);

  if (result.success) {
    showFeedback(`License activated — you're on the ${getTierLabel(result.tier)} plan.`, 'success');
    keyInput.classList.add('input--success');
    // Delay rendering the premium state so the success message is briefly visible
    setTimeout(() => {
      applyStatusUI({
        isPremium: true,
        hasKey:    true,
        key,
        status:    result.status,
        tier:      result.tier
      });
    }, 800);
  } else {
    showFeedback(result.error || 'Activation failed. Please try again.', 'error');
    keyInput.classList.add('input--error');
  }
}

// Puts the activate button into / out of a loading state
function setActivatingState(isLoading) {
  activateBtn.disabled     = isLoading;
  activateBtn.textContent  = isLoading ? 'Activating…' : 'Activate';
}

// ---------------------------------------------------------------------------
// Remove license handler
// ---------------------------------------------------------------------------

// Handles the "Remove license from this device" button click
async function handleRemoveLicense() {
  // Simple inline confirmation — no modal, just guard against mis-clicks
  const confirmed = window.confirm(
    'Remove your license from this device?\n\n' +
    'You can re-enter it at any time to restore premium access.'
  );
  if (!confirmed) return;

  removeLicenseBtn.disabled    = true;
  removeLicenseBtn.textContent = 'Removing…';

  await deactivateLicense();

  removeLicenseBtn.disabled    = false;
  removeLicenseBtn.textContent = 'Remove license from this device';

  keyInput.value               = '';
  keyInput.classList.remove('input--success', 'input--error');
  activateBtn.disabled         = true;

  applyStatusUI({
    isPremium: false,
    hasKey:    false,
    key:       null,
    status:    'free',
    tier:      null
  });
}

// ---------------------------------------------------------------------------
// Feedback helpers
// ---------------------------------------------------------------------------

// Displays a feedback message below the license key input
function showFeedback(message, type) {
  feedback.textContent = message;
  feedback.className   = `feedback-text feedback-text--${type}`;
  feedback.classList.remove('hidden');
}

// Clears the feedback message and resets input border state
function clearFeedback() {
  feedback.classList.add('hidden');
  feedback.textContent = '';
  keyInput.classList.remove('input--error', 'input--success');
}

// ---------------------------------------------------------------------------
// Notion section
// ---------------------------------------------------------------------------

function wireNotionListeners() {
  notionConnectBtn.addEventListener('click', handleNotionConnect);
  notionDisconnectBtn.addEventListener('click', handleNotionDisconnect);

  notionPageInput.addEventListener('input', () => {
    notionPageSaveBtn.disabled = notionPageInput.value.trim().length === 0;
    notionPageFeedback.classList.add('hidden');
    notionPageInput.classList.remove('input--error', 'input--success');
  });

  notionPageSaveBtn.addEventListener('click', handleNotionSavePage);

  notionPageInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !notionPageSaveBtn.disabled) handleNotionSavePage();
  });
}

async function renderNotionState() {
  const status = await getNotionStatus();

  // Status dot + text
  const dotBase = notionStatusDot.className.split(' ').filter(c => !c.startsWith('status-dot--'));
  if (status.connected && status.pageId) {
    notionStatusDot.className = [...dotBase, 'status-dot--active'].join(' ');
    notionStatusText.textContent = 'Connected' + (status.workspaceName ? ' — ' + status.workspaceName : '');
  } else if (status.connected) {
    notionStatusDot.className = [...dotBase, 'status-dot--disabled'].join(' ');
    notionStatusText.textContent = 'Connected — choose a target page below';
  } else {
    notionStatusDot.className = [...dotBase, 'status-dot--free'].join(' ');
    notionStatusText.textContent = 'Not connected';
  }

  // Show correct area
  if (status.connected) {
    notionConnectArea.classList.add('hidden');
    notionManageArea.classList.remove('hidden');
    notionWorkspaceName.textContent = status.workspaceName || 'your workspace';

    // Pre-fill page input if a page is already saved
    if (status.pageTitle && !notionPageInput.value) {
      notionPageInput.value       = status.pageTitle;
      notionPageSaveBtn.disabled  = false;
      notionPageFeedback.textContent = 'Current target: ' + status.pageTitle;
      notionPageFeedback.className   = 'feedback-text feedback-text--success';
      notionPageFeedback.classList.remove('hidden');
    }
  } else {
    notionConnectArea.classList.remove('hidden');
    notionManageArea.classList.add('hidden');
  }
}

async function handleNotionConnect() {
  notionConnectBtn.disabled    = true;
  notionConnectBtn.textContent = 'Connecting…';

  try {
    const result = await notionConnect();
    await renderNotionState();
    if (result.workspaceName) {
      // Brief success nudge
      notionStatusText.textContent = 'Connected — ' + result.workspaceName;
    }
  } catch (err) {
    notionConnectBtn.disabled    = false;
    notionConnectBtn.textContent = 'Connect Notion';
    // Show error inline below the button
    notionStatusText.textContent = 'Connection failed — ' + (err.message || 'please try again.');
    const dotBase = notionStatusDot.className.split(' ').filter(c => !c.startsWith('status-dot--'));
    notionStatusDot.className = [...dotBase, 'status-dot--error'].join(' ');
  }
}

async function handleNotionDisconnect() {
  const confirmed = window.confirm(
    'Disconnect Notion?\n\nYou can reconnect at any time.'
  );
  if (!confirmed) return;

  notionDisconnectBtn.disabled    = true;
  notionDisconnectBtn.textContent = 'Disconnecting…';

  await notionDisconnect();

  notionPageInput.value = '';
  notionPageFeedback.classList.add('hidden');
  notionPageInput.classList.remove('input--error', 'input--success');

  notionDisconnectBtn.disabled    = false;
  notionDisconnectBtn.textContent = 'Disconnect Notion';

  await renderNotionState();
}

async function handleNotionSavePage() {
  const input = notionPageInput.value.trim();
  if (!input) return;

  notionPageSaveBtn.disabled    = true;
  notionPageSaveBtn.textContent = 'Saving…';
  notionPageFeedback.classList.add('hidden');
  notionPageInput.classList.remove('input--error', 'input--success');

  const result = await notionSavePage(input);

  notionPageSaveBtn.disabled    = false;
  notionPageSaveBtn.textContent = 'Save';

  if (result.success) {
    notionPageFeedback.textContent = 'Target page set: ' + result.title;
    notionPageFeedback.className   = 'feedback-text feedback-text--success';
    notionPageFeedback.classList.remove('hidden');
    notionPageInput.classList.add('input--success');
    await renderNotionState();
  } else {
    notionPageFeedback.textContent = result.error || 'Could not save page.';
    notionPageFeedback.className   = 'feedback-text feedback-text--error';
    notionPageFeedback.classList.remove('hidden');
    notionPageInput.classList.add('input--error');
  }
}
