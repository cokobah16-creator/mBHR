// Refusal codes, HTTP statuses and wording for the staff-admin function.
//
// Pure functions (no Deno APIs) so they can be unit tested with vitest/bun.
//
// Every message is plain English for the administrator using the Users
// screen. Messages never name the hosting service, and replies and logs
// never contain an email address, a name, a link or an id.

/** HTTP status and message for every refusal code. */
const CATALOGUE = {
  // The request itself.
  invalid_request: [400, "The request wasn't understood."],
  invalid_action: [400, "The request wasn't understood."],
  unexpected_field: [400, "The request had a field this action doesn't accept."],
  pin_not_accepted: [400, "PINs are set on each device, never on the server."],
  method_not_allowed: [405, "The request wasn't understood."],
  too_large: [413, "The request wasn't understood."],
  invalid_email: [422, "Enter a valid email address."],
  invalid_name: [422, "Enter their full name (2 to 120 characters, no < or >)."],
  invalid_id: [422, "The request wasn't understood."],
  role_not_allowed: [422, "Choose one of the listed roles."],
  role_not_available: [422, "This role isn't available on this server yet. Choose another role."],
  invalid_admin_flags: [422, "The administrator settings aren't valid."],
  confirm_mismatch: [422, "What you typed doesn't match this account."],
  acknowledgement_required: [422, "Tick the box to confirm you know this person."],
  nothing_to_update: [422, "Change their name or role before saving."],

  // Who is asking.
  not_authenticated: [
    401,
    "Sign in online with an administrator account to manage staff accounts. A PIN unlock is not enough.",
  ],
  needs_permanent_admin: [403, "Only a permanent administrator can give someone administrator access."],
  not_permitted: [403, "Only an administrator can manage staff accounts."],

  // The account.
  not_staff_account: [404, "This isn't a staff account."],
  not_found: [404, "No account was found."],
  email_in_use_staff: [409, "This email already belongs to a staff account. Find them in the list."],
  email_in_use_patient: [
    409,
    "This email is used by a patient portal account. Use a different email for their staff account.",
  ],
  email_in_use: [
    409,
    "This email already belongs to another mBHR account (it may be a patient portal account). Use their work email.",
  ],
  id_conflict: [409, "This request clashed with another account. Close the form and try again."],
  staff_exists: [409, "They already have a staff record."],
  login_exists: [409, "They already have a login."],
  no_login: [409, "They don't have a login yet."],
  account_disabled: [409, "This account is disabled. Reactivate it first."],
  use_resend_invitation: [409, "They haven't finished setting up. Use Resend invitation instead."],
  own_account: [409, "You can't disable your own account."],
  permanent_admin: [409, "Permanent administrators can't be changed here."],
  last_admin: [
    409,
    "This is the last active administrator. Add or reactivate another administrator first.",
  ],
  admin_disable_unavailable: [409, "Disabling administrators isn't available on this server yet."],
  admin_accounts_unavailable: [
    409,
    "Adding or restoring administrators isn't available on this server yet.",
  ],
  already_active: [409, "This account is already active."],
  role_needed: [409, "Choose the role they should have."],
  no_staff_role: [409, "This staff record has no role that can sign in."],
  changed_elsewhere: [409, "Someone else changed this account. Reload and try again."],
  patient_login: [409, "This login belongs to a patient portal account."],
  patient_email: [409, "This login belongs to a patient portal account."],
  portal_signup: [409, "This login belongs to a patient portal account."],
  anonymous_login: [409, "This login was never confirmed. Use Add Staff instead."],
  login_unconfirmed: [409, "This login was never confirmed. Use Add Staff instead."],

  // Limits.
  rate_limited: [429, "Too many staff account changes. Try again in a few minutes."],
  email_rate_limited: [429, "Too many emails were sent. Try again later."],

  // Failures.
  partial_create: [
    500,
    "The login was created but the staff record wasn't. Try Add Staff again with the same details.",
  ],
  partial_disable: [500, "The account may be only partly disabled. Open Login status and try again."],
  server_error: [
    500,
    "The staff account service had an error. Check the list before trying again.",
  ],
  login_service_error: [502, "The login service didn't respond as expected. Try again."],
  staff_record_error: [502, "The staff record couldn't be saved. Try again."],
  partial_reactivate: [
    502,
    "Their staff record is back but their login is still blocked. Try Reactivate again.",
  ],
  not_configured: [503, "Staff account setup isn't finished on this server yet."],
  email_not_configured: [
    503,
    "Sending email isn't set up on this server yet. Ask whoever runs the server to finish email setup.",
  ],
  rate_limit_unavailable: [503, "Staff account changes are paused for a moment. Try again shortly."],
  staff_lookup_failed: [503, "Your staff record couldn't be checked. Try again shortly."],
} as const satisfies Record<string, readonly [number, string]>;

export type RefusalCode = keyof typeof CATALOGUE;

/** A refused request: what the reply carries besides `fn` and `success`. */
export interface Refusal {
  status: number;
  error: string;
  message: string;
  /** The request field that was refused, when there is one. */
  field?: string;
  /** For 429 replies. */
  retryAfterSeconds?: number;
}

