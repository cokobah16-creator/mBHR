// Ledger overlay: what a device shows while pharmacy commands are pending.
//
// The server owns every balance. A change made on this device is recorded
// as a pending movement until the server answers, so the quantity shown is
// the last server balance plus the pending movements. A pending dispense
// lowers it straight away; a refused one disappears and the quantity goes
// back up.
//
// Kept in src/sync (not src/features/pharmacy, a separate build chunk) so
// the pharmacy sync participant can be loaded at app start. Re-exported
// from src/features/pharmacy/fefo.ts.

export interface MovementLike {
  itemId: string;
  batchId?: string;
  qtyDelta: number;
  status: "pending" | "confirmed";
}

/** Sum of pending movements per lot. Confirmed movements are already in the server balance. */
export function pendingDeltaByBatch(movements: MovementLike[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of movements) {
    if (m.status !== "pending" || !m.batchId) continue;
    if (!Number.isFinite(m.qtyDelta)) continue;
    out.set(m.batchId, (out.get(m.batchId) ?? 0) + m.qtyDelta);
  }
  return out;
}

/** Sum of pending movements per medicine (all lots). */
export function pendingDeltaByItem(movements: MovementLike[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of movements) {
    if (m.status !== "pending") continue;
    if (!Number.isFinite(m.qtyDelta)) continue;
    out.set(m.itemId, (out.get(m.itemId) ?? 0) + m.qtyDelta);
  }
  return out;
}

/**
 * Quantity to show: the server balance plus pending changes. Not clamped:
 * a negative result means this device has used more than the server holds
 * (another device dispensed the same stock) and the count needs checking.
 */
export function shownQty(serverQty: number | undefined, pendingDelta: number | undefined): number {
  const base = typeof serverQty === "number" && Number.isFinite(serverQty) ? serverQty : 0;
  const delta = typeof pendingDelta === "number" && Number.isFinite(pendingDelta) ? pendingDelta : 0;
  return base + delta;
}
