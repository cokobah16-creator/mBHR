// Pure rules behind the pharmacy commands (src/services/pharmacyCommands.ts):
// which ledger a dispense uses, the optimistic rows it writes and the
// checks run before anything is saved. No Dexie, no network.
import type { Dispense, PharmacyItem, Prescription, StockMovement } from "@/db/mbhr";
import type { LotAllocation } from "@/features/pharmacy/fefo";
import type { DispenseLineInput } from "@/sync/pharmacySyncModel";

/**
 * ledger: every medicine is on the server's stock list (queued command).
 * local:  every medicine is stock kept only on this device (changed here).
 * mixed:  both kinds; cannot be dispensed until the opening stock is uploaded.
 * missing: a medicine is not in this device's stock list at all.
 */
export type DispenseMode = "ledger" | "local" | "mixed" | "missing";

export function dispenseMode(
  lines: Prescription["lines"],
  items: Pick<PharmacyItem, "id" | "localOnly">[],
): DispenseMode {
  if (lines.length === 0) return "missing";
  let local = 0;
  let ledger = 0;
  for (const line of lines) {
    const item = items.find((i) => i.id === line.itemId);
    if (!item) return "missing";
    if (item.localOnly === 1) local += 1;
    else ledger += 1;
  }
  if (local > 0 && ledger > 0) return "mixed";
  return local > 0 ? "local" : "ledger";
}

/**
 * Whether a prescription, as re-read inside the write transaction, may still
 * be dispensed or cancelled: it is open and no command for it is waiting.
 * Another tab or window may have dispensed it since this page loaded.
 */
export function prescriptionStillOpen(
  rx: Pick<Prescription, "status" | "pendingCommandId"> | undefined,
): boolean {
  return !!rx && rx.status === "open" && !rx.pendingCommandId;
}

export interface DispensePlanLine {
  itemId: string;
  qty: number;
  allocations: LotAllocation[];
}

export interface OptimisticDispense {
  lines: DispenseLineInput[];
  dispenses: Dispense[];
  movements: StockMovement[];
  /** Units taken per lot. */
  byBatch: Map<string, number>;
  /** Units taken per medicine. */
  byItem: Map<string, number>;
}

/** The ledger id of the movement for one dispense row (same on server and device). */
export function dispenseMovementId(dispenseId: string): string {
  return `m:${dispenseId}`;
}

/**
 * The rows a dispense writes on this device straight away: one dispense and
 * one pending movement per lot used. The same ids go to the server, which
 * keeps them where its allocation matches.
 */
export function buildOptimisticDispense(input: {
  prescription: Pick<Prescription, "id" | "patientId">;
  plan: DispensePlanLine[];
  commandId: string;
  actorId: string;
  at: string;
  newId: () => string;
  localOnly: boolean;
}): OptimisticDispense {
  const { prescription, plan, commandId, actorId, at, newId, localOnly } = input;
  const lines: DispenseLineInput[] = [];
  const dispenses: Dispense[] = [];
  const movements: StockMovement[] = [];
  const byBatch = new Map<string, number>();
  const byItem = new Map<string, number>();
  for (const line of plan) {
    const allocations = line.allocations.filter((a) => a.qty > 0);
    const inputLine: DispenseLineInput = { itemId: line.itemId, qty: line.qty, allocations: [] };
    for (const a of allocations) {
      const dispenseId = newId();
      inputLine.allocations.push({ dispenseId, batchId: a.batchId, qty: a.qty });
      dispenses.push({
        id: dispenseId,
        prescriptionId: prescription.id,
        patientId: prescription.patientId,
        itemId: line.itemId,
        batchId: a.batchId,
        qty: a.qty,
        dispensedBy: actorId,
        dispensedAt: at,
        ...(localOnly ? { localOnly: 1 as const } : { commandId, pending: 1 as const }),
      });
      if (!localOnly) {
        movements.push({
          // Same id as the server's movement for this dispense line, so a
          // download that arrives before the answer replaces it, not adds.
          id: dispenseMovementId(dispenseId),
          itemId: line.itemId,
          batchId: a.batchId,
          qtyDelta: -a.qty,
          reason: "dispense",
          status: "pending",
          commandId,
          prescriptionId: prescription.id,
          dispenseId,
          actorId,
          occurredAt: at,
        });
      }
      byBatch.set(a.batchId, (byBatch.get(a.batchId) ?? 0) + a.qty);
      byItem.set(line.itemId, (byItem.get(line.itemId) ?? 0) + a.qty);
    }
    lines.push(inputLine);
  }
  return { lines, dispenses, movements, byBatch, byItem };
}

/** Every line is fully covered by the lots chosen (no partial dispensing). */
export function planCoversAllLines(plan: DispensePlanLine[]): boolean {
  return (
    plan.length > 0 &&
    plan.every(
      (line) =>
        line.qty > 0 && line.allocations.reduce((sum, a) => sum + Math.max(0, a.qty), 0) === line.qty,
    )
  );
}

/** Movement for a counted lot: counted minus shown. 0 means nothing to record. */
export function countAdjustment(counted: number, shown: number): number {
  if (!Number.isFinite(counted) || !Number.isFinite(shown)) return 0;
  return Math.floor(counted) - Math.floor(shown);
}

export interface ReceiveInput {
  lotNumber: string;
  qty: number;
  expiryDate: string;
}

/** A problem with a lot being received, or null. */
export function receiveProblem(input: ReceiveInput): string | null {
  if (!input.lotNumber.trim() || !input.expiryDate || !(input.qty > 0)) {
    return "Enter the lot number, a quantity of at least 1 and the expiry date.";
  }
  if (!Number.isInteger(input.qty)) return "Enter a whole number of units.";
  if (Number.isNaN(new Date(input.expiryDate).getTime())) return "Enter a valid expiry date.";
  return null;
}
