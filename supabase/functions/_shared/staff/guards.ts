// Who may do what to which staff account, before anything is written.
//
// Pure functions (no Deno APIs) so they can be unit tested with vitest/bun.
// The actions read the rows and logins, then ask staffActionRefusal; a
// refusal stops the request with nothing changed.
//
// A login that has a staff record is a staff account whatever else it is
// linked to. A patient link on such a login never refuses anything here:
// the patient checks apply only to create_staff_record (a login with no
// staff record) and to reactivating a record with no staff role whose login
// this function never disabled or tagged as staff (that would promote an
// unknown login, as create_staff_record does).
//
// Until ADMIN_ACCOUNTS_ENABLED is turned on, nothing here lets a request
// make or restore an administrator.

import {
  ADMIN_ACCOUNTS_ENABLED,
  APP_META,
  DISABLE_DEMOTES_ROLE,
  PASSWORD_SET_META,
  PROVISIONABLE_ROLES,
} from "./constants.ts";
import { ownAccountRefusal, refusal, type Refusal } from "./errors.ts";
import { hasPortalSignupKeys } from "./health.ts";
import { isAccountDisabled, isLoginBanned, isStaffRole, isStaffTagged } from "./status.ts";
import type { AppUserRow, LoginRecord } from "./portTypes.ts";
import type { StaffAdminAction } from "./validate.ts";

const ADMIN_ROLE = "admin";

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function isTime(value: unknown): boolean {
  const s = text(value);
  return s !== null && !Number.isNaN(Date.parse(s));
}

/**
 * Whether reactivating this login would promote a login this function
 * never disabled (no mbhr_disabled_at) and never tagged as staff. Such a
 * reactivate gets the same patient checks as create_staff_record.
 */
export function reactivateNeedsPatientChecks(login: LoginRecord): boolean {
  return text(login.appMetadata?.[APP_META.disabledAt]) === null && !isStaffTagged(login);
}

/**
 * The refusal for a request that would make or restore an administrator:
 * none are made while ADMIN_ACCOUNTS_ENABLED is off, and only a permanent
 * administrator may when it is on.
 */
function adminGrantRefusal(actorPermanent: boolean): Refusal | null {
  if (!ADMIN_ACCOUNTS_ENABLED) return refusal("admin_accounts_unavailable");
  if (!actorPermanent) return refusal("needs_permanent_admin");
  return null;
}

/**
 * Whether this row and login make an administrator who can still act, for
 * the last-administrator rule: role admin, row not switched off, a login
 * that exists, matches, is not anonymous and is not banned, and either a
 * permanent administrator or someone who confirmed their email and set a
 * password or signed in.
 */
export function countsAsActiveAdmin(
  row: AppUserRow,
  login: LoginRecord | null,
  now: Date,
): boolean {
  if (row.role !== ADMIN_ROLE || row.is_active === false) return false;
  if (!login || login.id !== row.id || login.isAnonymous) return false;
  if (isLoginBanned(login, now)) return false;
  if (row.admin_permanent === true) return true;
  if (!isTime(login.emailConfirmedAt)) return false;
  return isTime(login.userMetadata?.[PASSWORD_SET_META]) || isTime(login.lastSignInAt);
}

/**
 * How many administrators other than targetId count as active. Pass every
 * admin row with its login (null when it has none).
 */
export function countOtherActiveAdmins(
  admins: readonly { row: AppUserRow; login: LoginRecord | null }[],
  targetId: string,
  now: Date,
): number {
  const seen = new Set<string>();
  let count = 0;
  for (const { row, login } of admins) {
    if (row.id === targetId || seen.has(row.id)) continue;
    seen.add(row.id);
    if (countsAsActiveAdmin(row, login, now)) count++;
  }
  return count;
}

export interface GuardInput {
  action: StaffAdminAction;
  /** The signed-in administrator. */
  actorId: string;
  /** Whether the caller's own row has admin_permanent. */
  actorPermanent: boolean;
  /** The target's staff record, or null when it has none. */
  row: AppUserRow | null;
  /** The target's login, or null when it has none. */
  login: LoginRecord | null;
  /** countOtherActiveAdmins for the target (disable, update). */
  otherActiveAdmins: number;
  /**
   * The role asked for: create, update and create_staff_record take it from
   * the request; reactivate passes the role it will restore, or null.
   */
  requestedRole?: string | null;
  /** Defaults to the current time. */
  now?: Date;
  /**
   * create_staff_record, and reactivate when reactivateNeedsPatientChecks:
   * whether the login is a patient's (patients.auth_uid) and whether a
   * patient record has its email. Left out, each counts as true, so a
   * missing check refuses.
   */
  patientLinked?: boolean;
  patientEmailOnFile?: boolean;
}

/**
 * The refusal for an action on a target, or null when it may go ahead.
 * Checks the request can make without writing: the staff record and login
 * exist, the caller is not acting on their own account where that is
 * refused, permanent administrators, the last administrator, and who may
 * give administrator access.
 */
