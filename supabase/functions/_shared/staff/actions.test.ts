import { describe, it, expect } from "vitest";
import {
  configuredOrigin,
  mergeAppMetadata,
  redirectFor,
  runStaffAdminAction,
  type ActionContext,
  type ActionResult,
} from "./actions";
import { BAN_DURATION, PROVISIONABLE_ROLES, UNBAN } from "./constants";
import type {
  AppUserFieldsUpdate,
  AppUserRow,
  LoginRecord,
  PortError,
  PortResult,
  StaffAdminPort,
} from "./portTypes";
import type { AccountView, OverviewResponse } from "./types";
import { routeStaffAdminRequest, type StaffRoute } from "./validate";

const NOW = new Date("2026-09-25T12:00:00.000Z");
const NOW_ISO = NOW.toISOString();
const PAST = "2026-09-03T00:00:00.000Z";
const FUTURE = "2126-09-25T12:00:00.000Z";
const ORIGIN = "https://staff.example.org";
const INVITE_LINK = `${ORIGIN}/reset-password?for=staff&link=invite`;
const RECOVERY_LINK = `${ORIGIN}/reset-password?for=staff`;

const ACTOR = "11111111-1111-4111-8111-111111111111";
const TARGET = "22222222-2222-4222-8222-222222222222";
const OTHER_ADMIN = "33333333-3333-4333-8333-333333333333";
const NEW_ID = "44444444-4444-4444-8444-444444444444";
const STRANGER = "55555555-5555-4555-8555-555555555555";

const TARGET_EMAIL = "test.person@example.org";
const NEW_EMAIL = "nkem.nurse@example.org";
const NEW_NAME = "Nkem Nurse";

const CTX: ActionContext = {
  actorId: ACTOR,
  now: NOW,
  appOrigin: ORIGIN,
  inviteLifetimeSec: 3600,
  launchedAt: null,
};

function secondsAgo(seconds: number): string {
  return new Date(NOW.getTime() - seconds * 1000).toISOString();
}

/** A confirmed login that has signed in. */
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

// ---------------------------------------------------------------------------
// The fake port: an in-memory Auth and app_users that records every call.

function ok<T>(data: T): PortResult<T> {
  return { data, error: null };
}

function err(code: string, status?: number): { data: null; error: PortError } {
  return { data: null, error: status === undefined ? { code } : { code, status } };
}

function copyLogin(l: LoginRecord): LoginRecord {
  return { ...l, appMetadata: { ...l.appMetadata }, userMetadata: { ...l.userMetadata } };
}

interface WorldOptions {
  actorPermanent?: boolean;
  actorLogin?: Partial<LoginRecord>;
  /** Another active administrator (default true). */
  otherAdmin?: boolean;
  /** The target's row: default a nurse; null for none. */
  target?: AppUserRow | null;
  /** The target's login: default confirmed and signed in; null for none. */
  targetLogin?: LoginRecord | null;
  logins?: LoginRecord[];
  rows?: AppUserRow[];
  patientUids?: string[];
  patientEmails?: string[];
}

interface State {
  logins: Map<string, LoginRecord>;
  rows: Map<string, AppUserRow>;
}

type Overrides = (base: StaffAdminPort, state: State) => Partial<StaffAdminPort>;

interface Call {
  method: string;
  args: unknown[];
}

function fake(options: WorldOptions = {}, overrides?: Overrides) {
  const logins = new Map<string, LoginRecord>();
  const rows = new Map<string, AppUserRow>();
  rows.set(
    ACTOR,
    adminRow(ACTOR, { full_name: "Ada Admin", admin_permanent: options.actorPermanent === true }),
  );
  logins.set(ACTOR, login(ACTOR, { email: "ada.admin@example.org", ...options.actorLogin }));
  if (options.otherAdmin !== false) {
    rows.set(OTHER_ADMIN, adminRow(OTHER_ADMIN, { full_name: "Obi Other" }));
    logins.set(OTHER_ADMIN, login(OTHER_ADMIN, { email: "obi.other@example.org" }));
  }
  const target = options.target === undefined ? row(TARGET) : options.target;
  if (target) rows.set(target.id, { ...target });
  const targetLogin = options.targetLogin === undefined ? login(TARGET) : options.targetLogin;
  if (targetLogin) logins.set(targetLogin.id, copyLogin(targetLogin));
  for (const l of options.logins ?? []) logins.set(l.id, copyLogin(l));
  for (const r of options.rows ?? []) rows.set(r.id, { ...r });
  const patientUids = options.patientUids ?? [];
  const patientEmails = options.patientEmails ?? [];

  const calls: Call[] = [];
  const audits: { id: string; action: string; entityId: string }[] = [];
  let auditIds = 0;

  const applyFields = (
    id: string,
    expectedRole: string,
    next: AppUserFieldsUpdate,
  ): PortResult<{ updated: boolean }> => {
    const current = rows.get(id);
    if (!current || current.role !== expectedRole) return ok({ updated: false });
    rows.set(id, { ...current, ...next });
    return ok({ updated: true });
  };

  const base: StaffAdminPort = {
    async getUserById(id) {
      const l = logins.get(id);
      return ok(l ? copyLogin(l) : null);
    },
    async listUsersPage(page, perPage) {
      return ok([...logins.values()].slice((page - 1) * perPage, page * perPage).map(copyLogin));
    },
    async createUser(i) {
      // Auth checks the email before the id.
      for (const l of logins.values()) {
        if (l.email === i.email) return err("email_exists", 422);
      }
      if (logins.has(i.id)) return err("user_already_exists", 422);
      const created: LoginRecord = {
        id: i.id,
        email: i.email,
        createdAt: NOW_ISO,
        invitedAt: null,
        confirmationSentAt: null,
        emailConfirmedAt: null,
        lastSignInAt: null,
        bannedUntil: null,
        isAnonymous: false,
        appMetadata: { ...i.appMetadata },
        userMetadata: { ...i.userMetadata },
      };
      logins.set(i.id, created);
      return ok(copyLogin(created));
    },
    async deleteUser(id) {
      logins.delete(id);
      return ok<true>(true);
    },
    async updateUserById(id, i) {
      const l = logins.get(id);
      if (!l) return err("user_not_found", 404);
      if (i.banDuration !== undefined) l.bannedUntil = i.banDuration === UNBAN ? null : FUTURE;
      if (i.appMetadata) l.appMetadata = { ...i.appMetadata };
      if (i.userMetadata) l.userMetadata = { ...i.userMetadata };
      return ok(copyLogin(l));
    },
    async inviteUserByEmail(email) {
      const l = [...logins.values()].find((x) => x.email === email);
      if (l?.emailConfirmedAt) return err("email_exists", 422);
      if (l) l.invitedAt = NOW_ISO;
      return ok<true>(true);
    },
    async resetPasswordForEmail() {
      return ok<true>(true);
    },
    async selectAppUser(id) {
      const r = rows.get(id);
      return ok(r ? { ...r } : null);
    },
    async selectAppUsersPage(from, to) {
      const sorted = [...rows.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return ok(sorted.slice(from, to + 1).map((r) => ({ ...r })));
    },
    async insertAppUser(r) {
      if (rows.has(r.id)) return err("23505", 409);
      rows.set(r.id, { ...r, created_at: NOW_ISO });
      return ok<true>(true);
    },
    async updateAppUserFields(id, expectedRole, next) {
      return applyFields(id, expectedRole, next);
    },
    async updateAppUserAccess(id, expectedRole, next) {
      return applyFields(id, expectedRole, next);
    },
    async selectPatientAuthUids() {
      return ok([...patientUids]);
    },
    async isPatientLogin(uid) {
      return ok(patientUids.includes(uid));
    },
    async patientEmailExists(email) {
      return ok(patientEmails.includes(email));
    },
    async checkLimits() {
      return { allowed: true as const };
    },
    async hashKey(value) {
      return `hashed-${value.length}`;
    },
    async insertAuditLog(i) {
      audits.push({ ...i });
    },
    newId() {
      auditIds += 1;
      return `audit-${auditIds}`;
    },
  };

  const chosen: StaffAdminPort = { ...base, ...(overrides ? overrides(base, { logins, rows }) : {}) };
  const recorded: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(chosen)) {
    recorded[name] = (...args: unknown[]) => {
      calls.push({ method: name, args });
      return (fn as (...a: unknown[]) => unknown)(...args);
    };
  }

  return {
    port: recorded as unknown as StaffAdminPort,
    calls,
    audits,
    logins,
    rows,
    /** The arguments of every call to one method, in order. */
    called(method: keyof StaffAdminPort): unknown[][] {
      return calls.filter((c) => c.method === method).map((c) => c.args);
    },
  };
}

type Fake = ReturnType<typeof fake>;

const WRITE_METHODS = [
  "createUser",
  "deleteUser",
  "updateUserById",
  "inviteUserByEmail",
  "resetPasswordForEmail",
  "insertAppUser",
  "updateAppUserFields",
  "updateAppUserAccess",
  "insertAuditLog",
];

function writes(fk: Fake): string[] {
  return fk.calls.filter((c) => WRITE_METHODS.includes(c.method)).map((c) => c.method);
}

function run(fk: Fake, route: StaffRoute, ctx: ActionContext = CTX): Promise<ActionResult> {
  return runStaffAdminAction(fk.port, ctx, route);
}

function account(res: ActionResult): AccountView {
  return res.body.account as AccountView;
}

type UpdateArgs = [string, { banDuration?: string; appMetadata?: Record<string, unknown>; userMetadata?: Record<string, unknown> }];

function loginUpdates(fk: Fake): UpdateArgs[] {
  return fk.called("updateUserById") as UpdateArgs[];
}

function banCalls(fk: Fake): UpdateArgs[] {
  return loginUpdates(fk).filter(([, i]) => i.banDuration !== undefined);
}

