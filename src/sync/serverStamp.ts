// The server's own updated_at, remembered per record for conflict checks.
//
// Before uploading an edit, the sync adapter asks whether the server copy
// changed since this device last saw it. Comparing this device's clock with
// the server's updated_at answers that wrongly whenever the two clocks
// disagree, and more so once the server stamps updated_at itself: a device
// running behind takes its own earlier upload for a newer change (a false
// conflict, and the edit is held back), and a device running ahead can
// overwrite another device's edit.
//
// So each record keeps _serverUpdatedAt: the server's updated_at exactly as
// this device last saw it (downloaded, read back after an upload, or the
// server copy a conflict decision was made against). The server changed the
// record since then only if its updated_at is now a different instant. The
// value is device-only: it is in no upload column map and never uploaded.

import { findFieldConflicts, timeOf } from "./fieldCompare";

type Row = Record<string, unknown>;

/** A server updated_at worth keeping (non-empty text), else undefined. */
export function serverStampOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * The marker to write when a server row is laid over this device's copy:
 * the row's updated_at as _serverUpdatedAt, or nothing when it has none.
 */
export function serverStampMarker(serverRow: Row): { _serverUpdatedAt?: string } {
  const stamp = serverStampOf(serverRow.updated_at);
  return stamp === undefined ? {} : { _serverUpdatedAt: stamp };
}

/** Digits of the fraction of a second past the millisecond, trailing zeros dropped. */
function subMillisecond(stamp: string): string {
  const fraction = /:\d{2}\.(\d+)/.exec(stamp)?.[1] ?? "";
  return fraction.slice(3).replace(/0+$/, "");
}

/**
 * True when the server's updated_at (`remoteUpdatedAt`) is the one this
 * device last saw (`seen`): the server has not changed the record since.
 * The same instant written another way ("Z" or "+00:00", a space for the
 * "T") counts as the same. Postgres keeps microseconds, so those must match
 * too. Values that are not dates must be identical. False when either side
 * is missing.
 */
export function serverUnchangedSince(remoteUpdatedAt: unknown, seen: unknown): boolean {
  const remote = serverStampOf(remoteUpdatedAt);
  const known = serverStampOf(seen);
  if (remote === undefined || known === undefined) return false;
  const remoteTime = timeOf(remote);
  const knownTime = timeOf(known);
  if (remoteTime === null || knownTime === null) return remote === known;
  return remoteTime === knownTime && subMillisecond(remote) === subMillisecond(known);
}

/**
 * A boolean server column this device stores as 1 or 0 (allergy isActive,
 * preference reminders) is read back as true or false: the same value.
 */
function sameStoredFlag(local: unknown, server: unknown): boolean {
  return typeof server === "boolean" && (local === 1 || local === 0) && server === (local === 1);
}

/**
 * The server's updated_at from a row read back after an upload, when that
 * row still holds what this device uploaded (`uploaded`, compared through
 * the upload's `columnMap`). Undefined otherwise: another change reached the
 * server in between, and the next upload must still be compared with it
 * field by field.
 */
export function stampAfterUpload(
  uploaded: Row,
  serverRow: Row,
  columnMap: Record<string, string>,
): string | undefined {
  const differences = findFieldConflicts(uploaded, serverRow, columnMap);
  if (differences.some((d) => !sameStoredFlag(d.localValue, d.remoteValue))) return undefined;
  return serverStampOf(serverRow.updated_at);
}
