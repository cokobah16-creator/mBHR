import { describe, it, expect } from "vitest";
import {
  countOtherActiveAdmins,
  countsAsActiveAdmin,
  reactivateNeedsPatientChecks,
  staffActionRefusal,
  type GuardInput,
} from "./guards";
import type { AppUserRow, LoginRecord } from "./portTypes";

const NOW = new Date("2026-09-25T12:00:00.000Z");
const PAST = "2026-09-03T00:00:00.000Z";
const FUTURE = "2126-09-25T12:00:00.000Z";
const ACTOR = "11111111-1111-4111-8111-111111111111";
const TARGET = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

/** A confirmed login that has signed in. */
function login(id: string, over: Partial<LoginRecord> = {}): LoginRecord {
  return {
    id,
    email: "test.person@example.org",
    createdAt: "2026-09-01T00:00:00.000Z",
    invitedAt: null,
    confirmationSentAt: null,
    emailConfirmedAt: "2026-09-02T00:00:00.000Z",
    lastSignInAt: PAST,
    bannedUntil: null,
    isAnonymous: false,
    appMetadata: {},
    userMetadata: {},
    ...over,
  };
}

function row(id: string, over: Partial<AppUserRow> = {}): AppUserRow {
  return {
    id,
    full_name: "Test Person",
    role: "nurse",
    admin_access: false,
    admin_permanent: false,
    created_at: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

function adminRow(id: string, over: Partial<AppUserRow> = {}): AppUserRow {
  return row(id, { role: "admin", admin_access: true, ...over });
}

function input(over: Partial<GuardInput> = {}): GuardInput {
  return {
    action: "disable",
    actorId: ACTOR,
    actorPermanent: false,
    row: row(TARGET),
    login: login(TARGET),
    otherActiveAdmins: 1,
    now: NOW,
    ...over,
  };
}

/** The refusal code, or null when the action may go ahead. */
function code(over: Partial<GuardInput> = {}): string | null {
  return staffActionRefusal(input(over))?.error ?? null;
}

describe("countsAsActiveAdmin", () => {
  it("counts a confirmed administrator who has signed in", () => {
    expect(countsAsActiveAdmin(adminRow(OTHER), login(OTHER), NOW)).toBe(true);
  });

  it("counts a confirmed administrator who has set a password but not signed in", () => {
    const l = login(OTHER, { lastSignInAt: null, userMetadata: { mbhr_password_set_at: PAST } });
    expect(countsAsActiveAdmin(adminRow(OTHER), l, NOW)).toBe(true);
  });

  it("does not count a banned login", () => {
    expect(countsAsActiveAdmin(adminRow(OTHER), login(OTHER, { bannedUntil: FUTURE }), NOW)).toBe(false);
  });

  it("does not count an unconfirmed login", () => {
    expect(countsAsActiveAdmin(adminRow(OTHER), login(OTHER, { emailConfirmedAt: null }), NOW)).toBe(false);
  });

  it("does not count a confirmed login with neither a password marker nor a sign-in", () => {
    expect(countsAsActiveAdmin(adminRow(OTHER), login(OTHER, { lastSignInAt: null }), NOW)).toBe(false);
  });

  it("counts a permanent administrator with a login, and not one without", () => {
    const permanent = adminRow(OTHER, { admin_permanent: true });
    const fresh = login(OTHER, { emailConfirmedAt: null, lastSignInAt: null });
    expect(countsAsActiveAdmin(permanent, fresh, NOW)).toBe(true);
    expect(countsAsActiveAdmin(permanent, null, NOW)).toBe(false);
    expect(countsAsActiveAdmin(permanent, login(OTHER, { bannedUntil: FUTURE }), NOW)).toBe(false);
  });

  it("does not count a switched-off row", () => {
    expect(countsAsActiveAdmin(adminRow(OTHER, { is_active: false }), login(OTHER), NOW)).toBe(false);
  });

  it("counts the admin role only, not admin_access on another role", () => {
    expect(countsAsActiveAdmin(row(OTHER, { admin_access: true }), login(OTHER), NOW)).toBe(false);
    expect(countsAsActiveAdmin(adminRow(OTHER, { role: "guest" }), login(OTHER), NOW)).toBe(false);
  });

  it("does not count an anonymous login or another person's login", () => {
    expect(countsAsActiveAdmin(adminRow(OTHER), login(OTHER, { isAnonymous: true }), NOW)).toBe(false);
    expect(countsAsActiveAdmin(adminRow(OTHER), login(TARGET), NOW)).toBe(false);
  });
});

describe("countOtherActiveAdmins", () => {
  it("leaves out the target, repeats and administrators who cannot act", () => {
    const admins = [
      { row: adminRow(TARGET), login: login(TARGET) },
      { row: adminRow(OTHER), login: login(OTHER) },
      { row: adminRow(OTHER), login: login(OTHER) },
      { row: adminRow(ACTOR), login: login(ACTOR, { bannedUntil: FUTURE }) },
    ];
    expect(countOtherActiveAdmins(admins, TARGET, NOW)).toBe(1);
    expect(countOtherActiveAdmins(admins, OTHER, NOW)).toBe(1);
    expect(countOtherActiveAdmins([], TARGET, NOW)).toBe(0);
  });
});

describe("staffActionRefusal: actions with no target", () => {
  it("never refuses ping or overview", () => {
    expect(code({ action: "ping", row: null, login: null })).toBeNull();
    expect(code({ action: "overview", row: null, login: null })).toBeNull();
  });
});

describe("staffActionRefusal: create", () => {
  it("adds no administrator while ADMIN_ACCOUNTS_ENABLED is off, even for a permanent administrator", () => {
    const base = { action: "create" as const, row: null, login: null };
    expect(staffActionRefusal(input({ ...base, requestedRole: "admin" }))).toEqual({
      status: 409,
      error: "admin_accounts_unavailable",
      message: "Adding or restoring administrators isn't available on this server yet.",
    });
    expect(code({ ...base, requestedRole: "admin", actorPermanent: true })).toBe("admin_accounts_unavailable");
    expect(code({ ...base, requestedRole: "nurse" })).toBeNull();
  });
});

describe("staffActionRefusal: login_status", () => {
  it("needs a staff record or the staff tag", () => {
    expect(code({ action: "login_status", row: null })).toBe("not_staff_account");
    expect(
      code({ action: "login_status", row: null, login: login(TARGET, { appMetadata: { mbhr_account: "staff" } }) }),
    ).toBeNull();
    expect(code({ action: "login_status" })).toBeNull();
    expect(code({ action: "login_status", login: null })).toBeNull();
  });
});

describe("staffActionRefusal: resend_invitation and reset_password", () => {
  it("needs a staff record and a login", () => {
    for (const action of ["resend_invitation", "reset_password"] as const) {
      expect(code({ action, row: null })).toBe("not_staff_account");
      expect(code({ action, login: null })).toBe("no_login");
    }
  });

  it("refuses a disabled account", () => {
    for (const action of ["resend_invitation", "reset_password"] as const) {
      expect(code({ action, login: login(TARGET, { bannedUntil: FUTURE }) })).toBe("account_disabled");
      expect(code({ action, row: row(TARGET, { role: "guest" }) })).toBe("account_disabled");
      expect(code({ action, row: row(TARGET, { is_active: false }) })).toBe("account_disabled");
    }
  });

  it("sends an invitation again to someone who has not confirmed", () => {
    const unconfirmed = login(TARGET, { emailConfirmedAt: null, lastSignInAt: null });
    expect(code({ action: "resend_invitation", login: unconfirmed })).toBeNull();
    expect(code({ action: "resend_invitation" })).toBeNull();
  });

  it("points a reset for someone who has not confirmed to Resend invitation", () => {
    const unconfirmed = login(TARGET, { emailConfirmedAt: null, lastSignInAt: null });
    expect(code({ action: "reset_password", login: unconfirmed })).toBe("use_resend_invitation");
    expect(code({ action: "reset_password" })).toBeNull();
  });

  it("lets the caller reset their own password", () => {
    expect(code({ action: "reset_password", row: row(ACTOR), login: login(ACTOR) })).toBeNull();
  });
});

describe("staffActionRefusal: disable", () => {
  it("needs a staff record and a login", () => {
    expect(code({ row: null })).toBe("not_staff_account");
    expect(code({ login: null })).toBe("no_login");
  });

  it("refuses the caller's own account first", () => {
    const own = staffActionRefusal(
      input({ row: adminRow(ACTOR, { admin_permanent: true }), login: login(ACTOR), otherActiveAdmins: 0 }),
    );
    expect(own).toEqual({ status: 409, error: "own_account", message: "You can't disable your own account." });
  });

  it("refuses a permanent administrator", () => {
    expect(code({ row: adminRow(TARGET, { admin_permanent: true }), actorPermanent: true })).toBe(
      "permanent_admin",
    );
  });

  it("refuses the last active administrator", () => {
    expect(staffActionRefusal(input({ row: adminRow(TARGET), otherActiveAdmins: 0 }))).toMatchObject({
      status: 409,
      error: "last_admin",
    });
    expect(code({ row: adminRow(TARGET), otherActiveAdmins: 1 })).toBeNull();
  });

  it("does not apply the last-administrator rule to other roles", () => {
    expect(code({ otherActiveAdmins: 0 })).toBeNull();
  });

  it("does not refuse a staff login that is also linked to a patient record", () => {
    expect(code({ patientLinked: true, patientEmailOnFile: true })).toBeNull();
  });
});

describe("staffActionRefusal: reactivate", () => {
  const disabledRow = row(TARGET, { role: "guest" });
  // Disabled by this function: mbhr_disabled_at is set.
  const bannedLogin = login(TARGET, { bannedUntil: FUTURE, appMetadata: { mbhr_disabled_at: PAST } });

  it("needs a staff record and a login, and refuses the caller's own account", () => {
    expect(code({ action: "reactivate", row: null })).toBe("not_staff_account");
    expect(code({ action: "reactivate", login: null })).toBe("no_login");
    expect(staffActionRefusal(input({ action: "reactivate", row: row(ACTOR), login: login(ACTOR) }))).toEqual({
      status: 409,
      error: "own_account",
      message: "You can't reactivate your own account.",
    });
  });

  it("refuses an account that is already active", () => {
    expect(code({ action: "reactivate" })).toBe("already_active");
  });

  it("lets a retry lift the ban when the staff record is already back", () => {
    expect(code({ action: "reactivate", login: bannedLogin, requestedRole: null })).toBeNull();
  });

  it("needs a role to restore", () => {
    expect(code({ action: "reactivate", row: disabledRow, login: bannedLogin, requestedRole: null })).toBe(
      "role_needed",
    );
    expect(code({ action: "reactivate", row: disabledRow, login: bannedLogin, requestedRole: "guest" })).toBe(
      "role_needed",
    );
    expect(code({ action: "reactivate", row: disabledRow, login: bannedLogin, requestedRole: "nurse" })).toBeNull();
  });

  it("restores no administrator while ADMIN_ACCOUNTS_ENABLED is off", () => {
    const base = { action: "reactivate" as const, row: disabledRow, login: bannedLogin, requestedRole: "admin" };
    expect(code(base)).toBe("admin_accounts_unavailable");
    expect(code({ ...base, actorPermanent: true })).toBe("admin_accounts_unavailable");
  });

  it("does not lift the ban on an admin record that kept its role while ADMIN_ACCOUNTS_ENABLED is off", () => {
    const base = { action: "reactivate" as const, row: adminRow(TARGET), login: bannedLogin, requestedRole: "admin" };
    expect(code(base)).toBe("admin_accounts_unavailable");
    expect(code({ ...base, actorPermanent: true })).toBe("admin_accounts_unavailable");
    // Nothing to undo still says so first.
    expect(code({ ...base, login: login(TARGET) })).toBe("already_active");
  });

  describe("a record with no staff role on a login this function never disabled or tagged", () => {
    const unmarked = login(TARGET, { bannedUntil: FUTURE });
    const base = { action: "reactivate" as const, row: disabledRow, login: unmarked, requestedRole: "nurse" };

    it("needs the patient checks", () => {
      expect(reactivateNeedsPatientChecks(unmarked)).toBe(true);
      expect(reactivateNeedsPatientChecks(bannedLogin)).toBe(false);
      expect(reactivateNeedsPatientChecks(login(TARGET, { appMetadata: { mbhr_account: "staff" } }))).toBe(false);
    });

    it("refuses when a check is missing, so a lookup that was not made refuses", () => {
      expect(code(base)).toBe("patient_login");
      expect(code({ ...base, patientLinked: false })).toBe("patient_email");
    });

    it("refuses a patient's login, a patient's email and a portal sign-up", () => {
      const clear = { patientLinked: false, patientEmailOnFile: false };
      expect(code({ ...base, ...clear, patientLinked: true })).toBe("patient_login");
      expect(code({ ...base, ...clear, patientEmailOnFile: true })).toBe("patient_email");
      const portal = login(TARGET, { bannedUntil: FUTURE, userMetadata: { dob: "1990-01-01" } });
      expect(code({ ...base, ...clear, login: portal })).toBe("portal_signup");
      expect(code({ ...base, ...clear })).toBeNull();
    });

    it("checks the patient link before asking for a role", () => {
      expect(code({ ...base, requestedRole: null })).toBe("patient_login");
      expect(code({ ...base, requestedRole: null, patientLinked: false, patientEmailOnFile: false })).toBe(
        "role_needed",
      );
    });

    it("never applies the patient checks to a disabled or tagged staff login", () => {
      const tagged = login(TARGET, { bannedUntil: FUTURE, appMetadata: { mbhr_account: "staff" } });
      expect(code({ ...base, login: tagged, patientLinked: true, patientEmailOnFile: true })).toBeNull();
      expect(code({ ...base, login: bannedLogin, patientLinked: true, patientEmailOnFile: true })).toBeNull();
    });

    it("never applies them to a record that still has a staff role", () => {
      expect(code({ ...base, row: row(TARGET), requestedRole: "nurse" })).toBeNull();
    });
  });
});

describe("staffActionRefusal: update", () => {
  const update = (over: Partial<GuardInput> = {}) => code({ action: "update", ...over });

  it("1. needs a staff record", () => {
    expect(update({ row: null, requestedRole: "doctor" })).toBe("not_staff_account");
  });

  it("2. refuses a staff record with no staff role or switched off", () => {
    expect(update({ row: row(TARGET, { role: "guest" }) })).toBe("account_disabled");
    expect(update({ row: row(TARGET, { is_active: false }) })).toBe("account_disabled");
  });

  it("3. refuses a banned login", () => {
    const refusal = staffActionRefusal(
      input({ action: "update", login: login(TARGET, { bannedUntil: FUTURE }) }),
    );
    expect(refusal).toEqual({
      status: 409,
      error: "account_disabled",
      message: "This account is disabled. Reactivate it first.",
    });
  });

  it("allows a name change with no login", () => {
    expect(update({ login: null, requestedRole: null })).toBeNull();
  });

  it("5. refuses a role that cannot be given", () => {
    expect(staffActionRefusal(input({ action: "update", requestedRole: "guest" }))).toMatchObject({
      status: 422,
      error: "role_not_allowed",
      field: "role",
    });
    expect(update({ requestedRole: "registration_lead" })).toBe("role_not_allowed");
  });

  it("6. refuses a change to the caller's own role, but not to their own name", () => {
    const own = { row: row(ACTOR), login: login(ACTOR) };
    expect(staffActionRefusal(input({ action: "update", ...own, requestedRole: "doctor" }))).toEqual({
      status: 409,
      error: "own_account",
      message: "You can't change your own role.",
    });
    expect(update({ ...own, requestedRole: null })).toBeNull();
    expect(update({ ...own, requestedRole: "nurse" })).toBeNull();
  });

  it("7. refuses a role change on a permanent administrator, before the own-account rule", () => {
    const permanent = adminRow(TARGET, { admin_permanent: true });
    expect(update({ row: permanent, requestedRole: "nurse", actorPermanent: true })).toBe("permanent_admin");
    expect(update({ row: permanent, requestedRole: null })).toBeNull();
    expect(update({ row: permanent, requestedRole: "admin" })).toBeNull();
    expect(
      update({
        row: adminRow(ACTOR, { admin_permanent: true }),
        login: login(ACTOR),
        requestedRole: "nurse",
        actorPermanent: true,
      }),
    ).toBe("permanent_admin");
  });

  it("8. gives no one the admin role while ADMIN_ACCOUNTS_ENABLED is off", () => {
    expect(staffActionRefusal(input({ action: "update", requestedRole: "admin" }))).toMatchObject({
      status: 409,
      error: "admin_accounts_unavailable",
    });
    expect(update({ requestedRole: "admin", actorPermanent: true, otherActiveAdmins: 0 })).toBe(
      "admin_accounts_unavailable",
    );
  });

  it("9. keeps another active administrator when an administrator's role changes", () => {
    expect(update({ row: adminRow(TARGET), requestedRole: "nurse", otherActiveAdmins: 0 })).toBe("last_admin");
    expect(update({ row: adminRow(TARGET), requestedRole: "nurse", otherActiveAdmins: 1 })).toBeNull();
    expect(update({ requestedRole: "doctor", otherActiveAdmins: 0 })).toBeNull();
  });

  it("does not refuse a staff login that is also linked to a patient record", () => {
    expect(update({ requestedRole: "doctor", patientLinked: true, patientEmailOnFile: true })).toBeNull();
  });
});

describe("staffActionRefusal: create_login", () => {
  const base = { action: "create_login" as const, login: null };

  it("needs a staff record with a role that can be given", () => {
    expect(code({ ...base, row: null })).toBe("not_staff_account");
    expect(code({ ...base, row: row(TARGET, { role: "guest" }) })).toBe("no_staff_role");
    expect(code({ ...base, row: row(TARGET, { role: "registration_lead" }) })).toBe("no_staff_role");
  });

  it("never recreates a permanent administrator's login", () => {
    expect(code({ ...base, row: adminRow(TARGET, { admin_permanent: true }), actorPermanent: true })).toBe(
      "permanent_admin",
    );
  });

  it("makes no login for an admin row while ADMIN_ACCOUNTS_ENABLED is off", () => {
    expect(code({ ...base, row: adminRow(TARGET) })).toBe("admin_accounts_unavailable");
    expect(code({ ...base, row: adminRow(TARGET), actorPermanent: true })).toBe("admin_accounts_unavailable");
  });

  it("refuses when a login already exists", () => {
    expect(code({ ...base, login: login(TARGET) })).toBe("login_exists");
    expect(code(base)).toBeNull();
  });
});

describe("staffActionRefusal: create_staff_record", () => {
  const base: Partial<GuardInput> = {
    action: "create_staff_record",
    row: null,
    login: login(TARGET),
    requestedRole: "nurse",
    patientLinked: false,
    patientEmailOnFile: false,
  };
  const record = (over: Partial<GuardInput> = {}) => code({ ...base, ...over });

  it("allows a confirmed login with no patient link", () => {
    expect(record()).toBeNull();
  });

  it("needs a login and no staff record", () => {
    expect(record({ login: null })).toBe("not_found");
    expect(record({ row: row(TARGET) })).toBe("staff_exists");
  });

  it("never grants admin", () => {
    expect(record({ requestedRole: "admin", actorPermanent: true })).toBe("role_not_allowed");
    expect(record({ requestedRole: null })).toBe("role_not_allowed");
    expect(record({ requestedRole: "guest" })).toBe("role_not_allowed");
  });

  it("refuses a patient's login, and refuses when the patient checks were not run", () => {
    expect(record({ patientLinked: true })).toBe("patient_login");
    expect(record({ patientLinked: undefined })).toBe("patient_login");
    expect(record({ patientEmailOnFile: true })).toBe("patient_email");
    expect(record({ patientEmailOnFile: undefined })).toBe("patient_email");
  });

  it("refuses portal sign-ups, anonymous and banned logins", () => {
    expect(record({ login: login(TARGET, { userMetadata: { dob: "1990-01-01" } }) })).toBe("portal_signup");
    expect(record({ login: login(TARGET, { isAnonymous: true }) })).toBe("anonymous_login");
    expect(record({ login: login(TARGET, { bannedUntil: FUTURE }) })).toBe("account_disabled");
  });

  it("refuses an unconfirmed login unless it is tagged as staff", () => {
    const unconfirmed = { emailConfirmedAt: null, lastSignInAt: null };
    expect(record({ login: login(TARGET, unconfirmed) })).toBe("login_unconfirmed");
    expect(
      record({ login: login(TARGET, { ...unconfirmed, appMetadata: { mbhr_account: "staff" } }) }),
    ).toBeNull();
  });
});
