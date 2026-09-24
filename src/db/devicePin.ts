import { db, type User } from "./index";
import { derivePinHash, newSaltB64, verifyPin } from "@/utils/pin";

export const PIN_IN_USE_MESSAGE =
  "Another account on this device already uses this PIN. Choose a different PIN.";

export interface DevicePinInput {
  userId: string;
  pin: string;
  confirmPin: string;
}

/**
 * True when another account on this device (active or not) would sign in
 * with this PIN. PIN sign-in matches the PIN against every active account, so
 * two accounts sharing one PIN would sign in as whichever is found first.
 */
export async function pinInUseOnDevice(
  pin: string,
  excludeUserId?: string,
): Promise<boolean> {
  const others = await db.users
    .filter((u) => u.id !== excludeUserId && !!u.pinHash && !!u.pinSalt)
    .toArray();
  for (const other of others) {
    if (await verifyPin(pin, other.pinHash, other.pinSalt)) return true;
  }
  return false;
}

/**
 * Gives an account that is already on this device a PIN, so the person can
 * sign in here without internet from then on. Used right after an online
 * sign-in created the local record (which has no PIN), and it never touches
 * anything but the PIN fields.
 *
 * The hash is derived before the write, outside any transaction:
 * crypto.subtle is not a Dexie operation and awaiting it inside a transaction
 * would let the transaction commit early.
 */
export async function setDevicePin(input: DevicePinInput): Promise<User> {
  if (!/^\d{6}$/.test(input.pin)) {
    throw new Error("The PIN must be exactly 6 digits");
  }
  if (input.pin !== input.confirmPin) {
    throw new Error("The two PINs do not match");
  }

  const user = await db.users.get(input.userId);
  if (!user) {
    throw new Error("This account is not on this device");
  }
  if (await pinInUseOnDevice(input.pin, user.id)) {
    throw new Error(PIN_IN_USE_MESSAGE);
  }

  const pinSalt = newSaltB64();
  const pinHash = await derivePinHash(input.pin, pinSalt);
  const updatedAt = new Date();

  await db.users.update(user.id, { pinHash, pinSalt, updatedAt });

  return { ...user, pinHash, pinSalt, updatedAt };
}
