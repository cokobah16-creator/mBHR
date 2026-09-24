import { describe, it, expect, beforeEach } from "vitest";
import {
  classifyRpcResponse,
  countOpenCommands,
  countWaitingPermission,
  drainCommands,
  enqueueCommand,
  newCommandId,
  PERMISSION_RETRY_MS,
  registerCommandHandler,
  retryDelayMs,
  safeReason,
  sendDecision,
  UNAVAILABLE_RETRY_MS,
  type CommandSender,
  type CommandStore,
  type DrainDeps,
  type RpcResponse,
  type ServerCommand,
} from "./commandOutbox";

/** In-memory stand-in for a Dexie table (only what the outbox uses). */
function memoryStore(): CommandStore & { rows: Map<string, ServerCommand> } {
  const rows = new Map<string, ServerCommand>();
  const copy = (c: ServerCommand) => JSON.parse(JSON.stringify(c)) as ServerCommand;
  return {
    rows,
    async add(command) {
      if (rows.has(command.id)) throw new Error("ConstraintError");
      rows.set(command.id, copy(command));
    },
    async get(id) {
      const row = rows.get(id);
      return row ? copy(row) : undefined;
    },
    async update(id, changes) {
      const row = rows.get(id);
      if (!row) return 0;
      const next = { ...row, ...changes } as Record<string, unknown>;
      for (const key of Object.keys(changes)) {
        if ((changes as Record<string, unknown>)[key] === undefined) delete next[key];
      }
      rows.set(id, next as unknown as ServerCommand);
      return 1;
    },
    async delete(id) {
      rows.delete(id);
    },
    where(index) {
      return {
        anyOf(values) {
          const match = () =>
            [...rows.values()].filter((r) =>
              values.includes(String((r as unknown as Record<string, unknown>)[index])),
            );
          return {
            toArray: async () => match().map(copy),
            count: async () => match().length,
          };
        },
      };
    },
  };
}

const ADA: CommandSender = { localUserId: "u-ada", cloudUserId: "c-ada", role: "nurse" };
const BAYO: CommandSender = { localUserId: "u-bayo", cloudUserId: "c-bayo", role: "volunteer" };

const PERMS: Record<string, string[]> = {
  nurse: ["register", "portal_manage", "merge_patients"],
  volunteer: ["register", "portal_manage"],
  pharmacist: ["dispense"],
};
const hasPermission = (role: string, permission: string) =>
  (PERMS[role] ?? []).includes(permission);

interface FakeServer {
  calls: { rpc: string; args: Record<string, unknown> }[];
  respond: (rpc: string, args: Record<string, unknown>) => RpcResponse | Promise<RpcResponse>;
}

function deps(
  server: FakeServer,
  sender: CommandSender | null,
  clock: { now: number },
  rejected: ServerCommand[] = [],
): DrainDeps {
  return {
    callRpc: async (rpc, args) => {
      server.calls.push({ rpc, args });
      return server.respond(rpc, args);
    },
    sender: async () => sender,
    hasPermission,
    onRejected: (command) => {
      rejected.push(command);
    },
    now: () => clock.now,
  };
}

const ok = (data: unknown): RpcResponse => ({ data, error: null, status: 200 });
const fail = (code: string, status: number, message = ""): RpcResponse => ({
  data: null,
  error: { code, message },
  status,
});

async function queue(
  store: CommandStore,
  at: number,
  overrides: Partial<Parameters<typeof enqueueCommand>[1]> = {},
) {
  return enqueueCommand(
    store,
    {
      rpc: "set_patient_portal_access",
      args: { p_patient_id: "p1", p_enabled: true },
      authorId: "u-ada",
      entityRefs: [{ table: "patients", id: "p1" }],
      ...overrides,
    },
    at,
  );
}

