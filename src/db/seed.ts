import { db, generateId } from './index'
import { derivePinHash, newSaltB64 } from '@/utils/pin'

export async function seed() {
  try {
    console.log('🌱 Starting database seeding...')
    await seedUsers()
    await seedInventory()
    await db.settings.put({ key: 'adminSetupDone', value: 'true' })
    console.log('✅ Database seeded successfully')
  } catch (error) {
    console.error('❌ Seeding failed:', error)
  }
}

async function seedUsers() {
  const existing = await db.users.count()
  console.log('Existing users count:', existing)
  if (existing > 0) return

  console.log('🌱 Seeding users with roles...')

  const createUser = async (
    id: string,
    fullName: string,
    role: 'admin' | 'doctor' | 'nurse' | 'pharmacist' | 'volunteer',
    pin: string
  ) => {
    const salt = newSaltB64()
    const pinHash = await derivePinHash(pin, salt)
    console.log(`Creating user ${fullName} with PIN ${pin} -> hash: ${pinHash.slice(0, 10)}...`)
    return {
      id,
      fullName,
      role,
      email: `${role}@local`,
      pinHash,
      pinSalt: salt,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  }

  const users = [
    await createUser('u-admin', 'Field Admin', 'admin', '123456'),
    await createUser('u-doc', 'Dr. A. Okoye', 'doctor', '234567'),
    await createUser('u-nurse', 'Nurse B. Danladi', 'nurse', '345678'),
    await createUser('u-pharm', 'Pharm C. Bello', 'pharmacist', '456789'),
    await createUser('u-vol', 'Volunteer D. Musa', 'volunteer', '567890')
  ]

  await db.users.bulkAdd(users)
  
  console.log('✅ Users created:')
  users.forEach(user => {
    console.log(`  - ${user.fullName} (${user.role}) - PIN: ${user.id.includes('admin') ? '123456' : user.id.includes('doc') ? '234567' : user.id.includes('nurse') ? '345678' : user.id.includes('pharm') ? '456789' : '567890'}`)
  })
}

async function seedInventory() {
  const existing = await db.inventory.count()
  if (existing > 0) return

  console.log('🌱 Seeding inventory...')

  const inventoryItems = [
    { itemName: 'Paracetamol 500mg', unit: 'tablets', onHandQty: 1000, reorderThreshold: 100 },
    { itemName: 'Ibuprofen 400mg', unit: 'tablets', onHandQty: 500, reorderThreshold: 50 },
    { itemName: 'Amoxicillin 250mg', unit: 'capsules', onHandQty: 200, reorderThreshold: 25 },
    { itemName: 'ORS Sachets', unit: 'sachets', onHandQty: 150, reorderThreshold: 20 },
    { itemName: 'Multivitamin', unit: 'tablets', onHandQty: 300, reorderThreshold: 30 },
    { itemName: 'Antacid Tablets', unit: 'tablets', onHandQty: 250, reorderThreshold: 25 },
    { itemName: 'Cough Syrup', unit: 'bottles', onHandQty: 50, reorderThreshold: 10 },
    { itemName: 'Bandages', unit: 'rolls', onHandQty: 100, reorderThreshold: 15 }
  ]

  for (const item of inventoryItems) {
    await db.inventory.add({
      id: generateId(),
      ...item,
      updatedAt: new Date(),
      _dirty: 1
    })
  }

  console.log('✅ Sample inventory seeded')
}