// ---------------------------------------------------------------------------

describe("redirectFor", () => {
  it("points invitations and reset links at the reset page on the configured origin", () => {
    expect(redirectFor("invite", ORIGIN)).toBe(INVITE_LINK);
    expect(redirectFor("recovery", ORIGIN)).toBe(RECOVERY_LINK);
  });
});

describe("configuredOrigin", () => {
  it("accepts a plain https origin", () => {
    expect(configuredOrigin("https://staff.example.org")).toBe("https://staff.example.org");
    expect(configuredOrigin(" https://staff.example.org/ ")).toBe("https://staff.example.org");
    expect(configuredOrigin("https://staff.example.org:8443")).toBe("https://staff.example.org:8443");
  });

  it("falls back to https://mbhr.app for anything else", () => {
    const rejected = [
      undefined,
      null,
      "",
      "   ",
      "http://staff.example.org",
      "https://staff.example.org/app",
      "https://staff.example.org/?next=1",
      "https://staff.example.org/#top",
      "https://user:secret@staff.example.org",
      "javascript:alert(1)",
      "staff.example.org",
      "not a url",
    ];
    for (const raw of rejected) expect(configuredOrigin(raw)).toBe("https://mbhr.app");
  });
});

describe("mergeAppMetadata", () => {
  it("lays the patch over the current keys, keeps null as a clear and skips undefined", () => {
    const current = { a: 1, b: "x" };
    expect(mergeAppMetadata(current, { b: "y", c: null, d: undefined })).toEqual({
      a: 1,
      b: "y",
      c: null,
    });
    expect(current).toEqual({ a: 1, b: "x" });
    expect(mergeAppMetadata(null, { a: 1 })).toEqual({ a: 1 });
  });
});

describe("runStaffAdminAction: requests that never reach the port", () => {
  it("passes a refused route straight through", async () => {
    const fk = fake();
    const res = await run(fk, routeStaffAdminRequest({ action: "nope" }, 20));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, error: "invalid_action" });
    expect(fk.calls).toHaveLength(0);
  });

  it("refuses a PIN before anything else", async () => {
    const fk = fake();
    const route = routeStaffAdminRequest({ action: "create", userId: NEW_ID, newPin: "1234" }, 60);
    const res = await run(fk, route);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("pin_not_accepted");
    expect(fk.calls).toHaveLength(0);
  });

  it("answers ping with the version only", async () => {
    const fk = fake();
    const res = await run(fk, { kind: "ping" });
    expect(res).toEqual({ status: 200, body: { version: "1", success: true } });
    expect(fk.calls).toHaveLength(0);
  });
});

describe("overview", () => {
  it("lists every staff record with its full email, and only counts portal logins", async () => {
    const fk = fake({
      logins: [
        login(STRANGER, { email: "pat.ient@example.org" }),
        login(NEW_ID, { email: "some.one@example.org" }),
      ],
      patientUids: [STRANGER],
    });
    const res = await run(fk, { kind: "overview" });
    expect(res.status).toBe(200);
    const body = res.body as unknown as OverviewResponse & { success: boolean };
    expect(body.success).toBe(true);
    expect(body.checkedAt).toBe(NOW_ISO);
    expect(body.accounts.map((a) => a.userId).sort()).toEqual([ACTOR, OTHER_ADMIN, TARGET].sort());
    expect(body.accounts.find((a) => a.userId === TARGET)?.email).toBe(TARGET_EMAIL);
    expect(body.health.counts).toEqual({ portalPatients: 1, portalSignups: 0, anonymous: 0 });
    expect(body.health.problems).toHaveLength(1);
    expect(body.health.problems[0]).toMatchObject({
      kind: "unknown_login",
      userId: NEW_ID,
      email: null,
      emailMasked: "s•••@e•••.org",
    });
    // No admin role while administrators can't be added (ADMIN_ACCOUNTS_ENABLED).
    expect(body.roles).toEqual(PROVISIONABLE_ROLES.filter((role) => role !== "admin"));
    expect(body.roles).toEqual(["volunteer", "nurse", "doctor", "pharmacist"]);
    expect(body.adminRoleNeedsPermanent).toBe(true);
    expect(body.inviteLifetimeSeconds).toBe(3600);
    expect(body.caller).toEqual({ userId: ACTOR, adminPermanent: false });
    expect(fk.called("checkLimits")[0][0]).toEqual([
      { bucket: "staff_admin_overview", key: ACTOR, max: 10, windowSeconds: 600 },
    ]);
    expect(writes(fk)).toEqual([]);
  });

  it("keeps a staff login that is also linked to a patient record as a normal staff account", async () => {
    const fk = fake({ patientUids: [TARGET] });
    const res = await run(fk, { kind: "overview" });
    const body = res.body as unknown as OverviewResponse;
    const target = body.accounts.find((a) => a.userId === TARGET);
    expect(target).toMatchObject({ email: TARGET_EMAIL, status: "active", linkedPatientRecord: true });
    expect(body.health.problems).toEqual([]);
    expect(body.health.counts.portalPatients).toBe(0);
  });

  it("stops at the overview limit before reading anything", async () => {
    const fk = fake({}, () => ({
      async checkLimits() {
        return { allowed: false as const, retryAfter: 120 };
      },
    }));
    const res = await run(fk, { kind: "overview" });
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: "rate_limited", retry_after_seconds: 120 });
    expect(fk.called("selectAppUsersPage")).toHaveLength(0);
  });

  it("pauses when the limit store cannot be reached", async () => {
    const fk = fake({}, () => ({
      async checkLimits() {
        return { allowed: false as const, error: true as const };
      },
    }));
    const res = await run(fk, { kind: "overview" });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("rate_limit_unavailable");
  });

  it("fails when the logins cannot be read, rather than showing everyone without one", async () => {
    const fk = fake({}, () => ({
      async listUsersPage() {
        return err("unexpected_failure", 500);
      },
    }));
    const res = await run(fk, { kind: "overview" });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("login_service_error");
  });
});

describe("login_status", () => {
  it("shows a staff account with who created it", async () => {
    const fk = fake({
      targetLogin: login(TARGET, {
        appMetadata: { mbhr_account: "staff", mbhr_created_by: ACTOR },
        userMetadata: { mbhr_password_set_at: PAST },
      }),
    });
    const res = await run(fk, { kind: "login_status", userId: TARGET });
    expect(res.status).toBe(200);
    expect(account(res)).toMatchObject({
      userId: TARGET,
      email: TARGET_EMAIL,
      status: "active",
      statusDetail: "signed_in",
      createdVia: "users_screen",
      createdByName: "Ada Admin",
    });
    expect(writes(fk)).toEqual([]);
  });

  it("shows a staff login that is also linked to a patient record as a normal staff account", async () => {
    const fk = fake({ patientUids: [TARGET], patientEmails: [TARGET_EMAIL] });
    const res = await run(fk, { kind: "login_status", userId: TARGET });
    expect(res.status).toBe(200);
    expect(account(res)).toMatchObject({
      userId: TARGET,
      email: TARGET_EMAIL,
      role: "nurse",
      status: "active",
      linkedPatientRecord: true,
    });
    expect(writes(fk)).toEqual([]);
  });

  it("refuses a patient's login that has no staff record", async () => {
    const fk = fake({ target: null, patientUids: [TARGET] });
    const res = await run(fk, { kind: "login_status", userId: TARGET });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_staff_account");
  });

  it("shows a staff-tagged login that has no staff record yet", async () => {
    const fk = fake({
      target: null,
      targetLogin: login(TARGET, { appMetadata: { mbhr_account: "staff" } }),
    });
    const res = await run(fk, { kind: "login_status", userId: TARGET });
    expect(res.status).toBe(200);
    expect(account(res)).toMatchObject({ userId: TARGET, email: TARGET_EMAIL, role: "" });
  });

  it("reports a login service failure, never 'no login'", async () => {
    const fk = fake({}, () => ({
      async getUserById() {
        return err("exception");
      },
    }));
    const res = await run(fk, { kind: "login_status", userId: TARGET });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("login_service_error");
  });
});

// ---------------------------------------------------------------------------

type CreateRoute = Extract<StaffRoute, { kind: "create" }>;

function createRoute(over: Partial<CreateRoute> = {}): StaffRoute {
  return {
    kind: "create",
    userId: NEW_ID,
    fullName: NEW_NAME,
    email: NEW_EMAIL,
    role: "nurse",
    ...over,
  };
}

function resumeMeta(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mbhr_account: "staff",
    mbhr_created_by: ACTOR,
    mbhr_created_at: secondsAgo(600),
    mbhr_initial_role: "nurse",
    ...over,
  };
}

/** A login left by an earlier create with the same details. */
function earlierLogin(over: Partial<LoginRecord> = {}): LoginRecord {
  return login(NEW_ID, {
    email: NEW_EMAIL,
    emailConfirmedAt: null,
    lastSignInAt: null,
    appMetadata: resumeMeta(),
    userMetadata: { full_name: NEW_NAME },
    ...over,
  });
}

