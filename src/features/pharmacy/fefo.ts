// First-Expired-First-Out allocation across stock lots.
//
// Expired lots are never allocated — they are returned separately so the
// pharmacist can see and quarantine them. When one lot cannot cover the
// quantity, the next-expiring lots are used; any remainder is reported as
// a shortfall rather than silently dispensing less.

export interface LotLike {
  id: string;
  itemId: string;
  lotNumber: string;
  /** ISO date (YYYY-MM-DD or full ISO string). */
  expiryDate: string;
  qtyOnHand: number;
}

export interface LotAllocation {
  batchId: string;
  lotNumber: string;
  expiryDate: string;
  qty: number;
}

export interface FefoResult {
  allocations: LotAllocation[];
  /** Units that could not be covered by in-date stock. */
  shortfall: number;
  /** Expired lots that still hold stock for this item. */
  expired: LotLike[];
  /** In-date lots in the order they would be used. */
  usable: LotLike[];
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function isExpired(expiryDate: string, now: Date = new Date()): boolean {
  const exp = new Date(expiryDate);
  if (Number.isNaN(exp.getTime())) return true;
  return startOfDay(exp) < startOfDay(now);
}

export function allocateFEFO(
  lots: LotLike[],
  itemId: string,
  qty: number,
  now: Date = new Date(),
): FefoResult {
  const forItem = lots.filter((l) => l.itemId === itemId && l.qtyOnHand > 0);
  const expired = forItem.filter((l) => isExpired(l.expiryDate, now));
  const usable = forItem
    .filter((l) => !isExpired(l.expiryDate, now))
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));

  const allocations: LotAllocation[] = [];
  let remaining = Math.max(0, Math.floor(qty));
  for (const lot of usable) {
    if (remaining === 0) break;
    const take = Math.min(lot.qtyOnHand, remaining);
    allocations.push({
      batchId: lot.id,
      lotNumber: lot.lotNumber,
      expiryDate: lot.expiryDate,
      qty: take,
    });
    remaining -= take;
  }

  return { allocations, shortfall: remaining, expired, usable };
}
