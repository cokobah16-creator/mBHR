// This device's identity for audit records.
//
// Every browser profile that runs mBHR gets a stable id, created once and
// kept in db.settings. It is not tied to a sign-in, so it stays the same
// across logouts; it changes only if the device's app data is wiped (or the
// app is opened on another web address, which has its own storage).
import { db, generateId } from "./index";

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
 * Stable id for this device. Concurrent first calls share one lookup, so two
 * ids are never minted.
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

/**
 * The device id if it has been read already, else null. For synchronous
 * callers (the audit stamp); sign-in reads it first so it is normally set.
 */
export function knownDeviceId(): string | null {
  return cachedDeviceId;
}
