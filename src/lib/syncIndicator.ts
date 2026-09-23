// Which state the header's sync indicator shows. Pure, so the order of
// precedence can be tested.

import type { CloudSessionState } from "@/stores/syncStore";

export type SyncIndicatorKind =
  | "no_session"
  | "offline"
  | "local"
  | "syncing"
  | "error"
  | "conflict"
  | "pending"
  | "synced"
  | "idle";

export interface SyncIndicatorInput {
  online: boolean;
  /** Cloud sync is set up on this device. */
  syncEnabled: boolean;
  cloudSession: CloudSessionState;
  syncing: boolean;
  /** The last sync failed or some operations stopped retrying. */
  hasError: boolean;
  conflictCount: number;
  pending: number;
  lastSuccessAt: number;
}

/**
 * With cloud sync set up but no online sign-in, nothing can upload, so that
 * state wins over every other (including offline and a sync reported as
 * running). While the sign-in has not been checked yet the usual states
 * show, so the header does not flash a warning on start-up.
 */
export function deriveSyncIndicatorKind(i: SyncIndicatorInput): SyncIndicatorKind {
  if (i.syncEnabled && i.cloudSession === "signed_out") return "no_session";
  if (!i.online) return "offline";
  if (!i.syncEnabled) return "local";
  if (i.syncing) return "syncing";
  if (i.hasError) return "error";
  if (i.conflictCount > 0) return "conflict";
  if (i.pending > 0) return "pending";
  if (i.lastSuccessAt > 0) return "synced";
  return "idle";
}
