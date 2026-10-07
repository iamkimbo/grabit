// =============================================================
// utils/date-utils.js
// Date and time helpers used by the freemium gate, the export
// counter, and anywhere else a local-time date string is needed.
// =============================================================

'use strict';

// Returns today's date as a "YYYY-MM-DD" string in the user's local timezone.
// Used as the key for the daily selective-export counter.
// Returns string
function getTodayString() {
  const d   = new Date();
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Returns true if storedDate is absent or different from today's date string.
// Determines whether the daily counter should be reset to zero.
// Returns boolean
function isNewDay(storedDate) {
  return !storedDate || storedDate !== getTodayString();
}

// Returns the number of milliseconds remaining until the next local midnight.
// Useful for scheduling a UI refresh when the daily cap resets.
// Returns number
function msUntilMidnight() {
  const now      = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime() - now.getTime();
}

// Formats a YYYY-MM-DD string (or any Date-parseable string) into a
// locale-aware human-readable date, e.g. "June 10, 2025".
// Falls back to the raw string if parsing fails.
// Returns string
function formatLocalDate(dateStr) {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
  } catch {
    return String(dateStr);
  }
}
