// Regression suite for the owner's rule on offline sign-in and sync:
//
//   Offline PIN authentication must never establish a cloud-authenticated
//   sync session. Online Supabase login -> authenticated online -> sync
//   allowed. Offline PIN login -> authenticated locally -> clinical work
//   allowed according to cached permissions -> sync BLOCKED ->
//   "Offline — sign in online to sync".
//
// src/stores/auth.ts is where this could quietly disappear, so these tests
// drive the real auth store, online sign-in check (src/lib/cloudSession.ts),
// sync engine (src/sync/adapter.ts), enhanced sync, command outbox, pharmacy
// and queue-ticket participants and SMS worker against one fake Supabase
// client. Like supabase-js, the fake keeps its sign-in in localStorage under
// "sb-<project>-auth-token", which every client in the app shares. Only
// device storage (Dexie) and a few leaf services are replaced.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import type { MockInstance } from "vitest";
import type { User } from "@/db";
import type { Role } from "@/auth/roles";

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  type AuthListener = (event: string, session: unknown) => void;

  // --- Supabase auth: the sign-in lives in localStorage, as in supabase-js.
  const AUTH_KEY = "sb-testproject-auth-token";
  /** Every supabase.auth method called, by name, in order. */
  const authCalls: string[] = [];
  const listeners = new Set<AuthListener>();
  const emit = (event: string, session: unknown) => listeners.forEach((l) => l(event, session));
  const storedSession = () => {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? (JSON.parse(raw) as { user?: { id: string; email?: string } }) : null;
  };
  /** Online accounts: email -> online user id and password. */
  const onlineAccounts = new Map<string, { id: string; password: string }>();

  const signInWithPassword = vi.fn(async (input: { email: string; password: string }) => {
    const email = input.email.toLowerCase();
    const account = onlineAccounts.get(email);
    if (!account || account.password !== input.password) {
      return {
        data: { user: null, session: null },
        error: { name: "AuthApiError", status: 400 },
      };
    }
    const user = { id: account.id, email, user_metadata: {} };
    const session = {
      access_token: `access-${account.id}`,
      refresh_token: `refresh-${account.id}`,
      token_type: "bearer",
      expires_in: 3600,
      user,
    };
    localStorage.setItem(AUTH_KEY, JSON.stringify(session));
    emit("SIGNED_IN", session);
    return { data: { user, session }, error: null };
  });
  const signOut = vi.fn(async (_options?: { scope?: string }) => {
    localStorage.removeItem(AUTH_KEY);
    emit("SIGNED_OUT", null);
    return { error: null as unknown };
  });
  const implemented: Record<string, (...args: never[]) => unknown> = {
    getSession: async () => ({ data: { session: storedSession() }, error: null }),
    getUser: async () => ({ data: { user: storedSession()?.user ?? null }, error: null }),
    onAuthStateChange: (callback: AuthListener) => {
      listeners.add(callback);
      return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
    },
    signInWithPassword,
    signOut,
  };
  // Any other auth method (setSession, refreshSession, signInWithOtp,
  // exchangeCodeForSession, signInAnonymously, ...) is recorded and creates
  // nothing, so a new call shows up in authCalls.
  const auth = new Proxy(implemented, {
    get(target, prop) {
      if (typeof prop !== "string" || prop === "then") return undefined;
      return (...args: never[]) => {
        authCalls.push(prop);
        const method = target[prop];
        if (method) return method(...args);
        return Promise.resolve({ data: { session: null, user: null }, error: null });
      };
    },
  });

  // --- Supabase data API: every request is recorded.
  /** Server staff records (public.app_users) by online user id. */
  const serverStaff = new Map<string, Row>();
  const writes: { table: string; method: string }[] = [];
  function query(table: string) {
    let idFilter: unknown;
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    for (const name of ["select", "neq", "gt", "gte", "lt", "lte", "in", "is", "not", "or", "order", "limit", "range", "match", "filter", "contains"]) {
      builder[name] = chain;
    }
    builder.eq = (column: string, value: unknown) => {
      if (column === "id") idFilter = value;
      return builder;
    };
    for (const name of ["upsert", "insert", "update", "delete"]) {
      builder[name] = () => {
        writes.push({ table, method: name });
        return builder;
      };
    }
    builder.maybeSingle = async () => ({
      data: table === "app_users" ? (serverStaff.get(String(idFilter)) ?? null) : null,
      error: null,
      status: 200,
    });
    builder.single = builder.maybeSingle;
    builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null, status: 200, count: 0 }).then(resolve, reject);
    return builder;
  }
  const from = vi.fn((table: string) => query(table));
  const rpc = vi.fn(async (_name: string, _args?: Row) => ({ data: null, error: null, status: 200 }));
  const invoke = vi.fn(async (_name: string, _options?: unknown) => ({ data: null, error: null }));
  const fetch = vi.fn(async (_url: unknown, _init?: unknown) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({}),
    text: async () => "{}",
  }));
  const client = { auth, from, rpc, functions: { invoke } };

  // --- Device storage: a small in-memory stand-in for Dexie tables.
  function fakeTable() {
    const rows = new Map<string, Row>();
    const keyOf = (row: Row) => String(row.id ?? row.key);
    const collection = (keep: (row: Row) => boolean) => {
      const list = () => [...rows.values()].filter(keep);
      const c = {
        toArray: async () => list().map((r) => ({ ...r })),
        count: async () => list().length,
        first: async () => {
          const r = list()[0];
          return r ? { ...r } : undefined;
        },
        primaryKeys: async () => list().map(keyOf),
        filter: (fn: (row: Row) => boolean) => collection((r) => keep(r) && fn(r)),
        and: (fn: (row: Row) => boolean) => collection((r) => keep(r) && fn(r)),
        limit: () => c,
        reverse: () => c,
        sortBy: async () => list().map((r) => ({ ...r })),
        modify: async (changes: Row) => {
          const matched = list();
          for (const r of matched) rows.set(keyOf(r), { ...r, ...changes });
          return matched.length;
        },
        delete: async () => {
          const matched = list();
          for (const r of matched) rows.delete(keyOf(r));
          return matched.length;
        },
      };
      return c;
    };
    const table = {
      rows,
      get: async (id: unknown) => {
        const r = rows.get(String(id));
        return r ? { ...r } : undefined;
      },
      put: async (row: Row) => {
        rows.set(keyOf(row), { ...row });
        return keyOf(row);
      },
      add: async (row: Row) => {
        rows.set(keyOf(row), { ...row });
        return keyOf(row);
      },
      bulkPut: async (list: Row[]) => {
        for (const row of list) rows.set(keyOf(row), { ...row });
      },
      update: async (id: unknown, changes: Row) => {
        const current = rows.get(String(id));
        if (!current) return 0;
        rows.set(String(id), { ...current, ...changes });
        return 1;
      },
      delete: async (id: unknown) => {
        rows.delete(String(id));
      },
      bulkDelete: async (ids: unknown[]) => {
        for (const id of ids) rows.delete(String(id));
      },
      clear: async () => rows.clear(),
      count: async () => rows.size,
      toArray: async () => [...rows.values()].map((r) => ({ ...r })),
      filter: (fn: (row: Row) => boolean) => collection(fn),
      toCollection: () => collection(() => true),
      orderBy: () => collection(() => true),
      where: (field: string) => ({
        equals: (value: unknown) => collection((r) => r[field] === value),
        anyOf: (values: unknown[]) => collection((r) => values.includes(r[field])),
        above: (value: number) => collection((r) => Number(r[field]) > value),
        below: (value: number) => collection((r) => Number(r[field]) < value),
      }),
    };
    return table;
  }
  type FakeTable = ReturnType<typeof fakeTable>;
  function fakeDatabase() {
    const tables = new Map<string, FakeTable>();
    const table = (name: string): FakeTable => {
      if (!tables.has(name)) tables.set(name, fakeTable());
      return tables.get(name)!;
    };
    const db = new Proxy({} as Record<string, unknown>, {
      get(_target, prop) {
        if (typeof prop !== "string" || prop === "then") return undefined;
        // Runs the callback directly; real Dexie adds atomicity.
        if (prop === "transaction") {
          return (...args: unknown[]) => (args[args.length - 1] as () => unknown)();
        }
        return table(prop);
      },
    });
    return { db, table, reset: () => tables.clear() };
  }

  let idSeq = 0;
  return {
    AUTH_KEY,
    authCalls,
    signInWithPassword,
    signOut,
    onlineAccounts,
    serverStaff,
    writes,
    from,
    rpc,
    invoke,
    fetch,
    client,
    main: fakeDatabase(),
    pharmacy: fakeDatabase(),
    outbox: fakeDatabase(),
    generateId: () => `test-id-${++idSeq}`,
  };
});

