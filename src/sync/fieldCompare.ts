// Field comparison for sync conflict detection.
//
// The same value can come back from the server in a different shape than
// this device stores it: a Date here and an ISO string there, null there
// and a missing key here, the same JSON object with its keys in another
// order. Those are not conflicts. Comparing them with !== flagged them as
// conflicts (often as high-PHI ones), so the helpers below normalise both
// sides before comparing.

import type { ConflictField } from "@/components/ConflictResolutionModal";

// Date or date-time in ISO 8601 / Postgres output form:
// date, then optional time, fraction and zone.
const ISO_DATE =
  /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?)(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)?)?$/i;

/** "+01", "+0100" and "+01:00" all become "+01:00"; "z" becomes "Z". */
function normaliseZone(zone: string): string {
  if (zone.toUpperCase() === "Z") return "Z";
  const digits = zone.slice(1).replace(":", "");
  return `${zone[0]}${digits.slice(0, 2)}:${(digits.slice(2) || "00").padEnd(2, "0")}`;
}

/** Sync bookkeeping fields: they always differ and are never user data. */
const IGNORED_FIELDS = new Set(["updatedAt", "createdAt"]);

/**
 * Epoch milliseconds for a Date or an ISO date string; null for anything
 * else (so phone numbers or plain numbers are never read as dates).
 */
export function timeOf(value: unknown): number | null {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof value !== "string") return null;
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const [, date, time, fraction, zone] = match;
  let iso = date;
  if (time) {
    // Postgres sends microseconds; JS dates hold milliseconds.
    const ms = (fraction ?? "").slice(0, 3).padEnd(3, "0");
    iso += `T${time.length === 5 ? `${time}:00` : time}.${ms}`;
    if (zone) iso += normaliseZone(zone);
  }
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : parsed;
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

function normalise(value: unknown): unknown {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (Array.isArray(value)) return value.map(normalise);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) continue;
      out[key] = normalise(record[key]);
    }
    return out;
  }
  return value;
}

/** JSON with object keys sorted at every level, so key order never matters. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(normalise(value)) ?? "";
}

/**
 * Whether two field values mean the same thing for sync:
 * - null, undefined and "" are all "no value";
 * - dates (Date or ISO string) compare by instant, to the millisecond;
 * - objects and arrays compare by content (stable JSON);
 * - everything else compares strictly.
 */
export function sameSyncValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const aEmpty = isEmpty(a);
  const bEmpty = isEmpty(b);
  if (aEmpty || bEmpty) return aEmpty && bEmpty;

  const aTime = timeOf(a);
  const bTime = timeOf(b);
  if (aTime !== null && bTime !== null) return aTime === bTime;
  if (a instanceof Date || b instanceof Date) return false;

  if (typeof a === "object" && typeof b === "object") {
    return stableStringify(a) === stableStringify(b);
  }
  return false;
}

function fieldType(value: unknown): ConflictField["type"] {
  if (typeof value === "number") return "number";
  if (value instanceof Date) return "date";
  if (typeof value === "object") return "object";
  return "string";
}

/**
 * Fields where this device's copy and the server copy really differ.
 *
 * `columnMap` maps this device's field names to server column names.
 * Fields this device does not hold (undefined) are skipped: the upload
 * leaves them out, so they cannot overwrite the server value.
 */
export function findFieldConflicts(
  localData: Record<string, unknown>,
  remoteData: Record<string, unknown>,
  columnMap: Record<string, string>,
): ConflictField[] {
  const conflicts: ConflictField[] = [];
  for (const [appKey, dbKey] of Object.entries(columnMap)) {
    if (IGNORED_FIELDS.has(appKey)) continue;
    const localValue = localData[appKey];
    if (localValue === undefined) continue;
    const remoteValue = remoteData[dbKey];
    if (sameSyncValue(localValue, remoteValue)) continue;
    conflicts.push({
      field: appKey,
      label: appKey.replace(/([A-Z])/g, " $1").trim(),
      localValue,
      remoteValue,
      type: fieldType(localValue),
    });
  }
  return conflicts;
}
