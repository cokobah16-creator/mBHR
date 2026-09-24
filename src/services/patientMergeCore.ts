// The device half of a patient merge, written against small table
// interfaces so it can be tested without IndexedDB. services/patientMerge.ts
// wires it to the Dexie database.
//
// requestMergeOn: in ONE transaction, moves the loser's history to the kept
// record, marks the loser as merged (mergePending: 1, so a download does not
// undo it), applies the chosen field values, records the merge as pending
// and queues the merge_patients command. Nothing here is marked _dirty: the
// server does the authoritative move and every device downloads the result.
//
// The command handlers settle the merge when the server answers: applied ->
// confirm; rejected -> undo exactly what this device changed.

import type { Patient, PatientMerge } from "@/db";
import { enqueueCommand, type CommandStore, type ServerCommand } from "@/sync/commandOutbox";
import {
  checkMerge,
  deviceFieldsForColumns,
  localPatchFromChoices,
  MAX_MERGE_CHAIN,
  mergeCommandArgs,
  mergeCommandPatients,
  MERGE_PATIENTS_RPC,
  parseMergeResult,
  type MergeFieldChoices,
  type MergeRefusal,
  type MergeResult,
  type MergeSource,
} from "./patientMergeRules";

/**
 * What this device changed for a pending merge, kept on the merge record so
 * a refusal can be undone precisely. Removed once the server answers.
 */
export interface MergeUndo {
  /** Child table name -> ids moved from the loser to the kept record. */
  moved: Record<string, string[]>;
  /**
   * Child table name -> moved ids that were not uploaded yet. They may be
   * uploaded under the kept record before the server answers; a refusal
   * marks them for upload again so the server puts them back too.
   */
  unsent?: Record<string, string[]>;
  /** Kept record's values before the chosen values were applied. */
  winnerBefore: Record<string, unknown>;
  /** Values applied to the kept record. */
  winnerApplied: Record<string, unknown>;
  /**
   * The kept record had unsent edits when the merge was asked for, so its
   * next upload carries the applied values before the server answers.
   */
  winnerUnsent?: boolean;
}

export type LocalPatientMerge = PatientMerge & { localUndo?: MergeUndo | null };

export type PatientRow = Pick<Patient, "id"> & Partial<Patient>;

export interface MergePatientsTable {
  get(id: string): Promise<PatientRow | undefined>;
  update(id: string, changes: Partial<Patient>): Promise<number>;
}

export interface MergeRecordsTable {
  add(row: LocalPatientMerge): Promise<unknown>;
  update(id: string, changes: Partial<LocalPatientMerge>): Promise<number>;
  delete(id: string): Promise<unknown>;
  /** The merge record queued with this command, if any. */
  byCommand(commandId: string): Promise<LocalPatientMerge | undefined>;
}

/** A table whose rows belong to a patient (patientId). */
export interface MergeChildTable {
  name: string;
  /** At most one row per patient (preferences): moved only if the kept record has none. */
  onePerPatient?: boolean;
  idsFor(patientId: string): Promise<string[]>;
  /** Set patientId to `to` on the given rows still pointing at `from`. Returns rows changed. */
  repoint(ids: string[], from: string, to: string): Promise<number>;
  /** The given rows that are not uploaded yet (_dirty = 1). */
  unsentIds?(ids: string[]): Promise<string[]>;
  /** Mark the given rows of `patientId` for upload (_dirty = 1). Returns rows changed. */
  markUnsent?(ids: string[], patientId: string): Promise<number>;
}

export interface MergeStores {
  patients: MergePatientsTable;
  merges: MergeRecordsTable;
  commands: CommandStore;
  children: MergeChildTable[];
  /** Runs `fn` in one read-write transaction over every store above. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  /** Derived search keys for changed fields (phoneN, nameKey, dobDay). */
  derivedKeys?(patient: PatientRow, patch: Record<string, unknown>): Record<string, unknown>;
}

