import { db, generateId, type User } from "./index";
import { derivePinHash, newSaltB64 } from "@/utils/pin";

export const FIRST_ADMIN_EXISTS_MESSAGE =
  "This device already has a staff account. Sign in with its PIN instead.";

export const LAST_ADMIN_MESSAGE =
  "This is the only administrator on this device. Create another administrator first.";

export interface FirstAdminInput {
  fullName: string;
  pin: string;
  confirmPin: string;
}

/**
 * True when the local database holds no staff account that could sign in.
 *
 * Demo seeding only runs in development (see src/db/seed.ts), so a freshly
 * installed production device starts with zero users and no PIN that could
 * ever sign in. First-run setup is the only way out of that state, which is
 * why both /login and /setup route on this answer.
 *
 * Counts active users specifically: the auth store only ever considers
 * `isActive === 1`, so a device whose every account is deactivated — which is
 * what migration 0003 leaves behind when it retires demo accounts — is just as
 * unusable as an empty one and needs the same way back in.
 */
export async function needsFirstRunSetup(): Promise<boolean> {
  return (await activeUserCount()) === 0;
}

function activeUserCount(): Promise<number> {
  return db.users.where("isActive").equals(1).count();
}

/**
 * How many *other* active administrators the device would still have if this
 * user stopped being one.
 *
 * Only the "admin" role grants the `users` permission (src/auth/roles.ts), and
 * first-run setup refuses to run while an active account exists, so demoting,
 * deactivating or deleting the last admin locks user management away for good.
 * Callers use this to refuse that edit.
 */
export async function countOtherActiveAdmins(
  excludeUserId: string,
): Promise<number> {
  return db.users
    .where("isActive")
    .equals(1)
    .filter((user) => user.role === "admin" && user.id !== excludeUserId)
    .count();
}

/**
 * Creates the device's first administrator.
 *
 * The PIN hash is derived before the write transaction opens: crypto.subtle is
 * not a Dexie operation, and awaiting it inside a transaction would let the
 * transaction commit early. The count is re-checked inside the transaction so
 * two tabs racing through the setup screen cannot both mint an admin — the
 * loser gets FIRST_ADMIN_EXISTS_MESSAGE and is sent to the login page.
 */
export async function createFirstAdmin(input: FirstAdminInput): Promise<User> {
  const fullName = input.fullName.trim();

  if (!fullName) {
    throw new Error("Enter the administrator's full name");
  }
  if (!/^\d{6}$/.test(input.pin)) {
    throw new Error("The PIN must be exactly 6 digits");
  }
  if (input.pin !== input.confirmPin) {
    throw new Error("The two PINs do not match");
  }

  const pinSalt = newSaltB64();
  const pinHash = await derivePinHash(input.pin, pinSalt);
  const now = new Date();

  const user: User = {
    id: generateId(),
    fullName,
    role: "admin",
    pinHash,
    pinSalt,
    // Permanent so a later admin cannot delete or demote the account of last
    // resort and lock the device out again.
    adminAccess: true,
    adminPermanent: true,
    isActive: 1,
    createdAt: now,
    updatedAt: now,
  };

  await db.transaction("rw", db.users, async () => {
    if ((await activeUserCount()) > 0) {
      throw new Error(FIRST_ADMIN_EXISTS_MESSAGE);
    }
    await db.users.add(user);
  });

  return user;
}
