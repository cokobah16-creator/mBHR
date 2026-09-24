// Server-side recipient rules for SMS and email edge functions.
//
// Pure functions (no Deno APIs) so they can be unit tested with vitest/bun.
//
// SMS: only Nigerian mobile numbers are accepted. Every Nigerian mobile number is
// 234 + a 10-digit national number whose first digit is 7, 8 or 9 and whose
// second digit is 0 or 1 (070x, 080x, 081x, 090x, 091x ...). Anything else
// (landlines, foreign numbers, short codes, free text) is rejected so the
// function cannot be used to message arbitrary numbers.

const NIGERIAN_MOBILE = /^234[789][01]\d{8}$/;

/**
 * Normalises a Nigerian mobile number to its E.164 digits without the "+",
 * e.g. "0803 123 4567", "+234 803 123 4567", "2348031234567" and
 * "8031234567" all become "2348031234567". Returns null for anything that is
 * not a Nigerian mobile number.
 */
export function normalizeNigerianMsisdn(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(/[\s\-().]/g, "");
  if (!/^\+?\d+$/.test(cleaned)) return null;

  let digits = cleaned.replace(/^\+/, "");
  if (digits.startsWith("00234")) digits = digits.slice(2);

  let candidate: string | null = null;
  if (/^0\d{10}$/.test(digits)) candidate = `234${digits.slice(1)}`;
  else if (/^234\d{10}$/.test(digits)) candidate = digits;
  // Common data-entry slip: country code plus the national trunk "0".
  else if (/^2340\d{10}$/.test(digits)) candidate = `234${digits.slice(4)}`;
  else if (/^\d{10}$/.test(digits)) candidate = `234${digits}`;

  return candidate && NIGERIAN_MOBILE.test(candidate) ? candidate : null;
}

/** "2348031234567" -> "+2348031234567". */
export function toE164(msisdn: string): string {
  return `+${msisdn}`;
}

/**
 * Masked form for logs. Same format as maskPhoneForLog in
 * src/services/logSafe.ts: "2348031234567" -> "234803***4567".
 */
export function maskMsisdn(msisdn: string | null | undefined): string {
  const digits = (msisdn || "").replace(/\D/g, "");
  if (!digits) return "(none)";
  if (digits.length < 8) return "***";
  const keepStart = Math.min(6, digits.length - 7);
  return `${digits.slice(0, keepStart)}***${digits.slice(-4)}`;
}

/**
 * Provider error text can quote the number (Twilio: "The 'To' number +234...
 * is not a valid phone number"). Masks every long digit run so the text is
 * safe to log or return.
 */
export function redactNumbers(text: unknown): string {
  return String(text ?? "").replace(/\+?\d[\d\s-]{6,}\d/g, (run) =>
    maskMsisdn(run),
  );
}

/** Upper bound on message length (about 6 SMS segments). */
export const MAX_SMS_CHARS = 960;

/** Trimmed message text, or null when empty, not text, or too long. */
export function validMessageText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text || text.length > MAX_SMS_CHARS) return null;
  return text;
}

/** One-time codes are 4 to 8 digits. */
export function validOtp(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const otp = String(raw).trim();
  return /^\d{4,8}$/.test(otp) ? otp : null;
}

/** Identifiers passed by the client (reminder / patient ids). */
export function validId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

/** Upper bound on an email address (the SMTP path limit). */
export const MAX_EMAIL_CHARS = 254;

// Loose on purpose: it does not try to decide which addresses exist. It only
// refuses text that names more than one recipient (commas, semicolons) or
// carries display-name or header syntax (<, >, quotes, brackets, spaces).
const EMAIL_ADDRESS =
  /^[^\s@,;<>"()[\]\\]+@[^\s@,;<>"()[\]\\]+\.[^\s@,;<>"()[\]\\]+$/;

/**
 * One plain email address such as "name@example.com", trimmed. Returns null
 * for anything else: not text, empty, too long, a list of addresses, or a
 * display name ("Name <name@example.com>").
 */
export function validEmailAddress(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim();
  if (!email || email.length > MAX_EMAIL_CHARS) return null;
  return EMAIL_ADDRESS.test(email) ? email : null;
}
