// Status of a staff account (Invited, Active, Disabled, Setup required),
// worked out from its staff record and its login.
//
// Pure functions (no Deno APIs) so they can be unit tested with vitest/bun.
// `now` is always passed in, never read from the clock.
//
// A login that has a staff record (app_users row) is a staff account, even
// when the same login is also linked to a patient record. The patient link
// is shown as information only and never changes the status.

import { APP_META, KNOWN_STAFF_ROLES, PASSWORD_SET_META, STAFF_ACCOUNT_TAG } from "./constants.ts";
import type { AccountStatus, AccountView, StatusDetail } from "./types.ts";
import type { AppUserRow, LoginRecord } from "./portTypes.ts";

/** A role that can sign in as staff: one the app knows, other than "guest". */
export function isStaffRole(role: unknown): boolean {
  return typeof role === "string" && KNOWN_STAFF_ROLES.includes(role);
}

/** A non-empty string, else null. */
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** Milliseconds since 1970 of an ISO time, or null when missing or invalid. */
function timeOf(value: unknown): number | null {
  const s = text(value);
  if (s === null) return null;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Whether the login is banned at `now`. A ban time that cannot be read
 * counts as banned, so an unreadable value never grants access.
 */
export function isLoginBanned(login: LoginRecord | null | undefined, now: Date): boolean {
  const until = text(login?.bannedUntil);
  if (until === null) return false;
  const ms = Date.parse(until);
  return Number.isNaN(ms) || ms > now.getTime();
}

/** Whether the login carries the server-only staff tag. */
export function isStaffTagged(login: LoginRecord | null | undefined): boolean {
  return login?.appMetadata?.[APP_META.account] === STAFF_ACCOUNT_TAG;
}

/**
 * When the person set their password (reset page marker), or null. The
 * person can edit this value, so it is for display only.
 */
export function passwordSetAtOf(login: LoginRecord | null | undefined): string | null {
  const value = login?.userMetadata?.[PASSWORD_SET_META];
  return timeOf(value) === null ? null : (value as string);
}

/**
 * When the last invitation or confirmation email was sent: the later of
 * invitedAt and confirmationSentAt, or null when neither is set.
 */
export function lastInvitationSentAt(login: LoginRecord | null | undefined): number | null {
  const invited = timeOf(login?.invitedAt);
  const sent = timeOf(login?.confirmationSentAt);
  if (invited === null) return sent;
  if (sent === null) return invited;
  return Math.max(invited, sent);
}

/**
 * Whether the account is switched off: the login is banned, the row is
 * switched off, or the row has no staff role (demoted to guest by Disable,
 * or never given one).
 */
export function isAccountDisabled(
  row: AppUserRow | null,
  login: LoginRecord | null,
  now: Date,
): boolean {
  if (isLoginBanned(login, now)) return true;
  if (!row) return false;
  return row.is_active === false || !isStaffRole(row.role);
}

export interface AccountStatusResult {
  status: AccountStatus;
  detail: StatusDetail;
  /** The login is banned but the staff record still has a staff role. */
  disablePartial: boolean;
  passwordSetAt: string | null;
}

function result(
  status: AccountStatus,
  detail: StatusDetail,
  login: LoginRecord | null,
  disablePartial = false,
): AccountStatusResult {
  return { status, detail, disablePartial, passwordSetAt: passwordSetAtOf(login) };
}

/**
 * The status of one account. Rules, first match wins:
 * 1. No login: setup_required / no_login.
 * 2. Login banned: disabled / by_admin (disablePartial when the row still
 *    has a staff role).
 * 3. Row switched off (is_active false): disabled / switched_off.
 * 4. No staff role (guest, unknown, or no row): disabled / by_admin when
 *    Disable recorded it, else disabled / no_staff_role.
 * 5. Email not confirmed: setup_required / invitation_not_sent when no email
 *    was sent, invited / expired when the last one is older than
 *    inviteLifetimeSec, else invited / pending.
 * 6. Created from the Users screen (not a repair) and no password marker:
 *    setup_required / password_not_set.
 * 7. Otherwise active / signed_in, or active / never_signed_in.
 */
export function accountStatus(
  login: LoginRecord | null,
  row: AppUserRow | null,
  now: Date,
  inviteLifetimeSec: number,
): AccountStatusResult {
  // 1
  if (!login) return result("setup_required", "no_login", null);

  // 2
  if (isLoginBanned(login, now)) {
    return result("disabled", "by_admin", login, row !== null && isStaffRole(row.role));
  }

  // 3
  if (row && row.is_active === false) return result("disabled", "switched_off", login);

  // 4
  if (!row || !isStaffRole(row.role)) {
    const recorded = text(login.appMetadata?.[APP_META.disabledAt]) !== null;
    return result("disabled", recorded ? "by_admin" : "no_staff_role", login);
  }

  // 5
  if (timeOf(login.emailConfirmedAt) === null) {
    const sent = lastInvitationSentAt(login);
    if (sent === null) return result("setup_required", "invitation_not_sent", login);
    const ageMs = now.getTime() - sent;
    return result("invited", ageMs > inviteLifetimeSec * 1000 ? "expired" : "pending", login);
  }

  // 6
  const meta = login.appMetadata ?? {};
  if (
    text(meta[APP_META.createdBy]) !== null &&
    text(meta[APP_META.repair]) === null &&
    passwordSetAtOf(login) === null
  ) {
    return result("setup_required", "password_not_set", login);
  }

  // 7
  return result(
    "active",
    timeOf(login.lastSignInAt) === null ? "never_signed_in" : "signed_in",
    login,
  );
}

/** How the account was made, from the login's server-only metadata. */
export function createdViaOf(login: LoginRecord | null): AccountView["createdVia"] {
  const meta = login?.appMetadata ?? {};
  if (text(meta[APP_META.repair]) !== null) return "repair";
  if (text(meta[APP_META.createdBy]) !== null) return "users_screen";
  return "not_recorded";
}

/** Staff names by id, for "created by" and "disabled by". */
export function staffNameMap(rows: readonly AppUserRow[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const row of rows) {
    const name = text(row.full_name);
    if (name !== null) names.set(row.id, name);
  }
  return names;
}

export interface AccountViewInput {
  /** The account id (the row's id, which is also the login's id). */
  userId: string;
  row: AppUserRow | null;
  login: LoginRecord | null;
  now: Date;
  inviteLifetimeSec: number;
  /** Staff names by id (staffNameMap), for createdByName and disabledByName. */
  names?: ReadonlyMap<string, string>;
  /** Logins linked to a patient record (patients.auth_uid). */
  patientUids?: ReadonlySet<string>;
}

/**
 * One account as the Users screen shows it. The email is given in full:
 * call this only for staff accounts (a row, or a staff-tagged login).
 */
export function accountView(input: AccountViewInput): AccountView {
  const { userId, row, login, now, inviteLifetimeSec, names, patientUids } = input;
  const s = accountStatus(login, row, now, inviteLifetimeSec);
  const meta = login?.appMetadata ?? {};
  const createdVia = createdViaOf(login);
  const nameOf = (id: unknown): string | null => {
    const key = text(id);
    return key === null ? null : (names?.get(key) ?? null);
  };
  const userFullName = text(login?.userMetadata?.full_name);

  const view: AccountView = {
    userId,
    fullName: text(row?.full_name) ?? userFullName ?? "",
    role: row?.role ?? "",
    adminAccess: row?.admin_access === true,
    adminPermanent: row?.admin_permanent === true,
    email: text(login?.email),
    status: s.status,
    statusDetail: s.detail,
    disablePartial: s.disablePartial,
    invitedAt: text(login?.invitedAt),
    emailConfirmedAt: text(login?.emailConfirmedAt),
    lastSignInAt: text(login?.lastSignInAt),
    passwordSetAt: s.passwordSetAt,
    createdAt: text(row?.created_at) ?? text(login?.createdAt) ?? "",
    createdVia,
    createdByName: nameOf(createdVia === "repair" ? meta[APP_META.repairBy] : meta[APP_META.createdBy]),
    disabledAt: text(meta[APP_META.disabledAt]),
    disabledByName: nameOf(meta[APP_META.disabledBy]),
  };
  if (patientUids?.has(userId)) view.linkedPatientRecord = true;
  return view;
}