vi.mock("@supabase/supabase-js", () => ({ createClient: () => h.client }));
vi.mock("@/db", () => ({ db: h.main.db, generateId: h.generateId }));
vi.mock("@/db/mbhr", () => ({ mbhrDb: h.pharmacy.db }));
vi.mock("@/db/outbox", () => ({ outboxDb: h.outbox.db }));
// PIN hashes in these tests are "<pin>@<salt>", so checking is a string compare.
vi.mock("@/utils/pin", () => ({
  derivePinHash: async (pin: string, salt: string) => `${pin}@${salt}`,
  newSaltB64: () => "test-salt",
  verifyPin: async (pin: string, hash: string, salt: string) => hash === `${pin}@${salt}`,
}));
vi.mock("@/lib/logger", () => {
  const quiet = () => undefined;
  const logger = { log: quiet, warn: quiet, error: quiet, info: quiet, debug: quiet, captureError: quiet };
  return { default: logger, ...logger };
});
// Not under test: where conflicts are filed, and the queue's device helpers.
vi.mock("@/sync/queueConflicts", () => ({ queueSyncConflicts: async () => 0 }));
vi.mock("@/services/queueAudit", () => ({ getDeviceId: async () => "test-device" }));
vi.mock("@/services/queueTicketStore", () => ({
  currentTicketContext: async () => ({
    siteKey: "main-site",
    serviceDate: "2026-09-24",
    syncEnabled: true,
  }),
  remainingTicketNumbers: async () => 0,
  setLeaseRequester: () => undefined,
}));