describe("classifyRpcResponse", () => {
  it("reads an applied answer", () => {
    expect(classifyRpcResponse(ok({ outcome: "applied", row_version: 3 }))).toEqual({
      kind: "applied",
      result: { outcome: "applied", row_version: 3 },
    });
  });

  it("reads a rejection returned by the RPC, keeping only a safe reason code", () => {
    expect(classifyRpcResponse(ok({ outcome: "rejected", reason: "patient_merged" }))).toMatchObject({
      kind: "rejected",
      reason: "patient_merged",
    });
    expect(
      classifyRpcResponse(ok({ outcome: "rejected", reason: "Ada Obi 0803 already merged" })),
    ).toMatchObject({ kind: "rejected", reason: "rejected_by_server" });
  });

  it("separates permission, missing RPC, raised rejections and transient failures", () => {
    expect(classifyRpcResponse(fail("42501", 403)).kind).toBe("permission");
    expect(classifyRpcResponse(fail("", 403)).kind).toBe("permission");
    expect(classifyRpcResponse(fail("PGRST202", 404)).kind).toBe("unavailable");
    expect(classifyRpcResponse(fail("P0001", 400, "cycle"))).toEqual({
      kind: "rejected",
      reason: "cycle",
    });
    expect(classifyRpcResponse(fail("23505", 409))).toEqual({
      kind: "rejected",
      reason: "invalid_request",
    });
    expect(classifyRpcResponse(fail("", 503))).toEqual({
      kind: "retry",
      code: "http_503",
      network: false,
    });
    expect(classifyRpcResponse({ data: null, error: { message: "Failed to fetch" } })).toEqual({
      kind: "retry",
      code: "network",
      network: true,
    });
    expect(classifyRpcResponse(fail("PGRST301", 401)).kind).toBe("retry");
  });
});

describe("pure helpers", () => {
  it("backs off up to 30 minutes", () => {
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(2)).toBe(60_000);
    expect(retryDelayMs(20)).toBe(30 * 60_000);
  });

  it("keeps only lower-case reason codes", () => {
    expect(safeReason("loser_merged_elsewhere")).toBe("loser_merged_elsewhere");
    expect(safeReason("Patient Ada")).toBe("rejected_by_server");
    expect(safeReason(undefined, "x")).toBe("x");
  });

  it("makes version-4 UUIDs", () => {
    const id = newCommandId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newCommandId()).not.toBe(id);
  });

  it("sends an authored command only under its author's sign-in", () => {
    const command = {
      id: "c1",
      rpc: "x",
      args: {},
      authorId: "u-ada",
      entityRefs: [],
      status: "pending",
      createdAt: 0,
      attempts: 0,
    } as ServerCommand;
    expect(sendDecision(command, ADA, hasPermission, 0)).toBe("send");
    expect(sendDecision(command, BAYO, hasPermission, 0)).toBe("other_author");
    expect(sendDecision({ ...command, nextAttemptAt: 10 }, ADA, hasPermission, 5)).toBe("not_due");
  });

  it("sends a backfill only for a holder of its permission", () => {
    const command = {
      id: "c1",
      rpc: "merge_patients",
      args: {},
      authorId: null,
      requiredPermission: "merge_patients",
      entityRefs: [],
      status: "pending",
      createdAt: 0,
      attempts: 0,
    } as ServerCommand;
    expect(sendDecision(command, ADA, hasPermission, 0)).toBe("send");
    expect(sendDecision(command, BAYO, hasPermission, 0)).toBe("no_permission");
  });
});

describe("enqueueCommand", () => {
  it("stores a pending command and leaves p_command_id to the sender", async () => {
    const store = memoryStore();
    const command = await queue(store, 1000, {
      args: { p_patient_id: "p1", p_command_id: "spoofed" },
    });
    expect(command.status).toBe("pending");
    expect(command.args).toEqual({ p_patient_id: "p1" });
    expect(await countOpenCommands(store)).toBe(1);
  });

  it("refuses a command with neither an author nor a required permission", async () => {
    const store = memoryStore();
    await expect(queue(store, 1000, { authorId: null })).rejects.toThrow(
      "CommandNeedsAuthorOrPermission",
    );
  });
});

