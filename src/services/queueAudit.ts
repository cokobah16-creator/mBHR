// Queue transition audit trail.
//
// Every change to the queue (call, send on, end here, move to front,
// remove, priority change) adds one QueueTransition row. queueManagement is
// the only writer, and it adds the row in the same Dexie transaction as the
// queue change, so a change is never saved without its audit row or the
// other way round. Rows are append-only and marked _dirty so the sync
// uploads them to the server table queue_transitions.
import { db, generateId, type QueueTransition } from "@/db";
import { useAuthStore } from "@/stores/auth";

/** Who made a queue change. */
export interface QueueActor {
  id: string;
  role: string;
  name?: string;
}

/** Actor recorded for automatic changes (e.g. long-wait escalation). */
export const SYSTEM_ACTOR: QueueActor = { id: "system", role: "system" };

export { getDeviceId } from "@/db/deviceIdentity";

/** The signed-in staff member as a queue actor, or null when nobody is signed in. */
export function currentQueueActor(): QueueActor | null {
  try {
    const user = useAuthStore.getState().currentUser;
    return user ? { id: user.id, role: user.role, name: user.fullName } : null;
  } catch {
    return null;
  }
}

export type TransitionInput = Omit<
  QueueTransition,
  "id" | "userId" | "userRole" | "deviceId" | "at" | "_dirty" | "_syncedAt"
>;

/** Builds an audit row; pure apart from the generated id. */
export function buildTransition(
  input: TransitionInput,
  actor: QueueActor,
  deviceId: string,
  at: Date,
): QueueTransition {
  return {
    ...input,
    id: generateId(),
    userId: actor.id,
    userRole: actor.role,
    deviceId,
    at,
    _dirty: 1,
  };
}

/**
 * Adds an audit row. Call it inside the Dexie transaction that makes the
 * queue change (the transaction must include db.queueTransitions).
 */
export async function addTransition(row: QueueTransition): Promise<void> {
  await db.queueTransitions.add(row);
}
