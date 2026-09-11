import { db } from "../index";
import { log, warn } from "@/lib/logger";
import type { Migration } from "./types";

const AUTH_STORAGE_KEY = "mbhr-auth";

/**
 * The staff accounts src/db/seed.ts used to create on every device, production
 * ones included. Their PINs are published in this repository, so gating the
 * seeder is only half the job: devices that already ran an older build still
 * hold these records and would keep accepting those PINs.
 *
 * Matched on the full name *and* the "<role>@local" address the seeder always
 * paired with it, so a real member of staff who happens to share a name is not
 * caught by it.
 */
const DEMO_ACCOUNTS: ReadonlyArray<{ fullName: string; email: string }> = [
  { fullName: "Admin User", email: "admin@local" },
  { fullName: "Dr. Sarah Johnson", email: "doctor@local" },
  { fullName: "Nurse Mary", email: "nurse@local" },
  { fullName: "Pharmacist John", email: "pharmacist@local" },
  { fullName: "Volunteer Mike", email: "volunteer@local" },
  { fullName: "Kristopher Okobah", email: "admin@local" },
];

export function isSeededDemoUser(user: {
  fullName?: string;
  email?: string;
}): boolean {
  return DEMO_ACCOUNTS.some(
    (demo) => demo.fullName === user.fullName && demo.email === user.email,
  );
}

/**
 * Deactivating the record stops the PIN working, but an already-signed-in demo
 * session lives in localStorage and would survive until it expired. Drop it so
 * the device lands on first-run setup on the next load.
 */
function clearPersistedSessionFor(userIds: readonly string[]): void {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return;

    const currentUserId = JSON.parse(raw)?.state?.currentUser?.id;
    if (currentUserId && userIds.includes(currentUserId)) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      log("Cleared a persisted demo session");
    }
  } catch (err) {
    // A malformed or unavailable store is not worth failing the migration
    // over — the PIN itself no longer works either way.
    warn("Could not inspect the persisted session", err);
  }
}

export const migration0003: Migration = {
  version: 3,
  name: "retire-demo-users",

  async up() {
    // Development is where these accounts are the point. seed.ts still creates
    // them there, so retiring them would just churn every reload.
    if (import.meta.env.DEV) {
      log("Keeping demo users: development build");
      return;
    }

    const demoUsers = (await db.users.toArray()).filter(isSeededDemoUser);
    if (demoUsers.length === 0) {
      log("No seeded demo users to retire");
      return;
    }

    const ids = demoUsers.map((user) => user.id);
    await db.users
      .where("id")
      .anyOf(ids)
      .modify({ isActive: 0, updatedAt: new Date() });

    clearPersistedSessionFor(ids);
    log(`Retired ${ids.length} seeded demo user(s)`);
  },
};
