import { describe, it, expect } from "vitest";
import type {
  AppUserRow,
  LoginRecord,
  PortError,
  PortResult,
  StaffAdminPort,
} from "./portTypes";

// Source text of this module, so the test can check it stays pure.
const SOURCE = import.meta.glob("./portTypes.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

function ok<T>(data: T): PortResult<T> {
  return { data, error: null };
}

function fail<T>(error: PortError): PortResult<T> {
  return { data: null, error };
}

function login(id: string): LoginRecord {
  return {
    id,
    email: "test.person@example.org",
    createdAt: null,
    invitedAt: null,
    confirmationSentAt: null,
    emailConfirmedAt: null,
    lastSignInAt: null,
    bannedUntil: null,
    isAnonymous: false,
    appMetadata: {},
    userMetadata: {},
  };
}

/** A minimal in-memory port: every method of StaffAdminPort is present. */
function memoryPort(): StaffAdminPort & { rows: Map<string, AppUserRow> } {
  const rows = new Map<string, AppUserRow>();
  const logins = new Map<string, LoginRecord>();
  return {
    rows,
    getUserById: async (id) => ok(logins.get(id) ?? null),
    listUsersPage: async () => ok([...logins.values()]),
    createUser: async (i) => {
      const record = { ...login(i.id), email: i.email, appMetadata: i.appMetadata, userMetadata: i.userMetadata };
      logins.set(i.id, record);
      return ok(record);
    },
    deleteUser: async (id) => {
      logins.delete(id);
      return ok(true as const);
    },
    updateUserById: async (id) => {
      const record = logins.get(id);
      return record ? ok(record) : fail({ code: "user_not_found", status: 404 });
    },
    inviteUserByEmail: async () => ok(true as const),
    resetPasswordForEmail: async () => ok(true as const),
    selectAppUser: async (id) => ok(rows.get(id) ?? null),
    selectAppUsersPage: async (from, to) => ok([...rows.values()].slice(from, to + 1)),
    insertAppUser: async (r) => {
      if (rows.has(r.id)) return fail({ code: "23505" });
      rows.set(r.id, { ...r, created_at: null });
      return ok(true as const);
    },
    updateAppUserFields: async (id, expectedRole, next) => {
      const row = rows.get(id);
      if (!row || row.role !== expectedRole) return ok({ updated: false });
      rows.set(id, { ...row, ...next });
      return ok({ updated: true });
    },
    updateAppUserAccess: async (id, expectedRole, next) => {
      const row = rows.get(id);
      if (!row || row.role !== expectedRole) return ok({ updated: false });
      rows.set(id, { ...row, ...next });
      return ok({ updated: true });
    },
    selectPatientAuthUids: async () => ok([]),
    isPatientLogin: async () => ok(false),
    patientEmailExists: async () => ok(false),
    checkLimits: async () => ({ allowed: true }),
    hashKey: async (v) => `hash:${v.length}`,
    insertAuditLog: async () => undefined,
    newId: () => ID,
  };
}

describe("staff-admin port types", () => {
  it("has no runtime code and no Deno or npm imports", () => {
    const text = SOURCE["./portTypes.ts"];
    expect(text).toBeTruthy();
    expect(text).not.toMatch(/^\s*import\s/m);
    expect(text).not.toMatch(/^\s*export\s+(const|function|class|let|var)\s/m);
  });

  it("tells a result from an error by its error field", async () => {
    const port = memoryPort();
    const missing = await port.updateUserById(ID, { banDuration: "876000h" });
    expect(missing.error).toEqual({ code: "user_not_found", status: 404 });
    expect(missing.data).toBeNull();

    const found = await port.getUserById(ID);
    expect(found.error).toBeNull();
    expect(found.data).toBeNull();
  });

  it("updates a staff record only while its role is still the expected one", async () => {
    const port = memoryPort();
    await port.insertAppUser({
      id: ID,
      full_name: "Test Person",
      role: "nurse",
      admin_access: false,
      admin_permanent: false,
    });

    const stale = await port.updateAppUserFields(ID, "doctor", { role: "admin", admin_access: true });
    expect(stale).toEqual({ data: { updated: false }, error: null });
    expect(port.rows.get(ID)?.role).toBe("nurse");

    const renamed = await port.updateAppUserFields(ID, "nurse", { full_name: "Test P. Person" });
    expect(renamed).toEqual({ data: { updated: true }, error: null });
    expect(port.rows.get(ID)).toMatchObject({ full_name: "Test P. Person", role: "nurse", admin_permanent: false });

    const duplicate = await port.insertAppUser({
      id: ID,
      full_name: "Test Person",
      role: "nurse",
      admin_access: false,
      admin_permanent: false,
    });
    expect(duplicate.error?.code).toBe("23505");
  });
});