describe("drainCommands", () => {
  let store: ReturnType<typeof memoryStore>;
  let clock: { now: number };

  beforeEach(() => {
    store = memoryStore();
    clock = { now: 10_000 };
  });

  it("sends with the command id, records the answer and runs the handler", async () => {
    const seen: string[] = [];
    const unregister = registerCommandHandler("set_patient_portal_access", {
      onApplied: (command, result) => {
        seen.push(`${command.id}:${(result as { outcome: string }).outcome}`);
      },
    });
    try {
      const command = await queue(store, 1);
      const server: FakeServer = { calls: [], respond: () => ok({ outcome: "applied" }) };
      const summary = await drainCommands(store, deps(server, ADA, clock));

      expect(summary.applied).toBe(1);
      expect(server.calls[0].args).toEqual({
        p_patient_id: "p1",
        p_enabled: true,
        p_command_id: command.id,
      });
      const stored = await store.get(command.id);
      expect(stored?.status).toBe("applied");
      expect(stored?.handledAt).toBe(clock.now);
      expect(seen).toEqual([`${command.id}:applied`]);
      expect(await countOpenCommands(store)).toBe(0);
    } finally {
      unregister();
    }
  });

  it("resends the same command id after a transient failure", async () => {
    const command = await queue(store, 1);
    const answers = [fail("", 503), ok({ outcome: "applied" })];
    const server: FakeServer = { calls: [], respond: () => answers.shift()! };

    const first = await drainCommands(store, deps(server, ADA, clock));
    expect(first.retrying).toBe(1);
    expect((await store.get(command.id))?.status).toBe("pending");

    // Not due yet: nothing is sent.
    await drainCommands(store, deps(server, ADA, clock));
    expect(server.calls).toHaveLength(1);

    clock.now += retryDelayMs(1);
    const second = await drainCommands(store, deps(server, ADA, clock));
    expect(second.applied).toBe(1);
    expect(server.calls.map((c) => c.args.p_command_id)).toEqual([command.id, command.id]);
  });

  it("never sends one person's decision under another person's sign-in", async () => {
    await queue(store, 1, { authorId: "u-ada" });
    const server: FakeServer = { calls: [], respond: () => ok({ outcome: "applied" }) };
    const summary = await drainCommands(store, deps(server, BAYO, clock));
    expect(summary.notSender).toBe(1);
    expect(server.calls).toHaveLength(0);
  });

  it("sends nothing without an online sign-in", async () => {
    await queue(store, 1);
    const server: FakeServer = { calls: [], respond: () => ok({}) };
    const summary = await drainCommands(store, deps(server, null, clock));
    expect(summary.skipped).toBe("no_sender");
    expect(server.calls).toHaveLength(0);
  });

  it("rejects on a refusal from the RPC, undoes via the handler and reports it", async () => {
    const undone: string[] = [];
    const unregister = registerCommandHandler("merge_patients", {
      onRejected: (_command, reason) => {
        undone.push(reason);
      },
    });
    try {
      const reported: ServerCommand[] = [];
      await queue(store, 1, { rpc: "merge_patients" });
      const server: FakeServer = { calls: [], respond: () => fail("P0001", 400, "cycle") };
      const summary = await drainCommands(store, deps(server, ADA, clock, reported));
      expect(summary.rejected).toBe(1);
      expect(undone).toEqual(["cycle"]);
      expect(reported.map((c) => c.rejectReason)).toEqual(["cycle"]);

      // A rejected command is never sent again.
      await drainCommands(store, deps(server, ADA, clock));
      expect(server.calls).toHaveLength(1);
    } finally {
      unregister();
    }
  });

  it("rejects an authored command the server refuses for permission", async () => {
    const command = await queue(store, 1);
    const server: FakeServer = { calls: [], respond: () => fail("42501", 403) };
    await drainCommands(store, deps(server, ADA, clock));
    const stored = await store.get(command.id);
    expect(stored?.status).toBe("rejected");
    expect(stored?.rejectReason).toBe("permission_denied");
  });

  it("keeps a refused backfill waiting for an authorised person, without retrying in a loop", async () => {
    const command = await queue(store, 1, {
      authorId: null,
      requiredPermission: "portal_manage",
    });
    const refuseBayo: FakeServer = {
      calls: [],
      respond: () => fail("42501", 403),
    };
    const first = await drainCommands(store, deps(refuseBayo, BAYO, clock));
    expect(first.waitingPermission).toBe(1);
    expect(await countWaitingPermission(store)).toBe(1);
    expect(await countOpenCommands(store)).toBe(1);

    // Same person again: not retried.
    await drainCommands(store, deps(refuseBayo, BAYO, clock));
    expect(refuseBayo.calls).toHaveLength(1);

    // Someone else signs in: tried at once.
    const accept: FakeServer = { calls: [], respond: () => ok({ outcome: "applied" }) };
    const second = await drainCommands(store, deps(accept, ADA, clock));
    expect(second.applied).toBe(1);
    expect((await store.get(command.id))?.status).toBe("applied");
  });

  it("retries a backfill refused for the same person after the pause", async () => {
    await queue(store, 1, { authorId: null, requiredPermission: "portal_manage" });
    const server: FakeServer = { calls: [], respond: () => fail("42501", 403) };
    await drainCommands(store, deps(server, BAYO, clock));
    clock.now += PERMISSION_RETRY_MS;
    await drainCommands(store, deps(server, BAYO, clock));
    expect(server.calls).toHaveLength(2);
  });

  it("waits 30 minutes when the RPC is not on the server yet", async () => {
    const command = await queue(store, 1);
    const server: FakeServer = { calls: [], respond: () => fail("PGRST202", 404) };
    const summary = await drainCommands(store, deps(server, ADA, clock));
    expect(summary.unavailable).toBe(1);
    const stored = await store.get(command.id);
    expect(stored?.status).toBe("pending");
    expect(stored?.lastErrorCode).toBe("rpc_unavailable");
    expect(stored?.nextAttemptAt).toBe(clock.now + UNAVAILABLE_RETRY_MS);
  });

  it("holds later commands for the same record behind a failed one, and stops when offline", async () => {
    await queue(store, 1, { args: { p_enabled: false } });
    await queue(store, 2, { args: { p_enabled: true } });
    await queue(store, 3, {
      args: { p_patient_id: "p2" },
      entityRefs: [{ table: "patients", id: "p2" }],
    });

    const busy: FakeServer = { calls: [], respond: () => fail("", 503) };
    const summary = await drainCommands(store, deps(busy, ADA, clock));
    // p1's second command waits for its first; p2's is independent.
    expect(busy.calls.map((c) => c.args.p_enabled ?? c.args.p_patient_id)).toEqual([false, "p2"]);
    expect(summary.deferred).toBe(1);

    clock.now += 60 * 60_000;
    const offline: FakeServer = {
      calls: [],
      respond: () => {
        throw new TypeError("Failed to fetch");
      },
    };
    await drainCommands(store, deps(offline, ADA, clock));
    expect(offline.calls).toHaveLength(1);
  });

  it("handles answers that arrived before the handler was registered", async () => {
    const command = await queue(store, 1, { rpc: "late_rpc" });
    const server: FakeServer = { calls: [], respond: () => ok({ outcome: "applied" }) };
    await drainCommands(store, deps(server, ADA, clock));
    expect((await store.get(command.id))?.handledAt).toBeUndefined();

    const seen: string[] = [];
    const unregister = registerCommandHandler("late_rpc", {
      onApplied: (c) => {
        seen.push(c.id);
      },
    });
    try {
      await drainCommands(store, deps(server, ADA, clock));
      expect(seen).toEqual([command.id]);
      expect(server.calls).toHaveLength(1);
    } finally {
      unregister();
    }
  });
});
