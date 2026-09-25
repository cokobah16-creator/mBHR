import { describe, it, expect, vi } from "vitest";

// Making and restoring administrators once it is switched on (constants.ts,
// ADMIN_ACCOUNTS_ENABLED = true): only a permanent administrator may.
// In its own file because the whole module graph sees the mocked value.
vi.mock("./constants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./constants")>();
  return { ...actual, ADMIN_ACCOUNTS_ENABLED: true };
});

import { runStaffAdminAction, type ActionContext, type ActionResult } from "./actions";
import { ADMIN_ACCOUNTS_ENABLED, PROVISIONABLE_ROLES, UNBAN } from "./constants";
import { staffActionRefusal, type GuardInput } from "./guards";
import type { AppUserRow, LoginRecord, PortResult, StaffAdminPort } from "./portTypes";
import type { StaffRoute } from "./validate";

const NOW = new Date("2026-09-25T12:00:00.000Z");
const NOW_ISO = NOW.toISOString();
const PAST = "2026-09-03T00:00:00.000Z";
const FUTURE = "2126-09-25T12:00:00.000Z";
const ACTOR = "11111111-1111-4111-8111-111111111111";
const TARGET = "22222222-2222-4222-8222-222222222222";
const NEW_ID = "44444444-4444-4444-8444-444444444444";
const TARGET_EMAIL = "test.person@example.org";

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
    email: TARGET_EMAIL,
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

/** A login this function disabled, which had the admin role. */
function disabledAdminLogin(): LoginRecord {
  return login(TARGET, {
    bannedUntil: FUTURE,
    appMetadata: {
      mbhr_disabled_role: "admin",
      mbhr_disabled_admin_access: true,
      mbhr_disabled_by: ACTOR,
      mbhr_disabled_at: PAST,
    },
  });
}

function ok<T>(data: T): PortResult<T> {
  return { data, error: null };
}