async function rootOf(patients: MergePatientsTable, id: string): Promise<string> {
  let current = id;
  const seen = new Set([id]);
  for (let i = 0; i < MAX_MERGE_CHAIN; i++) {
    const row = await patients.get(current);
    const next = row?.mergeInto;
    if (!next || seen.has(next)) break;
    seen.add(next);
    current = next;
  }
  return current;
}

/** The record a patient id now lives on, following merges on this device. */
export function canonicalIdOn(patients: MergePatientsTable, id: string): Promise<string> {
  return rootOf(patients, id);
}

export interface MergeRequestInput {
  winnerId: string;
  loserId: string;
  fieldChoices: MergeFieldChoices;
  source: MergeSource;
  actorId: string;
  mergeId: string;
  commandId: string;
  now: Date;
}

export type MergeRequestOutcome =
  | {
      ok: true;
      mergeId: string;
      commandId: string;
      /** The record kept (the chosen one, or the record it was merged into). */
      winnerId: string;
      movedCount: number;
      fieldsChanged: number;
    }
  | { ok: false; reason: MergeRefusal };

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    const ta = a instanceof Date ? a.getTime() : new Date(String(a)).getTime();
    const tb = b instanceof Date ? b.getTime() : new Date(String(b)).getTime();
    return ta === tb;
  }
  return (a ?? null) === (b ?? null);
}

/** Merge on this device and queue the command, atomically. */
export async function requestMergeOn(
  stores: MergeStores,
  input: MergeRequestInput,
): Promise<MergeRequestOutcome> {
  return stores.transaction(async () => {
    const winner = await stores.patients.get(input.winnerId);
    const loser = await stores.patients.get(input.loserId);
    const check = checkMerge({
      winnerId: input.winnerId,
      loserId: input.loserId,
      winnerExists: !!winner,
      loserExists: !!loser,
      winnerRoot: winner ? await rootOf(stores.patients, input.winnerId) : input.winnerId,
      loserRoot: loser ? await rootOf(stores.patients, input.loserId) : input.loserId,
      loserMergeInto: loser?.mergeInto ?? null,
    });
    if (check.ok === false) return { ok: false, reason: check.reason };

    const rootId = check.rootId;
    const root = rootId === input.winnerId ? winner! : await stores.patients.get(rootId);
    if (!root) return { ok: false, reason: "not_on_device" };

    // 1. Chosen values onto the kept record (not _dirty: the server applies
    //    them from the command; before-values are kept for an undo).
    const wanted = localPatchFromChoices(input.fieldChoices);
    const winnerBefore: Record<string, unknown> = {};
    const winnerApplied: Record<string, unknown> = {};
    const rootRow = root as unknown as Record<string, unknown>;
    for (const [field, value] of Object.entries(wanted)) {
      if (sameValue(rootRow[field], value)) continue;
      winnerBefore[field] = rootRow[field] ?? null;
      winnerApplied[field] = value;
    }
    if (Object.keys(winnerApplied).length > 0) {
      const derived = stores.derivedKeys?.(root, winnerApplied) ?? {};
      await stores.patients.update(rootId, { ...winnerApplied, ...derived } as Partial<Patient>);
    }

    // 2. History moves to the kept record (not _dirty: rows the server has
    //    are moved there too and come back at the next download; rows not
    //    uploaded yet are already _dirty and upload with the new id).
    const moved: Record<string, string[]> = {};
    const unsent: Record<string, string[]> = {};
    let movedCount = 0;
    for (const child of stores.children) {
      const ids = await child.idsFor(input.loserId);
      if (ids.length === 0) continue;
      if (child.onePerPatient && (await child.idsFor(rootId)).length > 0) continue;
      const notUploaded = child.unsentIds ? await child.unsentIds(ids) : [];
      const changed = await child.repoint(ids, input.loserId, rootId);
      if (changed > 0) {
        moved[child.name] = ids;
        if (notUploaded.length > 0) unsent[child.name] = notUploaded;
        movedCount += changed;
      }
    }

    // 3. The loser is marked merged; a download keeps this until the server answers.
    await stores.patients.update(input.loserId, {
      mergeInto: rootId,
      mergedAt: null,
      mergePending: 1,
    });

    // 4. The merge record (becomes the server's row: same id) and the command.
    const requestedAt = input.now.toISOString();
    await stores.merges.add({
      id: input.mergeId,
      winnerId: rootId,
      loserId: input.loserId,
      mergedBy: input.actorId,
      createdDay: Math.floor(input.now.getTime() / 86_400_000),
      reason: "duplicate_resolution",
      commandId: input.commandId,
      fieldChoices: input.fieldChoices,
      status: "pending",
      requestedAt,
      source: input.source,
      kind: "merge",
      localUndo: {
        moved,
        unsent,
        winnerBefore,
        winnerApplied,
        winnerUnsent: root._dirty === 1,
      },
    });
    await enqueueCommand(
      stores.commands,
      {
        id: input.commandId,
        rpc: MERGE_PATIENTS_RPC,
        args: mergeCommandArgs({
          winnerId: rootId,
          loserId: input.loserId,
          fieldChoices: input.fieldChoices,
          requestedBy: input.actorId,
          requestedAt,
          source: input.source,
          mergeId: input.mergeId,
        }),
        authorId: input.actorId,
        requiredPermission: "merge_patients",
        entityRefs: [
          { table: "patients", id: rootId },
          { table: "patients", id: input.loserId },
          { table: "patient_merges", id: input.mergeId },
        ],
      },
      input.now.getTime(),
    );

    return {
      ok: true,
      mergeId: input.mergeId,
      commandId: input.commandId,
      winnerId: rootId,
      movedCount,
      fieldsChanged: Object.keys(winnerApplied).length,
    };
  });
}

