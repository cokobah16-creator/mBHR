/**
 * Phone Number Normalization Utilities
 *
 * Provides utilities for normalizing phone numbers to E.164 format.
 * Nigerian local formats become +234 numbers; other countries' numbers
 * must be typed with their country code.
 */

/** A Nigerian mobile number in E.164 form: +234 then 7, 8 or 9 and 9 digits. */
const NIGERIAN_MOBILE_E164 = /^\+234[789]\d{9}$/;

/**
 * Normalize phone number to E.164 format
 *
 * Nigerian local formats become +234 numbers:
 * - 0803 123 4567 → +2348031234567
 * - 2348031234567 → +2348031234567
 * - 8031234567 (10-digit mobile, leading 0 dropped) → +2348031234567
 * - +234 0803 123 4567 (country code plus the trunk 0) → +2348031234567
 *
 * A number typed with "+" (or "00") and its country code keeps that country:
 * - +1 555 123 4567 → +15551234567
 * - 0044 7911 123456 → +447911123456
 *
 * Anything else returns null, because the country can't be told: "234" is
 * never added to a number that isn't Nigerian ("555 123 4567" is not saved
 * as +2345551234567). Forms reject such input with isValidPhone and ask for
 * the country code.
 *
 * @param input - Phone number in various formats
 * @returns Normalized phone number in E.164 format, or null if the input is
 * empty or can't be read as a full number
 */
export function normalizePhone(input?: string | null): string | null {
  if (!input) return null;

  let cleaned = String(input).trim().replace(/[\s\-().]/g, "");
  if (!cleaned) return null;
  if (cleaned.startsWith("00")) cleaned = "+" + cleaned.slice(2);

  // Typed with its country code.
  if (/^\+\d+$/.test(cleaned)) {
    let digits = cleaned.slice(1);
    if (/^2340\d{10}$/.test(digits)) digits = "234" + digits.slice(4);
    if (digits.startsWith("234")) {
      return digits.length === 13 ? "+" + digits : null;
    }
    // E.164 numbers are at most 15 digits and no country code starts with 0;
    // shorter than 8 is not a full number.
    return /^[1-9]\d{7,14}$/.test(digits) ? "+" + digits : null;
  }

  if (!/^\d+$/.test(cleaned)) return null;

  // Nigerian local formats.
  if (/^0\d{10}$/.test(cleaned)) return "+234" + cleaned.slice(1);
  if (/^234\d{10}$/.test(cleaned)) return "+" + cleaned;
  if (/^2340\d{10}$/.test(cleaned)) return "+234" + cleaned.slice(4);
  if (/^[789][01]\d{8}$/.test(cleaned)) return "+234" + cleaned;

  return null;
}

/**
 * Format phone number for display
 *
 * Converts E.164 format (+234...) to a more readable format
 * Example: +2348031234567 → 0803 123 4567
 *
 * @param phone - Phone number in E.164 format
 * @returns Formatted phone number for display
 */
export function formatPhoneForDisplay(phone?: string | null): string {
  if (!phone) return "";

  const normalized = normalizePhone(phone);
  if (!normalized) return phone;

  // For Nigerian numbers, format as: 0XXX XXX XXXX
  if (normalized.startsWith("+234")) {
    const digits = normalized.slice(4); // Remove +234
    if (digits.length === 10) {
      return `0${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
    }
  }

  return phone;
}

/**
 * Validate a phone number typed into a patient form
 *
 * Accepts a Nigerian mobile number in any local format, or a number from
 * another country typed with "+" and its country code. A Nigerian number
 * must be a mobile number (+234 then 7, 8 or 9 and 9 digits).
 *
 * @param phone - Phone number to validate
 * @returns true if phone number is valid
 */
export function isValidPhone(phone?: string | null): boolean {
  const normalized = normalizePhone(phone);
  if (!normalized) return false;
  if (normalized.startsWith("+234")) return NIGERIAN_MOBILE_E164.test(normalized);
  return true;
}

/** Shown when a patient form's phone number fails isValidPhone. */
export const INVALID_PHONE_MESSAGE =
  "Enter a Nigerian mobile number (08012345678), or for another country the full number with + and the country code (+44 7911 123456).";

/**
 * Strip phone number to digits only (for database indexing)
 *
 * @param phone - Phone number in any format
 * @returns Phone number with digits only (no + or country code)
 */
export function stripPhoneToDigits(phone?: string | null): string | null {
  if (!phone) return null;

  const digits = String(phone).replace(/\D+/g, "");
  return digits || null;
}
