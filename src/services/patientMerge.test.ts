// Device side of a patient merge (patientMergeCore, which services/patientMerge
// wires to IndexedDB), tested against in-memory tables.
import { describe, it, expect, beforeEach } from "vitest";
import type { Patient } from "@/db";
import type { CommandStore, ServerCommand } from "@/sync/commandOutbox";
import {
  canonicalIdOn,
  requestMergeOn,
  settleMergeApplied,
  settleMergeRejected,
  type LocalPatientMerge,
  type MergeChildTable,
  type MergeRequestInput,
  type MergeStores,
  type PatientRow,
} from "./patientMergeCore";

type Row = Record<string, unknown> & { id: string };

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function applyChanges(row: Row, changes: Record<string, unknown>): Row {
  const next: Row = { ...row };
  for (const [k, v] of Object.entries(changes)) {
    if (v === undefined) delete next[k];
    else next[k] = v;
  }
  return next;
}

interface World {
  stores: MergeStores;
  patients: Map<string, Row>;
  merges: Map<string, Row>;
  commands: Map<string, Row>;
  children: Record<string, Map<string, Row>>;
  failEnqueue: boolean;
}

function makeWorld(): World {
  const patients = new Map<string, Row>();
  const merges = new Map<string, Row>();
  const commands = new Map<string, Row>();
  const children: Record<string, Map<string, Row>> = {
    vitals: new Map(),
    queue: new Map(),
    patientPreferences: new Map(),
  };
  const world = { patients, merges, commands, children, failEnqueue: false } as World;

  const commandStore: CommandStore = {
    async add(command) {
      if (world.failEnqueue) throw new Error("QuotaExceededError");
      if (commands.has(command.id)) throw new Error("ConstraintError");
      commands.set(command.id, clone(command) as unknown as Row);
    },
    async get(id) {
      const row = commands.get(id);
      return row ? (clone(row) as unknown as ServerCommand) : undefined;
    },
    async update(id, changes) {
      const row = commands.get(id);
      if (!row) return 0;
      commands.set(id, applyChanges(row, changes as Record<string, unknown>));
      return 1;
    },
    async delete(id) {
      commands.delete(id);
    },
    where(index) {
      return {
        anyOf(values) {
          const match = () => [...commands.values()].filter((r) => values.includes(String(r[index])));
          return {
            toArray: async () => match().map((r) => clone(r) as unknown as ServerCommand),
            count: async () => match().length,
          };
        },
      };
    },
  };

  const childTables: MergeChildTable[] = Object.entries(children).map(([name, rows]) => ({
    name,
    onePerPatient: name === "patientPreferences",
    idsFor: async (patientId) =>
      [...rows.values()].filter((r) => r.patientId === patientId).map((r) => r.id),
    repoint: async (ids, from, to) => {
      let n = 0;
      for (const id of ids) {
        const row = rows.get(id);
        if (row && row.patientId === from) {
          rows.set(id, { ...row, patientId: to });
          n += 1;
        }
      }
      return n;
    },
    unsentIds: async (ids) => ids.filter((id) => rows.get(id)?._dirty === 1),
    markUnsent: async (ids, patientId) => {
      let n = 0;
      for (const id of ids) {
        const row = rows.get(id);
        if (row && row.patientId === patientId) {
          rows.set(id, { ...row, _dirty: 1 });
          n += 1;
        }
      }
      return n;
    },
  }));

  world.stores = {
    patients: {
      get: async (id) => (patients.has(id) ? (clone(patients.get(id)) as unknown as PatientRow) : undefined),
      update: async (id, changes) => {
        const row = patients.get(id);
        if (!row) return 0;
        patients.set(id, applyChanges(row, changes as Record<string, unknown>));
        return 1;
      },
    },
    merges: {
      add: async (row) => {
        if (merges.has(row.id)) throw new Error("ConstraintError");
        merges.set(row.id, clone(row) as unknown as Row);
      },
      update: async (id, changes) => {
        const row = merges.get(id);
        if (!row) return 0;
        merges.set(id, applyChanges(row, changes as Record<string, unknown>));
        return 1;
      },
      delete: async (id) => {
        merges.delete(id);
      },
      byCommand: async (commandId) => {
        const row = [...merges.values()].find((m) => m.commandId === commandId);
        return row ? (clone(row) as unknown as LocalPatientMerge) : undefined;
      },
    },
    commands: commandStore,
    children: childTables,
    // All-or-nothing, like a Dexie transaction.
    transaction: async (fn) => {
      const all = [patients, merges, commands, ...Object.values(children)];
      const saved = all.map((m) => new Map([...m].map(([k, v]) => [k, clone(v)])));
      try {
        return await fn();
      } catch (error) {
        all.forEach((m, i) => {
          m.clear();
          saved[i].forEach((v, k) => m.set(k, v));
        });
        throw error;
      }
    },
    derivedKeys: (_patient, patch) => ("phone" in patch ? { phoneN: String(patch.phone).replace(/\D/g, "") } : {}),
  };
  return world;
}

