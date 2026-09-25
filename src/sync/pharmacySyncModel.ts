// Pure rules for the pharmacy ledger sync (no Dexie, no network), so they
// can be tested on their own. The Dexie and Supabase side is in
// pharmacySync.ts; the commands a screen queues are in
// src/services/pharmacyCommands.ts.
import type {
  Dispense,
  PharmacyBatch,
  PharmacyItem,
  Prescription,
  PrescriptionStatus,
  StockDiscrepancy,
  StockMovement,
  StockMovementReason,
} from "@/db/mbhr";
import { pendingDeltaByBatch, pendingDeltaByItem, shownQty, type MovementLike } from "./stockOverlay";

type Raw = Record<string, unknown>;

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined;
const num = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);

// ---------------------------------------------------------------------------
// Server rows -> this device
// ---------------------------------------------------------------------------

/** A downloaded medicine. Quantities are recomputed afterwards (recomputeShown). */
export function itemFromServer(raw: Raw, local?: PharmacyItem): PharmacyItem | null {
  const id = str(raw.id);
  if (!id) return null;
  const serverQty = num(raw.on_hand_qty) ?? 0;
  return {
    ...(local ?? {}),
    id,
    medName: str(raw.med_name) ?? local?.medName ?? "",
    form: str(raw.form) ?? local?.form ?? "",
    strength: str(raw.strength) ?? local?.strength ?? "",
    unit: str(raw.unit) ?? local?.unit ?? "",
    reorderThreshold: num(raw.reorder_threshold) ?? local?.reorderThreshold ?? 0,
    isControlled: bool(raw.is_controlled) ?? local?.isControlled ?? false,
    isActive: bool(raw.is_active) ?? true,
    siteKey: str(raw.site_key) ?? local?.siteKey,
    updatedAt: str(raw.updated_at) ?? local?.updatedAt ?? new Date(0).toISOString(),
    serverQtyOnHand: serverQty,
    rowVersion: num(raw.row_version),
    onHandQty: local?.onHandQty ?? serverQty,
    localOnly: 0,
    pendingRegister: 0,
    registerRejected: undefined,
  };
}

export function batchFromServer(raw: Raw, local?: PharmacyBatch): PharmacyBatch | null {
  const id = str(raw.id);
  const itemId = str(raw.item_id);
  if (!id || !itemId) return null;
  const serverQty = num(raw.qty_on_hand) ?? 0;
  return {
    ...(local ?? {}),
    id,
    itemId,
    lotNumber: str(raw.lot_number) ?? local?.lotNumber ?? "",
    expiryDate: str(raw.expiry_date) ?? local?.expiryDate ?? "",
    receivedAt: str(raw.received_at) ?? local?.receivedAt ?? "",
    supplier: str(raw.supplier) ?? local?.supplier,
    serverQtyOnHand: serverQty,
    rowVersion: num(raw.row_version),
    qtyOnHand: local?.qtyOnHand ?? serverQty,
    localOnly: 0,
  };
}

const RX_STATUSES: PrescriptionStatus[] = ["open", "dispensed", "partial", "void"];

/**
 * A downloaded prescription merged with this device's copy. While this
 * device has a dispense or void waiting for the server, its own status is
 * kept (the command's answer settles it).
 */
export function prescriptionFromServer(
  raw: Raw,
  local: Prescription | undefined,
  syncedAt: string,
): Prescription | null {
  const id = str(raw.id);
  if (!id) return null;
  const serverStatus = str(raw.status) as PrescriptionStatus | undefined;
  const fromServer: PrescriptionStatus =
    serverStatus && RX_STATUSES.includes(serverStatus) ? serverStatus : (local?.status ?? "open");
  const status: PrescriptionStatus = local?.pendingCommandId
    ? local.status
    : // Handed over but refused by the server: never reopen it for a
      // second dispense.
      local?.handoverRefused === 1 && fromServer === "open"
      ? local.status
      : fromServer;
  const lines = Array.isArray(raw.lines) ? (raw.lines as Prescription["lines"]) : (local?.lines ?? []);
  return {
    ...(local ?? {}),
    id,
    visitId: str(raw.visit_id) ?? local?.visitId ?? "",
    patientId: str(raw.patient_id) ?? local?.patientId ?? "",
    prescriberId: str(raw.prescriber_id) ?? local?.prescriberId ?? "",
    createdAt: str(raw.created_at) ?? local?.createdAt ?? syncedAt,
    lines,
    status,
    dispensedAt: local?.pendingCommandId ? local.dispensedAt : (str(raw.dispensed_at) ?? undefined),
    rowVersion: num(raw.row_version),
    _dirty: 0,
    _syncedAt: syncedAt,
    localOnly: 0,
  };
}