/** The app's modules, loaded once cloud sync is configured (see beforeAll). */
async function loadApp() {
  const auth = await import("@/stores/auth");
  const cloud = await import("@/lib/cloudSession");
  const syncStore = await import("@/stores/syncStore");
  const indicator = await import("@/lib/syncIndicator");
  const adapter = await import("@/sync/adapter");
  const enhanced = await import("@/services/enhancedSync");
  const sms = await import("@/services/notificationWorker");
  const pharmacy = await import("@/sync/pharmacySync");
  const queue = await import("@/sync/queueSync");
  const roles = await import("@/auth/roles");
  const authStorage = await import("@/lib/supabaseAuthStorage");
  const operations = await import("@/stores/operationsQueue");
  return { auth, cloud, syncStore, indicator, adapter, enhanced, sms, pharmacy, queue, roles, authStorage, operations };
}
let app: Awaited<ReturnType<typeof loadApp>>;

const PIN_ADA = "482913";
const PIN_BAYO = "271828";
const ONLINE_PASSWORD = "correct-horse-battery";
const TODAY = "2026-09-24";

// Staff known to this device (synced staff directory: id = online user id),
// each with a device PIN.
const ADA = {
  id: "auth-ada",
  fullName: "Ada Okafor",
  role: "nurse",
  email: "ada@clinic.ng",
  pinHash: `${PIN_ADA}@salt-ada`,
  pinSalt: "salt-ada",
  isActive: 1,
  createdAt: new Date("2026-09-01T08:00:00Z"),
  updatedAt: new Date("2026-09-01T08:00:00Z"),
} satisfies User;
const BAYO = {
  id: "auth-bayo",
  fullName: "Bayo Adeyemi",
  role: "nurse",
  email: "bayo@clinic.ng",
  pinHash: `${PIN_BAYO}@salt-bayo`,
  pinSalt: "salt-bayo",
  isActive: 1,
  createdAt: new Date("2026-09-01T08:00:00Z"),
  updatedAt: new Date("2026-09-01T08:00:00Z"),
} satisfies User;

/** Auth methods that create, restore or refresh an online session. */
const SESSION_CREATING = [
  "signInWithPassword",
  "signInWithOtp",
  "signInWithOAuth",
  "signInWithIdToken",
  "signInWithSSO",
  "signInWithWeb3",
  "signInAnonymously",
  "signUp",
  "verifyOtp",
  "setSession",
  "refreshSession",
  "exchangeCodeForSession",
  "reauthenticate",
  "startAutoRefresh",
];
/** Auth methods that only read the stored sign-in, or end it. */
const READ_OR_END = new Set(["getSession", "getUser", "getClaims", "onAuthStateChange", "signOut"]);

/** Runs on every sync run next to the pharmacy and queue participants. */
const probe = {
  beforePush: vi.fn(async () => undefined),
  afterPull: vi.fn(async () => undefined),
};