const patient = (id: string, extra: Partial<Patient> = {}): Row =>
  ({ id, givenName: "Ada", familyName: "Obi", phone: "0803", _dirty: 0, ...extra }) as unknown as Row;

const request = (overrides: Partial<MergeRequestInput> = {}): MergeRequestInput => ({
  winnerId: "A",
  loserId: "B",
  fieldChoices: {},
  source: "conflict_review",
  actorId: "u-nurse",
  mergeId: "m-1",
  commandId: "c-1",
  now: new Date("2026-09-23T09:00:00.000Z"),
  ...overrides,
});

const commandOf = (w: World, id = "c-1") => w.commands.get(id) as unknown as ServerCommand;

describe("requestMergeOn: optimistic merge", () => {
  let w: World;
  beforeEach(() => {
    w = makeWorld();
    w.patients.set("A", patient("A"));
    w.patients.set("B", patient("B", { phone: "0805" }));
    w.children.vitals.set("v1", { id: "v1", patientId: "B", _dirty: 0 });
    w.children.vitals.set("v2", { id: "v2", patientId: "B", _dirty: 1 });
    w.children.vitals.set("v3", { id: "v3", patientId: "A", _dirty: 0 });
    w.children.queue.set("q1", { id: "q1", patientId: "B", _dirty: 0 });
  });

  it("moves history, marks the merged record and queues one command, without marking rows to upload", async () => {
    const out = await requestMergeOn(w.stores, request());
    expect(out).toMatchObject({ ok: true, winnerId: "A", movedCount: 3, mergeId: "m-1", commandId: "c-1" });

    expect(w.children.vitals.get("v1")).toEqual({ id: "v1", patientId: "A", _dirty: 0 });
    // A row not uploaded yet stays marked for upload (with the new patient).
    expect(w.children.vitals.get("v2")).toEqual({ id: "v2", patientId: "A", _dirty: 1 });
    expect(w.children.queue.get("q1")?.patientId).toBe("A");

    const loser = w.patients.get("B")!;
    expect(loser.mergeInto).toBe("A");
    expect(loser.mergePending).toBe(1);
    expect(loser._dirty).toBe(0);
    expect(w.patients.get("A")!._dirty).toBe(0);

    const merge = w.merges.get("m-1")!;
    expect(merge).toMatchObject({ winnerId: "A", loserId: "B", status: "pending", commandId: "c-1", source: "conflict_review" });

    const command = commandOf(w);
    expect(command.rpc).toBe("merge_patients");
    expect(command.authorId).toBe("u-nurse");
    expect(command.requiredPermission).toBe("merge_patients");
    expect(command.args).toMatchObject({ p_winner_id: "A", p_loser_id: "B", p_merge_id: "m-1", p_source: "conflict_review" });
    expect(command.entityRefs).toEqual([
      { table: "patients", id: "A" },
      { table: "patients", id: "B" },
      { table: "patient_merges", id: "m-1" },
    ]);
  });

  it("applies chosen values to the kept record without marking it for upload", async () => {
    await requestMergeOn(
      w.stores,
      request({ fieldChoices: { phone: { source: "loser", value: "0805" }, given_name: { source: "loser", value: "Ada" } } }),
    );
    const kept = w.patients.get("A")!;
    expect(kept.phone).toBe("0805");
    expect(kept.phoneN).toBe("0805");
    expect(kept._dirty).toBe(0);
    // Unchanged values are not recorded as applied.
    const undo = (w.merges.get("m-1") as unknown as LocalPatientMerge).localUndo!;
    expect(undo.winnerApplied).toEqual({ phone: "0805" });
    expect(undo.winnerBefore).toEqual({ phone: "0803" });
    expect(commandOf(w).args.p_field_choices).toEqual({
      phone: { source: "loser", value: "0805" },
      given_name: { source: "loser", value: "Ada" },
    });
  });

  it("keeps the record the chosen one was already merged into", async () => {
    w.patients.set("A", patient("A", { mergeInto: "C" }));
    w.patients.set("C", patient("C"));
    const out = await requestMergeOn(w.stores, request());
    expect(out).toMatchObject({ ok: true, winnerId: "C" });
    expect(w.patients.get("B")!.mergeInto).toBe("C");
    expect(commandOf(w).args.p_winner_id).toBe("C");
    expect(await canonicalIdOn(w.stores.patients, "B")).toBe("C");
  });

  it("refuses loops, repeats and records merged elsewhere, changing nothing", async () => {
    w.patients.set("A", patient("A", { mergeInto: "B" }));
    expect(await requestMergeOn(w.stores, request())).toEqual({ ok: false, reason: "cycle" });

    w.patients.set("A", patient("A"));
    w.patients.set("B", patient("B", { mergeInto: "A" }));
    expect(await requestMergeOn(w.stores, request())).toEqual({ ok: false, reason: "already_merged" });

    w.patients.set("C", patient("C"));
    w.patients.set("B", patient("B", { mergeInto: "C" }));
    expect(await requestMergeOn(w.stores, request())).toEqual({ ok: false, reason: "loser_merged_elsewhere" });

    expect(await requestMergeOn(w.stores, request({ loserId: "Z" }))).toEqual({ ok: false, reason: "not_on_device" });
    expect(w.commands.size).toBe(0);
    expect(w.merges.size).toBe(0);
    expect(w.children.vitals.get("v1")?.patientId).toBe("B");
  });

  it("moves a one-per-patient row only when the kept record has none", async () => {
    w.children.patientPreferences.set("p-a", { id: "p-a", patientId: "A" });
    w.children.patientPreferences.set("p-b", { id: "p-b", patientId: "B" });
    await requestMergeOn(w.stores, request());
    expect(w.children.patientPreferences.get("p-b")?.patientId).toBe("B");
  });

  it("changes nothing when the command cannot be queued (one transaction)", async () => {
    w.failEnqueue = true;
    await expect(requestMergeOn(w.stores, request())).rejects.toThrow();
    expect(w.patients.get("B")!.mergeInto).toBeUndefined();
    expect(w.children.vitals.get("v1")?.patientId).toBe("B");
    expect(w.merges.size).toBe(0);
  });
});

