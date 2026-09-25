import { describe, it, expect } from "vitest";
import {
  accountStatus,
  accountView,
  createdViaOf,
  isAccountDisabled,
  isLoginBanned,
  isStaffRole,
  isStaffTagged,
  lastInvitationSentAt,
  passwordSetAtOf,
  staffNameMap,
} from "./status";
import type { AppUserRow, LoginRecord } from "./portTypes";

const NOW = new Date("2026-09-25T12:00:00.000Z");
const LIFETIME = 3600;
const ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const ADMIN_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const OTHER_ADMIN_ID = "9b2d4a8e-1c3f-4e5a-8b7c-6d5e4f3a2b1c";

/** An ISO time `seconds` before NOW. */
function ago(seconds: number): string {
  return new Date(NOW.getTime() - seconds * 1000).toISOString();
}

/** A confirmed legacy login that has signed in. */
function login(over: Partial<LoginRecord> = {}): LoginRecord {
  return {
    id: ID,
    email: "test.person@example.org",
    createdAt: "2026-09-01T00:00:00.000Z",
    invitedAt: null,
    confirmationSentAt: null,
    emailConfirmedAt: "2026-09-02T00:00:00.000Z",
    lastSignInAt: "2026-09-03T00:00:00.000Z",
    bannedUntil: null,
    isAnonymous: false,
    appMetadata: {},
    userMetadata: {},
    ...over,
  };
}

