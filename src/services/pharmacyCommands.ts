// Pharmacy actions on this device (Wave B, item 4).
//
// Each action checks the staff member's permission, then writes its
// optimistic change and, for server-backed stock, the matching command in
// ONE Dexie transaction (mbhrDb.rx_commands lives in the same database), so
// a change can never be saved without its command or the other way round.
// The server applies commands to its stock ledger; answers are handled in
// src/sync/pharmacySync.ts.
//
// Stock kept only on this device (localOnly) is changed directly, as before
// the ledger existed, until a pharmacist uploads it as the site's opening
// stock (uploadOpeningStock) or replaces it with the server's
// (discardLocalStock).
//
// Errors thrown here carry only a name (and, for a changed lot, its lot
// number), never patient data.
import { can, type Role } from "@/auth/roles";
import {
  mbhrDb,
  ulid,
  type PharmacyBatch,
  type PharmacyItem,
  type Prescription,
  type StockMovement,
} from "@/db/mbhr";
import { isSupabaseEnabled } from "@/lib/supabaseClient";
import { supabase } from "@/lib/supabase";
import { DEFAULT_SITE_NAME, getActiveSiteName } from "@/services/activeSite";
import { getDeviceId } from "@/services/queueAudit";
import { enqueueCommand, newCommandId, type ServerCommand } from "@/sync/commandOutbox";
import {
  pharmacyServerReachable,
  rxCommandStore,
  sendPharmacyCommands,
  syncPharmacyNow,
} from "@/sync/pharmacySync";
import {
  dispenseLinesArg,
  mapLocalItemsToServer,
  parseShortLines,
  pharmacySiteKey,
  prescriptionUploadRow,
  remapLines,
} from "@/sync/pharmacySyncModel";
import { currentCommandSender } from "@/sync/adapter";
import {
  buildOptimisticDispense,
  countAdjustment,
  dispenseMode,
  planCoversAllLines,
  receiveProblem,
  type DispensePlanLine,
} from "./pharmacyCommandsModel";

export interface PharmacyActor {
  id: string;
  role: Role;
}

function named(name: string, message?: string): Error {
  const error = new Error(message ?? name);
  error.name = name;
  return error;
}

function requirePermission(actor: PharmacyActor | null | undefined, ok: (role: Role) => boolean) {
  if (!actor || !ok(actor.role)) throw named("NotAllowed");
}

const rxTables = () => [
  mbhrDb.prescriptions,
  mbhrDb.pharmacy_batches,
  mbhrDb.pharmacy_items,
  mbhrDb.dispenses,
  mbhrDb.stock_movements,
  mbhrDb.rx_commands,
];

/** Whether server-backed stock is used on this device (cloud sync set up). */
export const ledgerEnabled = isSupabaseEnabled;

async function currentSiteKey(): Promise<string> {
  return pharmacySiteKey(await getActiveSiteName().catch(() => DEFAULT_SITE_NAME), DEFAULT_SITE_NAME);
}

// ---------------------------------------------------------------------------
// Prescriptions
// ---------------------------------------------------------------------------

/** May this role write prescriptions? (consult, plus nurses as on /rx/new.) */
export function canPrescribe(role: Role | undefined): boolean {
  return !!role && (can(role, "consult") || role === "nurse");
}

/** Save a new prescription on this device; it uploads at the next sync. */
export async function createPrescription(
  input: Omit<Prescription, "id" | "status" | "createdAt" | "_dirty" | "prescriberId">,
  actor: PharmacyActor | null | undefined,
): Promise<Prescription> {
  requirePermission(actor, (role) => canPrescribe(role));
  const rx: Prescription = {
    ...input,
    id: ulid(),
    prescriberId: actor!.id,
    createdAt: new Date().toISOString(),
    status: "open",
    _dirty: 1,
  };
  await mbhrDb.prescriptions.add(rx);
  return rx;
}

