// Pure derivations for the pharmacy report. Thresholds here are the ones the
// report already used (reorder level, 7/30/90-day expiry windows); only the
// wording and tones are defined in this file.
import type { Tone } from "@/components/ui/StatusBadge";
import { toTime, type TimestampLike } from "./reportUtils";

const DAY_MS = 24 * 60 * 60 * 1000;

export type PharmacyPeriod = "7d" | "30d" | "90d" | "all";

export const PERIOD_LABELS: Record<PharmacyPeriod, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All records",
};

export function isPharmacyPeriod(value: string): value is PharmacyPeriod {
  return value === "7d" || value === "30d" || value === "90d" || value === "all";
}

const PERIOD_DAYS: Record<Exclude<PharmacyPeriod, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

interface DispenseLike {
  patientId: string;
  itemName: string;
  qty: number;
  dispensedAt: TimestampLike;
}

/** Records dispensed within the rolling period ending now. */
export function filterByPeriod<T extends DispenseLike>(
  records: T[],
  period: PharmacyPeriod,
  now: Date = new Date(),
): T[] {
  if (period === "all") return records;
  const cutoff = now.getTime() - PERIOD_DAYS[period] * DAY_MS;
  return records.filter((d) => {
    const t = toTime(d.dispensedAt);
    return t !== null && t >= cutoff;
  });
}

export interface DispensingSummary {
  unitsDispensed: number;
  records: number;
  uniquePatients: number;
  /** Dispensing records per day over the period, one decimal place. */
  recordsPerDay: number;
  /** Number of days the per-day figure is averaged over. */
  days: number;
  topMedicines: { name: string; units: number }[];
}

export function summariseDispensing(
  inPeriod: DispenseLike[],
  allRecords: DispenseLike[],
  period: PharmacyPeriod,
  now: Date = new Date(),
): DispensingSummary {
  const units = new Map<string, number>();
  for (const d of inPeriod) {
    units.set(d.itemName, (units.get(d.itemName) ?? 0) + (d.qty || 0));
  }
  const topMedicines = [...units.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, u]) => ({ name, units: u }));

  let days: number;
  if (period === "all") {
    const times = allRecords
      .map((d) => toTime(d.dispensedAt))
      .filter((t): t is number => t !== null);
    const earliest = times.length ? Math.min(...times) : now.getTime();
    days = Math.max(1, Math.ceil((now.getTime() - earliest) / DAY_MS));
  } else {
    days = PERIOD_DAYS[period];
  }

  return {
    unitsDispensed: inPeriod.reduce((sum, d) => sum + (d.qty || 0), 0),
    records: inPeriod.length,
    uniquePatients: new Set(inPeriod.map((d) => d.patientId)).size,
    recordsPerDay: Math.round((inPeriod.length / days) * 10) / 10,
    days,
    topMedicines,
  };
}

// ---------- Stock ----------

export type StockLevel = "out" | "low" | "ok";

export function stockLevel(item: { onHandQty: number; reorderThreshold: number }): StockLevel {
  if (item.onHandQty <= 0) return "out";
  if (item.onHandQty <= item.reorderThreshold) return "low";
  return "ok";
}

export const STOCK_LEVEL_META: Record<StockLevel, { label: string; tone: Tone }> = {
  out: { label: "Out of stock", tone: "danger" },
  low: { label: "Low stock", tone: "warning" },
  ok: { label: "In stock", tone: "success" },
};

/** Stock on hand as a percentage of the reorder level; null when none is set. */
export function stockCoverPercent(item: { onHandQty: number; reorderThreshold: number }): number | null {
  if (!item.reorderThreshold || item.reorderThreshold <= 0) return null;
  return Math.round((item.onHandQty / item.reorderThreshold) * 100);
}

/** Lowest cover first; items with no reorder level go last, then by name. */
export function sortByStockCover<T extends { itemName: string; onHandQty: number; reorderThreshold: number }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => {
    const ca = stockCoverPercent(a);
    const cb = stockCoverPercent(b);
    if (ca === null && cb !== null) return 1;
    if (cb === null && ca !== null) return -1;
    if (ca !== null && cb !== null && ca !== cb) return ca - cb;
    return a.itemName.localeCompare(b.itemName);
  });
}

// ---------- Expiry ----------

/** Batches are listed once they are within this many days of expiry. */
export const EXPIRY_WINDOW_DAYS = 90;

export type ExpiryLevel = "expired" | "week" | "month" | "quarter";

export function expiryLevel(daysUntilExpiry: number): ExpiryLevel {
  if (daysUntilExpiry <= 0) return "expired";
  if (daysUntilExpiry <= 7) return "week";
  if (daysUntilExpiry <= 30) return "month";
  return "quarter";
}

export const EXPIRY_LEVEL_META: Record<ExpiryLevel, { label: string; tone: Tone }> = {
  expired: { label: "Expired", tone: "danger" },
  week: { label: "Expires within 7 days", tone: "danger" },
  month: { label: "Expires within 30 days", tone: "warning" },
  quarter: { label: "Expires within 90 days", tone: "neutral" },
};

export function describeDaysLeft(daysUntilExpiry: number): string {
  if (daysUntilExpiry <= 0) return "Expired";
  return daysUntilExpiry === 1 ? "1 day" : `${daysUntilExpiry} days`;
}