describe("create", () => {
  it("creates the login, then the staff record, then sends the invitation", async () => {
    const fk = fake();
    const res = await run(fk, createRoute());
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      success: true,
      userId: NEW_ID,
      status: "invited",
      invitation: { sent: true, via: "invite" },
    });
    expect(fk.called("createUser")[0][0]).toEqual({
      id: NEW_ID,
      email: NEW_EMAIL,
      userMetadata: { full_name: NEW_NAME },
      appMetadata: {
        mbhr_account: "staff",
        mbhr_created_by: ACTOR,
        mbhr_created_at: NOW_ISO,
        mbhr_initial_role: "nurse",
        mbhr_last_action: "created",
        mbhr_last_action_by: ACTOR,
        mbhr_last_action_at: NOW_ISO,
      },
    });
    expect(fk.called("insertAppUser")[0][0]).toEqual({
      id: NEW_ID,
      full_name: NEW_NAME,
      role: "nurse",
      admin_access: false,
      admin_permanent: false,
    });
    expect(fk.called("inviteUserByEmail")[0]).toEqual([
      NEW_EMAIL,
      { redirectTo: INVITE_LINK, data: { full_name: NEW_NAME } },
    ]);
    expect(writes(fk)).toEqual(["createUser", "insertAppUser", "inviteUserByEmail", "insertAuditLog"]);
    expect(fk.audits).toEqual([{ id: "audit-1", action: "staff_account_created", entityId: NEW_ID }]);
    // A non-admin role never needs the caller's own record.
    expect(fk.called("selectAppUser").map((a) => a[0])).toEqual([NEW_ID]);
  });

  it("counts the email limits per caller and per hashed recipient", async () => {
    const fk = fake();
    await run(fk, createRoute());
    const [limits] = fk.called("checkLimits")[0] as [{ bucket: string; key: string; max: number }[]];
    expect(limits.map((l) => [l.bucket, l.max])).toEqual([
      ["staff_admin_email_user", 30],
      ["staff_admin_email_recipient", 5],
    ]);
    expect(limits[0].key).toBe(ACTOR);
    expect(limits[1].key).not.toContain("@");
  });

  it("refuses the admin role while administrators can't be added, even from a permanent administrator", async () => {
    for (const actorPermanent of [true, false]) {
      const fk = fake({ actorPermanent });
      const res = await run(fk, createRoute({ role: "admin" }));
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        success: false,
        error: "admin_accounts_unavailable",
        message: "Adding or restoring administrators isn't available on this server yet.",
      });
      expect(fk.called("createUser")).toHaveLength(0);
      expect(fk.called("checkLimits")).toHaveLength(0);
      expect(writes(fk)).toEqual([]);
    }
  });

  it("deletes the new login when the staff record cannot be saved", async () => {
    const fk = fake({}, () => ({
      async insertAppUser() {
        return err("22P02", 400);
      },
    }));
    const res = await run(fk, createRoute());
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "role_not_available", loginLeftBehind: false });
    expect(fk.called("deleteUser")).toEqual([[NEW_ID]]);
    expect(fk.logins.has(NEW_ID)).toBe(false);
    expect(fk.called("inviteUserByEmail")).toHaveLength(0);
  });

  it("reports partial_create when the login cannot be deleted either", async () => {
    const fk = fake({}, () => ({
      async insertAppUser() {
        return err("unexpected_failure", 500);
      },
      async deleteUser() {
        return err("unexpected_failure", 500);
      },
    }));
    const res = await run(fk, createRoute());
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: "partial_create", loginLeftBehind: true });
  });

  it("keeps the login when a concurrent retry of the same create saved the staff record first", async () => {
    const fk = fake({}, (_base, state) => ({
      async insertAppUser(r) {
        state.rows.set(r.id, { ...r, created_at: NOW_ISO });
        return err("23505", 409);
      },
    }));
    const res = await run(fk, createRoute());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      userId: NEW_ID,
      status: "invited",
      invitation: { sent: true, via: "invite" },
    });
    expect(fk.called("deleteUser")).toHaveLength(0);
    expect(fk.logins.has(NEW_ID)).toBe(true);
    expect(fk.called("inviteUserByEmail")).toHaveLength(1);
  });

  it("keeps the login when the staff record was saved but its reply was lost", async () => {
    const fk = fake({}, (_base, state) => ({
      async insertAppUser(r) {
        state.rows.set(r.id, { ...r, created_at: NOW_ISO });
        return err("exception");
      },
    }));
    const res = await run(fk, createRoute());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ userId: NEW_ID, status: "invited" });
    expect(fk.called("deleteUser")).toHaveLength(0);
    expect(fk.logins.has(NEW_ID)).toBe(true);
    expect(fk.called("inviteUserByEmail")).toHaveLength(1);
  });

  it("still undoes the new login when a different staff record took the id", async () => {
    const fk = fake({}, (_base, state) => ({
      async insertAppUser(r) {
        state.rows.set(r.id, { ...r, role: "doctor", created_at: NOW_ISO });
        return err("23505", 409);
      },
    }));
    const res = await run(fk, createRoute());
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "id_conflict", loginLeftBehind: false });
    expect(fk.called("deleteUser")).toEqual([[NEW_ID]]);
    expect(fk.called("inviteUserByEmail")).toHaveLength(0);
  });

  it("still succeeds when the invitation cannot be sent, and undoes nothing", async () => {
    const fk = fake({}, () => ({
      async inviteUserByEmail() {
        return err("unexpected_failure", 500);
      },
    }));
    const res = await run(fk, createRoute());
    expect(res.status).toBe(201);
    expect(res.body.invitation).toEqual({ sent: false, via: null, error: "send_failed" });
    expect(fk.rows.has(NEW_ID)).toBe(true);
    expect(fk.logins.has(NEW_ID)).toBe(true);
    expect(fk.called("deleteUser")).toHaveLength(0);
  });

  it("falls back to a reset link when Auth says the invitation was already accepted", async () => {
    const fk = fake({}, () => ({
      async inviteUserByEmail() {
        return err("email_exists", 422);
      },
    }));
    const res = await run(fk, createRoute());
    expect(res.body.invitation).toEqual({ sent: true, via: "recovery" });
    expect(fk.called("resetPasswordForEmail")).toEqual([[NEW_EMAIL, { redirectTo: RECOVERY_LINK }]]);
  });

  it("says when email sending is not set up or rate limited, without a fallback", async () => {
    for (const [code, expected] of [
      ["email_address_not_authorized", "email_not_configured"],
      ["over_email_send_rate_limit", "email_rate_limited"],
    ]) {
      const fk = fake({}, () => ({
        async inviteUserByEmail() {
          return err(code, 400);
        },
      }));
      const res = await run(fk, createRoute());
      expect(res.status).toBe(201);
      expect(res.body.invitation).toEqual({ sent: false, via: null, error: expected });
      expect(fk.called("resetPasswordForEmail")).toHaveLength(0);
    }
  });

  it("resumes a retry with the same id, and does not resend within 60 seconds", async () => {
    const fk = fake({
      logins: [earlierLogin({ invitedAt: secondsAgo(30) })],
      rows: [row(NEW_ID, { full_name: NEW_NAME })],
    });
    const res = await run(fk, createRoute());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      userId: NEW_ID,
      status: "invited",
      invitation: { sent: true, via: "invite", alreadySent: true },
      resumed: true,
    });
    expect(fk.called("createUser")).toHaveLength(0);
    expect(fk.called("insertAppUser")).toHaveLength(0);
    expect(fk.called("inviteUserByEmail")).toHaveLength(0);
  });

  it("finishes a resumed create: the missing staff record and a new invitation", async () => {
    const fk = fake({ logins: [earlierLogin({ invitedAt: secondsAgo(300) })] });
    const res = await run(fk, createRoute());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ resumed: true, invitation: { sent: true, via: "invite" } });
    expect(fk.called("insertAppUser")).toHaveLength(1);
    expect(fk.called("inviteUserByEmail")).toHaveLength(1);
    expect(fk.called("deleteUser")).toHaveLength(0);
  });

  const refusedResumes: [string, Partial<LoginRecord>][] = [
    ["another administrator made the login", { appMetadata: resumeMeta({ mbhr_created_by: OTHER_ADMIN }) }],
    ["the login is older than 24 hours", { appMetadata: resumeMeta({ mbhr_created_at: secondsAgo(25 * 3600) }) }],
    ["the login is banned", { bannedUntil: FUTURE }],
    ["the role differs", { appMetadata: resumeMeta({ mbhr_initial_role: "doctor" }) }],
    ["the name differs", { userMetadata: { full_name: "Someone Else" } }],
    ["the email differs", { email: "other.person@example.org" }],
    ["the login was not made here", { appMetadata: {} }],
  ];
  for (const [label, over] of refusedResumes) {
    it(`refuses to resume when ${label}`, async () => {
      const fk = fake({ logins: [earlierLogin(over)] });
      const res = await run(fk, createRoute());
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("id_conflict");
      expect(writes(fk)).toEqual([]);
    });
  }

  it("re-runs the resume check once when createUser says the id is taken", async () => {
    const fk = fake({}, (_base, state) => ({
      async createUser(i) {
        state.logins.set(i.id, earlierLogin());
        return err("user_already_exists", 422);
      },
    }));
    const res = await run(fk, createRoute());
    expect(res.status).toBe(200);
    expect(res.body.resumed).toBe(true);
    expect(fk.called("createUser")).toHaveLength(1);
    expect(fk.called("getUserById").filter((a) => a[0] === NEW_ID)).toHaveLength(2);
    expect(fk.called("insertAppUser")).toHaveLength(1);
  });

  it("resumes when a concurrent create with the same id and email made the login first", async () => {
    // Auth checks the email first, so the second request sees email_exists.
    const fk = fake({}, (base, state) => ({
      async createUser(i) {
        state.logins.set(i.id, earlierLogin({ appMetadata: resumeMeta({ mbhr_created_at: NOW_ISO }) }));
        return base.createUser(i);
      },
    }));
    const res = await run(fk, createRoute());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, userId: NEW_ID, resumed: true });
    expect(fk.called("createUser")).toHaveLength(1);
    expect(fk.called("getUserById").filter((a) => a[0] === NEW_ID)).toHaveLength(2);
    expect(fk.called("listUsersPage")).toHaveLength(0);
    expect(fk.called("insertAppUser")).toHaveLength(1);
    expect(fk.called("deleteUser")).toHaveLength(0);
  });

  it("looks again once when createUser fails with a server error, and resumes its own login", async () => {
    const fk = fake({}, (_base, state) => ({
      async createUser(i) {
        state.logins.set(i.id, earlierLogin({ appMetadata: resumeMeta({ mbhr_created_at: NOW_ISO }) }));
        return err("unexpected_failure", 500);
      },
    }));
    const res = await run(fk, createRoute());
    expect(res.status).toBe(200);
    expect(res.body.resumed).toBe(true);
    expect(fk.called("createUser")).toHaveLength(1);
  });

  it("reports a login service error when createUser keeps failing", async () => {
    const fk = fake({}, () => ({
      async createUser() {
        return err("unexpected_failure", 500);
      },
    }));
    const res = await run(fk, createRoute());
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("login_service_error");
    expect(fk.called("createUser")).toHaveLength(2);
    expect(fk.called("insertAppUser")).toHaveLength(0);
  });

  it("refuses when the id was taken by someone else's login", async () => {
    const fk = fake({}, (_base, state) => ({
      async createUser(i) {
        state.logins.set(i.id, earlierLogin({ appMetadata: resumeMeta({ mbhr_created_by: OTHER_ADMIN }) }));
        return err("user_already_exists", 422);
      },
    }));
    const res = await run(fk, createRoute());
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("id_conflict");
    expect(fk.called("insertAppUser")).toHaveLength(0);
  });

  it("stops on a transient login lookup error instead of creating", async () => {
    const fk = fake({}, () => ({
      async getUserById() {
        return err("exception");
      },
    }));
    const res = await run(fk, createRoute());
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("login_service_error");
    expect(fk.called("createUser")).toHaveLength(0);
  });

  it("refuses an id that already has a staff record", async () => {
    const fk = fake({ rows: [row(NEW_ID)] });
    const res = await run(fk, createRoute());
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("id_conflict");
    expect(fk.called("createUser")).toHaveLength(0);
  });

  describe("an email that already has a login", () => {
    it("says when a patient record uses it", async () => {
      const fk = fake({ patientEmails: [NEW_EMAIL] }, () => ({
        async createUser() {
          return err("email_exists", 422);
        },
      }));
      const res = await run(fk, createRoute());
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("email_in_use_patient");
    });

    it("says when a staff account uses it (tagged login or staff record)", async () => {
      const tagged = fake({
        logins: [login(STRANGER, { email: NEW_EMAIL, appMetadata: { mbhr_account: "staff" } })],
      });
      expect((await run(tagged, createRoute())).body.error).toBe("email_in_use_staff");

      const withRow = fake({ logins: [login(STRANGER, { email: NEW_EMAIL })], rows: [row(STRANGER)] });
      expect((await run(withRow, createRoute())).body.error).toBe("email_in_use_staff");
    });

    it("says staff, not patient, when a staff login's email is also on a patient record", async () => {
      const fk = fake({
        logins: [login(STRANGER, { email: NEW_EMAIL })],
        rows: [row(STRANGER)],
        patientEmails: [NEW_EMAIL],
        patientUids: [STRANGER],
      });
      const res = await run(fk, createRoute());
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("email_in_use_staff");
      expect(fk.called("insertAppUser")).toHaveLength(0);
    });

    it("otherwise says it belongs to another account", async () => {
      const fk = fake({ logins: [login(STRANGER, { email: NEW_EMAIL })] });
      const res = await run(fk, createRoute());
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("email_in_use");
      expect(fk.called("insertAppUser")).toHaveLength(0);
      expect(fk.called("deleteUser")).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------

type UpdateRoute = Extract<StaffRoute, { kind: "update" }>;

function updateRoute(over: Partial<UpdateRoute> = {}): StaffRoute {
  return { kind: "update", userId: TARGET, fullName: null, role: null, ...over };
}

describe("update", () => {
  it("1. needs a staff record", async () => {
    const fk = fake({ target: null });
    const res = await run(fk, updateRoute({ fullName: "New Name" }));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_staff_account");
    expect(writes(fk)).toEqual([]);
  });

  it("2. refuses a disabled (demoted) record", async () => {
    const fk = fake({ target: row(TARGET, { role: "guest" }) });
    for (const route of [updateRoute({ fullName: "New Name" }), updateRoute({ role: "doctor" })]) {
      const res = await run(fk, route);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        error: "account_disabled",
        message: "This account is disabled. Reactivate it first.",
      });
    }
    expect(writes(fk)).toEqual([]);
  });

  it("3. refuses a banned login", async () => {
    const fk = fake({ targetLogin: login(TARGET, { bannedUntil: FUTURE }) });
    const res = await run(fk, updateRoute({ fullName: "New Name" }));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("account_disabled");
    expect(writes(fk)).toEqual([]);
  });

  it("4 and 5. names, roles and fields are checked before any lookup", () => {
    const base = { action: "update", userId: TARGET };
    expect(routeStaffAdminRequest({ ...base, fullName: "<b>Bad</b>" }, 80)).toMatchObject({
      kind: "refused",
      status: 422,
      error: "invalid_name",
    });
    for (const role of ["guest", "registration_lead", "superuser"]) {
      expect(routeStaffAdminRequest({ ...base, role }, 80)).toMatchObject({
        kind: "refused",
        status: 422,
        error: "role_not_allowed",
      });
    }
    expect(routeStaffAdminRequest(base, 80)).toMatchObject({
      kind: "refused",
      status: 422,
      error: "nothing_to_update",
    });
    for (const field of ["adminAccess", "adminPermanent"]) {
      expect(routeStaffAdminRequest({ ...base, role: "nurse", [field]: true }, 80)).toMatchObject({
        kind: "refused",
        status: 400,
        error: "unexpected_field",
        field,
      });
    }
    expect(routeStaffAdminRequest({ ...base, fullName: "  New   Name " }, 80)).toEqual({
      kind: "update",
      userId: TARGET,
      fullName: "New Name",
      role: null,
    });
  });

  it("6. refuses a change to your own role, but allows your own name", async () => {
    const fk = fake();
    const res = await run(fk, updateRoute({ userId: ACTOR, role: "nurse" }));
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "own_account", message: "You can't change your own role." });
    expect(fk.called("updateAppUserFields")).toHaveLength(0);

    const named = await run(fk, updateRoute({ userId: ACTOR, fullName: "Ada A. Admin", role: "admin" }));
    expect(named.status).toBe(200);
    expect(fk.called("updateAppUserFields")).toEqual([[ACTOR, "admin", { full_name: "Ada A. Admin" }]]);
  });

  it("7. refuses a role change on a permanent administrator, but allows a name change", async () => {
    const fk = fake({ actorPermanent: true, target: adminRow(TARGET, { admin_permanent: true }) });
    const res = await run(fk, updateRoute({ role: "nurse" }));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("permanent_admin");
    expect(fk.called("updateAppUserFields")).toHaveLength(0);

    const named = await run(fk, updateRoute({ fullName: "New Name" }));
    expect(named.status).toBe(200);
    expect(fk.called("updateAppUserFields")).toEqual([[TARGET, "admin", { full_name: "New Name" }]]);
  });

  it("8. refuses the admin role while administrators can't be added, even from a permanent administrator", async () => {
    for (const actorPermanent of [false, true]) {
      const fk = fake({ actorPermanent });
      const res = await run(fk, updateRoute({ role: "admin" }));
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("admin_accounts_unavailable");
      expect(writes(fk)).toEqual([]);
      expect(fk.rows.get(TARGET)?.role).toBe("nurse");
    }
  });

  it("9. refuses to take the admin role from the last active administrator", async () => {
    const fk = fake({
      target: adminRow(TARGET),
      otherAdmin: false,
      actorLogin: { emailConfirmedAt: null },
    });
    const res = await run(fk, updateRoute({ role: "nurse" }));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("last_admin");
    expect(writes(fk)).toEqual([]);

    const withOther = fake({ target: adminRow(TARGET) });
    const ok200 = await run(withOther, updateRoute({ role: "nurse" }));
    expect(ok200.status).toBe(200);
    expect(withOther.called("updateAppUserFields")).toEqual([
      [TARGET, "admin", { role: "nurse", admin_access: false }],
    ]);
  });

  it("9. counts again after the write and puts the record back when no administrator is left", async () => {
    // Another request takes the admin role from OTHER_ADMIN at the same time.
    let raced = false;
    const fk = fake({ target: adminRow(TARGET), actorLogin: { emailConfirmedAt: null } }, (base, state) => ({
      async updateAppUserFields(id, expectedRole, next) {
        const res = await base.updateAppUserFields(id, expectedRole, next);
        if (!raced) {
          raced = true;
          const other = state.rows.get(OTHER_ADMIN);
          if (other) state.rows.set(OTHER_ADMIN, { ...other, role: "nurse", admin_access: false });
        }
        return res;
      },
    }));
    const res = await run(fk, updateRoute({ role: "nurse", fullName: "New Name" }));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("last_admin");
    expect(fk.called("updateAppUserFields")).toEqual([
      [TARGET, "admin", { full_name: "New Name", role: "nurse", admin_access: false }],
      [TARGET, "nurse", { role: "admin", admin_access: true, full_name: "Test Person" }],
    ]);
    expect(fk.rows.get(TARGET)).toMatchObject({ role: "admin", admin_access: true, full_name: "Test Person" });
    expect(fk.called("updateUserById")).toHaveLength(0);
    expect(fk.audits).toEqual([]);
  });

  it("9. puts the record back and fails when the recount cannot be read", async () => {
    let pages = 0;
    const fk = fake({ target: adminRow(TARGET) }, (base) => ({
      async selectAppUsersPage(from, to) {
        pages += 1;
        return pages === 1 ? base.selectAppUsersPage(from, to) : err("XX000", 500);
      },
    }));
    const res = await run(fk, updateRoute({ role: "nurse" }));
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("staff_record_error");
    expect(fk.rows.get(TARGET)).toMatchObject({ role: "admin", admin_access: true });
  });

  it("9. reports a server error when the record cannot be put back", async () => {
    let written = false;
    const fk = fake({ target: adminRow(TARGET), otherAdmin: false }, (base) => ({
      async updateAppUserFields(id, expectedRole, next) {
        if (expectedRole === "nurse") return err("XX000", 500);
        written = true;
        return base.updateAppUserFields(id, expectedRole, next);
      },
      async selectAppUsersPage(from, to) {
        // The first count sees an active ACTOR; the recount sees nobody.
        const res = await base.selectAppUsersPage(from, to);
        if (!written || res.error) return res;
        return ok(res.data.filter((r) => r.id !== ACTOR));
      },
    }));
    const res = await run(fk, updateRoute({ role: "nurse" }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("server_error");
  });

  it("10. writes only what changed, only if the role is unchanged, and never admin_permanent", async () => {
    const fk = fake();
    await run(fk, updateRoute({ fullName: "New Name" }));
    await run(fk, updateRoute({ role: "doctor" }));
    expect(fk.called("updateAppUserFields")).toEqual([
      [TARGET, "nurse", { full_name: "New Name" }],
      [TARGET, "nurse", { role: "doctor", admin_access: false }],
    ]);
    for (const [, , next] of fk.called("updateAppUserFields")) {
      expect(next).not.toHaveProperty("admin_permanent");
    }
    expect(fk.rows.get(TARGET)).toMatchObject({ full_name: "New Name", role: "doctor" });
  });

  it("10. says the account changed elsewhere when the conditional write matches nothing", async () => {
    const fk = fake({}, () => ({
      async updateAppUserFields() {
        return ok({ updated: false });
      },
    }));
    const res = await run(fk, updateRoute({ role: "doctor" }));
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error: "changed_elsewhere",
      message: "Someone else changed this account. Reload and try again.",
    });
    expect(fk.called("updateUserById")).toHaveLength(0);
    expect(fk.audits).toEqual([]);
  });

  it("10. maps a database error to a staff record error", async () => {
    const fk = fake({}, () => ({
      async updateAppUserFields() {
        return err("P0001", 400);
      },
    }));
    const res = await run(fk, updateRoute({ fullName: "New Name" }));
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("staff_record_error");
  });

  it("11 and 12. merges the new name into the login and stamps the last action", async () => {
    const fk = fake({
      targetLogin: login(TARGET, {
        appMetadata: { mbhr_account: "staff" },
        userMetadata: { full_name: "Test Person", mbhr_password_set_at: PAST },
      }),
    });
    const res = await run(fk, updateRoute({ fullName: "New Name" }));
    expect(res.status).toBe(200);
    expect(loginUpdates(fk)).toEqual([
      [
        TARGET,
        {
          appMetadata: {
            mbhr_account: "staff",
            mbhr_last_action: "updated",
            mbhr_last_action_by: ACTOR,
            mbhr_last_action_at: NOW_ISO,
          },
          userMetadata: { full_name: "New Name", mbhr_password_set_at: PAST },
        },
      ],
    ]);
  });

  it("11. leaves the login's name alone on a role-only change", async () => {
    const fk = fake();
    await run(fk, updateRoute({ role: "doctor" }));
    const [[, patch]] = loginUpdates(fk);
    expect(patch).not.toHaveProperty("userMetadata");
    expect(patch.appMetadata).toMatchObject({ mbhr_last_action: "updated" });
  });

  it("11 and 12. a login update failure does not fail the request", async () => {
    const fk = fake({}, () => ({
      async updateUserById() {
        return err("unexpected_failure", 500);
      },
    }));
    const res = await run(fk, updateRoute({ fullName: "New Name" }));
    expect(res.status).toBe(200);
    expect(account(res).fullName).toBe("New Name");
    expect(fk.audits.map((a) => a.action)).toEqual(["staff_account_updated"]);
  });

  it("12. a record with no login is updated without touching Auth", async () => {
    const fk = fake({ targetLogin: null });
    const res = await run(fk, updateRoute({ fullName: "New Name" }));
    expect(res.status).toBe(200);
    expect(fk.called("updateUserById")).toHaveLength(0);
    expect(account(res)).toMatchObject({ fullName: "New Name", status: "setup_required" });
  });

  it("13 and 14. writes the audit row and replies with the refreshed account", async () => {
    const fk = fake();
    const res = await run(fk, updateRoute({ fullName: "New Name", role: "doctor" }));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(fk.audits).toEqual([{ id: "audit-1", action: "staff_account_updated", entityId: TARGET }]);
    expect(account(res)).toMatchObject({
      userId: TARGET,
      fullName: "New Name",
      role: "doctor",
      adminAccess: false,
      email: TARGET_EMAIL,
      status: "active",
    });
  });

  it("writes nothing when the values are already stored", async () => {
    const fk = fake();
    const res = await run(fk, updateRoute({ fullName: "Test Person", role: "nurse" }));
    expect(res.status).toBe(200);
    expect(account(res)).toMatchObject({ fullName: "Test Person", role: "nurse" });
    expect(writes(fk)).toEqual([]);
  });

  it("allows every change on a staff login that is also linked to a patient record", async () => {
    const fk = fake({ patientUids: [TARGET], patientEmails: [TARGET_EMAIL] });
    const res = await run(fk, updateRoute({ fullName: "New Name", role: "doctor" }));
    expect(res.status).toBe(200);
    expect(account(res)).toMatchObject({
      fullName: "New Name",
      role: "doctor",
      status: "active",
      linkedPatientRecord: true,
    });
  });
});

