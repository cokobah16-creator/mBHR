import { db, User, generateId } from './index'
import { derivePinHash, newSaltB64 } from '@/utils/pin'

// Sample inventory items for seeding
const INVENTORY_ITEMS = [
  { itemName: 'Paracetamol 500mg', unit: 'tablets', onHandQty: 1000, reorderThreshold: 100 },
  { itemName: 'Ibuprofen 400mg', unit: 'tablets', onHandQty: 500, reorderThreshold: 50 },
  { itemName: 'Amoxicillin 250mg', unit: 'capsules', onHandQty: 200, reorderThreshold: 30 },
  { itemName: 'ORS Sachets', unit: 'sachets', onHandQty: 150, reorderThreshold: 25 },
  { itemName: 'Multivitamin', unit: 'tablets', onHandQty: 300, reorderThreshold: 50 },
  { itemName: 'Antacid Tablets', unit: 'tablets', onHandQty: 250, reorderThreshold: 40 },
  { itemName: 'Cough Syrup', unit: 'bottles', onHandQty: 50, reorderThreshold: 10 },
  { itemName: 'Antiseptic Solution', unit: 'bottles', onHandQty: 30, reorderThreshold: 5 },
  { itemName: 'Bandages', unit: 'rolls', onHandQty: 100, reorderThreshold: 20 },
  { itemName: 'Thermometer Strips', unit: 'strips', onHandQty: 200, reorderThreshold: 30 }
]

const USERS: Array<Pick<User, 'fullName'|'role'|'isActive'|'pinHash'|'pinSalt'>> = []

async function makeUser(fullName: string, role: User['role'], pin: string) {
  const pinSalt = newSaltB64()
  const pinHash = await derivePinHash(pin, pinSalt)
  USERS.push({ fullName, role, isActive: 1, pinSalt, pinHash })
}

export async function seed() {
  try {
    console.log('🌱 Starting database seeding...')
    
    // Check existing data
    const [userCount, inventoryCount] = await Promise.all([
      db.users.count(),
      db.inventory.count()
    ])
    
    console.log('Existing counts - Users:', userCount, 'Inventory:', inventoryCount)
    
    // Always seed users if none exist
    // Always seed inventory if none exist (separate checks)
    
    // Seed users if needed
    if (userCount === 0) {
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
    } else {
      console.log('✅ Users already exist, skipping user seeding')
    }

    // Seed inventory if needed
    if (inventoryCount === 0) {
      console.log('🌱 Adding inventory items...')
      await db.transaction('rw', db.inventory, async () => {
        for (const item of INVENTORY_ITEMS) {
          await db.inventory.add({
            id: generateId(),
            ...item,
            updatedAt: new Date()
          })
        }
      })
      
      console.log('✅ Inventory items created:')
      INVENTORY_ITEMS.forEach(item => {
        console.log(`  - ${item.itemName}: ${item.onHandQty} ${item.unit}`)
      })
    } else {
      console.log('✅ Inventory already exists, skipping inventory seeding')
    }
    
    console.log('✅ Database seeded successfully')
  } catch (error) {
    console.error('❌ Seeding failed:', error)
    throw error
  }
}