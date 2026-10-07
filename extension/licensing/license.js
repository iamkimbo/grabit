// =============================================================
// licensing/license.js
// LemonSqueezy license key validation, activation, and deactivation.
// All API calls go directly from the settings page to LemonSqueezy —
// no backend server is required. The license key itself authenticates
// every request against the License API.
//
// Storage keys written by this module:
//   isPremium        — boolean
//   licenseKey       — string | null
//   licenseInstanceId — string | null  (UUID from activation)
//   licenseStatus    — 'active' | 'inactive' | 'expired' | 'disabled' | 'free'
//   licenseTier      — 'monthly' | 'yearly' | 'unknown' | null
//   licenseVariantId — number | null
//
// Depends on: utils/storage.js (storageGet / storageSet)
// =============================================================

'use strict';

// ---------------------------------------------------------------------------
// LemonSqueezy configuration — replace ALL values before publishing
// ---------------------------------------------------------------------------

// ===== LEMONSQUEEZY CONFIG =====
// Replace this value before publishing:
// [Your LemonSqueezy store API key — for admin operations if ever needed]
const LS_API_KEY = 'YOUR_API_KEY_HERE';
// ================================

// ===== LEMONSQUEEZY CONFIG =====
// Replace this value before publishing:
// [Your LemonSqueezy Store ID — found in your dashboard under Store settings]
const LS_STORE_ID = 'YOUR_STORE_ID_HERE';
// ================================

// ===== LEMONSQUEEZY CONFIG =====
// Replace this value before publishing:
// [Your LemonSqueezy Product ID for Grabit]
const LS_PRODUCT_ID = 'YOUR_PRODUCT_ID_HERE';
// ================================

// ===== LEMONSQUEEZY CONFIG =====
// Replace this value before publishing:
// [Variant ID for the Monthly plan ($3/month) — found in your product's variants]
const LS_VARIANT_MONTHLY = 'YOUR_MONTHLY_VARIANT_ID';
// ================================

// ===== LEMONSQUEEZY CONFIG =====
// Replace this value before publishing:
// [Variant ID for the Yearly plan ($25/year) — found in your product's variants]
const LS_VARIANT_YEARLY = 'YOUR_YEARLY_VARIANT_ID';
// ================================

// ===== LEMONSQUEEZY CONFIG =====
// Replace this value before publishing:
// [LemonSqueezy checkout URL for the Monthly plan]
const LS_MONTHLY_CHECKOUT_URL = 'LEMONSQUEEZY_MONTHLY_CHECKOUT_URL';
// ================================

// ===== LEMONSQUEEZY CONFIG =====
// Replace this value before publishing:
// [LemonSqueezy checkout URL for the Yearly plan]
const LS_YEARLY_CHECKOUT_URL = 'LEMONSQUEEZY_YEARLY_CHECKOUT_URL';
// ================================

// ===== LEMONSQUEEZY CONFIG =====
// Replace this value before publishing:
// [LemonSqueezy License API — activate endpoint]
const LS_ACTIVATE_URL = 'https://api.lemonsqueezy.com/v1/licenses/activate';
// ================================

// ===== LEMONSQUEEZY CONFIG =====
// Replace this value before publishing:
// [LemonSqueezy License API — validate endpoint]
const LS_VALIDATE_URL = 'https://api.lemonsqueezy.com/v1/licenses/validate';
// ================================

// ===== LEMONSQUEEZY CONFIG =====
// Replace this value before publishing:
// [LemonSqueezy License API — deactivate endpoint]
const LS_DEACTIVATE_URL = 'https://api.lemonsqueezy.com/v1/licenses/deactivate';
// ================================

// ---------------------------------------------------------------------------
// Internal API helper
// ---------------------------------------------------------------------------

// Posts form-encoded parameters to a LemonSqueezy License API endpoint.
// LemonSqueezy returns HTTP 400 for invalid keys (still JSON), so we parse
// all responses regardless of status.
// Returns Promise<object> — the parsed JSON response body
async function callLicenseAPI(url, params) {
  const response = await fetch(url, {
    method:  'POST',
    headers: { 'Accept': 'application/json' },
    body:    new URLSearchParams(params)
  });

  // Parse body even on 4xx — LemonSqueezy puts error details in the JSON
  const data = await response.json();

  // Surface hard server errors (5xx) that have no useful JSON body
  if (!response.ok && response.status >= 500) {
    throw new Error(`License server error: HTTP ${response.status}`);
  }

  return data;
}

// ---------------------------------------------------------------------------
// Tier mapping
// ---------------------------------------------------------------------------

// Maps a LemonSqueezy variant ID to a human-readable tier name.
// Returns 'monthly' | 'yearly' | 'unknown'
function getLicenseTier(variantId) {
  if (!variantId) return 'unknown';
  if (String(variantId) === String(LS_VARIANT_MONTHLY)) return 'monthly';
  if (String(variantId) === String(LS_VARIANT_YEARLY))  return 'yearly';
  return 'unknown';
}