// ---------------------------------------------------------------------------

describe("resend_invitation", () => {
  it("sends a new invitation to an unconfirmed login", async () => {
    const fk = fake({
      targetLogin: login(TARGET, { emailConfirmedAt: null, lastSignInAt: null, invitedAt: PAST }),
    });
    const res = await run(fk, { kind: "resend_invitation", userId: TARGET });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, invitation: { sent: true, via: "invite" } });
    expect(fk.called("inviteUserByEmail")).toEqual([
      [TARGET_EMAIL, { redirectTo: INVITE_LINK, data: { full_name: "Test Person" } }],
    ]);
    expect(loginUpdates(fk)[0][1].appMetadata).toMatchObject({
      mbhr_last_action: "invitation_resent",
      mbhr_last_action_by: ACTOR,
    });
    expect(fk.audits.map((a) => a.action)).toEqual(["staff_invitation_resent"]);
  });

  it("sends a reset link to a confirmed login", async () => {
    const fk = fake();
    const res = await run(fk, { kind: "resend_invitation", userId: TARGET });
    expect(res.body.invitation).toEqual({ sent: true, via: "recovery" });
    expect(fk.called("resetPasswordForEmail")).toEqual([[TARGET_EMAIL, { redirectTo: RECOVERY_LINK }]]);
    expect(fk.called("inviteUserByEmail")).toHaveLength(0);
  });

  it("refuses a disabled account", async () => {
    for (const options of [
      { targetLogin: login(TARGET, { bannedUntil: FUTURE }) },
      { target: row(TARGET, { role: "guest" }) },
    ]) {
      const fk = fake(options);
      const res = await run(fk, { kind: "resend_invitation", userId: TARGET });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("account_disabled");
      expect(fk.called("checkLimits")).toHaveLength(0);
      expect(writes(fk)).toEqual([]);
    }
  });

  it("needs a staff record and a login", async () => {
    const noRow = await run(fake({ target: null }), { kind: "resend_invitation", userId: TARGET });
    expect(noRow.status).toBe(404);
    expect(noRow.body.error).toBe("not_staff_account");

    const noLogin = await run(fake({ targetLogin: null }), { kind: "resend_invitation", userId: TARGET });
    expect(noLogin.status).toBe(409);
    expect(noLogin.body.error).toBe("no_login");
  });

  it("stops at the email limits", async () => {
    const limited = fake({}, () => ({
      async checkLimits() {
        return { allowed: false as const, retryAfter: 90 };
      },
    }));
    const res = await run(limited, { kind: "resend_invitation", userId: TARGET });
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: "rate_limited", retry_after_seconds: 90 });
    expect(writes(limited)).toEqual([]);
  });

  it("does not stamp the login when nothing was sent", async () => {
    const fk = fake(
      { targetLogin: login(TARGET, { emailConfirmedAt: null, lastSignInAt: null }) },
      () => ({
        async inviteUserByEmail() {
          return err("unexpected_failure", 500);
        },
      }),
    );
    const res = await run(fk, { kind: "resend_invitation", userId: TARGET });
    expect(res.status).toBe(200);
    expect(res.body.invitation).toEqual({ sent: false, via: null, error: "send_failed" });
    expect(fk.called("updateUserById")).toHaveLength(0);
  });
});

