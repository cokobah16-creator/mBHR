import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Patient, ServerCommand } from "@/db";

// --- hoisted state and mocks -------------------------------------------------
const h = vi.hoisted(() => {
  const state = {
    serverConfigured: true,
    currentUser: { id: "u-nurse", role: "nurse" } as { id: string; role: string } | null,
    patients: new Map<string, Record<string, unknown>>(),
    commands: [] as Record<string, unknown>[],
  };

  function query(rows: () => Record<string, unknown>[]) {
    let filters: ((c: Record<string, unknown>) => boolean)[] = [];
    const api = {
      filter(fn: (c: Record<string, unknown>) => boolean) {
        filters = [...filters, fn];
        return api;
      },
      toArray: async () => rows().filter((r) => filters.every((f) => f(r))),
      count: async () => rows().filter((r) => filters.every((f) => f(r))).length,
    };
    return api;
  }

  const serverCommands = {
    add: vi.fn(async (c: Record<string, unknown>) => {
      state.commands.push({ ...c });
      return c.id;
    }),
    get: vi.fn(async (id: string) => state.commands.find((c) => c.id === id)),
    update: vi.fn(async (id: string, changes: Record<string, unknown>) => {
      const c = state.commands.find((x) => x.id === id);
      if (!c) return 0;
      Object.assign(c, changes);
      return 1;
    }),
    delete: vi.fn(async () => undefined),
    where: vi.fn((index: string) => ({
      anyOf: (values: string[]) => query(() => state.commands.filter((c) => values.includes(c[index] as string))),
      equals: (value: string) => query(() => state.commands.filter((c) => c[index] === value)),
    })),
  };

  const patients = {
    get: vi.fn(async (id: string) => state.patients.get(id)),
    update: vi.fn(async (id: string, changes: Record<string, unknown>) => {
      const p = state.patients.get(id);
      if (!p) return 0;
      Object.assign(p, changes);
      return 1;
    }),
  };

  return {
    state,
    serverCommands,
    patients,
    createAuditLog: vi.fn(async () => undefined),
    drainServerCommands: vi.fn(async () => null),
    refetchRows: vi.fn(async () => 1),
  };
});

vi.mock("@/db", () => ({
  db: {
    patients: h.patients,
    serverCommands: h.serverCommands,
    transaction: vi.fn(async (...args: unknown[]) => {
      const fn = args[args.length - 1] as () => Promise<unknown>;
      return fn();
    }),
  },
  createAuditLog: h.createAuditLog,
}));
vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return h.state.serverConfigured ? {} : null;
  },
}));
vi.mock("@/stores/auth", () => ({
  useAuthStore: { getState: () => ({ currentUser: h.state.currentUser }) },
}));
vi.mock("@/sync/adapter", () => ({
  asCommandStore: (table: unknown) => table,
  drainServerCommands: h.drainServerCommands,
  refetchRows: h.refetchRows,
}));

// Imported after the mocks are in place.
const {
  requestPortalAccessChange,
  handlePortalAccessApplied,
  handlePortalAccessRejected,
  listPortalAccessCommands,
  PORTAL_ACCESS_RPC,
} = await import("./portalAccess");

function seedPatient(over: Partial<Patient> = {}) {
  h.state.patients.set(over.id ?? "p1", {
    id: "p1",
    givenName: "Ada",
    familyName: "Obi",
    phone: "08012345678",
    portalEnabled: 0,
    ...over,
  });
}

function command(over: Partial<ServerCommand> = {}): ServerCommand {
  return {
    id: "c1",
    rpc: PORTAL_ACCESS_RPC,
    args: { p_patient_id: "p1", p_enabled: true },
    authorId: "u-nurse",
    entityRefs: [{ table: "patients", id: "p1" }],
    status: "applied",
    createdAt: 1,
    attempts: 1,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.serverConfigured = true;
  h.state.currentUser = { id: "u-nurse", role: "nurse" };
  h.state.patients.clear();
  h.state.commands.length = 0;
  vi.stubGlobal("navigator", { onLine: true });
});