async function mergeRecordFor(
  stores: MergeStores,
  command: ServerCommand,
): Promise<LocalPatientMerge | undefined> {
  return stores.merges.byCommand(command.id);
}

/**
 * Chosen values were applied to the kept record here when the merge was
 * requested (not marked for upload). Make this device agree with what the
 * server did with them, leaving values edited again since alone:
 * - the server kept a different record (the chosen one had been merged into
 *   another on the server): it applied the values there, so the chosen
 *   record gets its own values back;
 * - the records were already merged on the server (by another device): the
 *   server applied none of the values, so they stay as an ordinary edit of
 *   the kept record, uploaded at the next sync (as when values are chosen
 *   for records already merged on this device);
 * - otherwise, values the server could not store (skipped_fields) go back
 *   to what the kept record had before.
 */
async function reconcileChosenValues(
  stores: MergeStores,
  record: LocalPatientMerge,
  parsed: MergeResult,
): Promise<void> {
  const undo = record.localUndo;
  const keptId = record.winnerId;
  if (!undo || !keptId) return;
  const applied = undo.winnerApplied ?? {};
  if (Object.keys(applied).length === 0) return;
  const kept = await stores.patients.get(keptId);
  if (!kept) return;
  const row = kept as unknown as Record<string, unknown>;
  const stillApplied = Object.keys(applied).filter((f) => sameValue(row[f], applied[f]));
  if (stillApplied.length === 0) return;

  const serverKeptOther = !!parsed.winnerId && parsed.winnerId !== keptId;
  if (parsed.alreadyMerged && !serverKeptOther) {
    await stores.patients.update(keptId, { updatedAt: new Date(), _dirty: 1 });
    return;
  }
  const skipped = new Set(deviceFieldsForColumns(parsed.skippedFields));
  const back: Record<string, unknown> = {};
  for (const field of stillApplied) {
    if (serverKeptOther || skipped.has(field)) {
      back[field] = undo.winnerBefore?.[field] ?? null;
    }
  }
  if (Object.keys(back).length > 0) {
    const derived = stores.derivedKeys?.(kept, back) ?? {};
    // As for a refusal: if the kept record went up with the chosen values
    // (it had unsent edits), the restored values go up too.
    const reupload = undo.winnerUnsent === true && kept._dirty !== 1;
    await stores.patients.update(keptId, {
      ...back,
      ...derived,
      ...(reupload ? { _dirty: 1, updatedAt: new Date() } : {}),
    } as Partial<Patient>);
  }
}