/** Cancel an open prescription (the prescriber or the pharmacy). */
export async function voidPrescription(
  prescriptionId: string,
  reason: string,
  actor: PharmacyActor | null | undefined,
): Promise<"queued" | "local"> {
  requirePermission(actor, (role) => canPrescribe(role) || can(role, "dispense"));
  let mode = "local" as "queued" | "local";
  await mbhrDb.transaction("rw", [mbhrDb.prescriptions, mbhrDb.rx_commands], async () => {
    const rx = await mbhrDb.prescriptions.get(prescriptionId);
    if (!rx || rx.status !== "open" || rx.pendingCommandId) throw named("PrescriptionNotOpen");
    const neverUploaded = rx._dirty === 1 && !rx._syncedAt;
    if (!ledgerEnabled || rx.localOnly === 1 || neverUploaded) {
      // Not on the server: cancel here; it is never uploaded as open.
      await mbhrDb.prescriptions.update(rx.id, { status: "void", _dirty: 0, localOnly: 1 });
      return;
    }
    const commandId = newCommandId();
    await mbhrDb.prescriptions.update(rx.id, { status: "void", pendingCommandId: commandId });
    await enqueueCommand(rxCommandStore(), {
      id: commandId,
      rpc: "rx_void_prescription",
      args: {
        p_prescription_id: rx.id,
        p_reason: reason.slice(0, 200),
        p_occurred_at: new Date().toISOString(),
        p_requested_by: actor!.id,
      },
      authorId: actor!.id,
      entityRefs: [{ table: "prescriptions", id: rx.id }],
    });
    mode = "queued";
  });
  if (mode === "queued" && pharmacyServerReachable()) {
    void sendPharmacyCommands().catch(() => undefined);
  }
  return mode;
}

// ---------------------------------------------------------------------------
// Dispensing
// ---------------------------------------------------------------------------

export interface DispenseInput {
  prescription: Prescription;
  plan: DispensePlanLine[];
  items: Pick<PharmacyItem, "id" | "localOnly" | "medName" | "strength">[];
  allergyOverride: boolean;
}

export type DispenseOutcome =
  | { kind: "local" }
  | { kind: "queued"; commandId: string; offline: boolean };

/**
 * Dispense every line of a prescription from the lots in `plan` (FEFO).
 * Throws LotChanged (message "Lot <n> no longer has <q> available.") when a
 * lot changed since the page loaded; nothing is saved then.
 */
