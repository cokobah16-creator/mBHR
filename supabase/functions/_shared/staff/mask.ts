// Masked email addresses for logins that are not staff accounts.
//
// Pure functions (no Deno APIs) so they can be unit tested with vitest/bun.
//
// Account Health shows a login that may belong to a patient without its
// full address: enough for an administrator who already knows the person to
// recognise it, not enough to learn it.

const HIDDEN = "•••";

/**
 * "amaka.obi@gmail.com" -> "a•••@g•••.com": the first character of the
 * local part, the first character of the domain and the last domain label.
 */
export function maskEmail(email: string): string {
  const value = (email ?? "").trim();
  const at = value.lastIndexOf("@");
  if (at < 1 || at === value.length - 1) return HIDDEN;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const lastDot = domain.lastIndexOf(".");
  const tld = lastDot > 0 && lastDot < domain.length - 1 ? domain.slice(lastDot) : "";
  return `${local[0]}${HIDDEN}@${domain[0]}${HIDDEN}${tld}`;
}

/** maskEmail for a value that may be missing. */
export function maskEmailOrNull(email: string | null | undefined): string | null {
  return email ? maskEmail(email) : null;
}