/**
 * What to do when the server refuses a dispense.
 * - undo: the pharmacist was told not to hand it over; put stock back and
 *   reopen the prescription.
 * - resend_offline: the medicine was handed over and the server only lacked
 *   stock; send it again as handed over (a new command, since a refusal is
 *   stored per command), so the server records it with a discrepancy.
 * - keep_handed_over: the medicine was handed over and the server refused
 *   for another reason; keep the dispense on this device for reconciliation.
 */
export type RefusedDispenseAction = "undo" | "resend_offline" | "keep_handed_over";

export function refusedDispenseAction(reason: string, handedOver: boolean): RefusedDispenseAction {
  if (!handedOver) return "undo";
  return reason === "insufficient_stock" ? "resend_offline" : "keep_handed_over";
}

/** Prescription status after a refused dispense whose medicine was handed over. */
export function handedOverRefusalStatus(reason: string): PrescriptionStatus {
  return reason === "prescription_void" ? "void" : "dispensed";
}

export function dispenseFromServer(raw: Raw): Dispense | null {
  const id = str(raw.id);
  const prescriptionId = str(raw.prescription_id);
  if (!id || !prescriptionId) return null;
  return {
    id,
    prescriptionId,
    patientId: str(raw.patient_id) ?? "",
    itemId: str(raw.item_id) ?? "",
    batchId: str(raw.batch_id) ?? "",
    qty: num(raw.qty) ?? 0,
    dispensedBy: str(raw.dispensed_by) ?? "",
    dispensedAt: str(raw.dispensed_at) ?? "",
    pending: 0,
    localOnly: 0,
  };
}

const REASONS: StockMovementReason[] = [
  "receipt",
  "dispense",
  "adjust",
  "expire",
  "reversal",
  "opening_balance",
];

export function movementFromServer(raw: Raw): StockMovement | null {
  const id = str(raw.id);
  const itemId = str(raw.item_id);
  const qtyDelta = num(raw.qty_delta);
  const reason = str(raw.reason) as StockMovementReason | undefined;
  if (!id || !itemId || qtyDelta === undefined || !reason || !REASONS.includes(reason)) return null;
  return {
    id,
    itemId,
    batchId: str(raw.batch_id),
    qtyDelta,
    reason,
    status: "confirmed",
    prescriptionId: str(raw.prescription_id),
    dispenseId: str(raw.dispense_id),
    actorId: str(raw.requested_by),
    occurredAt: str(raw.occurred_at) ?? "",
    recordedAt: str(raw.recorded_at),
  };
}

export function discrepancyFromServer(raw: Raw): StockDiscrepancy | null {
  const id = str(raw.id);
  const itemId = str(raw.item_id);
  if (!id || !itemId) return null;
  return {
    id,
    itemId,
    batchId: str(raw.batch_id),
    qtyUncovered: num(raw.qty_uncovered) ?? 0,
    prescriptionId: str(raw.prescription_id),
    dispenseId: str(raw.dispense_id),
    status: str(raw.status) === "resolved" ? "resolved" : "open",
    createdAt: str(raw.created_at) ?? "",
    updatedAt: str(raw.updated_at),
  };
}

// ---------------------------------------------------------------------------
// Shown quantities
// ---------------------------------------------------------------------------

export interface QtyChange {
  id: string;
  qty: number;
}

/**
 * Quantities to show after a download or a server answer: the server
 * balance plus this device's pending movements. Stock kept only on this
 * device (localOnly) is left as counted. Returns only rows that change.
 */