let storageWrites: MockInstance<(key: string, value: string) => void>;

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function seedRows(table: ReturnType<typeof h.main.table>, rows: Record<string, unknown>[]) {
  for (const row of rows) table.rows.set(String(row.id), { ...row });
}

/** An online sign-in kept in this browser, as supabase-js stores it. */
function seedStoredSignIn(userId: string, email: string) {
  localStorage.setItem(
    h.AUTH_KEY,
    JSON.stringify({
      access_token: `access-${userId}`,
      refresh_token: `refresh-${userId}`,
      token_type: "bearer",
      user: { id: userId, email },
    }),
  );
}

function storedSignInKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && app.authStorage.isSupabaseAuthKey(key)) keys.push(key);
  }
  return keys;
}

function authTokenWrites(): unknown[][] {
  return storageWrites.mock.calls.filter(([key]) => app.authStorage.isSupabaseAuthKey(String(key)));
}

/** Forget requests and auth calls made while setting a test up. */
function forgetCalls() {
  h.authCalls.length = 0;
  h.writes.length = 0;
  for (const spy of [h.from, h.rpc, h.invoke, h.fetch, h.signInWithPassword, h.signOut, probe.beforePush, probe.afterPull]) {
    spy.mockClear();
  }
  storageWrites.mockClear();
}

function expectNothingSent() {
  expect(h.from).not.toHaveBeenCalled();
  expect(h.rpc).not.toHaveBeenCalled();
  expect(h.invoke).not.toHaveBeenCalled();
  expect(h.fetch).not.toHaveBeenCalled();
  expect(probe.beforePush).not.toHaveBeenCalled();
  expect(probe.afterPull).not.toHaveBeenCalled();
}

/** No online session was created, restored, refreshed or stored. */
function expectNoOnlineSessionCreated() {
  expect(h.authCalls.filter((name) => SESSION_CREATING.includes(name))).toEqual([]);
  // A new kind of auth call must be checked against the rule before it is
  // allowed here.
  expect(h.authCalls.filter((name) => !READ_OR_END.has(name))).toEqual([]);
  expect(authTokenWrites()).toEqual([]);
  expect(storedSignInKeys()).toEqual([]);
}

function pinSignIn(user: { id: string }, pin: string) {
  return app.auth.useAuthStore.getState().login(user.id, pin);
}

function onlineSignIn(user: { email: string }) {
  return app.auth.useAuthStore.getState().loginOnline(user.email, ONLINE_PASSWORD);
}

/** What the header's sync indicator shows (src/lib/syncIndicator.ts). */
function indicatorKind(online: boolean) {
  return app.indicator.deriveSyncIndicatorKind({
    online,
    syncEnabled: app.adapter.isOnlineSyncEnabled(),
    cloudSession: app.syncStore.useSyncStore.getState().cloudSession,
    syncing: false,
    hasError: false,
    conflictCount: 0,
    pending: 2,
    lastSuccessAt: 0,
  });
}

/** Unsent work on this device, one item per upload path. */
function seedUnsentWork() {
  seedRows(h.main.table("patients"), [
    { id: "patient-1", givenName: "Chioma", familyName: "Eze", _dirty: 1, updatedAt: "2026-09-24T09:00:00.000Z" },
  ]);
  seedRows(h.main.table("serverCommands"), [
    {
      id: "cmd-portal-1",
      rpc: "set_patient_portal_access",
      args: { p_patient_id: "patient-1", p_enabled: true },
      authorId: ADA.id,
      entityRefs: [{ table: "patients", id: "patient-1" }],
      status: "pending",
      createdAt: Date.now() - 60_000,
      attempts: 0,
    },
  ]);
  seedRows(h.pharmacy.table("rx_commands"), [
    {
      id: "cmd-rx-1",
      rpc: "rx_dispense",
      args: { p_prescription_id: "rx-1" },
      authorId: ADA.id,
      entityRefs: [{ table: "prescriptions", id: "rx-1" }],
      status: "pending",
      createdAt: Date.now() - 60_000,
      attempts: 0,
    },
  ]);
  seedRows(h.main.table("queue"), [
    {
      id: "queue-1",
      patientId: "patient-1",
      stage: "vitals",
      status: "waiting",
      position: 1,
      ticketId: "ticket-1",
      ticketNumber: "Q-001",
      siteKey: "main-site",
      serviceDate: TODAY,
      ticketPending: 1,
      queuedAt: new Date(),
    },
  ]);
  seedRows(h.main.table("outboundMessages"), [
    { id: "sms-1", patientId: "patient-1", status: "queued", attempts: 0, payload: { message: "Reminder" } },
  ]);
  app.operations.useOperationsQueue.getState().addOperation({
    type: "update",
    entity: "patient",
    entityId: "patient-1",
    data: { id: "patient-1", givenName: "Chioma" },
    priority: "normal",
    maxAttempts: 3,
  });
}