function row(over: Partial<AppUserRow> = {}): AppUserRow {
  return {
    id: ID,
    full_name: "Test Person",
    role: "nurse",
    admin_access: false,
    admin_permanent: false,
    created_at: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

describe("isStaffRole", () => {
  it("accepts the staff roles the app knows", () => {
    for (const role of ["volunteer", "nurse", "doctor", "pharmacist", "admin", "auditor", "lead_clinician"]) {
      expect(isStaffRole(role)).toBe(true);
    }
  });

  it("refuses guest, unknown roles and non-strings", () => {
    for (const role of ["guest", "", "Nurse", "janitor", null, undefined, 5, {}]) {
      expect(isStaffRole(role)).toBe(false);
    }
  });
});

describe("accountStatus: rules in order", () => {
  it("1. a staff record with no login needs setup", () => {
    expect(accountStatus(null, row(), NOW, LIFETIME)).toEqual({
      status: "setup_required",
      detail: "no_login",
      disablePartial: false,
      passwordSetAt: null,
    });
  });

  it("2. a banned login is disabled by an administrator", () => {
    const s = accountStatus(login({ bannedUntil: "2126-09-25T12:00:00.000Z" }), row(), NOW, LIFETIME);
    expect(s.status).toBe("disabled");
    expect(s.detail).toBe("by_admin");
  });

  it("2. flags a partial disable when the row still has a staff role", () => {
    const banned = login({ bannedUntil: "2126-09-25T12:00:00.000Z" });
    expect(accountStatus(banned, row({ role: "nurse" }), NOW, LIFETIME).disablePartial).toBe(true);
    expect(accountStatus(banned, row({ role: "guest" }), NOW, LIFETIME).disablePartial).toBe(false);
    expect(accountStatus(banned, null, NOW, LIFETIME).disablePartial).toBe(false);
  });

  it("2. a ban that has ended does not count", () => {
    const s = accountStatus(login({ bannedUntil: ago(60) }), row(), NOW, LIFETIME);
    expect(s).toMatchObject({ status: "active", detail: "signed_in", disablePartial: false });
  });

  it("2. a ban time that cannot be read counts as banned", () => {
    const s = accountStatus(login({ bannedUntil: "not a date" }), row(), NOW, LIFETIME);
    expect(s.status).toBe("disabled");
  });

  it("3. a switched-off row is disabled", () => {
    const s = accountStatus(login(), row({ is_active: false }), NOW, LIFETIME);
    expect(s).toMatchObject({ status: "disabled", detail: "switched_off" });
  });

  it("4. a demoted guest row with a recorded Disable is disabled by an administrator", () => {
    const s = accountStatus(
      login({ appMetadata: { mbhr_disabled_at: ago(3600), mbhr_disabled_role: "nurse" } }),
      row({ role: "guest" }),
      NOW,
      LIFETIME,
    );
    expect(s).toEqual({
      status: "disabled",
      detail: "by_admin",
      disablePartial: false,
      passwordSetAt: null,
    });
  });

  it("4. a guest or unknown role with no recorded Disable has no staff role", () => {
    for (const role of ["guest", "janitor"]) {
      const s = accountStatus(login(), row({ role }), NOW, LIFETIME);
      expect(s).toMatchObject({ status: "disabled", detail: "no_staff_role" });
    }
  });

  it("4. a staff-tagged login with no staff record has no staff role", () => {
    const s = accountStatus(login({ appMetadata: { mbhr_account: "staff" } }), null, NOW, LIFETIME);
    expect(s).toMatchObject({ status: "disabled", detail: "no_staff_role" });
  });

  it("5. an unconfirmed login with no email sent needs setup", () => {
    const s = accountStatus(login({ emailConfirmedAt: null, lastSignInAt: null }), row(), NOW, LIFETIME);
    expect(s).toMatchObject({ status: "setup_required", detail: "invitation_not_sent" });
  });

  it("5. a recent invitation is pending and an old one has expired", () => {
    const pending = login({ emailConfirmedAt: null, lastSignInAt: null, invitedAt: ago(1800) });
    const expired = login({ emailConfirmedAt: null, lastSignInAt: null, invitedAt: ago(7200) });
    expect(accountStatus(pending, row(), NOW, LIFETIME)).toMatchObject({
      status: "invited",
      detail: "pending",
    });
    expect(accountStatus(expired, row(), NOW, LIFETIME)).toMatchObject({
      status: "invited",
      detail: "expired",
    });
  });

  it("5. expiry is measured from the later of invitedAt and confirmationSentAt", () => {
    const at = (seconds: number) =>
      login({
        emailConfirmedAt: null,
        lastSignInAt: null,
        invitedAt: ago(7200),
        confirmationSentAt: ago(seconds),
      });
    expect(accountStatus(at(3600), row(), NOW, LIFETIME).detail).toBe("pending");
    expect(accountStatus(at(3601), row(), NOW, LIFETIME).detail).toBe("expired");
  });

  it("5. uses the lifetime it is given", () => {
    const l = login({ emailConfirmedAt: null, lastSignInAt: null, invitedAt: ago(7200) });
    expect(accountStatus(l, row(), NOW, 86400).detail).toBe("pending");
  });

  it("6. a login made from the Users screen with no password marker needs setup", () => {
    const l = login({ appMetadata: { mbhr_created_by: ADMIN_ID, mbhr_account: "staff" } });
    expect(accountStatus(l, row(), NOW, LIFETIME)).toMatchObject({
      status: "setup_required",
      detail: "password_not_set",
    });
  });

  it("6. an unreadable password marker does not count as set", () => {
    const l = login({
      appMetadata: { mbhr_created_by: ADMIN_ID },
      userMetadata: { mbhr_password_set_at: "yes" },
    });
    expect(accountStatus(l, row(), NOW, LIFETIME)).toMatchObject({
      detail: "password_not_set",
      passwordSetAt: null,
    });
  });

  it("6. the password marker makes it active and is returned for display", () => {
    const setAt = ago(600);
    const l = login({
      appMetadata: { mbhr_created_by: ADMIN_ID },
      userMetadata: { mbhr_password_set_at: setAt },
    });
    expect(accountStatus(l, row(), NOW, LIFETIME)).toEqual({
      status: "active",
      detail: "signed_in",
      disablePartial: false,
      passwordSetAt: setAt,
    });
  });

  it("6. a repaired login with no marker is active", () => {
    const l = login({
      appMetadata: { mbhr_created_by: ADMIN_ID, mbhr_repair: "create_staff_record" },
    });
    expect(accountStatus(l, row(), NOW, LIFETIME)).toMatchObject({
      status: "active",
      detail: "signed_in",
    });
  });

  it("7. a legacy untagged login is active", () => {
    expect(accountStatus(login(), row(), NOW, LIFETIME)).toEqual({
      status: "active",
      detail: "signed_in",
      disablePartial: false,
      passwordSetAt: null,
    });
    expect(accountStatus(login({ lastSignInAt: null }), row(), NOW, LIFETIME)).toMatchObject({
      status: "active",
      detail: "never_signed_in",
    });
  });
});

describe("status helpers", () => {
  it("isLoginBanned compares with now and treats a missing login as not banned", () => {
    expect(isLoginBanned(login({ bannedUntil: ago(-60) }), NOW)).toBe(true);
    expect(isLoginBanned(login({ bannedUntil: ago(60) }), NOW)).toBe(false);
    expect(isLoginBanned(login({ bannedUntil: "" }), NOW)).toBe(false);
    expect(isLoginBanned(null, NOW)).toBe(false);
  });

  it("isAccountDisabled covers a ban, a switched-off row and a non-staff role", () => {
    expect(isAccountDisabled(row(), login(), NOW)).toBe(false);
    expect(isAccountDisabled(row(), login({ bannedUntil: ago(-60) }), NOW)).toBe(true);
    expect(isAccountDisabled(row({ is_active: false }), login(), NOW)).toBe(true);
    expect(isAccountDisabled(row({ role: "guest" }), login(), NOW)).toBe(true);
    expect(isAccountDisabled(row(), null, NOW)).toBe(false);
  });

  it("isStaffTagged reads only the server-only app_metadata tag", () => {
    expect(isStaffTagged(login({ appMetadata: { mbhr_account: "staff" } }))).toBe(true);
    expect(isStaffTagged(login({ userMetadata: { mbhr_account: "staff" } }))).toBe(false);
    expect(isStaffTagged(login())).toBe(false);
    expect(isStaffTagged(null)).toBe(false);
  });

  it("lastInvitationSentAt takes the later time and ignores bad values", () => {
    expect(lastInvitationSentAt(login())).toBeNull();
    expect(lastInvitationSentAt(login({ invitedAt: ago(100), confirmationSentAt: ago(50) }))).toBe(
      NOW.getTime() - 50_000,
    );
    expect(lastInvitationSentAt(login({ invitedAt: ago(50), confirmationSentAt: "bad" }))).toBe(
      NOW.getTime() - 50_000,
    );
  });

  it("passwordSetAtOf returns only a readable time", () => {
    expect(passwordSetAtOf(login({ userMetadata: { mbhr_password_set_at: ago(10) } }))).toBe(ago(10));
    expect(passwordSetAtOf(login({ userMetadata: { mbhr_password_set_at: 5 } }))).toBeNull();
    expect(passwordSetAtOf(null)).toBeNull();
  });

  it("createdViaOf prefers a repair over a Users screen creation", () => {
    expect(createdViaOf(login({ appMetadata: { mbhr_repair: "create_login", mbhr_created_by: ADMIN_ID } }))).toBe(
      "repair",
    );
    expect(createdViaOf(login({ appMetadata: { mbhr_created_by: ADMIN_ID } }))).toBe("users_screen");
    expect(createdViaOf(login())).toBe("not_recorded");
    expect(createdViaOf(null)).toBe("not_recorded");
  });
});

describe("accountView", () => {
  const admin = row({ id: ADMIN_ID, full_name: "Ada Admin", role: "admin", admin_access: true });
  const other = row({ id: OTHER_ADMIN_ID, full_name: "Bola Admin", role: "admin", admin_access: true });
  const names = staffNameMap([admin, other, row({ id: "x", full_name: null })]);

  it("builds the view with the full email and the names of who acted", () => {
    const view = accountView({
      userId: ID,
      row: row({ role: "guest" }),
      login: login({
        invitedAt: ago(90000),
        appMetadata: {
          mbhr_created_by: ADMIN_ID,
          mbhr_disabled_by: OTHER_ADMIN_ID,
          mbhr_disabled_at: ago(60),
        },
      }),
      now: NOW,
      inviteLifetimeSec: LIFETIME,
      names,
    });
    expect(view).toEqual({
      userId: ID,
      fullName: "Test Person",
      role: "guest",
      adminAccess: false,
      adminPermanent: false,
      email: "test.person@example.org",
      status: "disabled",
      statusDetail: "by_admin",
      disablePartial: false,
      invitedAt: ago(90000),
      emailConfirmedAt: "2026-09-02T00:00:00.000Z",
      lastSignInAt: "2026-09-03T00:00:00.000Z",
      passwordSetAt: null,
      createdAt: "2026-09-01T00:00:00.000Z",
      createdVia: "users_screen",
      createdByName: "Ada Admin",
      disabledAt: ago(60),
      disabledByName: "Bola Admin",
    });
  });

  it("names the repairer for a repaired account", () => {
    const view = accountView({
      userId: ID,
      row: row(),
      login: login({ appMetadata: { mbhr_repair: "create_login", mbhr_repair_by: OTHER_ADMIN_ID } }),
      now: NOW,
      inviteLifetimeSec: LIFETIME,
      names,
    });
    expect(view.createdVia).toBe("repair");
    expect(view.createdByName).toBe("Bola Admin");
  });

  it("keeps a staff login that is also linked to a patient record a normal staff account", () => {
    const view = accountView({
      userId: ADMIN_ID,
      row: row({ id: ADMIN_ID, full_name: "Ada Admin", role: "admin", admin_access: true, admin_permanent: true }),
      login: login({ id: ADMIN_ID, email: "ada@example.org" }),
      now: NOW,
      inviteLifetimeSec: LIFETIME,
      names,
      patientUids: new Set([ADMIN_ID]),
    });
    expect(view).toMatchObject({
      userId: ADMIN_ID,
      email: "ada@example.org",
      role: "admin",
      adminPermanent: true,
      status: "active",
      statusDetail: "signed_in",
      linkedPatientRecord: true,
    });
  });

  it("leaves the patient flag off when there is no link", () => {
    const view = accountView({ userId: ID, row: row(), login: login(), now: NOW, inviteLifetimeSec: LIFETIME });
    expect(view).not.toHaveProperty("linkedPatientRecord");
    expect(view.createdByName).toBeNull();
  });

  it("shows a staff record with no login", () => {
    const view = accountView({ userId: ID, row: row(), login: null, now: NOW, inviteLifetimeSec: LIFETIME });
    expect(view).toMatchObject({
      email: null,
      status: "setup_required",
      statusDetail: "no_login",
      invitedAt: null,
      createdAt: "2026-09-01T00:00:00.000Z",
      createdVia: "not_recorded",
    });
  });

  it("uses the login's name and time for a staff-tagged login with no record", () => {
    const view = accountView({
      userId: ID,
      row: null,
      login: login({ appMetadata: { mbhr_account: "staff" }, userMetadata: { full_name: "Tag Person" } }),
      now: NOW,
      inviteLifetimeSec: LIFETIME,
    });
    expect(view).toMatchObject({
      fullName: "Tag Person",
      role: "",
      createdAt: "2026-09-01T00:00:00.000Z",
      statusDetail: "no_staff_role",
    });
  });
});
