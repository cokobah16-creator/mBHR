import { describe, it, expect } from "vitest";
import { accountHealth, classifyLogin, hasPortalSignupKeys } from "./health";
import type { AppUserRow, LoginRecord } from "./portTypes";

const NOW = new Date("2026-09-25T12:00:00.000Z");
const LAUNCHED = new Date("2026-09-20T00:00:00.000Z");
const DOTS = "•••";

function login(id: string, over: Partial<LoginRecord> = {}): LoginRecord {
  return {
    id,
    email: `${id}@example.org`,
    createdAt: "2026-09-01T00:00:00.000Z",
    invitedAt: null,
    confirmationSentAt: null,
    emailConfirmedAt: "2026-09-02T00:00:00.000Z",
    lastSignInAt: null,
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
    full_name: `Name ${id}`,
    role: "nurse",
    admin_access: false,
    admin_permanent: false,
    created_at: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

const STAFF_TAG = { mbhr_account: "staff" };

describe("classifyLogin (logins with no staff record)", () => {
  const none = { patientUids: new Set<string>() };

  it("puts a patient link first, even over the staff tag", () => {
    const l = login("p1", { appMetadata: STAFF_TAG, isAnonymous: true });
    expect(classifyLogin(l, { patientUids: new Set(["p1"]) })).toBe("portal_patient");
  });

  it("then anonymous, then the staff tag, then portal sign-up keys", () => {
    expect(classifyLogin(login("a", { isAnonymous: true, appMetadata: STAFF_TAG }), none)).toBe("anonymous");
    expect(
      classifyLogin(login("t", { appMetadata: STAFF_TAG, userMetadata: { dob: "1990-01-01" } }), none),
    ).toBe("staff_tagged");
    expect(classifyLogin(login("s", { userMetadata: { dob: "1990-01-01" } }), none)).toBe("portal_signup");
    expect(classifyLogin(login("s2", { userMetadata: { accepted_at: "2026-01-01" } }), none)).toBe(
      "portal_signup",
    );
  });

  it("treats a login with only a name as unknown", () => {
    expect(classifyLogin(login("u", { userMetadata: { full_name: "Some One" } }), none)).toBe("unknown");
  });

  it("ignores the staff tag in user-editable metadata", () => {
    expect(classifyLogin(login("u", { userMetadata: STAFF_TAG }), none)).toBe("unknown");
  });

  it("accepts the patient ids as a list too", () => {
    expect(classifyLogin(login("p1"), { patientUids: ["p1"] })).toBe("portal_patient");
  });
});

describe("hasPortalSignupKeys", () => {
  it("ignores keys that are present but empty", () => {
    expect(hasPortalSignupKeys(login("x", { userMetadata: { dob: null, family_name: undefined } }))).toBe(false);
    expect(hasPortalSignupKeys(login("x", { userMetadata: { family_name: "" } }))).toBe(true);
  });
});

describe("accountHealth", () => {
  it("lists staff records with no login, with a repair unless it is a permanent administrator", () => {
    const report = accountHealth(
      [],
      [
        row("r1", { role: "nurse" }),
        row("r2", { role: "admin", admin_access: true, admin_permanent: true }),
        row("r3", { role: "guest" }),
        row("r4", { role: "registration_lead" }),
      ],
      new Set<string>(),
      NOW,
      null,
      false,
    );
    expect(report.problems).toEqual([
      {
        kind: "staff_without_login",
        userId: "r1",
        email: null,
        emailMasked: null,
        fullName: "Name r1",
        createdAt: "2026-09-01T00:00:00.000Z",
        repair: "create_login",
      },
      {
        kind: "staff_without_login",
        userId: "r2",
        email: null,
        emailMasked: null,
        fullName: "Name r2",
        createdAt: "2026-09-01T00:00:00.000Z",
        repair: null,
      },
      {
        kind: "staff_without_login_no_role",
        userId: "r3",
        email: null,
        emailMasked: null,
        fullName: "Name r3",
        createdAt: "2026-09-01T00:00:00.000Z",
        repair: null,
        blocked: "no_staff_role",
      },
      {
        kind: "staff_without_login_no_role",
        userId: "r4",
        email: null,
        emailMasked: null,
        fullName: "Name r4",
        createdAt: "2026-09-01T00:00:00.000Z",
        repair: null,
        blocked: "no_staff_role",
      },
    ]);
    expect(report.counts).toEqual({ portalPatients: 0, portalSignups: 0, anonymous: 0 });
    expect(report.truncated).toBe(false);
  });

  it("counts patient, anonymous and portal sign-up logins without listing them", () => {
    const report = accountHealth(
      [
        login("p1"),
        login("p2", { appMetadata: STAFF_TAG }),
        login("a1", { isAnonymous: true }),
        login("s1", { userMetadata: { given_name: "Amaka" } }),
      ],
      [],
      new Set(["p1", "p2"]),
      NOW,
      null,
      false,
    );
    expect(report.problems).toEqual([]);
    expect(report.counts).toEqual({ portalPatients: 2, portalSignups: 1, anonymous: 1 });
  });

  it("lists staff-tagged logins first with the full email, and masks unknown logins", () => {
    const report = accountHealth(
      [
        login("legacy", { userMetadata: { full_name: "Legacy Person" } }),
        login("pending", { emailConfirmedAt: null }),
        login("tagged", { appMetadata: STAFF_TAG, userMetadata: { full_name: "Tag Person" } }),
      ],
      [row("r1")],
      new Set<string>(),
      NOW,
      null,
      false,
    );
    expect(report.problems.map((p) => p.kind)).toEqual([
      "staff_login_without_record",
      "staff_without_login",
      "unknown_login",
      "unknown_login",
    ]);
    expect(report.problems[0]).toEqual({
      kind: "staff_login_without_record",
      userId: "tagged",
      email: "tagged@example.org",
      emailMasked: `t${DOTS}@e${DOTS}.org`,
      fullName: "Tag Person",
      createdAt: "2026-09-01T00:00:00.000Z",
      repair: "create_staff_record",
    });
    expect(report.problems[2]).toEqual({
      kind: "unknown_login",
      userId: "legacy",
      email: null,
      emailMasked: `l${DOTS}@e${DOTS}.org`,
      fullName: null,
      createdAt: "2026-09-01T00:00:00.000Z",
      repair: "create_staff_record",
    });
    expect(report.problems[3]).toMatchObject({
      userId: "pending",
      email: null,
      repair: null,
      blocked: "login_unconfirmed",
    });
  });

  it("never lists or counts a staff login that is also linked to a patient record", () => {
    const report = accountHealth(
      [login("emeke", { lastSignInAt: "2026-09-10T00:00:00.000Z" })],
      [row("emeke", { role: "admin", admin_access: true, admin_permanent: true })],
      new Set(["emeke"]),
      NOW,
      LAUNCHED,
      false,
    );
    expect(report.problems).toEqual([]);
    expect(report.counts).toEqual({ portalPatients: 0, portalSignups: 0, anonymous: 0 });
  });

  it("flags a staff record made outside the Users screen only when the launch date is set", () => {
    const rows = [
      row("after", { created_at: "2026-09-21T00:00:00.000Z" }),
      row("before", { created_at: "2026-09-19T00:00:00.000Z" }),
      row("made-here", { created_at: "2026-09-21T00:00:00.000Z" }),
      row("repaired", { created_at: "2026-09-21T00:00:00.000Z" }),
    ];
    const logins = [
      login("after"),
      login("before"),
      login("made-here", { appMetadata: { mbhr_created_by: "admin-1" } }),
      login("repaired", { appMetadata: { mbhr_repair: "create_staff_record" } }),
    ];

    expect(accountHealth(logins, rows, new Set<string>(), NOW, null, false).problems).toEqual([]);

    const report = accountHealth(logins, rows, new Set<string>(), NOW, LAUNCHED, false);
    expect(report.problems).toEqual([
      {
        kind: "staff_record_outside_users",
        userId: "after",
        email: "after@example.org",
        emailMasked: `a${DOTS}@e${DOTS}.org`,
        fullName: "Name after",
        createdAt: "2026-09-21T00:00:00.000Z",
        repair: null,
      },
    ]);
  });

  it("passes truncated through", () => {
    expect(accountHealth([], [], new Set<string>(), NOW, null, true).truncated).toBe(true);
    expect(accountHealth([], [], [], NOW, null, false).truncated).toBe(false);
  });

  it("reports a login read twice only once", () => {
    const tagged = login("tagged", { appMetadata: STAFF_TAG });
    const report = accountHealth([tagged, tagged], [], new Set<string>(), NOW, null, false);
    expect(report.problems).toHaveLength(1);
  });
});