/** Sync now, enhanced sync, both command outboxes, queue tickets and SMS. */
async function tryEveryUploadPath() {
  const syncNow = await app.adapter.syncNow();
  // Asks the server for ticket numbers only when allowed (checked below:
  // nothing sent).
  await app.queue.topUpTicketNumbers("main-site", TODAY);
  return {
    syncNow,
    enhanced: await app.enhanced.enhancedSync.syncAll(),
    sender: await app.adapter.currentCommandSender(),
    commands: await app.adapter.drainServerCommands(),
    pharmacy: await app.pharmacy.syncPharmacyNow(),
    pharmacyCommands: await app.pharmacy.sendPharmacyCommands(),
    tickets: await app.queue.confirmPendingTickets(),
    sms: await app.sms.processNow(),
    reminder: await app.sms.sendReminderNow({
      id: "reminder-1",
      phoneNumber: "",
      message: "Reminder",
    }),
  };
}

/** Everything a PIN sign-in must leave closed, with nothing sent. */
async function expectSyncBlocked() {
  const tried = await tryEveryUploadPath();

  expect(tried.syncNow).toEqual({
    success: false,
    conflicts: [],
    error: app.adapter.NO_CLOUD_SESSION,
  });
  expect(tried.enhanced).toMatchObject({ success: false, pushed: 0, error: "NoCloudSession" });
  expect(tried.sender).toBeNull();
  expect(tried.commands).toMatchObject({ applied: 0, skipped: "no_sender" });
  expect(tried.pharmacy).toMatchObject({ ran: false, uploadedPrescriptions: 0 });
  expect(tried.pharmacyCommands).toMatchObject({ applied: 0, skipped: "no_sender" });
  expect(tried.tickets).toEqual({ confirmed: 0, changed: 0 });
  expect(tried.sms).toMatchObject({ reminders: 0, messages: 0, skipped: "signed_out" });
  expect(tried.reminder).toMatchObject({ ok: false, error: app.sms.SMS_NOT_SIGNED_IN_ERROR });
  expectNothingSent();

  // Unsent work stays on this device, untouched.
  expect(h.main.table("patients").rows.get("patient-1")).toMatchObject({ _dirty: 1 });
  expect(h.main.table("serverCommands").rows.get("cmd-portal-1")).toMatchObject({
    status: "pending",
    attempts: 0,
  });
  expect(h.pharmacy.table("rx_commands").rows.get("cmd-rx-1")).toMatchObject({
    status: "pending",
    attempts: 0,
  });
  expect(h.main.table("queue").rows.get("queue-1")).toMatchObject({ ticketPending: 1 });
  expect(app.operations.useOperationsQueue.getState().getPendingCount()).toBe(1);

  // Reported as "not signed in online", not as a sync failure.
  const sync = app.syncStore.useSyncStore.getState();
  expect(sync.cloudSession).toBe("signed_out");
  expect(sync.status).not.toBe("syncing");
  expect(sync.status).not.toBe("error");
  expect(sync.errorMessage).toBeNull();
}

beforeAll(async () => {
  vi.stubEnv("VITE_SUPABASE_URL", "https://testproject.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");
  vi.stubGlobal("fetch", h.fetch);
  // Loaded after the settings above so cloud sync counts as set up.
  app = await loadApp();
  app.adapter.registerSyncParticipant({ name: "regression-probe", ...probe });
  // As the header does: follow sign-in and sign-out events.
  app.cloud.watchCloudSession();
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  localStorage.clear();
  h.main.reset();
  h.pharmacy.reset();
  h.outbox.reset();
  seedRows(h.main.table("users"), [ADA, BAYO]);
  h.onlineAccounts.clear();
  h.onlineAccounts.set(ADA.email, { id: ADA.id, password: ONLINE_PASSWORD });
  h.onlineAccounts.set(BAYO.email, { id: BAYO.id, password: ONLINE_PASSWORD });
  h.serverStaff.clear();
  h.serverStaff.set(ADA.id, { id: ADA.id, role: "nurse", full_name: ADA.fullName, is_active: true });
  h.serverStaff.set(BAYO.id, { id: BAYO.id, role: "nurse", full_name: BAYO.fullName, is_active: true });
  app.auth.useAuthStore.setState({
    currentUser: null,
    currentSession: null,
    isAuthenticated: false,
    failedAttempts: 0,
    lockoutUntil: null,
    sessionExpiresAt: null,
    lastActivityAt: null,
    authMode: null,
    cloudUserId: null,
    signInRefusal: null,
  });
  app.syncStore.useSyncStore.setState({
    status: "idle",
    errorMessage: null,
    lastSuccessAt: 0,
    cloudSession: "unknown",
  });
  const operations = app.operations.useOperationsQueue.getState();
  operations.clearAll();
  operations.setProcessing(false);
  storageWrites = vi.spyOn(Storage.prototype, "setItem");
  forgetCalls();
});

