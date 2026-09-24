// How a downloaded server row is written over this device's copy.
//
// Two rules keep a download from losing data on this device:
// 1. A row with changes not uploaded yet (_dirty === 1) is left alone. The
//    upload step compares it with the server copy and raises a conflict
//    when both sides changed; overwriting it here would silently drop the
//    edit made on this device.
// 2. Otherwise the server row is laid over the local row instead of
//    replacing it, so fields that exist only on this device survive: queue
//    assignee and ticket number, patient search keys and merge links, staff
//    PIN hashes, portal state.

type Row = Record<string, unknown>;

export type PullDecision =
  | { kind: "kept-local" }
  | { kind: "apply"; row: Row };

/** This device holds changes to the row that have not been uploaded. */
export function hasUnsentChanges(localRow: unknown): boolean {
  return (
    !!localRow &&
    typeof localRow === "object" &&
    (localRow as { _dirty?: unknown })._dirty === 1
  );
}

/**
 * Decide what to write for one downloaded row. `remoteRow` is already in
 * this device's field names; `markers` are the sync fields to set (for
 * example `_dirty: 0` and `_syncedAt`).
 */
export function mergePulledRow(
  localRow: Row | null | undefined,
  remoteRow: Row,
  markers: Row = {},
): PullDecision {
  if (hasUnsentChanges(localRow)) return { kind: "kept-local" };
  return { kind: "apply", row: { ...(localRow ?? {}), ...remoteRow, ...markers } };
}