describe("reset_password", () => {
  it("points an unconfirmed login to Resend invitation", async () => {
    const fk = fake({ targetLogin: login(TARGET, { emailConfirmedAt: null, lastSignInAt: null }) });
    const res = await run(fk, { kind: "reset_password", userId: TARGET });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("use_resend_invitation");
    expect(fk.called("resetPasswordForEmail")).toHaveLength(0);
  });

  it("sends a reset link to a confirmed login", async () => {
    const fk = fake();
    const res = await run(fk, { kind: "reset_password", userId: TARGET });
    expect(res.status).toBe(200);
    expect(res.body.invitation).toEqual({ sent: true, via: "recovery" });
    expect(loginUpdates(fk)[0][1].appMetadata).toMatchObject({ mbhr_last_action: "password_reset_sent" });
    expect(fk.audits.map((a) => a.action)).toEqual(["staff_password_reset_sent"]);
  });

  it("lets administrators send a link to themselves", async () => {
    const fk = fake();
    const res = await run(fk, { kind: "reset_password", userId: ACTOR });
    expect(res.status).toBe(200);
    expect(fk.called("resetPasswordForEmail")[0][0]).toBe("ada.admin@example.org");
  });

  it("refuses a disabled account", async () => {
    const fk = fake({ targetLogin: login(TARGET, { bannedUntil: FUTURE }) });
    const res = await run(fk, { kind: "reset_password", userId: TARGET });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("account_disabled");
  });
});