// Returns the display name for a tier string.
// Returns 'Monthly' | 'Yearly' | 'Premium'
function getTierLabel(tier) {
  if (tier === 'monthly') return 'Monthly';
  if (tier === 'yearly')  return 'Yearly';
  return 'Premium';
}

// ---------------------------------------------------------------------------
// Checkout URLs (read by settings.js)
// ---------------------------------------------------------------------------

// Returns the checkout URL for the specified tier key.
// tier: 'monthly' | 'yearly'
// Returns string
function getCheckoutUrl(tier) {
  return tier === 'yearly' ? LS_YEARLY_CHECKOUT_URL : LS_MONTHLY_CHECKOUT_URL;
}

// ---------------------------------------------------------------------------
// Status query
// ---------------------------------------------------------------------------

// Reads the current license state from storage without making any API call.
// Returns Promise<{ isPremium, hasKey, key, status, tier }>
async function getLicenseStatus() {
  const s = await storageGet([
    'isPremium', 'licenseKey', 'licenseInstanceId',
    'licenseStatus', 'licenseTier'
  ]);
  return {
    isPremium: Boolean(s.isPremium),
    hasKey:    Boolean(s.licenseKey),
    key:       s.licenseKey       || null,
    instanceId: s.licenseInstanceId || null,
    status:    s.licenseStatus    || 'free',
    tier:      s.licenseTier      || null
  };
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

// Activates a license key with LemonSqueezy and, on success, writes
// premium state to chrome.storage.local.
// key: raw string from the input field (trimmed and uppercased internally)
// Returns Promise<{ success, status, tier, error? }>
async function activateLicense(key) {
  const cleanKey = (key || '').trim().toUpperCase();
  if (!cleanKey) {
    return { success: false, status: 'invalid', error: 'Please enter a license key.' };
  }

  let data;
  try {
    data = await callLicenseAPI(LS_ACTIVATE_URL, {
      license_key:   cleanKey,
      instance_name: 'Grabit Extension'
    });
  } catch (err) {
    return {
      success: false,
      status:  'error',
      error:   'Could not reach the license server. Check your connection and try again.'
    };
  }

  if (!data.activated) {
    // LemonSqueezy puts the reason in data.error
    const msg = data.error || 'This license key is not valid.';
    return { success: false, status: 'invalid', error: msg };
  }

  const variantId   = data.meta        && data.meta.variant_id;
  const instanceId  = data.instance    && data.instance.id;
  const lsStatus    = data.license_key && data.license_key.status;
  const tier        = getLicenseTier(variantId);

  await storageSet({
    isPremium:         true,
    licenseKey:        cleanKey,
    licenseInstanceId: instanceId || null,
    licenseStatus:     lsStatus   || 'active',
    licenseTier:       tier,
    licenseVariantId:  variantId  || null
  });

  return { success: true, status: lsStatus || 'active', tier };
}

// ---------------------------------------------------------------------------
// Validation (re-check on startup)
// ---------------------------------------------------------------------------

// Re-validates the stored license key+instanceId against LemonSqueezy.
// On network failure, falls back to the stored isPremium value so the
// user doesn't lose access when offline.
// Returns Promise<{ valid, status, tier, offline? }>
async function validateLicense() {
  const stored = await getLicenseStatus();
  if (!stored.hasKey) return { valid: false, status: 'free' };

  let data;
  try {
    data = await callLicenseAPI(LS_VALIDATE_URL, {
      license_key: stored.key,
      instance_id: stored.instanceId || ''
    });
  } catch {
    // Network error — trust cached status rather than revoking access
    return {
      valid:   stored.isPremium,
      status:  stored.status,
      tier:    stored.tier,
      offline: true
    };
  }

  const isValid  = Boolean(data.valid);
  const lsStatus = data.license_key && data.license_key.status;
  const variantId = data.meta       && data.meta.variant_id;
  const tier      = getLicenseTier(variantId || null);

  await storageSet({
    isPremium:        isValid,
    licenseStatus:    lsStatus || (isValid ? 'active' : 'inactive'),
    licenseTier:      isValid ? tier : null,
    licenseVariantId: variantId || null
  });

  return { valid: isValid, status: lsStatus, tier: isValid ? tier : null };
}

// ---------------------------------------------------------------------------
// Deactivation
// ---------------------------------------------------------------------------

// Deactivates the current license instance with LemonSqueezy and clears
// all premium state from chrome.storage.local. Silent on network failure —
// local state is always cleared even if the API call fails.
// Returns Promise<void>
async function deactivateLicense() {
  const stored = await getLicenseStatus();

  if (stored.hasKey && stored.instanceId) {
    try {
      await callLicenseAPI(LS_DEACTIVATE_URL, {
        license_key: stored.key,
        instance_id: stored.instanceId
      });
    } catch {
      // Silently fail — we still clear local storage below
    }
  }

  await storageSet({
    isPremium:         false,
    licenseKey:        null,
    licenseInstanceId: null,
    licenseStatus:     'free',
    licenseTier:       null,
    licenseVariantId:  null
  });
}
