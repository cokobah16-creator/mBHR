// Pharmacy ledger sync participant (Wave B, item 4). Replaces the unused
// mbhrAdapter.ts, which uploaded whole tables with absolute quantities.
//
// Prescriptions and stock lots are server-backed. Stock is never uploaded
// as a number: every change is a command (src/services/pharmacyCommands.ts)
// that the server applies to its append-only ledger under row locks
// (supabase/migrations/20260925100400_pharmacy_stock_ledger.sql), so two
// devices dispensing the same lot can never lose an update or take stock
// below zero.
//
// Each sync run (registered with the main engine, after its download):
//   1. upload new prescriptions (insert-if-absent; status always "open");
//   2. send queued pharmacy commands (mbhrDb.rx_commands), oldest first;
//   3. download medicines, lots, prescriptions, prescription dispenses,
//      the last 90 days of stock movements and stock discrepancies;
//   4. recompute the quantities shown: server balance + pending movements.
//
// Nothing here logs patient data: only error codes and names.
import { can, type Role } from "@/auth/roles";
import { mbhrDb, type Dispense, type Prescription } from "@/db/mbhr";
import { supabase } from "@/lib/supabase";
import {
  asCommandStore,
  commandDeps,
  currentCommandSender,
  isOnlineSyncEnabled,
  registerSyncParticipant,
} from "./adapter";
import {
  countOpenCommands,
  countWaitingPermission,
  drainCommands,
  enqueueCommand,
  registerCommandHandler,
  type CommandStore,
  type DrainSummary,
  type ServerCommand,
} from "./commandOutbox";
import { syncErrorCode } from "./errorCode";
import { advanceCursor, isCursorAhead } from "./cursorGuard";
import {
  batchFromServer,
  discrepancyFromServer,
  dispenseFromServer,
  handedOverRefusalStatus,
  isStaleBalance,
  itemFromServer,
  movementFromServer,
  parseBalances,
  parseDispenseResult,
  prescriptionFromServer,
  prescriptionUploadRow,
  recomputeShown,
  refusedDispenseAction,
  shouldUploadPrescription,
  type ServerBalance,
} from "./pharmacySyncModel";

type Raw = Record<string, unknown>;

/** The pharmacy command outbox (kept in the pharmacy database). */
export function rxCommandStore(): CommandStore {
  return asCommandStore(mbhrDb.rx_commands);
}

