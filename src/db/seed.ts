import { db, generateId } from "./index";
import { derivePinHash, newSaltB64 } from "@/utils/pin";
import { seedVitalsRanges } from "./seedVitalsRanges";

/**
 * Demo staff accounts with published PINs. Development only — see seed().
 */
async function seedDemoUsers() {
  const userCount = await db.users.count();
  console.log("Existing user count:", userCount);

  if (userCount > 0) return;

  console.log("🌱 Creating demo users...");

  const users = [
    {
      fullName: "Admin User",
      role: "admin" as const,
      pin: "123456",
      adminAccess: true,
      adminPermanent: false,
    },
    {
      fullName: "Dr. Sarah Johnson",
      role: "doctor" as const,
      pin: "234567",
      adminAccess: false,
      adminPermanent: false,
    },
    {
      fullName: "Nurse Mary",
      role: "nurse" as const,
      pin: "345678",
      adminAccess: false,
      adminPermanent: false,
    },
    {
      fullName: "Pharmacist John",
      role: "pharmacist" as const,
      pin: "456789",
      adminAccess: false,
      adminPermanent: false,
    },
    {
      fullName: "Volunteer Mike",
      role: "volunteer" as const,
      pin: "567890",
      adminAccess: false,
      adminPermanent: false,
    },
    {
      fullName: "Kristopher Okobah",
      role: "admin" as const,
      pin: "070398",
      adminAccess: true,
      adminPermanent: true,
    },
  ];

  for (const userData of users) {
    const pinSalt = newSaltB64();
    const pinHash = await derivePinHash(userData.pin, pinSalt);

    console.log(`Creating user: ${userData.fullName}, PIN: ${userData.pin}`);

    await db.users.add({
      id: generateId(),
      fullName: userData.fullName,
      role: userData.role,
      email: `${userData.role}@local`,
      pinHash,
      pinSalt,
      adminAccess: userData.adminAccess,
      adminPermanent: userData.adminPermanent,
      isActive: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  console.log(
    "✅ Users created with PINs: 123456, 234567, 345678, 456789, 567890, 070398",
  );
}

/**
 * Clinical reference data, not demo data — every environment needs it. Safe to
 * call repeatedly; migration 0002 seeds the same table on a fresh database, so
 * this is normally a no-op by the time it runs.
 */
export async function ensureVitalsRanges() {
  const rangesCount = await db.vitalsRanges.count();
  if (rangesCount > 0) return;

  console.log("🌱 Adding comprehensive vitals reference ranges...");
  await seedVitalsRanges();
  const finalCount = await db.vitalsRanges.count();
  console.log(`✅ Vitals ranges created: ${finalCount} reference ranges`);
}

export async function seed() {
  try {
    console.log("🌱 Starting database seeding...");

    // Demo staff exist only in development. In production a fresh device has
    // no users at all and is sent to first-run setup (src/db/firstRun.ts) to
    // create a real administrator, rather than shipping with published PINs.
    if (import.meta.env.DEV) {
      await seedDemoUsers();
    } else {
      console.log("Skipping demo users outside development");
    }

    await ensureVitalsRanges();

    console.log("✅ Database seeded successfully");
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    throw error;
  }
}