export function recomputeShown(
  items: Pick<PharmacyItem, "id" | "onHandQty" | "serverQtyOnHand" | "localOnly">[],
  batches: Pick<PharmacyBatch, "id" | "qtyOnHand" | "serverQtyOnHand" | "localOnly">[],
  movements: MovementLike[],
): { items: QtyChange[]; batches: QtyChange[] } {
  const byBatch = pendingDeltaByBatch(movements);
  const byItem = pendingDeltaByItem(movements);
  const itemChanges: QtyChange[] = [];
  const batchChanges: QtyChange[] = [];
  for (const b of batches) {
    if (b.localOnly === 1) continue;
    const qty = shownQty(b.serverQtyOnHand, byBatch.get(b.id));
    if (qty !== b.qtyOnHand) batchChanges.push({ id: b.id, qty });
  }
  for (const i of items) {
    if (i.localOnly === 1) continue;
    const qty = shownQty(i.serverQtyOnHand, byItem.get(i.id));
    if (qty !== i.onHandQty) itemChanges.push({ id: i.id, qty });
  }
  return { items: itemChanges, batches: batchChanges };
}

// ---------------------------------------------------------------------------
// Uploads and command arguments
// ---------------------------------------------------------------------------

/**
 * A prescription as uploaded (insert-if-absent). Status is always "open":
 * only the server's dispense and void commands change it.
 */
export function prescriptionUploadRow(rx: Prescription): Record<string, unknown> {
  return {
    id: rx.id,
    visit_id: rx.visitId ?? "",
    patient_id: rx.patientId,
    prescriber_id: rx.prescriberId,
    lines: rx.lines,
    created_at: rx.createdAt,
    status: "open",
  };
}

/** May this prescription be uploaded as a new, open prescription? */
export function shouldUploadPrescription(rx: Prescription): boolean {
  return rx._dirty === 1 && rx.localOnly !== 1 && rx.status === "open";
}

export interface DispenseAllocationInput {
  dispenseId: string;
  batchId: string;
  qty: number;
}

export interface DispenseLineInput {
  itemId: string;
  qty: number;
  allocations: DispenseAllocationInput[];
}

/** rx_dispense p_lines: [{item_id, qty, dispense_ids, hint:[{batch_id, qty}]}]. */
export function dispenseLinesArg(lines: DispenseLineInput[]): Record<string, unknown>[] {
  return lines.map((line) => ({
    item_id: line.itemId,
    qty: line.qty,
    dispense_ids: line.allocations.map((a) => a.dispenseId),
    hint: line.allocations.map((a) => ({ batch_id: a.batchId, qty: a.qty })),
  }));
}

// ---------------------------------------------------------------------------
// Server answers
// ---------------------------------------------------------------------------

export interface ServerBalance {
  id: string;
  qty: number;
  rowVersion?: number;
}

export interface DispenseResult {
  status?: PrescriptionStatus;
  dispensedAt?: string;
  allocations: { dispenseId: string; itemId: string; batchId: string; qty: number }[];
  items: ServerBalance[];
  batches: ServerBalance[];
  /** Units handed over offline that the server's stock could not cover. */
  uncovered: { itemId: string; qty: number }[];
}

/**
 * Is a balance in a command answer older than the one this device already
 * holds? A resent command returns its stored answer, which can predate a
 * newer download; applying it would show an old balance. Unknown versions
 * are applied (nothing to compare).
 */
export function isStaleBalance(localVersion: number | undefined, incomingVersion: number | undefined): boolean {
  return (
    typeof localVersion === "number" &&
    typeof incomingVersion === "number" &&
    incomingVersion < localVersion
  );
}

function arr(v: unknown): Raw[] {
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Raw[]) : [];
}

/** Balances in any command result: {items:[{id,on_hand_qty}], batches:[{id,qty_on_hand}]}. */
export function parseBalances(result: unknown): { items: ServerBalance[]; batches: ServerBalance[] } {
  const r = (result && typeof result === "object" ? result : {}) as Raw;
  const items = arr(r.items)
    .map((x) => ({ id: str(x.id) ?? "", qty: num(x.on_hand_qty) ?? NaN, rowVersion: num(x.row_version) }))
    .filter((x) => x.id && Number.isFinite(x.qty));
  const batches = arr(r.batches)
    .map((x) => ({ id: str(x.id) ?? "", qty: num(x.qty_on_hand) ?? NaN, rowVersion: num(x.row_version) }))
    .filter((x) => x.id && Number.isFinite(x.qty));
  return { items, batches };
}