function online(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/** Cloud sync is set up and this device has a connection. */
export function pharmacyServerReachable(): boolean {
  return !!supabase && isOnlineSyncEnabled() && online();
}

// ---------------------------------------------------------------------------
// Shown quantities
// ---------------------------------------------------------------------------

/** Recompute shown quantities (server balance + pending movements). */
export async function recomputeShownQuantities(): Promise<void> {
  await mbhrDb.transaction(
    "rw",
    [mbhrDb.pharmacy_items, mbhrDb.pharmacy_batches, mbhrDb.stock_movements],
    async () => {
      const [items, batches, pending] = await Promise.all([
        mbhrDb.pharmacy_items.toArray(),
        mbhrDb.pharmacy_batches.toArray(),
        mbhrDb.stock_movements.where("status").equals("pending").toArray(),
      ]);
      const changes = recomputeShown(items, batches, pending);
      for (const c of changes.batches) await mbhrDb.pharmacy_batches.update(c.id, { qtyOnHand: c.qty });
      for (const c of changes.items) await mbhrDb.pharmacy_items.update(c.id, { onHandQty: c.qty });
    },
  );
}

async function applyBalances(balances: { items: ServerBalance[]; batches: ServerBalance[] }) {
  for (const b of balances.batches) {
    const local = await mbhrDb.pharmacy_batches.get(b.id);
    // Unknown lot, or an answer older than the balance already downloaded.
    if (!local || isStaleBalance(local.rowVersion, b.rowVersion)) continue;
    await mbhrDb.pharmacy_batches.update(b.id, {
      serverQtyOnHand: b.qty,
      ...(b.rowVersion !== undefined ? { rowVersion: b.rowVersion } : {}),
    });
  }
  for (const i of balances.items) {
    const local = await mbhrDb.pharmacy_items.get(i.id);
    if (!local || isStaleBalance(local.rowVersion, i.rowVersion)) continue;
    await mbhrDb.pharmacy_items.update(i.id, {
      serverQtyOnHand: i.qty,
      ...(i.rowVersion !== undefined ? { rowVersion: i.rowVersion } : {}),
    });
  }
}

const LEDGER_TABLES = () => [
  mbhrDb.pharmacy_items,
  mbhrDb.pharmacy_batches,
  mbhrDb.stock_movements,
  mbhrDb.prescriptions,
  mbhrDb.dispenses,
];

function argString(command: ServerCommand, key: string): string | undefined {
  const v = command.args?.[key];
  return typeof v === "string" ? v : undefined;
}

// ---------------------------------------------------------------------------
// Command answers
// ---------------------------------------------------------------------------

registerCommandHandler("rx_dispense", {
  async onApplied(command, result) {
    const parsed = parseDispenseResult(result);
    const prescriptionId = argString(command, "p_prescription_id") ?? "";
    await mbhrDb.transaction("rw", LEDGER_TABLES(), async () => {
      const rx = await mbhrDb.prescriptions.get(prescriptionId);
      const optimistic = await mbhrDb.dispenses.where("commandId").equals(command.id).toArray();
      const template: Partial<Dispense> = optimistic[0] ?? {};
      if (parsed.allocations.length === 0) {
        // No allocation in the answer (older server): keep this device's rows.
        await mbhrDb.dispenses.where("commandId").equals(command.id).modify({ pending: 0 });
      } else {
        // The server's allocation is the record (it may have used other lots).
        await mbhrDb.dispenses.bulkDelete(optimistic.map((d) => d.id));
      }
      await mbhrDb.dispenses.bulkPut(
        parsed.allocations.map((a) => ({
          id: a.dispenseId,
          prescriptionId,
          patientId: rx?.patientId ?? template.patientId ?? "",
          itemId: a.itemId,
          batchId: a.batchId,
          qty: a.qty,
          dispensedBy: template.dispensedBy ?? argString(command, "p_requested_by") ?? "",
          dispensedAt: template.dispensedAt ?? argString(command, "p_occurred_at") ?? "",
          commandId: command.id,
          pending: 0 as const,
        })),
      );
      await mbhrDb.stock_movements
        .where("commandId")
        .equals(command.id)
        .filter((m) => m.status === "pending")
        .delete();
      await applyBalances(parsed);
      if (rx) {
        const uncovered = parsed.uncovered.reduce((sum, u) => sum + u.qty, 0);
        await mbhrDb.prescriptions.update(rx.id, {
          status: parsed.status ?? "dispensed",
          dispensedAt: parsed.dispensedAt ?? rx.dispensedAt,
          ...(rx.pendingCommandId === command.id ? { pendingCommandId: undefined } : {}),
          lastRejectReason: undefined,
          uncoveredQty: uncovered > 0 ? uncovered : undefined,
        });
      }
    });
    await recomputeShownQuantities();
  },
  async onRejected(command, reason) {
    const prescriptionId = argString(command, "p_prescription_id") ?? "";
    await mbhrDb.transaction("rw", [...LEDGER_TABLES(), mbhrDb.rx_commands], async () => {
      // Read the stored command, not the copy sent: the confirm wait marks
      // it as handed over (p_offline) while the call may still be in flight.
      const stored = await mbhrDb.rx_commands.get(command.id);
      const handedOver = (stored?.args ?? command.args)?.p_offline === true;
      const action = refusedDispenseAction(reason, handedOver);
      const rx = await mbhrDb.prescriptions.get(prescriptionId);
      const carried = !!rx && rx.pendingCommandId === command.id;
      await applyBalances(parseBalances(command.result));

      if (action === "resend_offline" && stored) {
        // Send it again as handed over under a new command id; the dispense
        // rows and pending stock follow the new command.
        const resent = await enqueueCommand(rxCommandStore(), {
          rpc: stored.rpc,
          args: { ...stored.args, p_offline: true },
          authorId: stored.authorId,
          requiredPermission: stored.requiredPermission,
          entityRefs: stored.entityRefs,
        });
        await mbhrDb.dispenses.where("commandId").equals(command.id).modify({ commandId: resent.id });
        await mbhrDb.stock_movements
          .where("commandId")
          .equals(command.id)
          .filter((m) => m.status === "pending")
          .modify({ commandId: resent.id });
        if (rx && carried) await mbhrDb.prescriptions.update(rx.id, { pendingCommandId: resent.id });
        return;
      }

      // The server never recorded these stock movements, so the shown stock
      // goes back to the server's balance either way.
      await mbhrDb.stock_movements
        .where("commandId")
        .equals(command.id)
        .filter((m) => m.status === "pending")
        .delete();

      if (action === "keep_handed_over") {
        // The medicine was given: keep the dispense rows as the record and
        // list the prescription for reconciliation instead of reopening it.
        if (rx && carried) {
          await mbhrDb.prescriptions.update(rx.id, {
            status: handedOverRefusalStatus(reason),
            pendingCommandId: undefined,
            lastRejectReason: reason,
            handoverRefused: 1,
          });
        }
        return;
      }

      await mbhrDb.dispenses.where("commandId").equals(command.id).delete();
      if (rx && carried) {
        // The command carried the prescription. When the server raised an
        // error (no stored result) nothing was saved there, so a
        // prescription it never had is uploaded again at the next sync.
        const neverOnServer =
          command.result === undefined &&
          !rx._syncedAt &&
          rx.rowVersion === undefined &&
          rx.localOnly !== 1;
        await mbhrDb.prescriptions.update(rx.id, {
          // Dispensed elsewhere: keep it out of the open list; the next
          // download brings the server's record.
          status: reason === "already_dispensed" ? "dispensed" : reason === "prescription_void" ? "void" : "open",
          dispensedAt: undefined,
          pendingCommandId: undefined,
          lastRejectReason: reason,
          ...(neverOnServer ? { _dirty: 1 as const } : {}),
        });
      }
    });
    await recomputeShownQuantities();
  },
});

async function settleStockCommand(command: ServerCommand, result: unknown, applied: boolean, reason?: string) {
  await mbhrDb.transaction("rw", LEDGER_TABLES(), async () => {
    const pending = await mbhrDb.stock_movements
      .where("commandId")
      .equals(command.id)
      .filter((m) => m.status === "pending")
      .toArray();
    await mbhrDb.stock_movements.bulkDelete(pending.map((m) => m.id));
    await applyBalances(parseBalances(result));
    if (applied || command.rpc !== "rx_receive_stock") return;
    // A refused receipt: the lot was never on the server.
    const batchArg = command.args?.p_batch as Raw | undefined;
    const batchId = typeof batchArg?.id === "string" ? batchArg.id : argString(command, "p_batch_id");
    const batch = batchId ? await mbhrDb.pharmacy_batches.get(batchId) : undefined;
    if (!batch || batch.serverQtyOnHand !== undefined) return;
    const stillPending = await mbhrDb.stock_movements
      .where("batchId")
      .equals(batch.id)
      .filter((m) => m.status === "pending")
      .count();
    if (stillPending > 0) return;
    if (reason === "opening_stock_already_uploaded" || command.args?.p_reason === "opening_balance") {
      // Opening stock from this device was refused (another device already
      // uploaded it, or the lot was not valid): keep the counted quantity
      // on this device so nothing is lost; the pharmacist can then discard
      // it for the server's stock.
      const qty = pending.reduce((sum, m) => sum + m.qtyDelta, 0);
      await mbhrDb.pharmacy_batches.update(batch.id, { localOnly: 1, qtyOnHand: qty });
    } else {
      await mbhrDb.pharmacy_batches.delete(batch.id);
    }
  });
  await recomputeShownQuantities();
}

for (const rpc of ["rx_receive_stock", "rx_adjust_stock"]) {
  registerCommandHandler(rpc, {
    onApplied: (command, result) => settleStockCommand(command, result, true),
    onRejected: (command, reason) => settleStockCommand(command, command.result, false, reason),
  });
}

/** Move everything recorded under one medicine id to another (server's id). */
async function remapItemId(fromId: string, toId: string) {
  if (!fromId || !toId || fromId === toId) return;
  await mbhrDb.transaction("rw", LEDGER_TABLES(), async () => {
    const from = await mbhrDb.pharmacy_items.get(fromId);
    const existing = await mbhrDb.pharmacy_items.get(toId);
    if (from && !existing) await mbhrDb.pharmacy_items.put({ ...from, id: toId });
    await mbhrDb.pharmacy_items.delete(fromId);
    await mbhrDb.pharmacy_batches.where("itemId").equals(fromId).modify({ itemId: toId });
    await mbhrDb.stock_movements.where("itemId").equals(fromId).modify({ itemId: toId });
    await mbhrDb.dispenses.filter((d) => d.itemId === fromId).modify({ itemId: toId });
    await mbhrDb.prescriptions
      .filter((r) => r.lines.some((l) => l.itemId === fromId))
      .modify((r: Prescription) => {
        r.lines = r.lines.map((l) => (l.itemId === fromId ? { ...l, itemId: toId } : l));
      });
  });
}

registerCommandHandler("rx_register_item", {
  async onApplied(command, result) {
    const localId = argString(command, "p_item_id") ?? "";
    const r = (result && typeof result === "object" ? result : {}) as Raw;
    const serverId = typeof r.item_id === "string" ? r.item_id : localId;
    await remapItemId(localId, serverId);
    const qty = typeof r.on_hand_qty === "number" ? r.on_hand_qty : undefined;
    await mbhrDb.pharmacy_items.update(serverId, {
      pendingRegister: 0,
      registerRejected: undefined,
      ...(qty !== undefined ? { serverQtyOnHand: qty } : {}),
    });
    await recomputeShownQuantities();
  },
  async onRejected(command, reason) {
    const localId = argString(command, "p_item_id") ?? "";
    await mbhrDb.pharmacy_items.update(localId, { pendingRegister: 0, registerRejected: reason });
  },
});

registerCommandHandler("rx_set_item_active", {
  async onApplied(command) {
    const id = argString(command, "p_item_id") ?? "";
    await mbhrDb.pharmacy_items.update(id, { isActive: command.args?.p_active !== false });
  },
  async onRejected(command) {
    const id = argString(command, "p_item_id") ?? "";
    await mbhrDb.pharmacy_items.update(id, { isActive: command.args?.p_active === false });
  },
});

registerCommandHandler("rx_void_prescription", {
  async onApplied(command) {
    const id = argString(command, "p_prescription_id") ?? "";
    await mbhrDb.prescriptions.update(id, { status: "void", pendingCommandId: undefined });
  },
  async onRejected(command, reason) {
    const id = argString(command, "p_prescription_id") ?? "";
    const rx = await mbhrDb.prescriptions.get(id);
    if (!rx || rx.pendingCommandId !== command.id) return;
    if (reason === "prescription_not_found") {
      // The server never had it (and a cancelled prescription is never
      // uploaded), so cancelling it on this device is complete.
      await mbhrDb.prescriptions.update(id, {
        status: "void",
        pendingCommandId: undefined,
        lastRejectReason: undefined,
        localOnly: 1,
        _dirty: 0,
      });
      return;
    }
    await mbhrDb.prescriptions.update(id, {
      status: reason === "already_dispensed" ? "dispensed" : "open",
      pendingCommandId: undefined,
      lastRejectReason: reason,
    });
  },
});

registerCommandHandler("rx_import_history", {
  async onApplied(command) {
    const id = argString(command, "p_prescription_id") ?? "";
    await mbhrDb.transaction("rw", [mbhrDb.prescriptions, mbhrDb.dispenses], async () => {
      await mbhrDb.prescriptions.update(id, { localOnly: 0, _dirty: 0 });
      await mbhrDb.dispenses.where("prescriptionId").equals(id).modify({ localOnly: 0 });
    });
  },
  async onRejected(command, reason) {
    const id = argString(command, "p_prescription_id") ?? "";
    await mbhrDb.prescriptions.update(id, { lastRejectReason: reason });
  },
});

// ---------------------------------------------------------------------------
// Upload, send, download
// ---------------------------------------------------------------------------

/** Upload prescriptions written on this device (insert-if-absent). */
async function uploadPrescriptions(role: Role): Promise<number> {
  if (!supabase || !can(role, "consult")) return 0;
  const dirty = (await mbhrDb.prescriptions.where("_dirty").equals(1).toArray()).filter(
    shouldUploadPrescription,
  );
  let uploaded = 0;
  for (let i = 0; i < dirty.length; i += 100) {
    const chunk = dirty.slice(i, i + 100);
    const { error } = await supabase
      .from("prescriptions")
      .upsert(chunk.map(prescriptionUploadRow), { onConflict: "id", ignoreDuplicates: true });
    if (error) {
      console.warn("[pharmacy-sync] prescription upload failed", syncErrorCode(error));
      return uploaded;
    }
    const syncedAt = new Date().toISOString();
    await mbhrDb.transaction("rw", mbhrDb.prescriptions, async () => {
      for (const rx of chunk) {
        const current = await mbhrDb.prescriptions.get(rx.id);
        if (current && current._dirty === 1) {
          await mbhrDb.prescriptions.update(rx.id, { _dirty: 0, _syncedAt: syncedAt });
        }
      }
    });
    uploaded += chunk.length;
  }
  return uploaded;
}

/** Send this device's queued pharmacy commands now. null: sync is not set up. */
export async function sendPharmacyCommands(): Promise<DrainSummary | null> {
  if (!supabase || !isOnlineSyncEnabled()) return null;
  return drainCommands(rxCommandStore(), commandDeps());
}

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const PAGE = 1000;
const MAX_PAGES = 10;

interface PullSpec {
  table: string;
  cursorColumn: string;
  /** Cursor to start from when none is stored. */
  initial?: () => string;
  filter?: (q: PullQuery) => PullQuery;
  apply: (rows: Raw[]) => Promise<void>;
}

interface PullQuery {
  gt(column: string, value: string): PullQuery;
  not(column: string, operator: string, value: unknown): PullQuery;
  order(column: string, options: { ascending: boolean }): PullQuery;
  limit(n: number): PromiseLike<{ data: unknown; error: unknown }>;
}

/**
 * A row stamped just before another can become visible just after it (the
 * transactions commit in the other order), so each run re-reads a short
 * window before the cursor. Applying a row twice changes nothing.
 */
const CURSOR_OVERLAP_MS = 2 * 60 * 1000;

function overlapFrom(cursor: string): string {
  const t = Date.parse(cursor);
  return Number.isFinite(t) ? new Date(t - CURSOR_OVERLAP_MS).toISOString() : cursor;
}

async function pullTable(spec: PullSpec): Promise<boolean> {
  if (!supabase) return false;
  const cursorId = `pull:${spec.table}`;
  const saved = (await mbhrDb.rx_cursors.get(cursorId))?.ts;
  // A cursor in the future may have skipped rows: download from the start.
  const stored = saved && !isCursorAhead(saved) ? saved : undefined;
  // The stored cursor is always a server timestamp string, so the string
  // comparison below compares like with like.
  let since = stored ?? spec.initial?.() ?? "";
  let from = stored ? overlapFrom(stored) : since;
  for (let page = 0; page < MAX_PAGES; page++) {
    let q = supabase.from(spec.table).select("*") as unknown as PullQuery;
    if (from) q = q.gt(spec.cursorColumn, from);
    if (spec.filter) q = spec.filter(q);
    const { data, error } = await q.order(spec.cursorColumn, { ascending: true }).limit(PAGE);
    if (error) {
      console.warn(`[pharmacy-sync] download failed for ${spec.table}`, syncErrorCode(error));
      return false;
    }
    const rows = (Array.isArray(data) ? data : []) as Raw[];
    if (rows.length === 0) break;
    await spec.apply(rows);
    const now = Date.now();
    // Not past this device's clock (see cursorGuard).
    for (const row of rows) since = advanceCursor(since, row[spec.cursorColumn], now);
    await mbhrDb.rx_cursors.put({ id: cursorId, ts: since });
    // A full page that did not move the cursor (future-dated rows) would
    // come back again unchanged: stop until the next run.
    if (rows.length < PAGE || since === from) break;
    from = since;
  }
  return true;
}

const PULLS: PullSpec[] = [
  {
    table: "pharmacy_items",
    cursorColumn: "updated_at",
    apply: async (rows) => {
      await mbhrDb.transaction("rw", mbhrDb.pharmacy_items, async () => {
        for (const raw of rows) {
          const local = await mbhrDb.pharmacy_items.get(String(raw.id));
          const row = itemFromServer(raw, local);
          if (row) await mbhrDb.pharmacy_items.put(row);
        }
      });
    },
  },
  {
    table: "pharmacy_batches",
    cursorColumn: "updated_at",
    apply: async (rows) => {
      await mbhrDb.transaction("rw", mbhrDb.pharmacy_batches, async () => {
        for (const raw of rows) {
          const local = await mbhrDb.pharmacy_batches.get(String(raw.id));
          const row = batchFromServer(raw, local);
          if (row) await mbhrDb.pharmacy_batches.put(row);
        }
      });
    },
  },
  {
    table: "prescriptions",
    cursorColumn: "updated_at",
    apply: async (rows) => {
      const syncedAt = new Date().toISOString();
      await mbhrDb.transaction("rw", mbhrDb.prescriptions, async () => {
        for (const raw of rows) {
          const local = await mbhrDb.prescriptions.get(String(raw.id));
          const row = prescriptionFromServer(raw, local, syncedAt);
          if (row) await mbhrDb.prescriptions.put(row);
        }
      });
    },
  },
  {
    table: "dispenses",
    cursorColumn: "updated_at",
    filter: (q) => q.not("prescription_id", "is", null),
    apply: async (rows) => {
      await mbhrDb.transaction("rw", mbhrDb.dispenses, async () => {
        for (const raw of rows) {
          const row = dispenseFromServer(raw);
          if (!row) continue;
          const local = await mbhrDb.dispenses.get(row.id);
          if (local?.pending === 1) continue; // settled by its command's answer
          await mbhrDb.dispenses.put({ ...row, commandId: local?.commandId });
        }
      });
    },
  },
  {
    table: "stock_movements",
    cursorColumn: "recorded_at",
    initial: () => new Date(Date.now() - NINETY_DAYS_MS).toISOString(),
    apply: async (rows) => {
      await mbhrDb.transaction("rw", mbhrDb.stock_movements, async () => {
        for (const raw of rows) {
          const row = movementFromServer(raw);
          // Replaces a pending row with the same id: the balance downloaded
          // with it already includes this movement.
          if (row) await mbhrDb.stock_movements.put(row);
        }
      });
    },
  },
  {
    table: "stock_discrepancies",
    cursorColumn: "updated_at",
    apply: async (rows) => {
      await mbhrDb.transaction("rw", mbhrDb.stock_discrepancies, async () => {
        for (const raw of rows) {
          const row = discrepancyFromServer(raw);
          if (row) await mbhrDb.stock_discrepancies.put(row);
        }
      });
    },
  },
];

export interface PharmacySyncResult {
  /** false: not set up, offline or not signed in online; nothing was sent. */
  ran: boolean;
  uploadedPrescriptions: number;
  commands: DrainSummary | null;
  /** Server tables whose download failed. */
  failedTables: string[];
}

/** Upload, send and download pharmacy records now. Never throws. */
export async function syncPharmacyNow(): Promise<PharmacySyncResult> {
  const result: PharmacySyncResult = {
    ran: false,
    uploadedPrescriptions: 0,
    commands: null,
    failedTables: [],
  };
  if (!pharmacyServerReachable()) return result;
  const sender = await currentCommandSender();
  if (!sender) return result;
  result.ran = true;
  const role = sender.role as Role;
  try {
    result.uploadedPrescriptions = await uploadPrescriptions(role);
  } catch (error) {
    console.warn("[pharmacy-sync] prescription upload failed", syncErrorCode(error));
  }
  try {
    result.commands = await sendPharmacyCommands();
  } catch (error) {
    console.warn("[pharmacy-sync] sending commands failed", syncErrorCode(error));
  }
  if (can(role, "dispense") || can(role, "inventory") || can(role, "consult")) {
    for (const spec of PULLS) {
      try {
        if (!(await pullTable(spec))) result.failedTables.push(spec.table);
      } catch (error) {
        console.warn(`[pharmacy-sync] download failed for ${spec.table}`, syncErrorCode(error));
        result.failedTables.push(spec.table);
      }
    }
  }
  await recomputeShownQuantities().catch((error) =>
    console.warn("[pharmacy-sync] recompute failed", syncErrorCode(error)),
  );
  return result;
}

// ---------------------------------------------------------------------------
// Counts for sync status
// ---------------------------------------------------------------------------

/**
 * Pharmacy changes on this device the server has not accepted yet: queued
 * commands plus prescriptions not uploaded. Safe inside a liveQuery.
 */
export async function countPharmacyUnsynced(): Promise<number> {
  const commands = await countOpenCommands(rxCommandStore()).catch(() => 0);
  const rx = await mbhrDb.prescriptions
    .where("_dirty")
    .equals(1)
    .filter(shouldUploadPrescription)
    .count()
    .catch(() => 0);
  return commands + rx;
}

/** Pharmacy commands waiting for an authorised person to sync. */
export async function countPharmacyAwaitingAuthorised(): Promise<number> {
  return countWaitingPermission(rxCommandStore()).catch(() => 0);
}

/** Stock kept only on this device (not yet opening stock on the server). */
export async function countLocalOnlyStock(): Promise<{ items: number; batches: number }> {
  const [items, batches] = await Promise.all([
    mbhrDb.pharmacy_items.where("localOnly").equals(1).count(),
    mbhrDb.pharmacy_batches.where("localOnly").equals(1).count(),
  ]);
  return { items, batches };
}

registerSyncParticipant({
  name: "pharmacy",
  afterPull: async () => {
    const result = await syncPharmacyNow();
    if (result.failedTables.length > 0) {
      throw Object.assign(new Error("PharmacyDownloadFailed"), { name: "PharmacyDownloadFailed" });
    }
  },
});
