// Bounded reads of the local queue for the live boards. Every stage move
// leaves a finished ("done") row behind, so the queue table keeps growing;
// the boards read only what they show through the status and updatedAt
// indexes instead of the whole table.

import { db, type QueueItem } from "@/db";
import { loadInRange } from "@/features/reports/localRecords";

/** Statuses of rows still waiting or being served. */
export const ACTIVE_QUEUE_STATUSES: QueueItem["status"][] = ["waiting", "in_progress"];

/** Rows still waiting or being served (no finished history). */
export function readActiveQueue(): Promise<QueueItem[]> {
  return db.queue.where("status").anyOf(ACTIVE_QUEUE_STATUSES).toArray();
}

/** Local midnight at the start of the day of `now`, and the next one. */
function localDay(now: number): { start: Date; end: Date } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/**
 * Active rows plus every row changed on this device's day of `now` (for
 * "done today" counts), each once. Finished rows from earlier days are not
 * read.
 */
export async function readQueueForToday(now: number = Date.now()): Promise<QueueItem[]> {
  const { start, end } = localDay(now);
  const [active, changedToday] = await Promise.all([
    readActiveQueue(),
    loadInRange<QueueItem>(db.queue, "updatedAt", start, end),
  ]);
  const byId = new Map<string, QueueItem>();
  for (const row of [...active, ...changedToday]) byId.set(row.id, row);
  return [...byId.values()];
}
