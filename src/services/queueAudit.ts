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

const DEVICE_ID_KEY = "device:id";
let cachedDeviceId: string | null = null;
let pendingDeviceId: Promise<string> | null = null;

async function loadOrCreateDeviceId(): Promise<string> {
  try {
    const row = await db.settings.get(DEVICE_ID_KEY);
    if (row?.value) {
      cachedDeviceId = String(row.value);
      return cachedDeviceId;
    }
    const id = `dev_${generateId()}`;
    await db.settings.put({ key: DEVICE_ID_KEY, value: id });
    cachedDeviceId = id;
    return id;
  } catch {
    // Storage unavailable: record the change anyway, clearly marked.
    return "unknown-device";
  }
}

/**
 * Stable id for this device (browser profile), created once and kept in
 * db.settings. It is not tied to a sign-in, so it stays the same across
 * logouts; it changes only if the device's app data is wiped. Concurrent
 * first calls share one lookup, so two ids are never minted.
 */
export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  if (!pendingDeviceId) {
    pendingDeviceId = loadOrCreateDeviceId().finally(() => {
      pendingDeviceId = null;
    });
  }
  return pendingDeviceId;
}

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
