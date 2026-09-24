// How a downloaded server row is written over this device's copy.
//
// Two rules keep a download from losing data on this device:
// 1. A row with changes not uploaded yet (_dirty === 1) is left alone. The
//    upload step compares it with the server copy and raises a conflict
//    when both sides changed; overwriting it here would silently drop the
//    edit made on this device.
// 2. Otherwise the server row is laid over the local row instead of
//    replacing it, so fields that exist only on this device survive: queue
//    assignee and ticket number, patient search keys, staff PIN hashes.
//
// Server-owned fields are the exception to rule 1. Only the server changes
// them (portal access, merge links, queue ticket once server-issued), and
// this device never uploads them, so they are applied even to a row with
// unsent edits: the edits and the sync markers stay, the server-owned
// values are updated. A field this device is still waiting to hear back
// about (an optimistic change with a command in the outbox) is "held" and
// keeps its local value until the command is answered.

type Row = Record<string, unknown>;

export type PullDecision =
  | { kind: "kept-local" }
  | { kind: "apply"; row: Row }
  /**
   * The local row has unsent edits: they are kept and only the server-owned
   * fields are updated. Counts as kept-local edits for reporting.
   */
  | { kind: "server-owned"; row: Row };

export interface MergeOptions {
  /** Fields only the server changes; applied even over unsent edits. */
  serverOwned?: readonly string[];
  /** Fields that keep their local value this time (pending local change). */
  held?: readonly string[];
}

/** This device holds changes to the row that have not been uploaded. */
export function hasUnsentChanges(localRow: unknown): boolean {
  return (
    !!localRow &&
    typeof localRow === "object" &&
    (localRow as { _dirty?: unknown })._dirty === 1
  );
}

function withoutHeld(remoteRow: Row, localRow: Row | null | undefined, held: readonly string[]): Row {
  if (held.length === 0 || !localRow) return remoteRow;
  const out: Row = { ...remoteRow };
  for (const field of held) {
    if (field in localRow) out[field] = localRow[field];
    else delete out[field];
  }
  return out;
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
  options: MergeOptions = {},
): PullDecision {
  const held = options.held ?? [];
  const remote = withoutHeld(remoteRow, localRow, held);

  if (hasUnsentChanges(localRow)) {
    const owned = (options.serverOwned ?? []).filter(
      (field) => !held.includes(field) && field in remote,
    );
    const changed = owned.filter((field) => !sameValue(localRow![field], remote[field]));
    if (changed.length === 0) return { kind: "kept-local" };
    const row: Row = { ...localRow };
    for (const field of changed) row[field] = remote[field];
    return { kind: "server-owned", row };
  }
  return { kind: "apply", row: { ...(localRow ?? {}), ...remote, ...markers } };
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // null and missing mean the same thing for a server-owned field.
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  return false;
}