/** Every refusal code with its message. */
export const REFUSAL_MESSAGES: Readonly<Record<RefusalCode, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(CATALOGUE).map(([code, [, message]]) => [code, message]),
  ) as Record<RefusalCode, string>,
);

/** Every refusal code with its HTTP status. */
export const REFUSAL_STATUS: Readonly<Record<RefusalCode, number>> = Object.freeze(
  Object.fromEntries(
    Object.entries(CATALOGUE).map(([code, [status]]) => [code, status]),
  ) as Record<RefusalCode, number>,
);

/** Whether a value is a code in the catalogue. */
export function isRefusalCode(value: unknown): value is RefusalCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CATALOGUE, value);
}

/** The refusal for a code, with an optional field or replacement message. */
export function refusal(
  code: RefusalCode,
  extra: { field?: string; message?: string; retryAfterSeconds?: number } = {},
): Refusal {
  const [status, message] = CATALOGUE[code];
  const result: Refusal = { status, error: code, message: extra.message ?? message };
  if (extra.field !== undefined) result.field = extra.field;
  if (extra.retryAfterSeconds !== undefined) result.retryAfterSeconds = extra.retryAfterSeconds;
  return result;
}

/** 409 own_account, worded for the action that was refused. */
export function ownAccountRefusal(action: "disable" | "reactivate" | "update"): Refusal {
  if (action === "update") return refusal("own_account", { message: "You can't change your own role." });
  if (action === "reactivate") {
    return refusal("own_account", { message: "You can't reactivate your own account." });
  }
  return refusal("own_account");
}

/** 429 rate_limited with the wait in whole minutes (at least 1). */
export function rateLimitedRefusal(retryAfterSeconds: number): Refusal {
  const seconds =
    Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? Math.ceil(retryAfterSeconds) : 60;
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  const wait = minutes === 1 ? "1 minute" : `${minutes} minutes`;
  return refusal("rate_limited", {
    message: `Too many staff account changes. Try again in ${wait}.`,
    retryAfterSeconds: seconds,
  });
}

/** The JSON reply body for a refusal (without `fn`, added by the function). */
export function refusalBody(r: Refusal): Record<string, unknown> {
  const body: Record<string, unknown> = { success: false, error: r.error, message: r.message };
  if (r.field !== undefined) body.field = r.field;
  if (r.retryAfterSeconds !== undefined) body.retry_after_seconds = r.retryAfterSeconds;
  return body;
}

/** What an Auth admin error means for this function. */
export type AuthErrorKind =
  | "not_found"
  | "email_exists"
  | "id_taken"
  | "email_rate_limited"
  | "email_not_authorized"
  | "otp_expired"
  | "unknown";

const AUTH_CODES: Record<string, AuthErrorKind> = {
  user_not_found: "not_found",
  email_exists: "email_exists",
  // createUser with an id that already has a login.
  user_already_exists: "id_taken",
  over_email_send_rate_limit: "email_rate_limited",
  over_request_rate_limit: "email_rate_limited",
  email_address_not_authorized: "email_not_authorized",
  otp_expired: "otp_expired",
  invite_not_found: "otp_expired",
};

/**
 * Classifies an Auth admin error from its code (and, when the code is
 * missing, its HTTP status). Anything not recognised is "unknown", so it is
 * never mistaken for "not found".
 */
export function classifyAuthError(
  e: { code?: string | null; status?: number | null } | null | undefined,
): AuthErrorKind {
  if (!e) return "unknown";
  const code = typeof e.code === "string" ? e.code : "";
  if (code && Object.prototype.hasOwnProperty.call(AUTH_CODES, code)) return AUTH_CODES[code];
  if (!code && e.status === 404) return "not_found";
  if (!code && e.status === 429) return "email_rate_limited";
  return "unknown";
}

/** The refusal for an Auth admin error that stops the request. */
export function authAdminRefusal(kind: AuthErrorKind): Refusal {
  switch (kind) {
    case "not_found":
      return refusal("not_found");
    case "email_exists":
      return refusal("email_in_use");
    case "id_taken":
      return refusal("id_conflict");
    case "email_rate_limited":
      return refusal("email_rate_limited");
    case "email_not_authorized":
      return refusal("email_not_configured");
    default:
      return refusal("login_service_error");
  }
}

/** Why an invitation or reset email was not sent (InvitationResult.error). */
export function invitationError(
  kind: AuthErrorKind,
): "email_not_configured" | "email_rate_limited" | "send_failed" {
  if (kind === "email_not_authorized") return "email_not_configured";
  if (kind === "email_rate_limited") return "email_rate_limited";
  return "send_failed";
}

/** The refusal for a failed app_users write, from its Postgres error code. */
export function staffRowRefusal(pgCode: string | null | undefined): Refusal {
  switch (pgCode) {
    case "22P02": // invalid enum label: the role is not on this server
      return refusal("role_not_available");
    case "23514": // check constraint (admin_permanent needs admin)
      return refusal("invalid_admin_flags");
    case "23505": // unique violation: the row already exists
      return refusal("staff_exists");
    case "42501": // insufficient privilege
      return refusal("not_permitted");
    default:
      return refusal("staff_record_error");
  }
}
