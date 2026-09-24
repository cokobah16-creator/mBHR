// Range reads over the local Dexie tables for reports.
//
// Records created on this device store their timestamps as Date objects;
// records downloaded by sync keep the ISO strings Supabase sent (this includes
// this device's own records once sync has pulled them back). IndexedDB
// orders Dates and strings separately, so a single `between(Date, Date)`
// silently skips every synced record (and an ISO-string range skips every
// local one). These helpers query both key types and merge the results.
import type { IndexableType, Table } from "dexie";
import { toTime, type TimestampLike } from "./reportUtils";

/** Records whose `index` value falls in [start, end). */
export async function loadInRange<T>(
  table: Table<T, IndexableType>,
  index: string,
  start: Date,
  end: Date,
): Promise<T[]> {
  const [asDates, asStrings] = await Promise.all([
    table.where(index).between(start, end, true, false).toArray(),
    table
      .where(index)
      .between(start.toISOString(), end.toISOString(), true, false)
      .toArray(),
  ]);
  return [...asDates, ...asStrings];
}

/**
 * Only the records in [start, end) whose `index` value is stored as ISO text
 * (records written by sync). These are exactly the ones a Date-only
 * `between(start, end)` query misses, so a page built on such a query can
 * say how much it left out.
 */
export async function loadTextKeyedInRange<T>(
  table: Table<T, IndexableType>,
  index: string,
  start: Date,
  end: Date,
): Promise<T[]> {
  return table
    .where(index)
    .between(start.toISOString(), end.toISOString(), true, false)
    .toArray();
}

/** Number of records whose `index` value falls in [start, end). */
export async function countInRange<T>(
  table: Table<T, IndexableType>,
  index: string,
  start: Date,
  end: Date,
): Promise<number> {
  const [asDates, asStrings] = await Promise.all([
    table.where(index).between(start, end, true, false).count(),
    table
      .where(index)
      .between(start.toISOString(), end.toISOString(), true, false)
      .count(),
  ]);
  return asDates + asStrings;
}

/**
 * The `limit` records with the latest `index` value, newest first. A plain
 * orderBy(index).reverse() returns every ISO-string key before any Date key,
 * so records edited here since the last sync would never make the list.
 */
export async function latestByIndex<T>(
  table: Table<T, IndexableType>,
  index: string,
  limit: number,
  valueOf: (row: T) => TimestampLike,
): Promise<T[]> {
  const [dateKeyed, stringKeyed] = await Promise.all([
    // "" is the smallest string key: below it are numbers and Dates.
    table.where(index).below("").reverse().limit(limit).toArray(),
    table.where(index).aboveOrEqual("").reverse().limit(limit).toArray(),
  ]);
  return [...dateKeyed, ...stringKeyed]
    .sort((a, b) => (toTime(valueOf(b)) ?? 0) - (toTime(valueOf(a)) ?? 0))
    .slice(0, limit);
}
