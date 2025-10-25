// Nigerian date formatting utilities
// All dates in the application should use dd/mm/yyyy format
/**
 * Formats a date to Nigerian format (dd/mm/yyyy)
 * @param date - Date object, string, or timestamp
 * @returns Formatted date string in dd/mm/yyyy format
 */
export function formatNigerianDate(date) {
    if (!date)
        return '';
    const dateObj = date instanceof Date ? date : new Date(date);
    if (isNaN(dateObj.getTime()))
        return '';
    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const year = dateObj.getFullYear();
    return `${day}/${month}/${year}`;
}
/**
 * Formats a date to Nigerian short format (dd/mm/yy)
 * @param date - Date object, string, or timestamp
 * @returns Formatted date string in dd/mm/yy format
 */
export function formatNigerianDateShort(date) {
    if (!date)
        return '';
    const dateObj = date instanceof Date ? date : new Date(date);
    if (isNaN(dateObj.getTime()))
        return '';
    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const year = String(dateObj.getFullYear()).slice(-2);
    return `${day}/${month}/${year}`;
}
/**
 * Formats a date with time in Nigerian format (dd/mm/yyyy HH:mm)
 * @param date - Date object, string, or timestamp
 * @returns Formatted date string with time
 */
export function formatNigerianDateTime(date) {
    if (!date)
        return '';
    const dateObj = date instanceof Date ? date : new Date(date);
    if (isNaN(dateObj.getTime()))
        return '';
    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const year = dateObj.getFullYear();
    const hours = String(dateObj.getHours()).padStart(2, '0');
    const minutes = String(dateObj.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}`;
}
/**
 * Formats a date with time in Nigerian format with seconds (dd/mm/yyyy HH:mm:ss)
 * @param date - Date object, string, or timestamp
 * @returns Formatted date string with time and seconds
 */
export function formatNigerianDateTimeFull(date) {
    if (!date)
        return '';
    const dateObj = date instanceof Date ? date : new Date(date);
    if (isNaN(dateObj.getTime()))
        return '';
    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const year = dateObj.getFullYear();
    const hours = String(dateObj.getHours()).padStart(2, '0');
    const minutes = String(dateObj.getMinutes()).padStart(2, '0');
    const seconds = String(dateObj.getSeconds()).padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
}
/**
 * Formats time only (HH:mm)
 * @param date - Date object, string, or timestamp
 * @returns Formatted time string
 */
export function formatTime(date) {
    if (!date)
        return '';
    const dateObj = date instanceof Date ? date : new Date(date);
    if (isNaN(dateObj.getTime()))
        return '';
    const hours = String(dateObj.getHours()).padStart(2, '0');
    const minutes = String(dateObj.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}
/**
 * Legacy function for compatibility - uses Nigerian format
 * @deprecated Use formatNigerianDate instead
 */
export function formatDate(date) {
    return formatNigerianDate(date);
}
/**
 * Formats relative time (e.g., "2 hours ago", "3 days ago")
 * @param date - Date object, string, or timestamp
 * @returns Relative time string
 */
export function formatRelativeTime(date) {
    if (!date)
        return '';
    const dateObj = date instanceof Date ? date : new Date(date);
    if (isNaN(dateObj.getTime()))
        return '';
    const now = new Date();
    const diffMs = now.getTime() - dateObj.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);
    if (diffSeconds < 60)
        return 'Just now';
    if (diffMinutes < 60)
        return `${diffMinutes} ${diffMinutes === 1 ? 'minute' : 'minutes'} ago`;
    if (diffHours < 24)
        return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
    if (diffDays < 7)
        return `${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;
    return formatNigerianDate(dateObj);
}
/**
 * Parses a Nigerian format date string (dd/mm/yyyy) to a Date object
 * @param dateString - Date string in dd/mm/yyyy format
 * @returns Date object or null if invalid
 */
export function parseNigerianDate(dateString) {
    if (!dateString)
        return null;
    const parts = dateString.split('/');
    if (parts.length !== 3)
        return null;
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parseInt(parts[2], 10);
    if (isNaN(day) || isNaN(month) || isNaN(year))
        return null;
    const date = new Date(year, month, day);
    if (date.getDate() !== day || date.getMonth() !== month || date.getFullYear() !== year) {
        return null;
    }
    return date;
}