export async function dispensePrescription(
  input: DispenseInput,
  actor: PharmacyActor | null | undefined,
): Promise<DispenseOutcome> {
  requirePermission(actor, (role) => can(role, "dispense"));
  const { prescription, plan, items, allergyOverride } = input;
  const mode = dispenseMode(prescription.lines, items);
  if (mode === "missing") throw named("UnknownItem");
  if (mode === "mixed") throw named("MixedStock");
  if (!planCoversAllLines(plan)) throw named("IncompleteAllocation");

  const localOnly = mode === "local";
  const commandId = newCommandId();
  const at = new Date().toISOString();
  const offline = !pharmacyServerReachable();
  const built = buildOptimisticDispense({
    prescription,
    plan,
    commandId,
    actorId: actor!.id,
    at,
    newId: ulid,
    localOnly,
  });

  const lotNumbers = new Map(plan.flatMap((line) => line.allocations.map((a) => [a.batchId, a.lotNumber] as const)));

  await mbhrDb.transaction("rw", rxTables(), async () => {
    const rx = await mbhrDb.prescriptions.get(prescription.id);
    if (!rx || rx.status !== "open" || rx.pendingCommandId) throw named("PrescriptionNotOpen");
    // Re-read inside the transaction: another tab may have used a lot.
    for (const [batchId, qty] of built.byBatch) {
      const lot = await mbhrDb.pharmacy_batches.get(batchId);
      if (!lot || lot.qtyOnHand < qty) {
        const lotNumber = lot?.lotNumber ?? lotNumbers.get(batchId) ?? "";
        throw named("LotChanged", `Lot ${lotNumber} no longer has ${qty} available.`);
      }
      await mbhrDb.pharmacy_batches.update(batchId, { qtyOnHand: lot.qtyOnHand - qty });
    }
    for (const [itemId, qty] of built.byItem) {
      const item = await mbhrDb.pharmacy_items.get(itemId);
      if (item) {
        // Not clamped: the shown quantity is the ledger's, never hidden.
        await mbhrDb.pharmacy_items.update(itemId, { onHandQty: item.onHandQty - qty, updatedAt: at });
      }
    }
    await mbhrDb.dispenses.bulkAdd(built.dispenses);
    if (built.movements.length > 0) await mbhrDb.stock_movements.bulkAdd(built.movements);

    if (localOnly) {
      await mbhrDb.prescriptions.update(rx.id, {
        status: "dispensed",
        dispensedAt: at,
        localOnly: 1,
        _dirty: 0,
        lastRejectReason: undefined,
      });
      if (ledgerEnabled) {
        // Record the dispensing (not the stock) on the server so other
        // devices see this prescription as dispensed.
        await enqueueImportHistory(
          rx,
          { ...rx, status: "dispensed", dispensedAt: at },
          built.dispenses,
          items,
          actor!.id,
        );
      }
      return;
    }

    await mbhrDb.prescriptions.update(rx.id, {
      status: "dispensed",
      dispensedAt: at,
      pendingCommandId: commandId,
      // The command carries the prescription, so no separate upload.
      _dirty: 0,
      lastRejectReason: undefined,
      uncoveredQty: undefined,
    });
    await enqueueCommand(rxCommandStore(), {
      id: commandId,
      rpc: "rx_dispense",
      args: {
        p_prescription_id: rx.id,
        p_lines: dispenseLinesArg(built.lines),
        p_occurred_at: at,
        p_offline: offline,
        p_allergy_override: allergyOverride,
        p_requested_by: actor!.id,
        p_prescription: prescriptionUploadRow(rx),
      },
      authorId: actor!.id,
      entityRefs: [
        { table: "prescriptions", id: rx.id },
        ...[...built.byBatch.keys()].map((id) => ({ table: "pharmacy_batches", id })),
      ],
    });
  });

  return localOnly ? { kind: "local" } : { kind: "queued", commandId, offline };
}

async function enqueueImportHistory(
  rx: Prescription,
  snapshot: Prescription,
  dispenses: { id: string; itemId: string; batchId: string; qty: number; dispensedBy: string; dispensedAt: string }[],
  items: Pick<PharmacyItem, "id" | "medName" | "strength">[],
  authorId: string,
  itemIdMap?: Map<string, string>,
  createdAt?: number,
): Promise<void> {
  const mapId = (id: string) => itemIdMap?.get(id) ?? id;
  const lines = itemIdMap ? remapLines(snapshot.lines, itemIdMap).lines : snapshot.lines;
  await enqueueCommand(
    rxCommandStore(),
    {
      rpc: "rx_import_history",
      args: {
        p_prescription_id: rx.id,
        p_prescription: {
          ...prescriptionUploadRow({ ...snapshot, lines }),
          status: snapshot.status,
          dispensed_at: snapshot.dispensedAt ?? null,
        },
        p_dispenses: dispenses.map((d) => {
          const item = items.find((i) => i.id === d.itemId);
          return {
            id: d.id,
            item_id: mapId(d.itemId),
            batch_id: d.batchId || null,
            qty: d.qty,
            dispensed_by: d.dispensedBy,
            dispensed_at: d.dispensedAt,
            item_name: item ? `${item.medName} ${item.strength}`.trim() : null,
          };
        }),
        p_requested_by: authorId,
      },
      authorId,
      entityRefs: [{ table: "prescriptions", id: rx.id }],
    },
    createdAt,
  );
}

export interface CommandAnswer {
  status: ServerCommand["status"] | "missing";
  rejectReason?: string;
  /** Per-line availability when the server had too little stock. */
  shortLines: { itemId: string; requested: number; available: number }[];
}