describe("server answers", () => {
  let w: World;
  beforeEach(async () => {
    w = makeWorld();
    w.patients.set("A", patient("A"));
    w.patients.set("B", patient("B", { phone: "0805" }));
    w.children.vitals.set("v1", { id: "v1", patientId: "B", _dirty: 0 });
    w.children.vitals.set("v3", { id: "v3", patientId: "A", _dirty: 0 });
    await requestMergeOn(w.stores, request({ fieldChoices: { phone: { source: "loser", value: "0805" } } }));
  });

  it("applied: confirms the merge and drops the undo data", async () => {
    await settleMergeApplied(w.stores, commandOf(w), {
      outcome: "applied",
      merge_id: "m-1",
      winner_id: "A",
      loser_id: "B",
      merged_at: "2026-09-23T09:05:00.000Z",
    });
    expect(w.patients.get("B")).toMatchObject({ mergeInto: "A", mergePending: 0, mergedAt: "2026-09-23T09:05:00.000Z" });
    const merge = w.merges.get("m-1")!;
    expect(merge.status).toBe("applied");
    expect(merge.localUndo).toBeNull();
  });

  it("applied under another id: keeps one history entry (the server's, downloaded next)", async () => {
    await settleMergeApplied(w.stores, commandOf(w), {
      outcome: "applied",
      merge_id: "server-older",
      winner_id: "A",
      already_merged: true,
    });
    expect(w.merges.has("m-1")).toBe(false);
    expect(w.patients.get("B")!.mergePending).toBe(0);
  });

  it("rejected: undoes the merge on this device and marks the entry refused", async () => {
    // A later edit on this device is not overwritten by the undo.
    w.children.vitals.set("v9", { id: "v9", patientId: "A", _dirty: 1 });
    const undo = await settleMergeRejected(w.stores, commandOf(w), "loser_merged_elsewhere");
    expect(undo).toEqual({ winnerId: "A", loserId: "B", restored: 1 });

    const loser = w.patients.get("B")!;
    expect(loser.mergeInto).toBeUndefined();
    expect(loser.mergePending).toBe(0);
    expect(w.children.vitals.get("v1")?.patientId).toBe("B");
    expect(w.children.vitals.get("v3")?.patientId).toBe("A");
    expect(w.children.vitals.get("v9")?.patientId).toBe("A");
    expect(w.patients.get("A")!.phone).toBe("0803");

    const merge = w.merges.get("m-1")!;
    expect(merge.status).toBe("rejected");
    expect(merge.rejectReason).toBe("loser_merged_elsewhere");
    expect(merge.localUndo).toBeNull();
  });

  it("rejected: a row not uploaded at merge time is marked for upload again", async () => {
    // Recorded for B on this device, not uploaded when the merge was made.
    const x = makeWorld();
    x.patients.set("A", patient("A"));
    x.patients.set("B", patient("B"));
    x.children.vitals.set("v1", { id: "v1", patientId: "B", _dirty: 0 });
    x.children.vitals.set("v2", { id: "v2", patientId: "B", _dirty: 1 });
    await requestMergeOn(x.stores, request());
    const undo = (x.merges.get("m-1") as unknown as LocalPatientMerge).localUndo!;
    expect(undo.unsent).toEqual({ vitals: ["v2"] });

    // A sync uploaded v2 under A before the server refused the merge.
    x.children.vitals.set("v2", { id: "v2", patientId: "A", _dirty: 0 });
    await settleMergeRejected(x.stores, commandOf(x), "loser_merged_elsewhere");

    // Back on B, and uploaded again so the server moves it back too.
    expect(x.children.vitals.get("v2")).toEqual({ id: "v2", patientId: "B", _dirty: 1 });
    // A row the server already had under B needs no upload.
    expect(x.children.vitals.get("v1")).toEqual({ id: "v1", patientId: "B", _dirty: 0 });
  });

  it("rejected: restored values upload again when the kept record went up with them", async () => {
    const x = makeWorld();
    // The kept record had unsent edits when the merge was asked for.
    x.patients.set("A", patient("A", { _dirty: 1 }));
    x.patients.set("B", patient("B", { phone: "0805" }));
    await requestMergeOn(x.stores, request({ fieldChoices: { phone: { source: "loser", value: "0805" } } }));
    // A sync uploaded A (with the chosen phone) before the server refused the merge.
    x.patients.set("A", { ...x.patients.get("A")!, _dirty: 0 });
    await settleMergeRejected(x.stores, commandOf(x), "loser_merged_elsewhere");
    expect(x.patients.get("A")).toMatchObject({ phone: "0803", _dirty: 1 });
  });

  it("rejected: restored values stay local when the kept record never went up with them", async () => {
    await settleMergeRejected(w.stores, commandOf(w), "cycle");
    expect(w.patients.get("A")).toMatchObject({ phone: "0803", _dirty: 0 });
  });

  it("applied: a value the server could not store goes back to the kept record's own", async () => {
    await settleMergeApplied(w.stores, commandOf(w), {
      outcome: "applied",
      merge_id: "m-1",
      winner_id: "A",
      loser_id: "B",
      skipped_fields: ["phone"],
    });
    expect(w.patients.get("A")).toMatchObject({ phone: "0803", phoneN: "0803", _dirty: 0 });
  });

  it("applied, already merged on the server: chosen values stay as an edit that uploads", async () => {
    await settleMergeApplied(w.stores, commandOf(w), {
      outcome: "applied",
      merge_id: "server-older",
      winner_id: "A",
      loser_id: "B",
      already_merged: true,
    });
    expect(w.patients.get("A")).toMatchObject({ phone: "0805", _dirty: 1 });
  });

  it("applied to another kept record on the server: the chosen record gets its values back", async () => {
    await settleMergeApplied(w.stores, commandOf(w), {
      outcome: "applied",
      merge_id: "m-1",
      winner_id: "C",
      loser_id: "B",
    });
    expect(w.patients.get("A")).toMatchObject({ phone: "0803", _dirty: 0 });
    expect(w.patients.get("B")!.mergeInto).toBe("C");
  });

  it("rejected: a value edited again after the merge is left alone", async () => {
    w.patients.set("A", { ...w.patients.get("A")!, phone: "0809" });
    await settleMergeRejected(w.stores, commandOf(w), "cycle");
    expect(w.patients.get("A")!.phone).toBe("0809");
  });

  it("rejected backfill command (no local undo data): clears the merge link only", async () => {
    w.merges.set("old", {
      id: "old",
      winnerId: "A",
      loserId: "C",
      mergedBy: "u-old",
      createdDay: 20000,
      reason: "duplicate_resolution",
      commandId: "c-old",
      status: "pending",
    });
    w.patients.set("C", patient("C", { mergeInto: "A", mergePending: 1 }));
    const backfill = {
      id: "c-old",
      rpc: "merge_patients",
      args: { p_winner_id: "A", p_loser_id: "C", p_source: "backfill" },
      authorId: null,
      requiredPermission: "merge_patients",
      entityRefs: [],
      status: "rejected",
      createdAt: 1,
      attempts: 1,
    } as unknown as ServerCommand;
    await settleMergeRejected(w.stores, backfill, "cycle");
    expect(w.patients.get("C")!.mergeInto).toBeUndefined();
    expect(w.merges.get("old")!.status).toBe("rejected");
    // The other, pending merge is untouched.
    expect(w.patients.get("B")!.mergeInto).toBe("A");
  });
});