/** An in-memory Auth and app_users that records the method names called. */
function fake(options: { actorPermanent: boolean; target: AppUserRow | null; targetLogin: LoginRecord | null }) {
  const rows = new Map<string, AppUserRow>([
    [ACTOR, adminRow(ACTOR, { full_name: "Ada Admin", admin_permanent: options.actorPermanent })],
  ]);
  const logins = new Map<string, LoginRecord>([[ACTOR, login(ACTOR, { email: "ada.admin@example.org" })]]);
  if (options.target) rows.set(options.target.id, { ...options.target });
  if (options.targetLogin) logins.set(options.targetLogin.id, { ...options.targetLogin });
  const calls: string[] = [];

  const applyFields = (
    id: string,
    expectedRole: string,
    next: Partial<AppUserRow>,
  ): PortResult<{ updated: boolean }> => {
    const current = rows.get(id);
    if (!current || current.role !== expectedRole) return ok({ updated: false });
    rows.set(id, { ...current, ...next });
    return ok({ updated: true });
  };

  const port: StaffAdminPort = {
    async getUserById(id) {
      calls.push("getUserById");
      const l = logins.get(id);
      return ok(l ? { ...l } : null);
    },
    async listUsersPage(page, perPage) {
      calls.push("listUsersPage");
      return ok([...logins.values()].slice((page - 1) * perPage, page * perPage));
    },
    async createUser(i) {
      calls.push("createUser");
      const created: LoginRecord = {
        ...login(i.id, { email: i.email, emailConfirmedAt: null, lastSignInAt: null, createdAt: NOW_ISO }),
        appMetadata: { ...i.appMetadata },
        userMetadata: { ...i.userMetadata },
      };
      logins.set(i.id, created);
      return ok({ ...created });
    },
    async deleteUser(id) {
      calls.push("deleteUser");
      logins.delete(id);
      return ok<true>(true);
    },
    async updateUserById(id, i) {
      calls.push("updateUserById");
      const l = logins.get(id);
      if (!l) return { data: null, error: { code: "user_not_found", status: 404 } };
      if (i.banDuration !== undefined) l.bannedUntil = i.banDuration === UNBAN ? null : FUTURE;
      if (i.appMetadata) l.appMetadata = { ...i.appMetadata };
      if (i.userMetadata) l.userMetadata = { ...i.userMetadata };
      return ok({ ...l });
    },
    async inviteUserByEmail() {
      calls.push("inviteUserByEmail");
      return ok<true>(true);
    },
    async resetPasswordForEmail() {
      calls.push("resetPasswordForEmail");
      return ok<true>(true);
    },
    async selectAppUser(id) {
      calls.push(`selectAppUser:${id === ACTOR ? "actor" : "target"}`);
      const r = rows.get(id);
      return ok(r ? { ...r } : null);
    },
    async selectAppUsersPage(from, to) {
      calls.push("selectAppUsersPage");
      return ok([...rows.values()].slice(from, to + 1));
    },
    async insertAppUser(r) {
      calls.push("insertAppUser");
      if (rows.has(r.id)) return { data: null, error: { code: "23505", status: 409 } };
      rows.set(r.id, { ...r, created_at: NOW_ISO });
      return ok<true>(true);
    },
    async updateAppUserFields(id, expectedRole, next) {
      calls.push("updateAppUserFields");
      return applyFields(id, expectedRole, next);
    },
    async updateAppUserAccess(id, expectedRole, next) {
      calls.push("updateAppUserAccess");
      return applyFields(id, expectedRole, next);
    },
    async selectPatientAuthUids() {
      return ok([]);
    },
    async isPatientLogin() {
      calls.push("isPatientLogin");
      return ok(false);
    },
    async patientEmailExists() {
      calls.push("patientEmailExists");
      return ok(false);
    },
    async checkLimits() {
      calls.push("checkLimits");
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

function run(fk: ReturnType<typeof fake>, route: StaffRoute): Promise<ActionResult> {
  return runStaffAdminAction(fk.port, CTX, route);
}

function guard(over: Partial<GuardInput>): string | null {
  return (
    staffActionRefusal({
      action: "create",
      actorId: ACTOR,
      actorPermanent: false,
      row: null,
      login: null,
      otherActiveAdmins: 1,
      now: NOW,
      ...over,
    })?.error ?? null
  );
}

describe("administrator accounts switched on (ADMIN_ACCOUNTS_ENABLED = true)", () => {
  it("runs with the switch on", () => {
    expect(ADMIN_ACCOUNTS_ENABLED).toBe(true);
  });

  describe("the guard", () => {
    it("lets only a permanent administrator give the admin role on create and update", () => {
      expect(guard({ action: "create", requestedRole: "admin" })).toBe("needs_permanent_admin");
      expect(guard({ action: "create", requestedRole: "admin", actorPermanent: true })).toBeNull();

      const update = { action: "update" as const, row: row(TARGET), login: login(TARGET), requestedRole: "admin" };
      expect(guard(update)).toBe("needs_permanent_admin");
      expect(guard({ ...update, actorPermanent: true })).toBeNull();
    });

    it("lets only a permanent administrator restore an administrator", () => {
      const restore = {
        action: "reactivate" as const,
        row: row(TARGET, { role: "guest" }),
        login: disabledAdminLogin(),
        requestedRole: "admin",
      };
      expect(guard(restore)).toBe("needs_permanent_admin");
      expect(guard({ ...restore, actorPermanent: true })).toBeNull();

      const keptRole = { ...restore, row: adminRow(TARGET) };
      expect(guard(keptRole)).toBe("needs_permanent_admin");
      expect(guard({ ...keptRole, actorPermanent: true })).toBeNull();
    });

    it("lets only a permanent administrator make a login for an admin record", () => {
      const repair = { action: "create_login" as const, row: adminRow(TARGET) };
      expect(guard(repair)).toBe("needs_permanent_admin");
      expect(guard({ ...repair, actorPermanent: true })).toBeNull();
      expect(guard({ ...repair, row: adminRow(TARGET, { admin_permanent: true }), actorPermanent: true })).toBe(
        "permanent_admin",
      );
    });

    it("still never grants admin through create_staff_record", () => {
      expect(
        guard({
          action: "create_staff_record",
          login: login(TARGET),
          requestedRole: "admin",
          actorPermanent: true,
          patientLinked: false,
          patientEmailOnFile: false,
        }),
      ).toBe("role_not_allowed");
    });
  });

  describe("the actions", () => {
    it("offers the admin role in the overview", async () => {
      const fk = fake({ actorPermanent: true, target: row(TARGET), targetLogin: login(TARGET) });
      const res = await run(fk, { kind: "overview" });
      expect(res.status).toBe(200);
      expect(res.body.roles).toEqual([...PROVISIONABLE_ROLES]);
      expect(res.body.roles).toContain("admin");
    });

    it("creates an administrator for a permanent administrator, never with admin_permanent", async () => {
      const fk = fake({ actorPermanent: true, target: null, targetLogin: null });
      const res = await run(fk, {
        kind: "create",
        userId: NEW_ID,
        fullName: "Nkem Nurse",
        email: "nkem.nurse@example.org",
        role: "admin",
      });
      expect(res.status).toBe(201);
      expect(fk.calls).toContain("selectAppUser:actor");
      expect(fk.rows.get(NEW_ID)).toMatchObject({ role: "admin", admin_access: true, admin_permanent: false });
    });

    it("refuses the admin role from an administrator who is not permanent, before any write", async () => {
      const fk = fake({ actorPermanent: false, target: null, targetLogin: null });
      const res = await run(fk, {
        kind: "create",
        userId: NEW_ID,
        fullName: "Nkem Nurse",
        email: "nkem.nurse@example.org",
        role: "admin",
      });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("needs_permanent_admin");
      expect(fk.calls).not.toContain("checkLimits");
      expect(fk.calls).not.toContain("createUser");
    });

    it("changes a role to admin for a permanent administrator", async () => {
      const fk = fake({ actorPermanent: true, target: row(TARGET), targetLogin: login(TARGET) });
      const res = await run(fk, { kind: "update", userId: TARGET, fullName: null, role: "admin" });
      expect(res.status).toBe(200);
      expect(fk.rows.get(TARGET)).toMatchObject({ role: "admin", admin_access: true, admin_permanent: false });

      const plain = fake({ actorPermanent: false, target: row(TARGET), targetLogin: login(TARGET) });
      const refused = await run(plain, { kind: "update", userId: TARGET, fullName: null, role: "admin" });
      expect(refused.status).toBe(403);
      expect(refused.body.error).toBe("needs_permanent_admin");
      expect(plain.calls).not.toContain("updateAppUserFields");
    });

    it("restores an administrator for a permanent administrator, record first and ban last", async () => {
      const fk = fake({
        actorPermanent: true,
        target: row(TARGET, { role: "guest" }),
        targetLogin: disabledAdminLogin(),
      });
      const res = await run(fk, { kind: "reactivate", userId: TARGET, role: null });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe("admin");
      expect(fk.rows.get(TARGET)).toMatchObject({ role: "admin", admin_access: true });
      expect(fk.logins.get(TARGET)?.bannedUntil).toBeNull();
      const writes = fk.calls.filter((c) => c === "updateAppUserAccess" || c === "updateUserById");
      expect(writes).toEqual(["updateAppUserAccess", "updateUserById"]);
      expect(fk.calls).not.toContain("isPatientLogin");
    });

    it("lifts the ban on an admin record that kept its role for a permanent administrator only", async () => {
      const plain = fake({ actorPermanent: false, target: adminRow(TARGET), targetLogin: disabledAdminLogin() });
      const refused = await run(plain, { kind: "reactivate", userId: TARGET, role: null });
      expect(refused.status).toBe(403);
      expect(refused.body.error).toBe("needs_permanent_admin");
      expect(plain.logins.get(TARGET)?.bannedUntil).toBe(FUTURE);

      const fk = fake({ actorPermanent: true, target: adminRow(TARGET), targetLogin: disabledAdminLogin() });
      const res = await run(fk, { kind: "reactivate", userId: TARGET, role: null });
      expect(res.status).toBe(200);
      expect(fk.calls).not.toContain("updateAppUserAccess");
      expect(fk.logins.get(TARGET)?.bannedUntil).toBeNull();
    });

    it("makes a login for an admin record for a permanent administrator", async () => {
      const fk = fake({ actorPermanent: true, target: adminRow(TARGET), targetLogin: null });
      const res = await run(fk, {
        kind: "create_login",
        userId: TARGET,
        email: TARGET_EMAIL,
        confirmFullName: "test person",
      });
      expect(res.status).toBe(201);
      expect(fk.calls).toContain("createUser");
    });
  });
});
