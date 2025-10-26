/**
 * Phone Number Normalization Utilities
 *
 * Provides utilities for normalizing phone numbers to E.164 format,
 * with specific handling for Nigerian phone numbers.
 */
/**
 * Normalize phone number to E.164 format
 *
 * Handles Nigerian phone numbers by default, converting:
 * - 0803 123 4567 → +2348031234567
 * - 08031234567 → +2348031234567
 * - 2348031234567 → +2348031234567
 * - +2348031234567 → +2348031234567 (already normalized)
 *
 * @param input - Phone number in various formats
 * @returns Normalized phone number in E.164 format (+234...) or null if input is empty
 */
export function normalizePhone(input) {
    if (!input)
        return null;
    // Remove all non-digit characters
    let digits = String(input).replace(/\D+/g, '');
    if (!digits)
        return null;
    // Handle Nigerian numbers
    // If starts with 0, replace with 234
    if (digits.startsWith('0')) {
        digits = '234' + digits.slice(1);
    }
    // If doesn't start with 234, assume it's a Nigerian number and prepend 234
    else if (!digits.startsWith('234')) {
        digits = '234' + digits;
    }
    return '+' + digits;
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
export function formatPhoneForDisplay(phone) {
    if (!phone)
        return '';
    const normalized = normalizePhone(phone);
    if (!normalized)
        return phone;
    // For Nigerian numbers, format as: 0XXX XXX XXXX
    if (normalized.startsWith('+234')) {
        const digits = normalized.slice(4); // Remove +234
        if (digits.length === 10) {
            return `0${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
        }
    }
    return phone;
}
/**
 * Validate phone number format
 *
 * @param phone - Phone number to validate
 * @returns true if phone number is valid
 */
export function isValidPhone(phone) {
    if (!phone)
        return false;
    const normalized = normalizePhone(phone);
    if (!normalized)
        return false;
    // Nigerian phone numbers should be +234 followed by 10 digits
    const nigerianPattern = /^\+234\d{10}$/;
    return nigerianPattern.test(normalized);
}
/**
 * Strip phone number to digits only (for database indexing)
 *
 * @param phone - Phone number in any format
 * @returns Phone number with digits only (no + or country code)
 */
export function stripPhoneToDigits(phone) {
    if (!phone)
        return null;
    const digits = String(phone).replace(/\D+/g, '');
    return digits || null;
}