afterEach(async () => {
  // Let a background online sign-out from logout finish.
  await settle();
  storageWrites.mockRestore();
});

describe("offline PIN sign-in never gives a cloud sync session", () => {
  it("opens the local workspace with cached permissions and no online session", async () => {
    expect(await pinSignIn(ADA, PIN_ADA)).toBe(true);

    const { isAuthenticated, currentUser } = app.auth.useAuthStore.getState();
    expect(isAuthenticated).toBe(true);
    expect(currentUser).toMatchObject({ id: ADA.id, role: "nurse" });
    // Clinical work follows the role cached on this device.
    expect(app.roles.can(currentUser!.role as Role, "vitals")).toBe(true);

    expectNoOnlineSessionCreated();
    expect(await app.cloud.checkCloudSession()).toBe(false);
    expectNothingSent();
  });

  it("blocks Sync now and every other upload path, and says so", async () => {
    seedUnsentWork();
    expect(await pinSignIn(ADA, PIN_ADA)).toBe(true);

    await expectSyncBlocked();
    expectNoOnlineSessionCreated();
  });

  it('shows "Offline — sign in online to sync"', async () => {
    expect(await pinSignIn(ADA, PIN_ADA)).toBe(true);

    // Straight after sign-in, before anything re-reads the online sign-in.
    expect(app.syncStore.useSyncStore.getState().cloudSession).toBe("signed_out");
    expect(indicatorKind(false)).toBe("no_session");
    expect(indicatorKind(true)).toBe("no_session");
    expect(app.cloud.NO_CLOUD_SESSION_LABEL).toBe("Offline — sign in online to sync");
    expect(app.cloud.NO_CLOUD_SESSION_DETAIL).toMatch(/sign in online/i);
    expect(app.sms.SMS_NOT_SIGNED_IN_ERROR).toMatch(/sign in online/i);
  });

  it("does not count a wrong PIN as any kind of sign-in", async () => {
    expect(await pinSignIn(ADA, PIN_BAYO)).toBe(false);

    expect(app.auth.useAuthStore.getState().isAuthenticated).toBe(false);
    expectNoOnlineSessionCreated();
    expect((await app.adapter.syncNow()).error).toBe(app.adapter.NO_CLOUD_SESSION);
    expectNothingSent();
  });

  describe("an online sign-in left on this device is ended, not carried over", () => {
    const leftovers = [
      {
        name: "one whose logout could not finish (app closed straight after)",
        setUp: async () => {
          seedStoredSignIn(ADA.id, ADA.email);
          return { user: ADA, pin: PIN_ADA };
        },
      },
      {
        name: "another account's in this browser (the patient portal shares it)",
        setUp: async () => {
          seedStoredSignIn("portal-patient-1", "patient@example.com");
          return { user: ADA, pin: PIN_ADA };
        },
      },
    ];

    for (const leftover of leftovers) {
      it(leftover.name, async () => {
        seedUnsentWork();
        const { user, pin } = await leftover.setUp();
        forgetCalls();

        expect(await pinSignIn(user, pin)).toBe(true);

        // Ended on this device only; nothing new was created or stored.
        expect(h.signOut).toHaveBeenCalledWith({ scope: "local" });
        expectNoOnlineSessionCreated();
        await expectSyncBlocked();
      });
    }

    it("the previous person's, when their local session expired while the app was closed", async () => {
      const longAgo = Date.now() - 24 * 60 * 60 * 1000;
      localStorage.setItem(
        "mbhr-auth",
        JSON.stringify({
          state: {
            failedAttempts: 0,
            lockoutUntil: null,
            currentUser: ADA,
            currentSession: {
              id: "old-session",
              userId: ADA.id,
              createdAt: new Date(longAgo),
              deviceKey: "old-device-key",
              lastSeenAt: new Date(longAgo),
            },
            isAuthenticated: true,
            authMode: "online",
            cloudUserId: ADA.id,
            sessionExpiresAt: longAgo,
            lastActivityAt: longAgo,
          },
          version: 0,
        }),
      );
      seedStoredSignIn(ADA.id, ADA.email);
      seedUnsentWork();
      forgetCalls();

      await app.auth.useAuthStore.persist.rehydrate();
      await settle();

      // The expired local session is gone, and its online sign-in was ended
      // on this device with it.
      expect(app.auth.useAuthStore.getState()).toMatchObject({
        isAuthenticated: false,
        authMode: null,
        cloudUserId: null,
      });
      expect(h.signOut).toHaveBeenCalledWith({ scope: "local" });
      expect(storedSignInKeys()).toEqual([]);
      forgetCalls();

      expect(await pinSignIn(BAYO, PIN_BAYO)).toBe(true);

      expectNoOnlineSessionCreated();
      await expectSyncBlocked();
    });

    it("waits for the last logout's online sign-out before opening the workspace", async () => {
      expect(await onlineSignIn(ADA)).toBe(true);
      // A slow network: the sign-out takes a moment to reach the server.
      h.signOut.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              localStorage.removeItem(h.AUTH_KEY);
              resolve({ error: null });
            }, 20);
          }),
      );
      await app.auth.useAuthStore.getState().logout();
      seedUnsentWork();
      forgetCalls();

      expect(await pinSignIn(BAYO, PIN_BAYO)).toBe(true);

      // Sync straight away (as a reconnect or background run would).
      await expectSyncBlocked();
      expectNoOnlineSessionCreated();
    });

    it("shows the no-session state after a logout made offline", async () => {
      expect(await onlineSignIn(ADA)).toBe(true);
      expect(await app.cloud.checkCloudSession()).toBe(true);
      // Offline, the sign-out cannot reach the server: logout then removes
      // the stored sign-in itself, which sends no sign-out event.
      h.signOut.mockImplementationOnce(async () => ({
        error: { name: "AuthRetryableFetchError", status: 0 },
      }));
      await app.auth.useAuthStore.getState().logout();
      await settle();
      expect(storedSignInKeys()).toEqual([]);
      forgetCalls();

      expect(await pinSignIn(BAYO, PIN_BAYO)).toBe(true);

      expect(app.syncStore.useSyncStore.getState().cloudSession).toBe("signed_out");
      expect(indicatorKind(false)).toBe("no_session");
      expectNoOnlineSessionCreated();
    });
  });
});

