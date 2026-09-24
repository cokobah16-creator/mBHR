// Sync markers to write on this device after the server accepted an upload.
//
// An upload takes a network round trip, often several seconds on a weak
// connection. A record edited on this device during that time (a queue
// status change, a corrected vital) was not part of what was uploaded.
// Marking it clean would hide that edit from the next upload, and the
// download that follows would then write the older server copy over it.
// So the record is marked clean only when it still holds exactly what was
// read for the upload; otherwise it stays marked unsent and goes up on the
// next sync.

import { stableStringify } from "./fieldCompare";

type Row = Record<string, unknown>;

/**
 * Sync bookkeeping fields; they are not record content. transitionPending
 * and ticketPending are device-only queue markers (never uploaded): they are
 * set together with a status or ticket change, which still counts as an
 * edit, and the queue-ticket sync participant clears them on its own.
 */
const SYNC_MARKERS = ["_dirty", "_syncedAt", "transitionPending", "ticketPending"];

function content(row: Row): string {
  const copy: Row = { ...row };
  for (const marker of SYNC_MARKERS) delete copy[marker];
  return stableStringify(copy);
}

/** The record still holds what was read before the upload (sync markers aside). */
export function unchangedSinceRead(read: Row, current: Row): boolean {
  return content(read) === content(current);
}

/**
 * What to write after a successful upload of `uploaded` (the record as read
 * before the upload). `current` is the record as it is on this device now.
 *
 * - Unchanged (or no longer on this device): mark it clean.
 * - Edited during the upload: keep it marked unsent, and only record when
 *   the server last took a copy, so the next upload is not mistaken for a
 *   conflict with this device's own earlier upload.
 */
export function markersAfterUpload(
  uploaded: Row,
  current: Row | null | undefined,
  syncedAt: string,
): Row {
  if (current && !unchangedSinceRead(uploaded, current)) {
    return { _syncedAt: syncedAt };
  }
  return { _dirty: 0, _syncedAt: syncedAt };
}
