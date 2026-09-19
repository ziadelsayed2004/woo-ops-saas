/**
 * Shared frontend formatting utilities for Egypt localization.
 */

/**
 * Format a number as Egyptian Pound (EGP / ج.م) with Western Arabic numerals (e.g., 1,250.00 ج.م).
 * Handles null/undefined/invalid values gracefully.
 */
export const formatCurrencyEGP = (value) => {
  if (value === null || value === undefined || isNaN(value)) {
    return '0.00 ج.م';
  }
  const formatted = parseFloat(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return `${formatted} ج.م`;
};

/**
 * Format a date/time string or object to Egypt Timezone (Africa/Cairo) with time.
 * e.g., "27/06/2026 12:30 م"
 */
export const formatEgyptDateTime = (value) => {
  if (!value) return '-';
  try {
    const date = new Date(value);
    if (isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat('ar-EG', {
      timeZone: 'Africa/Cairo',
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
};

/**
 * Format a date string or object to Egypt Timezone (Africa/Cairo) date-only.
 * e.g., "27/06/2026"
 */
export const formatEgyptDate = (value) => {
  if (!value) return '-';
  try {
    const date = new Date(value);
    if (isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat('ar-EG', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      numberingSystem: 'latn'
    }).format(date);
  } catch (e) {
    return '-';
  }
};