async function readAnswer(commandId: string): Promise<CommandAnswer> {
  const command = await mbhrDb.rx_commands.get(commandId);
  if (!command) return { status: "missing", shortLines: [] };
  return {
    status: command.status,
    rejectReason: command.rejectReason,
    shortLines: command.status === "rejected" ? parseShortLines(command.result) : [],
  };
}

/**
 * Ask the server to confirm a queued dispense straight away (when online).
 * If no answer arrives, the command is marked as handed over offline: the
 * server then records what it can and reports any uncovered units as a
 * stock discrepancy instead of refusing medicine already given.
 */
export async function confirmDispenseNow(commandId: string, waitMs = 8000): Promise<CommandAnswer> {
  const deadline = Date.now() + waitMs;
  const sendAndWait = async () => {
    if (!pharmacyServerReachable() || !(await currentCommandSender())) return;
    const summary = await sendPharmacyCommands();
    // Another sync may be sending it right now: wait for its answer.
    while (summary?.skipped === "busy" && Date.now() < deadline) {
      const answer = await readAnswer(commandId);
      if (answer.status !== "pending") return;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  };
  // A stalled connection must not keep the pharmacist waiting: after
  // waitMs the answer is read as it stands (sending carries on in the
  // background and its answer is handled when it arrives).
  await Promise.race([
    sendAndWait().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, waitMs)),
  ]);
  // Read the answer and mark it handed over in one step, so a refusal that
  // lands meanwhile is either reported here (not handed over) or, once
  // marked, handled as handed over (pharmacySync keeps the record).
  return mbhrDb.transaction("rw", mbhrDb.rx_commands, async () => {
    const answer = await readAnswer(commandId);
    // The screen now reports it saved, so the medicine may be handed over.
    if (answer.status === "pending" || answer.status === "waiting_permission") {
      const command = await mbhrDb.rx_commands.get(commandId);
      if (command && command.args?.p_offline !== true) {
        await mbhrDb.rx_commands.update(commandId, { args: { ...command.args, p_offline: true } });
      }
    }
    return answer;
  });
}

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

export interface NewMedicineInput {
  medName: string;
  form: string;
  strength: string;
  unit: string;
  reorderThreshold: number;
  isControlled: boolean;
}

/** Add a medicine. Server-backed when cloud sync is set up. */
export async function addMedicine(
  input: NewMedicineInput,
  actor: PharmacyActor | null | undefined,
): Promise<PharmacyItem> {
  requirePermission(actor, (role) => can(role, "inventory"));
  const siteKey = await currentSiteKey();
  const now = new Date().toISOString();
  const item: PharmacyItem = {
    id: ulid(),
    ...input,
    onHandQty: 0,
    updatedAt: now,
    siteKey,
    isActive: true,
    ...(ledgerEnabled ? { localOnly: 0 as const, pendingRegister: 1 as const } : { localOnly: 1 as const }),
  };
  await mbhrDb.transaction("rw", [mbhrDb.pharmacy_items, mbhrDb.rx_commands], async () => {
    await mbhrDb.pharmacy_items.add(item);
    if (ledgerEnabled) await enqueueRegisterItem(item, actor!.id);
  });
  if (ledgerEnabled && pharmacyServerReachable()) void sendPharmacyCommands().catch(() => undefined);
  return item;
}

async function enqueueRegisterItem(item: PharmacyItem, authorId: string, createdAt?: number) {
  await enqueueCommand(
    rxCommandStore(),
    {
      rpc: "rx_register_item",
      args: {
        p_item_id: item.id,
        p_item: {
          id: item.id,
          med_name: item.medName,
          form: item.form,
          strength: item.strength,
          unit: item.unit,
          reorder_threshold: item.reorderThreshold,
          is_controlled: !!item.isControlled,
          site_key: item.siteKey ?? null,
        },
        p_requested_by: authorId,
      },
      authorId,
      entityRefs: [{ table: "pharmacy_items", id: item.id }],
    },
    createdAt,
  );
}

