// Account Health: staff records and logins that do not line up.
//
// Pure functions (no Deno APIs) so they can be unit tested with vitest/bun.
//
// Default-deny: a login is shown with its full email only when it is a
// staff account (it has a staff record, or the server-only staff tag).
// Every other login is shown masked, or only counted.
//
// A login that has a staff record is a staff account whatever else it is
// linked to (for example a test patient record). The patient link never
// makes it a problem. Only logins with no staff record are classified.

import { APP_META, PORTAL_SIGNUP_KEYS, PROVISIONABLE_ROLES } from "./constants.ts";
import { maskEmailOrNull } from "./mask.ts";
import { isStaffTagged } from "./status.ts";
import type { HealthItem, HealthReport } from "./types.ts";
import type { AppUserRow, LoginRecord } from "./portTypes.ts";

/** What a login with no staff record is. */
export type LoginClass =
  | "portal_patient"
  | "anonymous"
  | "staff_tagged"
  | "portal_signup"
  | "unknown";

type UidSet = ReadonlySet<string> | readonly string[];

function toSet(uids: UidSet): ReadonlySet<string> {
  return uids instanceof Set ? uids : new Set(uids as readonly string[]);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function timeOf(value: unknown): number | null {
  const s = text(value);
  if (s === null) return null;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}

/** Whether the login's user_metadata has any patient portal sign-up key. */
export function hasPortalSignupKeys(login: LoginRecord): boolean {
  const meta = login.userMetadata ?? {};
  return PORTAL_SIGNUP_KEYS.some((key) => {
    if (!Object.prototype.hasOwnProperty.call(meta, key)) return false;
    const value = meta[key];
    return value !== undefined && value !== null;
  });
}

/**
 * Classifies a login that has NO staff record, first match wins:
 * linked to a patient record, anonymous, staff-tagged, portal sign-up
 * metadata, otherwise unknown. Never call it for a login with a staff
 * record: that login is a staff account.
 */
export function classifyLogin(
  login: LoginRecord,
  ctx: { patientUids: UidSet },
): LoginClass {
  if (toSet(ctx.patientUids).has(login.id)) return "portal_patient";
  if (login.isAnonymous) return "anonymous";
  if (isStaffTagged(login)) return "staff_tagged";
  if (hasPortalSignupKeys(login)) return "portal_signup";
  return "unknown";
}

function rowWithoutLogin(row: AppUserRow): HealthItem {
  const base = {
    userId: row.id,
    email: null,
    emailMasked: null,
    fullName: text(row.full_name),
    createdAt: text(row.created_at),
  };
  if (PROVISIONABLE_ROLES.includes(row.role)) {
    return {
      kind: "staff_without_login",
      ...base,
      // A permanent administrator's login is never recreated from here.
      repair: row.admin_permanent === true ? null : "create_login",
    };
  }
  return { kind: "staff_without_login_no_role", ...base, repair: null, blocked: "no_staff_role" };
}

/**
 * The Account Health report.
 * - Rows with no login: staff_without_login (repair create_login, except for
 *   a permanent administrator), or staff_without_login_no_role.
 * - Logins with no row (classifyLogin): patient, anonymous and portal
 *   sign-up logins are only counted; staff-tagged logins are
 *   staff_login_without_record with the full email; the rest are
 *   unknown_login with a masked email only.
 * - Rows with a login, only when launchedAt is set: a row made after launch
 *   whose login was not made or repaired here is staff_record_outside_users
 *   (information only).
 * Staff-tagged logins are listed first. Nothing is repaired here.
 */
export function accountHealth(
  logins: readonly LoginRecord[],
  rows: readonly AppUserRow[],
  patientUids: UidSet,
  _now: Date,
  launchedAt: Date | null,
  truncated: boolean,
): HealthReport {
  const uids = toSet(patientUids);
  const rowIds = new Set(rows.map((row) => row.id));
  const loginsById = new Map<string, LoginRecord>();
  for (const login of logins) {
    if (!loginsById.has(login.id)) loginsById.set(login.id, login);
  }

  const tagged: HealthItem[] = [];
  const rowProblems: HealthItem[] = [];
  const unknown: HealthItem[] = [];
  const outside: HealthItem[] = [];
  const counts = { portalPatients: 0, portalSignups: 0, anonymous: 0 };
  const launchedMs =
    launchedAt && !Number.isNaN(launchedAt.getTime()) ? launchedAt.getTime() : null;

  for (const row of rows) {
    const login = loginsById.get(row.id);
    if (!login) {
      rowProblems.push(rowWithoutLogin(row));
      continue;
    }
    if (launchedMs === null) continue;
    const createdMs = timeOf(row.created_at);
    const meta = login.appMetadata ?? {};
    if (
      createdMs !== null &&
      createdMs > launchedMs &&
      text(meta[APP_META.createdBy]) === null &&
      text(meta[APP_META.repair]) === null
    ) {
      outside.push({
        kind: "staff_record_outside_users",
        userId: row.id,
        // It has a staff record, so it is a staff account.
        email: text(login.email),
        emailMasked: maskEmailOrNull(login.email),
        fullName: text(row.full_name),
        createdAt: text(row.created_at),
        repair: null,
      });
    }
  }

  for (const login of loginsById.values()) {
    if (rowIds.has(login.id)) continue;
    switch (classifyLogin(login, { patientUids: uids })) {
      case "portal_patient":
        counts.portalPatients++;
        break;
      case "anonymous":
        counts.anonymous++;
        break;
      case "portal_signup":
        counts.portalSignups++;
        break;
      case "staff_tagged":
        tagged.push({
          kind: "staff_login_without_record",
          userId: login.id,
          email: text(login.email),
          emailMasked: maskEmailOrNull(login.email),
          fullName: text(login.userMetadata?.full_name),
          createdAt: text(login.createdAt),
          repair: "create_staff_record",
        });
        break;
      case "unknown": {
        const confirmed = timeOf(login.emailConfirmedAt) !== null;
        const item: HealthItem = {
          kind: "unknown_login",
          userId: login.id,
          // Not known to be staff: never the full email or the name.
          email: null,
          emailMasked: maskEmailOrNull(login.email),
          fullName: null,
          createdAt: text(login.createdAt),
          repair: confirmed ? "create_staff_record" : null,
        };
        if (!confirmed) item.blocked = "login_unconfirmed";
        unknown.push(item);
        break;
      }
    }
  }

  return {
    problems: [...tagged, ...rowProblems, ...unknown, ...outside],
    counts,
    truncated,
  };
}
