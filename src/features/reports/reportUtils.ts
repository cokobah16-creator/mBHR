// Pure helpers shared by the staff reports and dashboards. No React, no
// Dexie: everything here is unit-tested in reportUtils.test.ts.
//
// Timestamps in the local database are not uniform: records created on this
// device store Date objects, while records downloaded by sync keep the ISO
// strings Supabase returned. Every helper therefore accepts either.

export type TimestampLike = Date | string | number | null | undefined;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Milliseconds since epoch, or null when the value is missing or invalid. */
export function toTime(value: TimestampLike): number | null {
  if (value === null || value === undefined || value === "") return null;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/** True when `value` falls in [start, end): start inclusive, end exclusive. */
export function isInRange(value: TimestampLike, start: Date, end: Date): boolean {
  const t = toTime(value);
  if (t === null) return false;
  return t >= start.getTime() && t < end.getTime();
}

/** Local midnight at the start of the given day. */
export function startOfLocalDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

/** Adds whole calendar days in local time (safe across DST changes). */
export function addLocalDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * "yyyy-mm-dd" for the local calendar day. Used for <input type="date">
 * values, day buckets and file names. (toISOString() would give the UTC day,
 * which is yesterday between midnight and 01:00 in Nigeria.)
 */
export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parses "yyyy-mm-dd" as local midnight. Returns null for anything else. */
export function parseLocalDateKey(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const out = new Date(y, mo - 1, d);
  if (out.getFullYear() !== y || out.getMonth() !== mo - 1 || out.getDate() !== d) {
    return null;
  }
  return out;
}

/**
 * Inclusive local date range ("from" and "to" days) → [start, end) bounds.
 * Returns null when either date is invalid or "from" is after "to".
 */
export function localRangeBounds(
  fromKey: string,
  toKey: string,
): { start: Date; end: Date } | null {
  const from = parseLocalDateKey(fromKey);
  const to = parseLocalDateKey(toKey);
  if (!from || !to || from.getTime() > to.getTime()) return null;
  return { start: from, end: addLocalDays(to, 1) };
}

/** Every local day in [start, end), as Date objects at local midnight. */
export function listLocalDays(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  let d = startOfLocalDay(start);
  // Guard against runaway loops if someone picks a range decades long.
  for (let i = 0; d.getTime() < end.getTime() && i < 3660; i++) {
    days.push(d);
    d = addLocalDays(d, 1);
  }
  return days;
}

/**
 * Counts values per local day key. Values outside [start, end) and invalid
 * timestamps are ignored. Every day in the range is present, even with 0.
 */
export function countByLocalDay(
  values: TimestampLike[],
  start: Date,
  end: Date,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const day of listLocalDays(start, end)) counts.set(localDateKey(day), 0);
  for (const v of values) {
    const t = toTime(v);
    if (t === null || t < start.getTime() || t >= end.getTime()) continue;
    const key = localDateKey(new Date(t));
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Whole days from `now` until `date`, rounded up (negative once past). */
export function daysUntil(date: TimestampLike, now: Date = new Date()): number | null {
  const t = toTime(date);
  if (t === null) return null;
  return Math.ceil((t - now.getTime()) / DAY_MS);
}

/**
 * Average of (end − start) in whole minutes, over pairs where both times are
 * present and end is not before start. Null when there is nothing to average
 * (so the UI can say "No data" instead of showing 0).
 */
export function averageMinutes(
  pairs: Array<{ start: TimestampLike; end: TimestampLike }>,
): { minutes: number; count: number } | null {
  let total = 0;
  let count = 0;
  for (const p of pairs) {
    const s = toTime(p.start);
    const e = toTime(p.end);
    if (s === null || e === null || e < s) continue;
    total += e - s;
    count += 1;
  }
  if (count === 0) return null;
  return { minutes: Math.round(total / count / 60000), count };
}

/** Whole-number percentage, 0 when total is 0. */
export function percentOf(value: number, total: number): number {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

/** Change against a previous figure in plain words, e.g. "3 more than yesterday". */
export function describeChange(current: number, previous: number, label: string): string {
  const diff = current - previous;
  if (diff === 0) return `Same as ${label}`;
  return diff > 0 ? `${diff} more than ${label}` : `${-diff} fewer than ${label}`;
}

// ---------- CSV ----------

export type CsvCell = string | number | boolean | Date | null | undefined;

// A cell starting with one of these is treated as a formula by spreadsheet
// apps. Plain numbers (including negatives) are left alone.
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

function csvCell(value: CsvCell): string {
  let s: string;
  if (value === null || value === undefined) s = "";
  else if (value instanceof Date) s = Number.isFinite(value.getTime()) ? localDateKey(value) : "";
  else s = String(value);
  if (typeof value === "string" && FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) {
    s = `'${s}`;
  }
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 CSV text with a header row. Dates are written as local yyyy-mm-dd. */
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

/** "name_2026-09-23.csv" using the local date. */
export function csvFileName(base: string, now: Date = new Date()): string {
  return `${base}_${localDateKey(now)}.csv`;
}
