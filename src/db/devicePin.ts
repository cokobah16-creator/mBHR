import { db, type User } from "./index";
import { derivePinHash, newSaltB64 } from "@/utils/pin";
import { isStaffRole } from "@/auth/roles";

export interface DevicePinInput {
  userId: string;
  pin: string;
  confirmPin: string;
}

/** The device-only fields that make up a staff member's offline access. */
export type DevicePinFields = Pick<User, "pinHash" | "pinSalt" | "pinEnrolledAt">;

/**
 * Checks a new PIN and derives its device-only fields. Two people may pick
 * the same PIN: offline sign-in asks who is signing in first and checks only
 * that person's PIN (see login in src/stores/auth.ts).
 */
export async function devicePinFields(
  pin: string,
  confirmPin: string,
): Promise<DevicePinFields> {
  if (!/^\d{6}$/.test(pin)) {
    throw new Error("The PIN must be exactly 6 digits");
  }
  if (pin !== confirmPin) {
    throw new Error("The two PINs do not match");
  }
  const pinSalt = newSaltB64();
  const pinHash = await derivePinHash(pin, pinSalt);
  return { pinHash, pinSalt, pinEnrolledAt: new Date() };
}

/**
 * Enrolls a PIN for an account already on this device, so the person can
 * sign in here without internet. Used right after a first online sign-in on
 * the device (enrollment is required before entering the app), and by an
 * administrator under Users to set or reset someone's device PIN.
 *
 * Only the PIN fields change. They are never uploaded, so this does not mark
 * the account for sync.
 *
 * The hash is derived before the write, outside any transaction:
 * crypto.subtle is not a Dexie operation and awaiting it inside a transaction
 * would let the transaction commit early.
 */
export async function setDevicePin(input: DevicePinInput): Promise<User> {
  const fields = await devicePinFields(input.pin, input.confirmPin);

  const user = await db.users.get(input.userId);
  if (!user) {
    throw new Error("This account is not on this device");
  }
  // Offline access is for active staff only.
  if (user.isActive !== 1 || !isStaffRole(user.role)) {
    throw new Error("This account cannot have offline access on this device");
  }

  await db.users.update(user.id, fields);

  return { ...user, ...fields };
}

/**
 * Removes someone's offline access on this device. They can enroll again by
 * signing in online here, or an administrator can set a new PIN.
 */
export async function clearDevicePin(userId: string): Promise<void> {
  await db.users.update(userId, {
    pinHash: "",
    pinSalt: "",
    pinEnrolledAt: undefined,
  });
}
