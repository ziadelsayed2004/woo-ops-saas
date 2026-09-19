/**
 * Shared backend formatting constants and utilities for Egypt localization.
 */

const currency = 'EGP';
const timezone = 'Africa/Cairo';

/**
 * Format a number as Egyptian Pound (EGP / ج.م) with Western Arabic numerals (e.g., 1,250.00 ج.م).
 * Handles null/undefined/invalid values gracefully.
 */
function formatCurrencyEGP(value) {
  if (value === null || value === undefined || isNaN(value)) {
    return '0.00 ج.م';
  }
  const formatted = parseFloat(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return `${formatted} ج.م`;
}

/**
 * Format a date/time to Egypt Timezone (Africa/Cairo) with time.
 * e.g., "27/06/2026 12:30 م"
 */
function formatEgyptDateTime(value) {
  if (!value) return '-';
  try {
    const date = new Date(value);
    if (isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat('ar-EG', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      numberingSystem: 'latn'
    }).format(date);
  } catch (e) {
    return '-';
  }
}

/**
 * Format a date to Egypt Timezone (Africa/Cairo) date-only.
 * e.g., "27/06/2026"
 */
function formatEgyptDate(value) {
  if (!value) return '-';
  try {
    const date = new Date(value);
    if (isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat('ar-EG', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      numberingSystem: 'latn'
    }).format(date);
  } catch (e) {
    return '-';
  }
}

module.exports = {
  currency,
  timezone,
  formatCurrencyEGP,
  formatEgyptDateTime,
  formatEgyptDate
};
