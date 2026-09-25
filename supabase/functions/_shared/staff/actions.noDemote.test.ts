import { describe, it, expect, vi } from "vitest";

// Disable when the demotion to guest is switched off (constants.ts,
// DISABLE_DEMOTES_ROLE = false): ban only, refused for administrators.
// In its own file because the whole module graph sees the mocked value.
vi.mock("./constants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./constants")>();
  return { ...actual, DISABLE_DEMOTES_ROLE: false };
});

import { runStaffAdminAction, type ActionContext } from "./actions";
import { BAN_DURATION, DISABLE_DEMOTES_ROLE, UNBAN } from "./constants";
import type { AppUserRow, LoginRecord, PortResult, StaffAdminPort } from "./portTypes";

const NOW = new Date("2026-09-25T12:00:00.000Z");
const FUTURE = "2126-09-25T12:00:00.000Z";
const ACTOR = "11111111-1111-4111-8111-111111111111";
const TARGET = "22222222-2222-4222-8222-222222222222";
const OTHER_ADMIN = "33333333-3333-4333-8333-333333333333";

const CTX: ActionContext = {
  actorId: ACTOR,
  now: NOW,
  appOrigin: "https://staff.example.org",
  inviteLifetimeSec: 3600,
  launchedAt: null,
};

function login(id: string, over: Partial<LoginRecord> = {}): LoginRecord {
  return {
    id,
    email: `${id.slice(0, 4)}@example.org`,
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

function ok<T>(data: T): PortResult<T> {
  return { data, error: null };
}

/** Just enough of the port for Disable, recording the method names called. */
function fake(target: AppUserRow, targetLogin: LoginRecord) {
  const rows = new Map<string, AppUserRow>([
    [ACTOR, row(ACTOR, { role: "admin", admin_access: true })],
    [OTHER_ADMIN, row(OTHER_ADMIN, { role: "admin", admin_access: true })],
    [TARGET, { ...target }],
  ]);
  const logins = new Map<string, LoginRecord>([
    [ACTOR, login(ACTOR)],
    [OTHER_ADMIN, login(OTHER_ADMIN)],
    [TARGET, { ...targetLogin }],
  ]);
  const calls: string[] = [];
  const notUsed = async (): Promise<never> => {
    throw new Error("not used by disable");
  };

  const port: StaffAdminPort = {
    async getUserById(id) {
      calls.push("getUserById");
      return ok(logins.get(id) ?? null);
    },
    listUsersPage: notUsed,
    createUser: notUsed,
    deleteUser: notUsed,
    async updateUserById(id, i) {
      calls.push(i.banDuration === undefined ? "recordOnLogin" : "ban");
      const l = logins.get(id);
      if (!l) return { data: null, error: { code: "user_not_found", status: 404 } };
      if (i.banDuration !== undefined) l.bannedUntil = i.banDuration === UNBAN ? null : FUTURE;
      if (i.appMetadata) l.appMetadata = { ...i.appMetadata };
      return ok({ ...l });
    },
    inviteUserByEmail: notUsed,
    resetPasswordForEmail: notUsed,
    async selectAppUser(id) {
      calls.push("selectAppUser");
      return ok(rows.get(id) ?? null);
    },
    async selectAppUsersPage(from, to) {
      calls.push("selectAppUsersPage");
      return ok([...rows.values()].slice(from, to + 1));
    },
    insertAppUser: notUsed,
    async updateAppUserFields() {
      calls.push("updateAppUserFields");
      return ok({ updated: true });
    },
    async updateAppUserAccess() {
      calls.push("updateAppUserAccess");
      return ok({ updated: true });
    },
    selectPatientAuthUids: notUsed,
    isPatientLogin: notUsed,
    patientEmailExists: notUsed,
    async checkLimits() {
      return { allowed: true as const };
    },
    async hashKey(value) {
      return `hashed-${value.length}`;
    },
    async insertAuditLog() {
      calls.push("insertAuditLog");
    },
    newId() {
      return "audit-1";
    },
  };
  return { port, calls, rows, logins };
}

describe("disable without demotion (DISABLE_DEMOTES_ROLE = false)", () => {
  it("runs with the switch off", () => {
    expect(DISABLE_DEMOTES_ROLE).toBe(false);
  });

  it("refuses an administrator before any write", async () => {
    const fk = fake(row(TARGET, { role: "admin", admin_access: true }), login(TARGET));
    const res = await runStaffAdminAction(fk.port, CTX, { kind: "disable", userId: TARGET });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("admin_disable_unavailable");
    expect(fk.calls).not.toContain("recordOnLogin");
    expect(fk.calls).not.toContain("ban");
    expect(fk.calls).not.toContain("updateAppUserAccess");
  });

  it("records the role and bans the login, leaving the staff record as it is", async () => {
    const fk = fake(row(TARGET), login(TARGET));
    const res = await runStaffAdminAction(fk.port, CTX, { kind: "disable", userId: TARGET });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, status: "disabled", rowUpdated: false });
    expect(fk.calls.filter((c) => c === "recordOnLogin" || c === "ban")).toEqual([
      "recordOnLogin",
      "ban",
    ]);
    expect(fk.calls).not.toContain("updateAppUserAccess");
    expect(fk.rows.get(TARGET)?.role).toBe("nurse");
    expect(fk.logins.get(TARGET)?.bannedUntil).toBe(FUTURE);
    expect(fk.logins.get(TARGET)?.appMetadata.mbhr_disabled_role).toBe("nurse");
    expect(BAN_DURATION).toBe("876000h");
  });

  it("is idempotent once the login is banned and the disable recorded", async () => {
    const fk = fake(
      row(TARGET),
      login(TARGET, {
        bannedUntil: FUTURE,
        appMetadata: { mbhr_disabled_at: "2026-09-20T00:00:00.000Z" },
      }),
    );
    const res = await runStaffAdminAction(fk.port, CTX, { kind: "disable", userId: TARGET });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      status: "disabled",
      rowUpdated: false,
      alreadyDisabled: true,
    });
    expect(fk.calls).not.toContain("recordOnLogin");
    expect(fk.calls).not.toContain("ban");
  });
});