export function staffActionRefusal(input: GuardInput): Refusal | null {
  const { action, actorId, actorPermanent, row, login, otherActiveAdmins } = input;
  const now = input.now ?? new Date();
  const requestedRole = input.requestedRole ?? null;
  const self = (row?.id ?? login?.id) === actorId;

  switch (action) {
    case "ping":
    case "overview":
      return null;

    case "create":
      if (requestedRole === ADMIN_ROLE) return adminGrantRefusal(actorPermanent);
      return null;

    case "login_status":
      // A staff record, or a login tagged as staff. A patient's login with
      // no staff record is not shown here.
      if (!row && !(login && isStaffTagged(login))) return refusal("not_staff_account");
      return null;

    case "resend_invitation":
    case "reset_password":
      if (!row) return refusal("not_staff_account");
      if (!login) return refusal("no_login");
      if (isAccountDisabled(row, login, now)) return refusal("account_disabled");
      if (action === "reset_password" && !isTime(login.emailConfirmedAt)) {
        return refusal("use_resend_invitation");
      }
      return null;

    case "disable":
      if (!row) return refusal("not_staff_account");
      if (!login) return refusal("no_login");
      if (self) return ownAccountRefusal("disable");
      if (row.admin_permanent === true) return refusal("permanent_admin");
      if (row.role === ADMIN_ROLE) {
        if (!DISABLE_DEMOTES_ROLE) return refusal("admin_disable_unavailable");
        if (otherActiveAdmins < 1) return refusal("last_admin");
      }
      return null;

    case "reactivate":
      if (!row) return refusal("not_staff_account");
      if (!login) return refusal("no_login");
      if (self) return ownAccountRefusal("reactivate");
      if (isStaffRole(row.role)) {
        // The row is fine: only a banned login is left to undo. Unbanning an
        // administrator still restores administrator access (A4).
        if (!isLoginBanned(login, now)) return refusal("already_active");
        if (row.role === ADMIN_ROLE) return adminGrantRefusal(actorPermanent);
        return null;
      }
      // A record with no staff role on a login this function never disabled
      // or tagged: giving it a role would promote that login, so it gets the
      // patient checks create_staff_record makes.
      if (reactivateNeedsPatientChecks(login)) {
        if (input.patientLinked !== false) return refusal("patient_login");
        if (input.patientEmailOnFile !== false) return refusal("patient_email");
        if (hasPortalSignupKeys(login)) return refusal("portal_signup");
      }
      if (!isStaffRole(requestedRole)) return refusal("role_needed");
      if (requestedRole === ADMIN_ROLE) return adminGrantRefusal(actorPermanent);
      return null;

    case "update": {
      if (!row) return refusal("not_staff_account");
      if (!isStaffRole(row.role) || row.is_active === false) return refusal("account_disabled");
      if (isLoginBanned(login, now)) return refusal("account_disabled");
      if (requestedRole === null || requestedRole === row.role) return null; // name only
      if (!PROVISIONABLE_ROLES.includes(requestedRole)) return refusal("role_not_allowed", { field: "role" });
      // A role change. Permanent administrators first: the database refuses
      // it too.
      if (row.admin_permanent === true) return refusal("permanent_admin");
      if (self) return ownAccountRefusal("update");
      if (requestedRole === ADMIN_ROLE) {
        const r = adminGrantRefusal(actorPermanent);
        if (r) return r;
      }
      if (row.role === ADMIN_ROLE && otherActiveAdmins < 1) return refusal("last_admin");
      return null;
    }

    case "create_login":
      if (!row) return refusal("not_staff_account");
      if (!PROVISIONABLE_ROLES.includes(row.role) || row.is_active === false) {
        return refusal("no_staff_role");
      }
      if (row.admin_permanent === true) return refusal("permanent_admin");
      if (row.role === ADMIN_ROLE) {
        const r = adminGrantRefusal(actorPermanent);
        if (r) return r;
      }
      if (login) return refusal("login_exists");
      return null;

    case "create_staff_record":
      if (!login) return refusal("not_found");
      if (row) return refusal("staff_exists");
      // A staff record made for an existing login never grants admin.
      if (
        requestedRole === null ||
        requestedRole === ADMIN_ROLE ||
        !PROVISIONABLE_ROLES.includes(requestedRole)
      ) {
        return refusal("role_not_allowed", { field: "role" });
      }
      if (input.patientLinked !== false) return refusal("patient_login");
      if (input.patientEmailOnFile !== false) return refusal("patient_email");
      if (hasPortalSignupKeys(login)) return refusal("portal_signup");
      if (login.isAnonymous) return refusal("anonymous_login");
      if (isLoginBanned(login, now)) return refusal("account_disabled");
      if (!isTime(login.emailConfirmedAt) && !isStaffTagged(login)) return refusal("login_unconfirmed");
      return null;
  }
  return null;
}
