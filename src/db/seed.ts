import { db, generateId } from "./index";
import { derivePinHash, newSaltB64 } from "@/utils/pin";
import { seedVitalsRanges } from "./seedVitalsRanges";

export async function seed() {
  try {
    console.log("🌱 Starting database seeding...");

    const userCount = await db.users.count();
    console.log("Existing user count:", userCount);

    // Seed users if needed
    if (userCount === 0) {
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

        console.log(
          `Creating user: ${userData.fullName}, PIN: ${userData.pin}`,
        );
        console.log(`  Salt: ${pinSalt.substring(0, 10)}...`);
        console.log(`  Hash: ${pinHash.substring(0, 20)}...`);

        const userId = generateId();
        await db.users.add({
          id: userId,
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

        // Verify the user was created correctly
        const createdUser = await db.users.get(userId);
        if (createdUser) {
          console.log(
            `✓ User created: ${createdUser.fullName}, Active: ${createdUser.isActive}, HasHash: ${!!createdUser.pinHash}, HasSalt: ${!!createdUser.pinSalt}`,
          );
        }
      }

      console.log(
        "✅ Users created with PINs: 123456, 234567, 345678, 456789, 567890, 070398",
      );

      // Final verification
      const allUsers = await db.users.where("isActive").equals(1).toArray();
      console.log(`✅ Verified ${allUsers.length} active users in database`);
      allUsers.forEach((u) => {
        console.log(
          `  - ${u.fullName} (${u.role}) - Hash: ${u.pinHash?.substring(0, 10)}..., Salt: ${u.pinSalt?.substring(0, 10)}...`,
        );
      });
    }

    // Seed vitals reference ranges (clinical reference data)
    const rangesCount = await db.vitalsRanges.count();
    if (rangesCount === 0) {
      console.log("🌱 Adding comprehensive vitals reference ranges...");
      await seedVitalsRanges();
      const finalCount = await db.vitalsRanges.count();
      console.log(`✅ Vitals ranges created: ${finalCount} reference ranges`);
    }

    console.log("✅ Database seeded successfully");
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    throw error;
  }
}