/** Deactivate or reactivate a medicine (kept for history). */
export async function setMedicineActive(
  itemId: string,
  active: boolean,
  actor: PharmacyActor | null | undefined,
): Promise<"queued" | "local"> {
  requirePermission(actor, (role) => can(role, "inventory"));
  let mode = "local" as "queued" | "local";
  await mbhrDb.transaction("rw", [mbhrDb.pharmacy_items, mbhrDb.rx_commands], async () => {
    const item = await mbhrDb.pharmacy_items.get(itemId);
    if (!item) throw named("UnknownItem");
    await mbhrDb.pharmacy_items.update(itemId, { isActive: active, updatedAt: new Date().toISOString() });
    if (item.localOnly === 1) return;
    await enqueueCommand(rxCommandStore(), {
      rpc: "rx_set_item_active",
      args: { p_item_id: itemId, p_active: active, p_requested_by: actor!.id },
      authorId: actor!.id,
      entityRefs: [{ table: "pharmacy_items", id: itemId }],
    });
    mode = "queued";
  });
  if (mode === "queued" && pharmacyServerReachable()) void sendPharmacyCommands().catch(() => undefined);
  return mode;
}

/** Delete a medicine kept only on this device, with its lots. */
export async function deleteLocalMedicine(itemId: string, actor: PharmacyActor | null | undefined) {
  requirePermission(actor, (role) => can(role, "inventory"));
  await mbhrDb.transaction("rw", [mbhrDb.pharmacy_items, mbhrDb.pharmacy_batches], async () => {
    const item = await mbhrDb.pharmacy_items.get(itemId);
    if (!item || item.localOnly !== 1) throw named("NotLocalOnly");
    await mbhrDb.pharmacy_batches.where("itemId").equals(itemId).delete();
    await mbhrDb.pharmacy_items.delete(itemId);
  });
}

export interface ReceiveStockInput {
  itemId: string;
  lotNumber: string;
  qty: number;
  expiryDate: string;
  supplier?: string;
}

/** Record a new lot received into stock. */
export async function receiveStock(
  input: ReceiveStockInput,
  actor: PharmacyActor | null | undefined,
): Promise<{ kind: "local" } | { kind: "queued"; commandId: string }> {
  requirePermission(actor, (role) => can(role, "inventory"));
  const problem = receiveProblem(input);
  if (problem) throw named("InvalidLot", problem);
  const now = new Date().toISOString();
  const commandId = newCommandId();
  let local = false;
  await mbhrDb.transaction("rw", rxTables(), async () => {
    const item = await mbhrDb.pharmacy_items.get(input.itemId);
    if (!item) throw named("UnknownItem");
    local = item.localOnly === 1;
    const batch: PharmacyBatch = {
      id: ulid(),
      itemId: item.id,
      lotNumber: input.lotNumber.trim(),
      expiryDate: input.expiryDate,
      qtyOnHand: input.qty,
      receivedAt: now,
      supplier: input.supplier?.trim() || undefined,
      localOnly: local ? 1 : 0,
    };
    await mbhrDb.pharmacy_batches.add(batch);
    await mbhrDb.pharmacy_items.update(item.id, { onHandQty: item.onHandQty + input.qty, updatedAt: now });
    if (local) return;
    const movement: StockMovement = {
      id: ulid(),
      itemId: item.id,
      batchId: batch.id,
      qtyDelta: input.qty,
      reason: "receipt",
      status: "pending",
      commandId,
      actorId: actor!.id,
      occurredAt: now,
    };
    await mbhrDb.stock_movements.add(movement);
    await enqueueReceipt(batch, movement, "receipt", actor!.id, commandId);
  });
  if (local) return { kind: "local" };
  if (pharmacyServerReachable()) void sendPharmacyCommands().catch(() => undefined);
  return { kind: "queued", commandId };
}

