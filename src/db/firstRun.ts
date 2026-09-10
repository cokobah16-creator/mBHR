import { db, generateId, type User } from "./index";
import { derivePinHash, newSaltB64 } from "@/utils/pin";

export const FIRST_ADMIN_EXISTS_MESSAGE =
  "This device already has a staff account. Sign in with its PIN instead.";

export interface FirstAdminInput {
  fullName: string;
  pin: string;
  confirmPin: string;
}

/**
 * True when the local database holds no staff account at all.
 *
 * Demo seeding only runs in development (see src/db/seed.ts), so a freshly
 * installed production device starts with zero users and no PIN that could
 * ever sign in. First-run setup is the only way out of that state, which is
 * why both /login and /setup route on this answer.
 */
export async function needsFirstRunSetup(): Promise<boolean> {
  return (await db.users.count()) === 0;
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
    if ((await db.users.count()) > 0) {
      throw new Error(FIRST_ADMIN_EXISTS_MESSAGE);
    }
    await db.users.add(user);
  });

  return user;
}
