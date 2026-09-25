// Download cursors ("updated_at greater than ...") must not move past real
// time. A row stamped in the future (a device clock set ahead) would
// otherwise carry the saved cursor with it, and rows stamped later at the
// correct time would not be downloaded until the clock caught up.

/** How far ahead of this device's clock a row may be and still move a cursor. */
export const CURSOR_MAX_AHEAD_MS = 5 * 60 * 1000;

function limitFor(now: number): number {
  return now + CURSOR_MAX_AHEAD_MS;
}

/**
 * The cursor after a downloaded row: the row's timestamp when it is later
 * than the current cursor and not in the future. A future-dated row is
 * still applied, it just does not move the cursor (it is read again on the
 * next run, after the rows stamped at the correct time).
 */
export function advanceCursor(
  current: string,
  rowTimestamp: unknown,
  now: number = Date.now(),
): string {
  if (typeof rowTimestamp !== "string" || rowTimestamp === "") return current;
  const at = Date.parse(rowTimestamp);
  if (!Number.isFinite(at) || at > limitFor(now)) return current;
  const currentAt = Date.parse(current);
  if (Number.isFinite(currentAt)) return at > currentAt ? rowTimestamp : current;
  return rowTimestamp > current ? rowTimestamp : current;
}

/**
 * True when a saved cursor is in the future: a future-dated row moved it
 * there, so rows after the point it passed may have been skipped. The
 * download then starts again from the beginning (rows already on this
 * device are applied again, which changes nothing; unsent edits are kept).
 */
export function isCursorAhead(cursor: string, now: number = Date.now()): boolean {
  const at = Date.parse(cursor);
  return Number.isFinite(at) && at > limitFor(now);
}
