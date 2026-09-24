// Patient merges: the server decides, every device converges.
//
// requestMerge() merges two records on this device straight away and queues
// a merge_patients command in the same transaction (see patientMergeCore).
// The command is sent by the staff member who asked for the merge, the next
// time they sync while signed in online. The server
// (20260925100300_patient_merge_authoritative.sql) then moves the history to
// the kept record, marks the other record as merged and writes an
// append-only merge history row. Other devices download all of that.
//
// If the server refuses (for example the other record was already merged
// into someone else), the command handler below undoes the merge on this
// device and the refusal is listed for review under Conflicts.
//
// Nothing here logs patient details: only error names and reason codes.

import type { Table } from "dexie";
import { db, epochDay, nameKeyOf, normPhone, type Patient, type ServerCommand } from "@/db";
import { can, type Role } from "@/auth/roles";
import { useAuthStore } from "@/stores/auth";
import { isSupabaseEnabled } from "@/lib/supabaseClient";
import { newCommandId, registerCommandHandler, type CommandStore } from "@/sync/commandOutbox";
import type { SyncTable } from "@/sync/adapter";
import {
  canonicalIdOn,
  requestMergeOn,
  settleMergeApplied,
  settleMergeRejected,
  type LocalPatientMerge,
  type MergeChildTable,
  type MergeStores,
  type PatientRow,
} from "./patientMergeCore";
import {
  mergeCommandPatients,
  mergeRefusalMessage,
  MERGE_PATIENTS_RPC,
  type MergeFieldChoices,
  type MergeRefusal,
  type MergeSource,
} from "./patientMergeRules";

export type { MergeFieldChoices, MergeSource } from "./patientMergeRules";

export interface MergeActor {
  id: string;
  role: Role;
}

/**
 * The sync adapter, loaded when first needed. It is not imported statically:
 * the adapter already reaches this module through its own imports (adapter
 * -> queueConflicts -> conflictQueue -> patientDeduplication -> here), and a
 * static import back would close that cycle, so code here could run before
 * the adapter module has finished loading (a TDZ error in tests and in some
 * bundle orders). This module still loads at app start with the adapter, so
 * the answer handlers below are registered before the first sync.
 */
function loadAdapter() {
  return import("@/sync/adapter");
}

/** Local tables whose rows follow a patient into the kept record. */
const CHILD_TABLES: { name: string; onePerPatient?: boolean }[] = [
  { name: "visits" },
  { name: "vitals" },
  { name: "consultations" },
  { name: "dispenses" },
  { name: "queue" },
  { name: "careTasks" },
  { name: "triageRecords" },
  { name: "appointments" },
  { name: "clinicalAlerts" },
  { name: "patientAllergies" },
  { name: "patientPreferences", onePerPatient: true },
];

/** Synced tables (server table, patient field) downloaded again after a refusal. */
const REFETCH_TABLES: { table: SyncTable; column: string }[] = [
  { table: "visits", column: "patientId" },
  { table: "vitals", column: "patientId" },
  { table: "consultations", column: "patientId" },
  { table: "dispenses", column: "patientId" },
  { table: "queue", column: "patientId" },
  { table: "patient_allergies", column: "patientId" },
  { table: "patient_preferences", column: "patientId" },
];

function childTable(name: string): Table | null {
  const t = (db as unknown as Record<string, unknown>)[name];
  return t && typeof t === "object" && typeof (t as Table).where === "function" ? (t as Table) : null;
}

function dexieChildren(): { tables: Table[]; children: MergeChildTable[] } {
  const tables: Table[] = [];
  const children: MergeChildTable[] = [];
  for (const spec of CHILD_TABLES) {
    const table = childTable(spec.name);
    if (!table) continue;
    tables.push(table);
    children.push({
      name: spec.name,
      onePerPatient: spec.onePerPatient,
      idsFor: async (patientId) =>
        (await table.where("patientId").equals(patientId).primaryKeys()).map(String),
      repoint: (ids, from, to) =>
        ids.length === 0
          ? Promise.resolve(0)
          : table
              .where(":id")
              .anyOf(ids)
              .filter((row: { patientId?: string }) => row.patientId === from)
              .modify({ patientId: to }),
      unsentIds: async (ids) =>
        ids.length === 0
          ? []
          : (
              await table
                .where(":id")
                .anyOf(ids)
                .filter((row: { _dirty?: number }) => row._dirty === 1)
                .primaryKeys()
            ).map(String),
      markUnsent: (ids, patientId) =>
        ids.length === 0
          ? Promise.resolve(0)
          : table
              .where(":id")
              .anyOf(ids)
              .filter((row: { patientId?: string }) => row.patientId === patientId)
              .modify({ _dirty: 1 }),
    });
  }
  return { tables, children };
}