describe("online sign-in gives a cloud session and sync runs", () => {
  it("syncs after an online sign-in", async () => {
    seedUnsentWork();

    expect(await onlineSignIn(ADA)).toBe(true);

    expect(h.signInWithPassword).toHaveBeenCalledTimes(1);
    // The same checks that stay quiet for a PIN do see this sign-in.
    expect(authTokenWrites().length).toBeGreaterThan(0);
    expect(storedSignInKeys()).toEqual([h.AUTH_KEY]);
    expect(await app.cloud.checkCloudSession()).toBe(true);
    expect(app.syncStore.useSyncStore.getState().cloudSession).toBe("signed_in");
    expect(indicatorKind(true)).not.toBe("no_session");
    expect(await app.adapter.currentCommandSender()).toEqual({
      localUserId: ADA.id,
      cloudUserId: ADA.id,
      role: "nurse",
    });

    const result = await app.adapter.syncNow();

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(probe.beforePush).toHaveBeenCalledTimes(1);
    expect(probe.afterPull).toHaveBeenCalledTimes(1);
    // The unsent record, the queued operation and the command were sent.
    expect(h.writes).toContainEqual({ table: "patients", method: "upsert" });
    expect(h.main.table("patients").rows.get("patient-1")).toMatchObject({ _dirty: 0 });
    expect(app.operations.useOperationsQueue.getState().getPendingCount()).toBe(0);
    expect(h.rpc).toHaveBeenCalledWith(
      "set_patient_portal_access",
      expect.objectContaining({ p_command_id: "cmd-portal-1" }),
    );
    expect(h.rpc).toHaveBeenCalledWith("lease_ticket_block", expect.anything());

    const enhanced = await app.enhanced.enhancedSync.syncAll();
    expect(enhanced.error).not.toBe("NoCloudSession");
    expect((await app.pharmacy.syncPharmacyNow()).ran).toBe(true);
    expect((await app.sms.processNow()).skipped).toBeUndefined();
  });

  it("same person: syncs online, and after logout and a PIN unlock sync is blocked again", async () => {
    expect(await onlineSignIn(ADA)).toBe(true);
    expect((await app.adapter.syncNow()).success).toBe(true);

    await app.auth.useAuthStore.getState().logout();
    await settle();

    // Logout ended the online sign-in on this device.
    expect(h.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(storedSignInKeys()).toEqual([]);
    expect(app.syncStore.useSyncStore.getState().cloudSession).toBe("signed_out");

    seedUnsentWork();
    forgetCalls();
    expect(await pinSignIn(ADA, PIN_ADA)).toBe(true);

    await expectSyncBlocked();
    expectNoOnlineSessionCreated();
    expect(indicatorKind(false)).toBe("no_session");
  });
});

describe("sync needs the signed-in staff member's own online sign-in", () => {
  it("records the session type: offline for a PIN, online for email and password", async () => {
    expect(await pinSignIn(ADA, PIN_ADA)).toBe(true);
    expect(app.auth.useAuthStore.getState()).toMatchObject({ authMode: "offline", cloudUserId: null });
    await app.auth.useAuthStore.getState().logout();
    await settle();

    expect(await onlineSignIn(BAYO)).toBe(true);
    expect(app.auth.useAuthStore.getState()).toMatchObject({ authMode: "online", cloudUserId: BAYO.id });
  });

  it("a PIN session stays blocked even if an online sign-in appears in this browser afterwards", async () => {
    seedUnsentWork();
    expect(await pinSignIn(ADA, PIN_ADA)).toBe(true);
    // For example restored by another tab, or the same person's account
    // signed in by the patient portal: still not an online staff session.
    seedStoredSignIn(ADA.id, ADA.email);
    forgetCalls();

    await expectSyncBlocked();
  });

  it("an online staff session stops syncing when another account's sign-in replaces it", async () => {
    expect(await onlineSignIn(ADA)).toBe(true);
    expect(await app.cloud.checkCloudSession()).toBe(true);

    // The patient portal signs a patient in, in the same browser.
    seedStoredSignIn("portal-patient-1", "patient@example.com");
    seedUnsentWork();
    forgetCalls();

    await expectSyncBlocked();
  });

  it("never syncs as the previous person after a new person's PIN sign-in", async () => {
    expect(await onlineSignIn(ADA)).toBe(true);
    // The tablet changes hands without a logout: Bayo unlocks with his PIN.
    expect(await pinSignIn(BAYO, PIN_BAYO)).toBe(true);
    seedStoredSignIn(ADA.id, ADA.email);
    seedUnsentWork();
    forgetCalls();

    await expectSyncBlocked();
  });

  it("an account deactivated on this device cannot come back on through an online sign-in", async () => {
    h.main.table("users").rows.set(ADA.id, {
      ...ADA,
      isActive: 0,
      disabledLocallyAt: new Date("2026-09-24T08:00:00Z"),
      accessConflict: 1,
    });

    expect(await onlineSignIn(ADA)).toBe(false);

    expect(app.auth.useAuthStore.getState()).toMatchObject({
      isAuthenticated: false,
      signInRefusal: "deactivated_on_device",
    });
    expect(h.main.table("users").rows.get(ADA.id)).toMatchObject({ isActive: 0, accessConflict: 1 });
    await settle();
    expect(storedSignInKeys()).toEqual([]);
    expect(await pinSignIn(ADA, PIN_ADA)).toBe(false);
  });

  it("an account the server deactivated loses online and offline sign-in on this device", async () => {
    h.serverStaff.set(ADA.id, { id: ADA.id, role: "nurse", full_name: ADA.fullName, is_active: false });

    expect(await onlineSignIn(ADA)).toBe(false);

    expect(app.auth.useAuthStore.getState().signInRefusal).toBe("deactivated");
    expect(h.main.table("users").rows.get(ADA.id)).toMatchObject({ isActive: 0 });
    await settle();
    expect(storedSignInKeys()).toEqual([]);
    expect(await pinSignIn(ADA, PIN_ADA)).toBe(false);
  });
});