// ---------------------------------------------------------------------------

describe("disable", () => {
  it("records the role, demotes the record, then bans the login", async () => {
    const fk = fake();
    const res = await run(fk, { kind: "disable", userId: TARGET });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, status: "disabled", rowUpdated: true });

    const order = fk.calls.filter(
      (c) => c.method === "updateUserById" || c.method === "updateAppUserAccess",
    );
    expect(order.map((c) => c.method)).toEqual([
      "updateUserById",
      "updateAppUserAccess",
      "updateUserById",
    ]);
    expect(order[0].args).toEqual([
      TARGET,
      {
        appMetadata: {
          mbhr_disabled_role: "nurse",
          mbhr_disabled_admin_access: false,
          mbhr_disabled_by: ACTOR,
          mbhr_disabled_at: NOW_ISO,
          mbhr_last_action: "disabled",
          mbhr_last_action_by: ACTOR,
          mbhr_last_action_at: NOW_ISO,
        },
      },
    ]);
    expect(order[1].args).toEqual([TARGET, "nurse", { role: "guest", admin_access: false }]);
    expect(order[2].args).toEqual([TARGET, { banDuration: BAN_DURATION }]);
    expect(fk.rows.get(TARGET)).toMatchObject({ role: "guest", admin_access: false });
    expect(fk.logins.get(TARGET)?.bannedUntil).toBe(FUTURE);
    expect(fk.audits.map((a) => a.action)).toEqual(["staff_account_disabled"]);
  });

  it("disables an administrator while another active administrator remains", async () => {
    const fk = fake({ target: adminRow(TARGET) });
    const res = await run(fk, { kind: "disable", userId: TARGET });
    expect(res.status).toBe(200);
    expect(loginUpdates(fk)[0][1].appMetadata).toMatchObject({
      mbhr_disabled_role: "admin",
      mbhr_disabled_admin_access: true,
    });
    expect(fk.called("updateAppUserAccess")).toEqual([
      [TARGET, "admin", { role: "guest", admin_access: false }],
    ]);
    expect(fk.logins.get(TARGET)?.bannedUntil).toBe(FUTURE);
  });

  it("does not ban when the demotion write fails, and undoes the record", async () => {
    const fk = fake({}, () => ({
      async updateAppUserAccess() {
        return err("08006", 503);
      },
    }));
    const res = await run(fk, { kind: "disable", userId: TARGET });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("staff_record_error");
    expect(fk.logins.get(TARGET)?.bannedUntil ?? null).toBeNull();
    expect(fk.rows.get(TARGET)?.role).toBe("nurse");
    expect(fk.logins.get(TARGET)?.appMetadata.mbhr_disabled_role ?? null).toBeNull();
  });

  it("stops before the ban when the record changed since it was read", async () => {
    const fk = fake({}, () => ({
      async updateAppUserAccess() {
        return ok({ updated: false });
      },
    }));
    const res = await run(fk, { kind: "disable", userId: TARGET });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("changed_elsewhere");
    expect(banCalls(fk)).toEqual([]);
    expect(fk.logins.get(TARGET)?.bannedUntil).toBeNull();
    expect(fk.logins.get(TARGET)?.appMetadata.mbhr_disabled_at).toBeNull();
  });

  it("is idempotent when the account is already disabled", async () => {
    const fk = fake({
      target: row(TARGET, { role: "guest" }),
      targetLogin: login(TARGET, {
        bannedUntil: FUTURE,
        appMetadata: { mbhr_disabled_at: PAST, mbhr_disabled_role: "nurse" },
      }),
    });
    const res = await run(fk, { kind: "disable", userId: TARGET });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      status: "disabled",
      rowUpdated: true,
      alreadyDisabled: true,
    });
    expect(writes(fk)).toEqual([]);
  });

  it("finishes an interrupted disable, keeping the role it recorded", async () => {
    const fk = fake({
      target: row(TARGET, { role: "guest" }),
      targetLogin: login(TARGET, {
        appMetadata: { mbhr_disabled_role: "doctor", mbhr_disabled_admin_access: false },
      }),
    });
    const res = await run(fk, { kind: "disable", userId: TARGET });
    expect(res.status).toBe(200);
    expect(res.body.rowUpdated).toBe(true);
    expect(fk.called("updateAppUserAccess")).toHaveLength(0);
    expect(fk.logins.get(TARGET)?.appMetadata.mbhr_disabled_role).toBe("doctor");
    expect(fk.logins.get(TARGET)?.bannedUntil).toBe(FUTURE);
  });

  /** The other administrator is banned by the time of the recount. */
  function racingAdmins(extra: (base: StaffAdminPort) => Partial<StaffAdminPort> = () => ({})) {
    let otherReads = 0;
    return fake(
      { target: adminRow(TARGET), actorLogin: { emailConfirmedAt: null } },
      (base) => ({
        async getUserById(id) {
          if (id === OTHER_ADMIN) {
            otherReads += 1;
            if (otherReads > 1) return ok(login(OTHER_ADMIN, { bannedUntil: FUTURE }));
          }
          return base.getUserById(id);
        },
        ...extra(base),
      }),
    );
  }

  it("puts the record back and refuses when no other administrator is left at the recount", async () => {
    const fk = racingAdmins();
    const res = await run(fk, { kind: "disable", userId: TARGET });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("last_admin");
    expect(fk.called("updateAppUserAccess")).toEqual([
      [TARGET, "admin", { role: "guest", admin_access: false }],
      [TARGET, "guest", { role: "admin", admin_access: true }],
    ]);
    expect(fk.rows.get(TARGET)).toMatchObject({ role: "admin", admin_access: true });
    expect(banCalls(fk)).toEqual([]);
    expect(fk.logins.get(TARGET)?.appMetadata.mbhr_disabled_at).toBeNull();
  });

  it("reports partial_disable when the record cannot be put back", async () => {
    let accessWrites = 0;
    const fk = racingAdmins((base) => ({
      async updateAppUserAccess(id, expectedRole, next) {
        accessWrites += 1;
        return accessWrites === 1 ? base.updateAppUserAccess(id, expectedRole, next) : err("08006", 503);
      },
    }));
    const res = await run(fk, { kind: "disable", userId: TARGET });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("partial_disable");
  });

  it("puts the record back when the ban fails", async () => {
    const fk = fake({}, (base) => ({
      async updateUserById(id, i) {
        return i.banDuration === BAN_DURATION ? err("unexpected_failure", 500) : base.updateUserById(id, i);
      },
    }));
    const res = await run(fk, { kind: "disable", userId: TARGET });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("login_service_error");
    expect(fk.rows.get(TARGET)?.role).toBe("nurse");
    expect(fk.logins.get(TARGET)?.bannedUntil).toBeNull();
    expect(fk.logins.get(TARGET)?.appMetadata.mbhr_disabled_at).toBeNull();
  });

  it("reports partial_disable when the ban fails and the record cannot be put back", async () => {
    let accessWrites = 0;
    const fk = fake({}, (base) => ({
      async updateUserById(id, i) {
        return i.banDuration === BAN_DURATION ? err("unexpected_failure", 500) : base.updateUserById(id, i);
      },
      async updateAppUserAccess(id, expectedRole, next) {
        accessWrites += 1;
        return accessWrites === 1 ? base.updateAppUserAccess(id, expectedRole, next) : err("08006", 503);
      },
    }));
    const res = await run(fk, { kind: "disable", userId: TARGET });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("partial_disable");
  });

  it("changes nothing when the role cannot be recorded on the login", async () => {
    const fk = fake({}, () => ({
      async updateUserById() {
        return err("unexpected_failure", 500);
      },
    }));
    const res = await run(fk, { kind: "disable", userId: TARGET });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("login_service_error");
    expect(fk.called("updateAppUserAccess")).toHaveLength(0);
    expect(fk.rows.get(TARGET)?.role).toBe("nurse");
  });

  it("refuses your own account and a permanent administrator before any write", async () => {
    const self = fake();
    const own = await run(self, { kind: "disable", userId: ACTOR });
    expect(own.status).toBe(409);
    expect(own.body).toMatchObject({ error: "own_account", message: "You can't disable your own account." });
    expect(writes(self)).toEqual([]);

    const perm = fake({ actorPermanent: true, target: adminRow(TARGET, { admin_permanent: true }) });
    const res = await run(perm, { kind: "disable", userId: TARGET });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("permanent_admin");
    expect(writes(perm)).toEqual([]);
  });

  it("refuses the last active administrator before any write", async () => {
    const fk = fake({
      target: adminRow(TARGET),
      otherAdmin: false,
      actorLogin: { emailConfirmedAt: null },
    });
    const res = await run(fk, { kind: "disable", userId: TARGET });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("last_admin");
    expect(writes(fk)).toEqual([]);
  });

  it("needs a staff record and a login", async () => {
    const noRow = await run(fake({ target: null }), { kind: "disable", userId: TARGET });
    expect(noRow.status).toBe(404);
    const noLogin = await run(fake({ targetLogin: null }), { kind: "disable", userId: TARGET });
    expect(noLogin.status).toBe(409);
    expect(noLogin.body.error).toBe("no_login");
  });
});

// ---------------------------------------------------------------------------

function disabledLogin(meta: Record<string, unknown> = {}): LoginRecord {
  return login(TARGET, {
    bannedUntil: FUTURE,
    appMetadata: {
      mbhr_disabled_role: "nurse",
      mbhr_disabled_admin_access: false,
      mbhr_disabled_by: ACTOR,
      mbhr_disabled_at: PAST,
      ...meta,
    },
  });
}