export function parseDispenseResult(result: unknown): DispenseResult {
  const r = (result && typeof result === "object" ? result : {}) as Raw;
  const status = str(r.status) as PrescriptionStatus | undefined;
  const allocations = arr(r.allocations)
    .map((a) => ({
      dispenseId: str(a.dispense_id) ?? "",
      itemId: str(a.item_id) ?? "",
      batchId: str(a.batch_id) ?? "",
      qty: num(a.qty) ?? 0,
    }))
    .filter((a) => a.dispenseId && a.itemId && a.qty > 0);
  const uncovered = arr(r.uncovered)
    .map((u) => ({ itemId: str(u.item_id) ?? "", qty: num(u.qty) ?? 0 }))
    .filter((u) => u.itemId && u.qty > 0);
  return {
    status: status && RX_STATUSES.includes(status) ? status : undefined,
    dispensedAt: str(r.dispensed_at),
    allocations,
    ...parseBalances(result),
    uncovered,
  };
}

/** Per-line availability in an insufficient_stock rejection. */
export function parseShortLines(result: unknown): { itemId: string; requested: number; available: number }[] {
  const r = (result && typeof result === "object" ? result : {}) as Raw;
  return arr(r.lines)
    .map((l) => ({
      itemId: str(l.item_id) ?? "",
      requested: num(l.requested) ?? 0,
      available: num(l.available) ?? 0,
    }))
    .filter((l) => l.itemId);
}

/** Plain-English explanation of a refused pharmacy command, for staff. */
export function rejectReasonText(reason: string | undefined): string {
  switch (reason) {
    case "insufficient_stock":
      return "The server does not have enough in-date stock for this. Another device may have used it.";
    case "already_dispensed":
      return "This prescription was already dispensed on another device.";
    case "prescription_void":
      return "This prescription was cancelled.";
    case "prescription_not_open":
      return "This prescription is no longer open.";
    case "prescription_not_found":
      return "The server has no record of this prescription yet.";
    case "lines_mismatch":
      return "The medicines or quantities sent do not match the prescription on the server.";
    case "unknown_item":
    case "item_not_found":
      return "The medicine is not on the server's stock list.";
    case "batch_not_found":
      return "That lot is not on the server's stock list.";
    case "batch_item_mismatch":
      return "That lot belongs to a different medicine on the server.";
    case "opening_stock_already_uploaded":
      return "Opening stock for this site was already uploaded from another device.";
    case "invalid_quantity":
      return "The quantity was not valid.";
    case "permission_denied":
      return "Your account is not allowed to make this change.";
    case "invalid_request":
      return "The server could not accept this change.";
    default:
      return "The server refused this change.";
  }
}

// ---------------------------------------------------------------------------
// Opening stock and discard
// ---------------------------------------------------------------------------

/** Medicine identity used to match stock between devices (name, form, strength). */
export function itemIdentityKey(item: Pick<PharmacyItem, "medName" | "form" | "strength">): string {
  const norm = (v: string | undefined) => (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return `${norm(item.medName)}|${norm(item.form)}|${norm(item.strength)}`;
}

/** Prescription lines with medicine ids replaced (ids not in the map are kept). */
export function remapLines(
  lines: Prescription["lines"],
  idMap: Map<string, string>,
): { lines: Prescription["lines"]; changed: boolean; unmatched: number } {
  let changed = false;
  let unmatched = 0;
  const out = lines.map((line) => {
    const next = idMap.get(line.itemId);
    if (next === undefined) {
      unmatched += 1;
      return line;
    }
    if (next !== line.itemId) changed = true;
    return { ...line, itemId: next };
  });
  return { lines: out, changed, unmatched };
}

/**
 * For "use the server's stock": map each medicine kept only on this device
 * to the server medicine with the same name, form and strength.
 */
export function mapLocalItemsToServer(
  localItems: Pick<PharmacyItem, "id" | "medName" | "form" | "strength">[],
  serverItems: Pick<PharmacyItem, "id" | "medName" | "form" | "strength">[],
): Map<string, string> {
  const byKey = new Map<string, string>();
  for (const s of [...serverItems].sort((a, b) => a.id.localeCompare(b.id))) {
    const key = itemIdentityKey(s);
    if (!byKey.has(key)) byKey.set(key, s.id);
  }
  const map = new Map<string, string>();
  for (const s of serverItems) map.set(s.id, s.id);
  for (const l of localItems) {
    const match = byKey.get(itemIdentityKey(l));
    if (match) map.set(l.id, match);
  }
  return map;
}

/** Site key for pharmacy stock (same slug rule as queue tickets). */
export function pharmacySiteKey(name: string | null | undefined, fallback: string): string {
  const slug = (value: string) =>
    value
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
  return slug(name ?? "") || slug(fallback) || "site";
}