async function enqueueReceipt(
  batch: PharmacyBatch,
  movement: StockMovement,
  reason: "receipt" | "opening_balance",
  authorId: string,
  commandId: string,
  extra: Record<string, unknown> = {},
  createdAt?: number,
) {
  await enqueueCommand(
    rxCommandStore(),
    {
      id: commandId,
      rpc: "rx_receive_stock",
      args: {
        p_movement_id: movement.id,
        p_batch: {
          id: batch.id,
          item_id: batch.itemId,
          lot_number: batch.lotNumber,
          expiry_date: batch.expiryDate,
          received_at: batch.receivedAt,
          supplier: batch.supplier ?? null,
        },
        p_qty: movement.qtyDelta,
        p_reason: reason,
        p_occurred_at: movement.occurredAt,
        p_requested_by: authorId,
        ...extra,
      },
      authorId,
      entityRefs: [
        { table: "pharmacy_items", id: batch.itemId },
        { table: "pharmacy_batches", id: batch.id },
      ],
    },
    createdAt,
  );
}

/**
 * Record a physical count of a lot (or write off expired stock with
 * reason "expire"). The server applies the difference and refuses it if its
 * own balance would go below zero.
 */
export async function adjustStock(
  input: { batchId: string; counted: number; reason: "adjust" | "expire"; note?: string },
  actor: PharmacyActor | null | undefined,
): Promise<{ kind: "unchanged" | "local" } | { kind: "queued"; commandId: string; delta: number }> {
  requirePermission(actor, (role) => can(role, "inventory"));
  if (!Number.isInteger(input.counted) || input.counted < 0) throw named("InvalidCount");
  const now = new Date().toISOString();
  const commandId = newCommandId();
  type AdjustOutcome = { kind: "unchanged" | "local" } | { kind: "queued"; commandId: string; delta: number };
  let outcome = { kind: "unchanged" } as AdjustOutcome;
  await mbhrDb.transaction("rw", rxTables(), async () => {
    const batch = await mbhrDb.pharmacy_batches.get(input.batchId);
    if (!batch) throw named("UnknownLot");
    const delta = countAdjustment(input.counted, batch.qtyOnHand);
    if (delta === 0) return;
    const item = await mbhrDb.pharmacy_items.get(batch.itemId);
    await mbhrDb.pharmacy_batches.update(batch.id, { qtyOnHand: batch.qtyOnHand + delta });
    if (item) {
      await mbhrDb.pharmacy_items.update(item.id, { onHandQty: item.onHandQty + delta, updatedAt: now });
    }
    if (batch.localOnly === 1) {
      outcome = { kind: "local" };
      return;
    }
    const movementId = ulid();
    await mbhrDb.stock_movements.add({
      id: movementId,
      itemId: batch.itemId,
      batchId: batch.id,
      qtyDelta: delta,
      reason: input.reason,
      status: "pending",
      commandId,
      actorId: actor!.id,
      occurredAt: now,
    });
    await enqueueCommand(rxCommandStore(), {
      id: commandId,
      rpc: "rx_adjust_stock",
      args: {
        p_movement_id: movementId,
        p_batch_id: batch.id,
        p_qty_delta: delta,
        p_reason: input.reason,
        p_note: input.note?.slice(0, 200) ?? null,
        p_occurred_at: now,
        p_requested_by: actor!.id,
      },
      authorId: actor!.id,
      entityRefs: [
        { table: "pharmacy_items", id: batch.itemId },
        { table: "pharmacy_batches", id: batch.id },
      ],
    });
    outcome = { kind: "queued", commandId, delta };
  });
  if (outcome.kind === "queued" && pharmacyServerReachable()) {
    void sendPharmacyCommands().catch(() => undefined);
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// Opening stock (one designated device per site)
// ---------------------------------------------------------------------------

export interface SiteClaim {
  siteKey: string;
  /** This device already uploaded the site's opening stock. */
  claimedHere: boolean;
  /** Another device did (when). */
  claimedElsewhereAt?: string;
}

/** Who uploaded this site's opening stock, if anyone (online only). */
export async function readSiteClaim(): Promise<SiteClaim | null> {
  if (!supabase || !pharmacyServerReachable()) return null;
  const siteKey = await currentSiteKey();
  const deviceId = await getDeviceId();
  const { data, error } = await supabase
    .from("pharmacy_site_onboarding")
    .select("device_id, claimed_at")
    .eq("site_key", siteKey)
    .maybeSingle();
  if (error) throw named("RemoteReadFailed");
  const row = data as { device_id?: string; claimed_at?: string } | null;
  if (!row) return { siteKey, claimedHere: false };
  return row.device_id === deviceId
    ? { siteKey, claimedHere: true }
    : { siteKey, claimedHere: false, claimedElsewhereAt: row.claimed_at };
}

export interface OnboardingSummary {
  medicines: number;
  lots: number;
  emptyLotsRemoved: number;
  prescriptions: number;
  history: number;
}

/**
 * Upload the stock kept only on this device as this site's opening stock.
 * Run on ONE device per site; other devices use discardLocalStock. Online
 * only. The server refuses opening stock from a second device.
 */
export async function uploadOpeningStock(actor: PharmacyActor | null | undefined): Promise<OnboardingSummary> {
  requirePermission(actor, (role) => can(role, "inventory"));
  if (!ledgerEnabled || !pharmacyServerReachable()) throw named("Offline");
  const sender = await currentCommandSender();
  if (!sender || sender.localUserId !== actor!.id) throw named("NoOnlineSignIn");
  const claim = await readSiteClaim();
  if (claim?.claimedElsewhereAt) throw named("ClaimedElsewhere");
  const siteKey = await currentSiteKey();
  const deviceId = await getDeviceId();
  const summary: OnboardingSummary = { medicines: 0, lots: 0, emptyLotsRemoved: 0, prescriptions: 0, history: 0 };
  // Commands are sent oldest first: medicines, then lots, then history.
  let clock = Date.now();
  const next = () => clock++;

  await mbhrDb.transaction("rw", rxTables(), async () => {
    const items = await mbhrDb.pharmacy_items.where("localOnly").equals(1).toArray();
    const allItems = await mbhrDb.pharmacy_items.toArray();
    for (const item of items) {
      const updated: PharmacyItem = { ...item, localOnly: 0, pendingRegister: 1, siteKey };
      await mbhrDb.pharmacy_items.put(updated);
      await enqueueRegisterItem(updated, actor!.id, next());
      summary.medicines += 1;
    }
    const batches = await mbhrDb.pharmacy_batches.where("localOnly").equals(1).toArray();
    for (const batch of batches) {
      if (!(batch.qtyOnHand > 0)) {
        await mbhrDb.pharmacy_batches.delete(batch.id);
        summary.emptyLotsRemoved += 1;
        continue;
      }
      const commandId = newCommandId();
      const movement: StockMovement = {
        id: ulid(),
        itemId: batch.itemId,
        batchId: batch.id,
        qtyDelta: batch.qtyOnHand,
        reason: "opening_balance",
        status: "pending",
        commandId,
        actorId: actor!.id,
        occurredAt: new Date().toISOString(),
      };
      await mbhrDb.pharmacy_batches.update(batch.id, { localOnly: 0, serverQtyOnHand: undefined });
      await mbhrDb.stock_movements.add(movement);
      await enqueueReceipt(batch, movement, "opening_balance", actor!.id, commandId, {
        p_site_key: siteKey,
        p_device_id: deviceId,
      }, next());
      summary.lots += 1;
    }
    const counts = await moveLocalPrescriptions(actor!.id, allItems, undefined, next);
    summary.prescriptions = counts.open;
    summary.history = counts.history;
  });
  await syncPharmacyNow();
  return summary;
}

/** Open local-only prescriptions upload normally; dispensed ones as history. */
async function moveLocalPrescriptions(
  authorId: string,
  items: Pick<PharmacyItem, "id" | "medName" | "strength">[],
  itemIdMap: Map<string, string> | undefined,
  next: () => number,
): Promise<{ open: number; history: number; unmatched: number }> {
  const out = { open: 0, history: 0, unmatched: 0 };
  const local = await mbhrDb.prescriptions.where("localOnly").equals(1).toArray();
  for (const rx of local) {
    if (rx.status === "open") {
      const remapped = itemIdMap ? remapLines(rx.lines, itemIdMap) : { lines: rx.lines, unmatched: 0 };
      out.unmatched += remapped.unmatched;
      await mbhrDb.prescriptions.update(rx.id, { lines: remapped.lines, localOnly: 0, _dirty: 1 });
      out.open += 1;
    } else if (rx.status === "dispensed" || rx.status === "partial") {
      const dispenses = await mbhrDb.dispenses.where("prescriptionId").equals(rx.id).toArray();
      await enqueueImportHistory(rx, rx, dispenses, items, authorId, itemIdMap, next());
      out.history += 1;
    }
  }
  return out;
}

/**
 * On every other device: drop the stock kept only here and use the
 * server's. Prescriptions are kept (open ones are matched to the server's
 * medicines by name, form and strength and uploaded; dispensed ones are
 * uploaded as history). Online only.
 */
export async function discardLocalStock(
  actor: PharmacyActor | null | undefined,
): Promise<{ medicines: number; lots: number; prescriptions: number; history: number; unmatchedLines: number }> {
  requirePermission(actor, (role) => can(role, "inventory"));
  if (!ledgerEnabled || !pharmacyServerReachable()) throw named("Offline");
  const sender = await currentCommandSender();
  if (!sender || sender.localUserId !== actor!.id) throw named("NoOnlineSignIn");
  // Download the server's stock first so medicines can be matched.
  const pulled = await syncPharmacyNow();
  if (!pulled.ran || pulled.failedTables.includes("pharmacy_items")) throw named("RemoteReadFailed");
  let clock = Date.now();
  const next = () => clock++;
  let result = { medicines: 0, lots: 0, prescriptions: 0, history: 0, unmatchedLines: 0 };
  await mbhrDb.transaction("rw", rxTables(), async () => {
    const all = await mbhrDb.pharmacy_items.toArray();
    const localItems = all.filter((i) => i.localOnly === 1);
    const serverItems = all.filter((i) => i.localOnly !== 1 && i.pendingRegister !== 1);
    const idMap = mapLocalItemsToServer(localItems, serverItems);
    const counts = await moveLocalPrescriptions(actor!.id, all, idMap, next);
    const lots = await mbhrDb.pharmacy_batches.where("localOnly").equals(1).toArray();
    await mbhrDb.pharmacy_batches.bulkDelete(lots.map((b) => b.id));
    await mbhrDb.pharmacy_items.bulkDelete(localItems.map((i) => i.id));
    result = {
      medicines: localItems.length,
      lots: lots.length,
      prescriptions: counts.open,
      history: counts.history,
      unmatchedLines: counts.unmatched,
    };
  });
  await syncPharmacyNow();
  return result;
}

/** Mark a stock discrepancy as reconciled (after a physical count). Online only. */
export async function resolveDiscrepancy(id: string, actor: PharmacyActor | null | undefined): Promise<void> {
  requirePermission(actor, (role) => can(role, "inventory"));
  if (!supabase || !pharmacyServerReachable()) throw named("Offline");
  const { data, error } = await supabase.rpc("rx_resolve_discrepancy", { p_id: id });
  if (error) throw named(error.code === "42501" ? "NotAllowed" : "RemoteWriteFailed");
  const outcome = (data as { outcome?: string } | null)?.outcome;
  if (outcome === "rejected") throw named("RemoteRejected");
  await mbhrDb.stock_discrepancies.update(id, { status: "resolved" });
}