const GUEST_ROW = row(TARGET, { role: "guest" });

describe("reactivate", () => {
  it("restores the recorded role first, then lifts the ban last", async () => {
    const fk = fake({ target: GUEST_ROW, targetLogin: disabledLogin() });
    const res = await run(fk, { kind: "reactivate", userId: TARGET, role: null });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, status: "active", role: "nurse" });
    const order = fk.calls.filter(
      (c) => c.method === "updateUserById" || c.method === "updateAppUserAccess",
    );
    expect(order.map((c) => c.method)).toEqual(["updateAppUserAccess", "updateUserById"]);
    expect(order[0].args).toEqual([TARGET, "guest", { role: "nurse", admin_access: false }]);
    expect(order[1].args).toEqual([
      TARGET,
      {
        banDuration: UNBAN,
        appMetadata: {
          mbhr_disabled_role: null,
          mbhr_disabled_admin_access: null,
          mbhr_disabled_by: null,
          mbhr_disabled_at: null,
          mbhr_last_action: "reactivated",
          mbhr_last_action_by: ACTOR,
          mbhr_last_action_at: NOW_ISO,
        },
      },
    ]);
    expect(fk.audits.map((a) => a.action)).toEqual(["staff_account_reactivated"]);
  });

  it("reports partial_reactivate when the ban cannot be lifted", async () => {
    const fk = fake({ target: GUEST_ROW, targetLogin: disabledLogin() }, () => ({
      async updateUserById() {
        return err("unexpected_failure", 500);
      },
    }));
    const res = await run(fk, { kind: "reactivate", userId: TARGET, role: null });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("partial_reactivate");
    expect(fk.rows.get(TARGET)?.role).toBe("nurse");
  });

  it("skips the record on a retry and only lifts the ban", async () => {
    const fk = fake({ target: row(TARGET), targetLogin: disabledLogin() });
    const res = await run(fk, { kind: "reactivate", userId: TARGET, role: null });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("nurse");
    expect(fk.called("updateAppUserAccess")).toHaveLength(0);
    expect(fk.logins.get(TARGET)?.bannedUntil).toBeNull();
  });

  it("asks for a role when none was recorded, and uses the one given", async () => {
    const bare = login(TARGET, { bannedUntil: FUTURE });
    const fk = fake({ target: GUEST_ROW, targetLogin: bare });
    const res = await run(fk, { kind: "reactivate", userId: TARGET, role: null });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("role_needed");
    expect(writes(fk)).toEqual([]);

    const given = await run(fk, { kind: "reactivate", userId: TARGET, role: "doctor" });
    expect(given.status).toBe(200);
    expect(given.body.role).toBe("doctor");
    expect(fk.called("updateAppUserAccess")).toEqual([
      [TARGET, "guest", { role: "doctor", admin_access: false }],
    ]);
  });

  it("does not restore the admin role while administrators can't be restored", async () => {
    const adminLogin = disabledLogin({ mbhr_disabled_role: "admin", mbhr_disabled_admin_access: true });
    for (const actorPermanent of [false, true]) {
      const fk = fake({ actorPermanent, target: GUEST_ROW, targetLogin: adminLogin });
      const res = await run(fk, { kind: "reactivate", userId: TARGET, role: null });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("admin_accounts_unavailable");
      expect(writes(fk)).toEqual([]);
      expect(fk.rows.get(TARGET)?.role).toBe("guest");
    }
    // Nor when the admin role is the one asked for.
    const asked = fake({
      actorPermanent: true,
      target: GUEST_ROW,
      targetLogin: disabledLogin({ mbhr_disabled_role: null }),
    });
    const res = await run(asked, { kind: "reactivate", userId: TARGET, role: "admin" });
    expect(res.body.error).toBe("admin_accounts_unavailable");
    expect(writes(asked)).toEqual([]);
  });

  it("does not lift the ban on an admin record that kept its role while administrators can't be restored", async () => {
    const adminLogin = disabledLogin({ mbhr_disabled_role: "admin", mbhr_disabled_admin_access: true });
    for (const actorPermanent of [false, true]) {
      const fk = fake({ actorPermanent, target: adminRow(TARGET), targetLogin: adminLogin });
      const res = await run(fk, { kind: "reactivate", userId: TARGET, role: null });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("admin_accounts_unavailable");
      expect(writes(fk)).toEqual([]);
      expect(fk.logins.get(TARGET)?.bannedUntil).toBe(FUTURE);
    }
  });

  describe("a record with no staff role on a login this function never disabled", () => {
    // A guest row that was never disabled here: giving it a role would
    // promote the login, so it gets the patient checks.
    const unmarked = login(TARGET, { bannedUntil: FUTURE });

    it("refuses a login linked to a patient record", async () => {
      const fk = fake({ target: GUEST_ROW, targetLogin: unmarked, patientUids: [TARGET] });
      const res = await run(fk, { kind: "reactivate", userId: TARGET, role: "nurse" });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("patient_login");
      expect(fk.called("isPatientLogin")).toEqual([[TARGET]]);
      expect(writes(fk)).toEqual([]);
      expect(fk.rows.get(TARGET)?.role).toBe("guest");
    });

    it("refuses a login whose email is on a patient record", async () => {
      const fk = fake({ target: GUEST_ROW, targetLogin: unmarked, patientEmails: [TARGET_EMAIL] });
      const res = await run(fk, { kind: "reactivate", userId: TARGET, role: "nurse" });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("patient_email");
      expect(fk.called("patientEmailExists")).toEqual([[TARGET_EMAIL]]);
      expect(writes(fk)).toEqual([]);
    });

    it("refuses a login made by the patient portal sign-up", async () => {
      const portal = login(TARGET, { userMetadata: { dob: "1990-01-01", given_name: "Pat" } });
      const fk = fake({ target: GUEST_ROW, targetLogin: portal });
      const res = await run(fk, { kind: "reactivate", userId: TARGET, role: "nurse" });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("portal_signup");
      expect(writes(fk)).toEqual([]);
    });

    it("refuses when the patient checks cannot be made", async () => {
      const linkFails = fake({ target: GUEST_ROW, targetLogin: unmarked }, () => ({
        async isPatientLogin() {
          return err("XX000", 500);
        },
      }));
      const a = await run(linkFails, { kind: "reactivate", userId: TARGET, role: "nurse" });
      expect(a.status).toBe(502);
      expect(a.body.error).toBe("staff_record_error");
      expect(writes(linkFails)).toEqual([]);

      const emailFails = fake({ target: GUEST_ROW, targetLogin: unmarked }, () => ({
        async patientEmailExists() {
          return err("XX000", 500);
        },
      }));
      const b = await run(emailFails, { kind: "reactivate", userId: TARGET, role: "nurse" });
      expect(b.status).toBe(502);
      expect(b.body.error).toBe("staff_record_error");
      expect(writes(emailFails)).toEqual([]);
    });

    it("skips the patient checks for a login this function disabled or tagged as staff", async () => {
      const disabled = fake({ target: GUEST_ROW, targetLogin: disabledLogin(), patientUids: [TARGET] });
      expect((await run(disabled, { kind: "reactivate", userId: TARGET, role: null })).status).toBe(200);
      expect(disabled.called("isPatientLogin")).toHaveLength(0);

      const tagged = fake({
        target: GUEST_ROW,
        targetLogin: login(TARGET, { bannedUntil: FUTURE, appMetadata: { mbhr_account: "staff" } }),
        patientUids: [TARGET],
      });
      const res = await run(tagged, { kind: "reactivate", userId: TARGET, role: "nurse" });
      expect(res.status).toBe(200);
      expect(tagged.called("isPatientLogin")).toHaveLength(0);
    });

    it("never runs the patient checks on a record that still has a staff role", async () => {
      const fk = fake({ targetLogin: unmarked, patientUids: [TARGET] });
      const res = await run(fk, { kind: "reactivate", userId: TARGET, role: null });
      expect(res.status).toBe(200);
      expect(fk.called("isPatientLogin")).toHaveLength(0);
    });
  });

  it("refuses your own account and an account that is already active", async () => {
    const self = await run(fake(), { kind: "reactivate", userId: ACTOR, role: null });
    expect(self.status).toBe(409);
    expect(self.body).toMatchObject({
      error: "own_account",
      message: "You can't reactivate your own account.",
    });

    const active = await run(fake(), { kind: "reactivate", userId: TARGET, role: null });
    expect(active.status).toBe(409);
    expect(active.body.error).toBe("already_active");
  });
});

// ---------------------------------------------------------------------------

type CreateLoginRoute = Extract<StaffRoute, { kind: "create_login" }>;

function createLoginRoute(over: Partial<CreateLoginRoute> = {}): StaffRoute {
  return {
    kind: "create_login",
    userId: TARGET,
    email: TARGET_EMAIL,
    confirmFullName: "test person",
    ...over,
  };
}

