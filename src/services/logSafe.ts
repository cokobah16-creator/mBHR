/**
 * Log-safe descriptions for messaging and portal services.
 *
 * Console output and Sentry breadcrumbs must never carry patient names,
 * contact details, message text, registration links or raw server errors
 * (a Postgres unique-violation message, for example, echoes the email or
 * phone number that clashed). These helpers reduce such values to facts that
 * identify nobody: the error class and a short error code, or a masked phone.
 */

const SAFE_CODE = /^[A-Za-z0-9_.-]{1,32}$/;
const SAFE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/**
 * Error class plus a short error code when there is one, for example
 * "TypeError", "FunctionsHttpError" or "PostgrestError (code 23505)".
 * Messages, details and hints are never included.
 */
export function safeErrorLabel(error: unknown): string {
  if (error === null || error === undefined) return "unknown error";
  if (typeof error !== "object") {
    // A thrown string can hold anything, including patient details.
    return `non-error value (${typeof error})`;
  }

  const record = error as { name?: unknown; code?: unknown; status?: unknown };
  const rawName =
    error instanceof Error
      ? error.name
      : typeof record.name === "string"
        ? record.name
        : "";
  const name = SAFE_NAME.test(rawName) ? rawName : "Error";

  const rawCode =
    typeof record.code === "string" || typeof record.code === "number"
      ? String(record.code)
      : typeof record.status === "number"
        ? String(record.status)
        : "";
  return SAFE_CODE.test(rawCode) ? `${name} (code ${rawCode})` : name;
}

/**
 * Phone number with the middle digits hidden, for logs:
 * "+234 803 123 4567" -> "234803***4567", "08031234567" -> "0803***4567".
 * Short or empty input gives "***" or "(none)".
 */
export function maskPhoneForLog(phone: string | null | undefined): string {
  const digits = (phone || "").replace(/\D/g, "");
  if (!digits) return "(none)";
  if (digits.length < 8) return "***";
  // Keep the operator prefix and the last four digits; always hide at least
  // three digits in between.
  const keepStart = Math.min(6, digits.length - 7);
  return `${digits.slice(0, keepStart)}***${digits.slice(-4)}`;
}
