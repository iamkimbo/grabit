// =============================================================
// utils/gate.js
// Freemium gate for selective exports.
//
// Rule summary:
//   • "Export All" with no selection changes → always free, unlimited.
//   • Any use of a selective control (individual checkboxes, AI-only
//     toggle, Last 10/20, Deselect All) → counts as one selective use.
//   • Free users: 3 selective export uses per calendar day.
//   • Counter resets at midnight local time (keyed on "YYYY-MM-DD").
//   • Premium users: unlimited, gate is bypassed entirely.
//   • Counter is stored in chrome.storage.local under
//     "selectiveExportUsage" as { date: string, count: number }.
//
// Depends on: utils/storage.js, utils/date-utils.js
// =============================================================

'use strict';

// Maximum number of selective exports allowed per day for free users
const FREE_SELECTIVE_LIMIT = 3;

// ---------------------------------------------------------------------------
// DEMO MODE — off by default, so the free-tier daily cap is enforced.
// ---------------------------------------------------------------------------
// Set to true only for a live demo: it bypasses ONLY the 3/day
// selective-export cap below (unlimited selective exports for every user,
// free or premium). Premium-tier gating (DOCX/Notion/watermark-free) lives
// in popup.js and watermark.js and is unaffected by this flag.
// Keep false in any published build.
const DEMO_MODE_UNLIMITED = false;

// ---------------------------------------------------------------------------
// Gate check
// ---------------------------------------------------------------------------

// Checks whether a selective export is allowed and, if so, increments the
// daily counter atomically. Should be called once per export attempt when
// the user's selection differs from the default (all-selected) state.
//
// Reads isPremium from storage — premium users always pass.
// Free users are allowed FREE_SELECTIVE_LIMIT uses per calendar day.
//
// Returns Promise<{ allowed: boolean, usedToday: number, remaining: number }>
async function checkSelectiveGate() {
  // DEMO MODE — when enabled, bypasses the daily cap entirely.
  if (DEMO_MODE_UNLIMITED) {
    return { allowed: true, usedToday: 0, remaining: Infinity };
  }

  const storage = await storageGet(['isPremium', 'selectiveExportUsage']);

  // Premium users bypass the gate entirely
  if (storage.isPremium) {
    return { allowed: true, usedToday: 0, remaining: Infinity };
  }

  const today = getTodayString();
  let usage   = storage.selectiveExportUsage || { date: today, count: 0 };

  // Reset counter when the calendar day has changed
  if (isNewDay(usage.date)) {
    usage = { date: today, count: 0 };
  }

  if (usage.count >= FREE_SELECTIVE_LIMIT) {
    return {
      allowed:   false,
      usedToday: usage.count,
      remaining: 0
    };
  }

  // Increment before returning — the export is authorised
  const newCount = usage.count + 1;
  await storageSet({ selectiveExportUsage: { date: today, count: newCount } });

  return {
    allowed:   true,
    usedToday: newCount,
    remaining: FREE_SELECTIVE_LIMIT - newCount
  };
}

// ---------------------------------------------------------------------------
// Usage query (no side effects)
// ---------------------------------------------------------------------------

// Returns how many selective exports the current user has remaining today.
// Does not modify the counter. Premium users receive Infinity.
// Returns Promise<number>
async function getRemainingSelectiveExports() {
  // DEMO MODE — when enabled, bypasses the daily cap entirely.
  if (DEMO_MODE_UNLIMITED) return Infinity;

  const storage = await storageGet(['isPremium', 'selectiveExportUsage']);

  if (storage.isPremium) return Infinity;

  const usage = storage.selectiveExportUsage;
  if (!usage || isNewDay(usage.date)) return FREE_SELECTIVE_LIMIT;

  return Math.max(0, FREE_SELECTIVE_LIMIT - usage.count);
}

// ---------------------------------------------------------------------------
// Reset (for development / testing only — not exposed in production UI)
// ---------------------------------------------------------------------------

// Forces the daily counter back to zero for the current day.
// Returns Promise<void>
async function resetSelectiveExportCounter() {
  await storageSet({
    selectiveExportUsage: { date: getTodayString(), count: 0 }
  });
}