describe("create_login", () => {
  it("creates a tagged login for the staff record and sends the invitation", async () => {
    const fk = fake({ targetLogin: null });
    const res = await run(fk, createLoginRoute());
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      success: true,
      userId: TARGET,
      status: "invited",
      invitation: { sent: true, via: "invite" },
    });
    expect(fk.called("createUser")[0][0]).toEqual({
      id: TARGET,
      email: TARGET_EMAIL,
      userMetadata: { full_name: "Test Person" },
      appMetadata: {
        mbhr_account: "staff",
        mbhr_repair: "create_login",
        mbhr_repair_by: ACTOR,
        mbhr_repair_at: NOW_ISO,
        mbhr_last_action: "login_created",
        mbhr_last_action_by: ACTOR,
        mbhr_last_action_at: NOW_ISO,
      },
    });
    expect(fk.called("inviteUserByEmail")[0][1]).toMatchObject({ redirectTo: INVITE_LINK });
    expect(fk.audits.map((a) => a.action)).toEqual(["staff_login_created"]);
  });

  it("refuses a permanent administrator's record", async () => {
    const fk = fake({
      actorPermanent: true,
      target: adminRow(TARGET, { admin_permanent: true }),
      targetLogin: null,
    });
    const res = await run(fk, createLoginRoute());
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("permanent_admin");
    expect(writes(fk)).toEqual([]);
  });

  it("does not make a login for an admin record while administrators can't be added", async () => {
    for (const actorPermanent of [false, true]) {
      const fk = fake({ actorPermanent, target: adminRow(TARGET), targetLogin: null });
      const res = await run(fk, createLoginRoute());
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("admin_accounts_unavailable");
      expect(writes(fk)).toEqual([]);
    }
  });

  it("refuses when the typed name does not match the record", async () => {
    const fk = fake({ targetLogin: null });
    const res = await run(fk, createLoginRoute({ confirmFullName: "Someone Else" }));
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "confirm_mismatch", field: "confirmFullName" });
    expect(writes(fk)).toEqual([]);
  });

  it("refuses when a login already exists, or the record has no staff role", async () => {
    const exists = await run(fake(), createLoginRoute());
    expect(exists.status).toBe(409);
    expect(exists.body.error).toBe("login_exists");

    const guest = await run(fake({ target: GUEST_ROW, targetLogin: null }), createLoginRoute());
    expect(guest.status).toBe(409);
    expect(guest.body.error).toBe("no_staff_role");
  });

  it("never deletes anything when the login cannot be created", async () => {
    const fk = fake({ targetLogin: null }, () => ({
      async createUser() {
        return err("unexpected_failure", 500);
      },
    }));
    const res = await run(fk, createLoginRoute());
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("login_service_error");
    expect(fk.called("deleteUser")).toHaveLength(0);
    expect(fk.rows.has(TARGET)).toBe(true);
  });

  it("says when a patient record uses the email", async () => {
    const fk = fake({ targetLogin: null, patientEmails: [TARGET_EMAIL] }, () => ({
      async createUser() {
        return err("email_exists", 422);
      },
    }));
    const res = await run(fk, createLoginRoute());
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("email_in_use_patient");
    expect(fk.called("deleteUser")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

type RecordRoute = Extract<StaffRoute, { kind: "create_staff_record" }>;

function recordRoute(over: Partial<RecordRoute> = {}): StaffRoute {
  return {
    kind: "create_staff_record",
    userId: TARGET,
    fullName: "Test Person",
    role: "nurse",
    confirmEmail: TARGET_EMAIL,
    acknowledged: true,
    ...over,
  };
}

describe("create_staff_record", () => {
  it("adds a staff record without administrator access and tags the login", async () => {
    const fk = fake({ target: null });
    const res = await run(fk, recordRoute());
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, userId: TARGET, status: "active" });
    expect(fk.called("insertAppUser")[0][0]).toEqual({
      id: TARGET,
      full_name: "Test Person",
      role: "nurse",
      admin_access: false,
      admin_permanent: false,
    });
    expect(fk.logins.get(TARGET)?.appMetadata).toMatchObject({
      mbhr_account: "staff",
      mbhr_repair: "create_staff_record",
      mbhr_repair_by: ACTOR,
      mbhr_repair_at: NOW_ISO,
      mbhr_last_action: "staff_record_created",
    });
    expect(fk.audits.map((a) => a.action)).toEqual(["staff_record_created"]);
  });

  it("never grants the admin role", async () => {
    const routed = routeStaffAdminRequest(
      {
        action: "create_staff_record",
        userId: TARGET,
        fullName: "Test Person",
        role: "admin",
        confirmEmail: TARGET_EMAIL,
        acknowledged: true,
      },
      200,
    );
    expect(routed).toMatchObject({ kind: "refused", status: 422, error: "role_not_allowed" });

    const fk = fake({ target: null, actorPermanent: true });
    const res = await run(fk, recordRoute({ role: "admin" }));
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("role_not_allowed");
    expect(fk.called("insertAppUser")).toHaveLength(0);
  });

  it("refuses when the typed email does not match, before any patient lookup", async () => {
    const fk = fake({ target: null });
    const res = await run(fk, recordRoute({ confirmEmail: "other.person@example.org" }));
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "confirm_mismatch", field: "confirmEmail" });
    expect(fk.called("isPatientLogin")).toHaveLength(0);
    expect(fk.called("patientEmailExists")).toHaveLength(0);
  });

  it("needs the acknowledgement", () => {
    const routed = routeStaffAdminRequest(
      {
        action: "create_staff_record",
        userId: TARGET,
        fullName: "Test Person",
        role: "nurse",
        confirmEmail: TARGET_EMAIL,
        acknowledged: false,
      },
      200,
    );
    expect(routed).toMatchObject({ kind: "refused", status: 422, error: "acknowledgement_required" });
  });

  const refusals: [string, WorldOptions, string][] = [
    ["a login linked to a patient record", { patientUids: [TARGET] }, "patient_login"],
    ["an email a patient record uses", { patientEmails: [TARGET_EMAIL] }, "patient_email"],
    [
      "a portal sign-up login",
      { targetLogin: login(TARGET, { userMetadata: { dob: "1990-01-01" } }) },
      "portal_signup",
    ],
    ["an anonymous login", { targetLogin: login(TARGET, { isAnonymous: true }) }, "anonymous_login"],
    ["a banned login", { targetLogin: login(TARGET, { bannedUntil: FUTURE }) }, "account_disabled"],
    [
      "an unconfirmed login that is not tagged as staff",
      { targetLogin: login(TARGET, { emailConfirmedAt: null, lastSignInAt: null }) },
      "login_unconfirmed",
    ],
  ];
  for (const [label, options, code] of refusals) {
    it(`refuses ${label}`, async () => {
      const fk = fake({ target: null, ...options });
      const res = await run(fk, recordRoute());
      expect(res.status).toBe(409);
      expect(res.body.error).toBe(code);
      expect(writes(fk)).toEqual([]);
    });
  }

  it("allows an unconfirmed login that is tagged as staff", async () => {
    const fk = fake({
      target: null,
      targetLogin: login(TARGET, {
        emailConfirmedAt: null,
        lastSignInAt: null,
        appMetadata: { mbhr_account: "staff" },
      }),
    });
    const res = await run(fk, recordRoute());
    expect(res.status).toBe(201);
  });

  it("refuses when a staff record exists, or there is no login", async () => {
    const exists = await run(fake(), recordRoute());
    expect(exists.status).toBe(409);
    expect(exists.body.error).toBe("staff_exists");

    const none = await run(fake({ target: null, targetLogin: null }), recordRoute());
    expect(none.status).toBe(404);
    expect(none.body.error).toBe("not_found");
  });

  it("treats an insert that finds a row already there as staff_exists", async () => {
    const fk = fake({ target: null }, () => ({
      async insertAppUser() {
        return err("23505", 409);
      },
    }));
    const res = await run(fk, recordRoute());
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("staff_exists");
  });

  it("refuses when the patient checks cannot be made", async () => {
    const fk = fake({ target: null }, () => ({
      async isPatientLogin() {
        return err("exception");
      },
    }));
    const res = await run(fk, recordRoute());
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("staff_record_error");
    expect(fk.called("insertAppUser")).toHaveLength(0);
  });

  it("looks up this login's patient link directly, never through the paged list", async () => {
    const fk = fake({ target: null, patientUids: [TARGET] }, () => ({
      // A partial list that misses the login must not let it through.
      async selectPatientAuthUids() {
        return ok([]);
      },
    }));
    const res = await run(fk, recordRoute());
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("patient_login");
    expect(fk.called("isPatientLogin")).toEqual([[TARGET]]);
    expect(fk.called("selectPatientAuthUids")).toHaveLength(0);
    expect(writes(fk)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

function keysDeep(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) keysDeep(item, out);
  } else if (value !== null && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) {
      out.push(key);
      keysDeep(inner, out);
    }
  }
  return out;
}

describe("what reaches the port", () => {
  it("never carries a PIN, and keeps emails and names out of audit rows and limit keys", async () => {
    const fk = fake();
    const routes: StaffRoute[] = [
      { kind: "overview" },
      { kind: "login_status", userId: TARGET },
      updateRoute({ fullName: "New Name" }),
      { kind: "resend_invitation", userId: TARGET },
      { kind: "reset_password", userId: TARGET },
      { kind: "disable", userId: TARGET },
      { kind: "reactivate", userId: TARGET, role: null },
      createRoute(),
    ];
    for (const route of routes) {
      const res = await run(fk, route);
      expect(res.status).toBeLessThan(300);
    }
    expect(keysDeep(fk.calls.map((c) => c.args)).filter((k) => /pin/i.test(k))).toEqual([]);

    const audits = JSON.stringify(fk.audits);
    expect(fk.audits.length).toBeGreaterThan(0);
    expect(audits).not.toContain("@");
    expect(audits).not.toMatch(/New Name|Test Person|Nkem|Ada Admin/);

    const limitKeys = fk
      .called("checkLimits")
      .flatMap((a) => (a[0] as { key: string }[]).map((l) => l.key));
    expect(limitKeys.length).toBeGreaterThan(0);
    for (const key of limitKeys) expect(key).not.toContain("@");
  });

  it("builds every link from the configured origin", async () => {
    const fk = fake({}, () => ({
      async inviteUserByEmail() {
        return err("email_exists", 422);
      },
    }));
    await run(fk, createRoute(), { ...CTX, appOrigin: "https://other.example.net" });
    expect(fk.called("inviteUserByEmail")[0][1]).toMatchObject({
      redirectTo: "https://other.example.net/reset-password?for=staff&link=invite",
    });
    expect(fk.called("resetPasswordForEmail")[0][1]).toEqual({
      redirectTo: "https://other.example.net/reset-password?for=staff",
    });
  });
});
