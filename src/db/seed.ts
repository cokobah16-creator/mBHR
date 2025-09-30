import { db, User, generateId } from './index'
import { derivePinHash, newSaltB64 } from '@/utils/pin'

const USERS: Array<Pick<User, 'fullName'|'role'|'isActive'|'pinHash'|'pinSalt'>> = []

async function makeUser(fullName: string, role: User['role'], pin: string) {
  const pinSalt = newSaltB64()
  const pinHash = await derivePinHash(pin, pinSalt)
  USERS.push({ fullName, role, isActive: true, pinSalt, pinHash })
}

export async function seed() {
  try {
    console.log('🌱 Starting database seeding...')
    
    // Only seed if there are no users yet
    const count = await db.users.count()
    console.log('Existing users count:', count)
    
    if (count > 0) {
      console.log('✅ Database already seeded, skipping...')
      return
    }
    
    // Clear the USERS array in case this is called multiple times
    USERS.length = 0
    
    // Create known demo users with known PINs using the same hasher
    console.log('🌱 Creating users with consistent PIN hashing...')
    await makeUser('Admin User', 'admin', '123456')
    await makeUser('Kristopher Okobah', 'admin', '070398')
    await makeUser('Nurse Joy', 'nurse', '234567')
    await makeUser('Doctor Ada', 'doctor', '111222')
    await makeUser('Pharmacist Chidi', 'pharmacist', '333444')
    await makeUser('Volunteer Musa', 'volunteer', '555666')
    
    console.log('🌱 Adding users to database...')
    await db.transaction('rw', db.users, async () => {
      for (const u of USERS) {
        await db.users.add({
          id: generateId(),
          ...u,
          email: `${u.role}@local`,
          createdAt: new Date(),
          updatedAt: new Date()
        } as User)
      }
    })
    
    console.log('✅ Users created:')
    USERS.forEach((user, index) => {
      const pins = ['123456', '070398', '234567', '111222', '333444', '555666']
      console.log(`  - ${user.fullName} (${user.role}) - PIN: ${pins[index]}`)
    })
    
    console.log('✅ Database seeded successfully')
  } catch (error) {
    console.error('❌ Seeding failed:', error)
    throw error
  }
}