/** Search keys the duplicate check uses, recomputed for changed fields. */
function derivedKeys(patient: PatientRow, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const next = { ...patient, ...patch } as Partial<Patient>;
  if ("phone" in patch) out.phoneN = next.phone ? normPhone(String(next.phone)) : "";
  if ("givenName" in patch || "familyName" in patch) {
    out.nameKey = nameKeyOf(String(next.givenName ?? ""), String(next.familyName ?? ""));
  }
  if ("dob" in patch && next.dob) {
    const day = new Date(String(next.dob));
    if (!Number.isNaN(day.getTime())) out.dobDay = epochDay(day);
  }
  return out;
}

function mergeStores(): MergeStores {
  const { tables, children } = dexieChildren();
  const commands = db.serverCommands as unknown as CommandStore;
  return {
    patients: {
      get: (id) => db.patients.get(id),
      update: (id, changes) => db.patients.update(id, changes),
    },
    merges: {
      add: (row) => db.patientMerges.add(row),
      update: (id, changes) => db.patientMerges.update(id, changes),
      delete: (id) => db.patientMerges.delete(id),
      byCommand: (commandId) =>
        db.patientMerges.where("commandId").equals(commandId).first() as Promise<
          LocalPatientMerge | undefined
        >,
    },
    commands,
    children,
    derivedKeys,
    transaction: (fn) =>
      db.transaction(
        "rw",
        [db.patients, db.patientMerges, db.serverCommands, ...tables],
        fn,
      ),
  };
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

function currentActor(): MergeActor | null {
  const user = useAuthStore.getState().currentUser;
  return user ? { id: user.id, role: user.role } : null;
}

export interface MergeRequest {
  /** The record to keep. */
  winnerId: string;
  /** The record merged into it (kept as history, marked merged). */
  loserId: string;
  /** Values copied onto the kept record, by server column. */
  fieldChoices?: MergeFieldChoices;
  source: Exclude<MergeSource, "backfill">;
  /** Defaults to the person signed in on this device. */
  actor?: MergeActor;
}

export type MergeRequestResult =
  | {
      ok: true;
      mergeId: string;
      commandId: string;
      /** The record kept (the chosen one, or the record it was already merged into). */
      winnerId: string;
      /** False when cloud sync is not set up: the merge stays on this device. */
      willSync: boolean;
      movedCount: number;
      fieldsChanged: number;
    }
  | { ok: false; reason: MergeRefusal | "not_saved"; message: string };

/**
 * Merge `loserId` into `winnerId`: on this device now, on the server at the
 * next sync. Checks merge_patients before writing anything.
 */
export async function requestMerge(request: MergeRequest): Promise<MergeRequestResult> {
  const actor = request.actor ?? currentActor();
  if (!actor || !can(actor.role, "merge_patients")) {
    return { ok: false, reason: "not_permitted", message: mergeRefusalMessage("not_permitted") };
  }
  try {
    const outcome = await requestMergeOn(mergeStores(), {
      winnerId: request.winnerId,
      loserId: request.loserId,
      fieldChoices: request.fieldChoices ?? {},
      source: request.source,
      actorId: actor.id,
      mergeId: newCommandId(),
      commandId: newCommandId(),
      now: new Date(),
    });
    if (outcome.ok === false) {
      return { ok: false, reason: outcome.reason, message: mergeRefusalMessage(outcome.reason) };
    }
    sendSoon();
    return { ...outcome, willSync: isSupabaseEnabled };
  } catch (error) {
    console.warn("[patientMerge] merge not saved", errorName(error));
    return {
      ok: false,
      reason: "not_saved",
      message: "The records were not merged. Nothing was changed. Try again.",
    };
  }
}

/** Send queued commands now when the device looks online (best effort). */
function sendSoon(): void {
  if (!isSupabaseEnabled) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  void loadAdapter()
    .then((adapter) => adapter.drainServerCommands())
    .catch((error) => {
      console.warn("[patientMerge] sending the merge failed", errorName(error));
    });
}

/**
 * The record a patient id now lives on, following merges known to this
 * device. Use it before adding vitals, consultations or queue entries for a
 * patient id that may have been merged away.
 */
export function canonicalPatientId(id: string): Promise<string> {
  return canonicalIdOn({ get: (key) => db.patients.get(key), update: () => Promise.resolve(0) }, id);
}

export type DuplicateRegistrationResult =
  | { kind: "use_existing"; patientId: string }
  | { kind: "merged"; patientId: string; willSync: boolean }
  | { kind: "refused"; message: string };

/**
 * Registration found a likely duplicate and staff chose the existing
 * patient. A registration that was never saved needs no merge: staff simply
 * continue with the existing record. A saved record is merged into it.
 */
export async function chooseExistingForRegistration(input: {
  draftId: string | undefined;
  existingId: string;
  actor: MergeActor;
}): Promise<DuplicateRegistrationResult> {
  const saved = input.draftId ? await db.patients.get(input.draftId) : undefined;
  if (!saved || !input.draftId || input.draftId === input.existingId) {
    return { kind: "use_existing", patientId: input.existingId };
  }
  const result = await requestMerge({
    winnerId: input.existingId,
    loserId: input.draftId,
    source: "dedupe_modal",
    actor: input.actor,
  });
  if (result.ok === false) {
    if (result.reason === "already_merged") {
      return { kind: "use_existing", patientId: await canonicalPatientId(input.existingId) };
    }
    return { kind: "refused", message: result.message };
  }
  return { kind: "merged", patientId: result.winnerId, willSync: result.willSync };
}

/** Merge history for a kept record, newest first (synced and pending rows). */
export async function listMerges(patientId: string): Promise<LocalPatientMerge[]> {
  const rows = (await db.patientMerges
    .where("winnerId")
    .equals(patientId)
    .toArray()) as LocalPatientMerge[];
  const at = (m: LocalPatientMerge) =>
    Date.parse(m.createdAt ?? m.requestedAt ?? "") || m.createdDay * 86_400_000;
  return rows.sort((a, b) => at(b) - at(a));
}

// ---------------------------------------------------------------------------
// Command handlers (also for the one-off backfill commands, which have no author)
// ---------------------------------------------------------------------------

export async function handleMergeApplied(command: ServerCommand, result: unknown): Promise<void> {
  await settleMergeApplied(mergeStores(), command, result);
}

export async function handleMergeRejected(command: ServerCommand, reason: string): Promise<void> {
  const undo = await settleMergeRejected(mergeStores(), command, reason);
  const ids = [undo.winnerId, undo.loserId].filter((id): id is string => !!id);
  if (ids.length === 0 || !isSupabaseEnabled) return;
  // Put back the server's copies (the refusal is already listed for review).
  try {
    const { refetchRows } = await loadAdapter();
    await refetchRows("patients", "id", ids);
    for (const { table, column } of REFETCH_TABLES) {
      await refetchRows(table, column, ids);
    }
  } catch (error) {
    // Offline or not signed in: the next download brings them.
    console.warn("[patientMerge] could not download the records again", errorName(error));
  }
}

/**
 * Merges recorded on this device before merges were sent to the server,
 * whose merged-away record never existed here (a registration that was not
 * saved), were queued by the one-off backfill. There is nothing to merge:
 * drop the command so it does not wait forever, and mark the entry.
 */
export async function dropUnsendableBackfillMerges(): Promise<number> {
  const open = await db.serverCommands
    .where("status")
    .anyOf(["pending", "waiting_permission"])
    .filter((c) => c.rpc === MERGE_PATIENTS_RPC && c.args?.p_source === "backfill")
    .toArray();
  let dropped = 0;
  for (const command of open) {
    const { loserId } = mergeCommandPatients(command.args);
    if (loserId && (await db.patients.get(loserId))) continue;
    await db.transaction("rw", db.serverCommands, db.patientMerges, async () => {
      const record = await db.patientMerges.where("commandId").equals(command.id).first();
      if (record) {
        await db.patientMerges.update(record.id, {
          status: "rejected",
          rejectReason: "record_not_saved",
        });
      }
      await db.serverCommands.delete(command.id);
    });
    dropped += 1;
  }
  return dropped;
}

let unregister: (() => void) | null = null;

/** Register the merge answer handlers. Safe to call more than once; runs on load. */
export function registerPatientMergeHandlers(): void {
  if (unregister) return;
  unregister = registerCommandHandler(MERGE_PATIENTS_RPC, {
    onApplied: handleMergeApplied,
    onRejected: handleMergeRejected,
  });
  // Checked at every sync (after queued commands are sent), not at load:
  // the device database may not be open or upgraded yet at that point.
  // The adapter is loaded lazily (see loadAdapter), so the participant is
  // registered once it has finished loading.
  void loadAdapter()
    .then(({ registerSyncParticipant }) => {
      registerSyncParticipant({
        name: "patient-merges",
        beforePush: async () => {
          await dropUnsendableBackfillMerges();
        },
      });
    })
    .catch((error) => {
      console.warn("[patientMerge] could not join the sync run", errorName(error));
    });
}

registerPatientMergeHandlers();