describe("requestPortalAccessChange", () => {
  it("refuses a role without portal_manage and writes nothing", async () => {
    seedPatient();
    h.state.currentUser = { id: "u-pharm", role: "pharmacist" };

    const result = await requestPortalAccessChange("p1", true);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/role cannot change portal access/i);
    expect(h.patients.update).not.toHaveBeenCalled();
    expect(h.serverCommands.add).not.toHaveBeenCalled();
  });

  it("refuses when nobody is signed in", async () => {
    seedPatient();
    h.state.currentUser = null;
    const result = await requestPortalAccessChange("p1", true);
    expect(result.ok).toBe(false);
    expect(h.serverCommands.add).not.toHaveBeenCalled();
  });

  it("writes the requested value as pending and queues one command", async () => {
    seedPatient();

    const result = await requestPortalAccessChange("p1", true, { reason: "registration" });

    expect(result).toMatchObject({ ok: true, state: "waiting_for_server" });
    expect(result.commandId).toBe(h.state.commands[0]?.id);
    expect(h.state.patients.get("p1")).toMatchObject({ portalEnabled: 1, portalPending: 1 });
    // Not marked for upload: portal access is not part of the patient upload.
    expect(h.state.patients.get("p1")?._dirty).toBeUndefined();
    expect(h.state.commands).toHaveLength(1);
    const queued = h.state.commands[0];
    expect(queued).toMatchObject({
      rpc: "set_patient_portal_access",
      authorId: "u-nurse",
      status: "pending",
      entityRefs: [{ table: "patients", id: "p1" }],
    });
    expect(queued.args).toMatchObject({
      p_patient_id: "p1",
      p_enabled: true,
      p_reason: "registration",
      p_requested_by: "u-nurse",
      p_source: "staff",
    });
    expect(typeof (queued.args as Record<string, unknown>).p_client_at).toBe("string");
    expect(h.createAuditLog).toHaveBeenCalledWith(
      "nurse",
      "portal_access_on_requested",
      "patient",
      "p1",
    );
    expect(h.drainServerCommands).toHaveBeenCalled();
  });

  it("does not try to send while the device is offline", async () => {
    seedPatient();
    vi.stubGlobal("navigator", { onLine: false });
    const result = await requestPortalAccessChange("p1", false);
    expect(result.ok).toBe(true);
    expect(h.drainServerCommands).not.toHaveBeenCalled();
  });

  it("keeps the change on this device only when no server is set up", async () => {
    seedPatient();
    h.state.serverConfigured = false;

    const result = await requestPortalAccessChange("p1", true);

    expect(result).toEqual({ ok: true, state: "device_only" });
    expect(h.state.patients.get("p1")).toMatchObject({ portalEnabled: 1 });
    expect(h.state.patients.get("p1")?.portalPending).toBeUndefined();
    expect(h.serverCommands.add).not.toHaveBeenCalled();
  });

  it("refuses a merged-away record", async () => {
    seedPatient({ mergeInto: "p2" });
    const result = await requestPortalAccessChange("p1", true);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/merged/);
    expect(h.serverCommands.add).not.toHaveBeenCalled();
  });

  it("queues a command for a record kept only on the server when asked to", async () => {
    const result = await requestPortalAccessChange("server-only", true, { serverRecord: true });

    expect(result.ok).toBe(true);
    expect(result.state).toBe("waiting_for_server");
    expect(result.commandId).toBe(h.state.commands[0].id);
    expect(h.patients.update).not.toHaveBeenCalled();
    expect(h.state.commands[0].entityRefs).toEqual([{ table: "patients", id: "server-only" }]);
  });

  it("reports a patient missing from this device", async () => {
    const result = await requestPortalAccessChange("nobody", true);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not on this device/);
  });
});

describe("portal access command handlers", () => {
  it("stores the confirmed value and clears pending when applied", async () => {
    seedPatient({ portalEnabled: 1, portalPending: 1 });

    await handlePortalAccessApplied(command(), {
      outcome: "applied",
      portal_enabled: true,
      changed_at: "2026-09-23T10:00:00Z",
    });

    expect(h.state.patients.get("p1")).toMatchObject({
      portalEnabled: 1,
      portalPending: 0,
      portalEnabledChangedAt: "2026-09-23T10:00:00Z",
    });
  });

  it("leaves a newer waiting change alone", async () => {
    seedPatient({ portalEnabled: 0, portalPending: 1 });
    h.state.commands.push({ ...command({ id: "c2", status: "pending", createdAt: 5 }) });

    await handlePortalAccessApplied(command({ id: "c1" }), { portal_enabled: true });

    expect(h.state.patients.get("p1")).toMatchObject({ portalEnabled: 0, portalPending: 1 });
  });

  it("restores the server's value from a refusal", async () => {
    seedPatient({ portalEnabled: 1, portalPending: 1 });

    await handlePortalAccessRejected(
      command({
        status: "rejected",
        rejectReason: "newer_decision_on_server",
        result: { outcome: "rejected", portal_enabled: false, changed_at: "2026-09-23T09:00:00Z" },
      }),
    );

    expect(h.state.patients.get("p1")).toMatchObject({
      portalEnabled: 0,
      portalPending: 0,
      portalEnabledChangedAt: "2026-09-23T09:00:00Z",
    });
    expect(h.refetchRows).not.toHaveBeenCalled();
  });

  it("falls back to off and downloads the record when the refusal has no value", async () => {
    seedPatient({ portalEnabled: 1, portalPending: 1 });

    await handlePortalAccessRejected(
      command({ status: "rejected", rejectReason: "permission_denied", authorId: null }),
    );

    expect(h.state.patients.get("p1")).toMatchObject({ portalEnabled: 0, portalPending: 0 });
    expect(h.refetchRows).toHaveBeenCalledWith("patients", "id", ["p1"]);
  });

  it("survives a failed download after a refusal", async () => {
    seedPatient({ portalEnabled: 1, portalPending: 1 });
    h.refetchRows.mockRejectedValueOnce(Object.assign(new Error("Offline"), { name: "Offline" }));

    await expect(
      handlePortalAccessRejected(command({ status: "rejected" })),
    ).resolves.toBeUndefined();
    expect(h.state.patients.get("p1")).toMatchObject({ portalPending: 0 });
  });
});

describe("listPortalAccessCommands", () => {
  it("returns this patient's portal commands, newest first", async () => {
    h.state.commands.push(
      { ...command({ id: "a", createdAt: 1 }) },
      { ...command({ id: "b", createdAt: 3 }) },
      { ...command({ id: "other", createdAt: 2, entityRefs: [{ table: "patients", id: "p2" }] }) },
      { ...command({ id: "merge", rpc: "merge_patients", createdAt: 4 }) },
    );

    const list = await listPortalAccessCommands("p1");

    expect(list.map((c) => c.id)).toEqual(["b", "a"]);
  });
});