/** The server applied the merge: confirm it on this device. */
export async function settleMergeApplied(
  stores: MergeStores,
  command: ServerCommand,
  result: unknown,
): Promise<void> {
  const parsed = parseMergeResult(result);
  const { winnerId, loserId } = mergeCommandPatients(command.args);
  await stores.transaction(async () => {
    const loserKey = parsed.loserId ?? loserId;
    if (loserKey) {
      const loser = await stores.patients.get(loserKey);
      if (loser) {
        await stores.patients.update(loserKey, {
          mergePending: 0,
          mergeInto: parsed.winnerId ?? loser.mergeInto ?? winnerId,
          mergedAt: parsed.mergedAt ?? loser.mergedAt ?? null,
        });
      }
    }
    const record = await mergeRecordFor(stores, command);
    if (!record) return;
    await reconcileChosenValues(stores, record, parsed);
    if (parsed.mergeId && parsed.mergeId !== record.id) {
      // The server holds this merge under another id (an earlier merge of
      // the same records, or a merge queued before merge ids were sent).
      // Its row is downloaded at the next sync; keep one entry, not two.
      await stores.merges.delete(record.id);
      return;
    }
    await stores.merges.update(record.id, {
      status: "applied",
      rejectReason: undefined,
      winnerId: parsed.winnerId ?? record.winnerId,
      localUndo: null,
    });
  });
}

export interface RejectionUndo {
  winnerId?: string;
  loserId?: string;
  /** Child rows put back on the loser. */
  restored: number;
}

/**
 * The server refused the merge: undo what this device changed. Only values
 * this merge set are put back; later edits are left alone.
 */
export async function settleMergeRejected(
  stores: MergeStores,
  command: ServerCommand,
  reason: string,
): Promise<RejectionUndo> {
  const { winnerId, loserId } = mergeCommandPatients(command.args);
  return stores.transaction(async () => {
    const record = await mergeRecordFor(stores, command);
    const keptId = record?.winnerId ?? winnerId;
    const goneId = record?.loserId ?? loserId;
    let restored = 0;

    if (goneId) {
      const loser = await stores.patients.get(goneId);
      if (loser && (!keptId || !loser.mergeInto || loser.mergeInto === keptId)) {
        await stores.patients.update(goneId, {
          mergeInto: undefined,
          mergedAt: null,
          mergePending: 0,
        });
      } else if (loser && loser.mergePending) {
        await stores.patients.update(goneId, { mergePending: 0 });
      }
    }

    const undo = record?.localUndo;
    if (undo && keptId && goneId) {
      for (const child of stores.children) {
        const ids = undo.moved[child.name];
        if (ids?.length) restored += await child.repoint(ids, keptId, goneId);
        // Rows recorded here before the merge and not uploaded then may
        // have been uploaded under the kept record since: upload them again
        // so the server puts them back on the right patient too.
        const unsent = undo.unsent?.[child.name];
        if (unsent?.length && child.markUnsent) await child.markUnsent(unsent, goneId);
      }
      const kept = await stores.patients.get(keptId);
      if (kept) {
        const row = kept as unknown as Record<string, unknown>;
        const back: Record<string, unknown> = {};
        for (const [field, applied] of Object.entries(undo.winnerApplied)) {
          if (sameValue(row[field], applied)) back[field] = undo.winnerBefore[field] ?? null;
        }
        if (Object.keys(back).length > 0) {
          const derived = stores.derivedKeys?.(kept, back) ?? {};
          // The kept record had unsent edits when the merge was asked for
          // and has been uploaded since, with the chosen values: upload the
          // restored values too, so the server drops them as well.
          const reupload = undo.winnerUnsent === true && kept._dirty !== 1;
          await stores.patients.update(keptId, {
            ...back,
            ...derived,
            ...(reupload ? { _dirty: 1, updatedAt: new Date() } : {}),
          } as Partial<Patient>);
        }
      }
    }

    if (record) {
      await stores.merges.update(record.id, {
        status: "rejected",
        rejectReason: reason,
        localUndo: null,
      });
    }
    return { winnerId: keptId, loserId: goneId, restored };
  });
}
