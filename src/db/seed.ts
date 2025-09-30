import { db, generateId } from './index'
import { sha256Hex } from '@/utils/crypto'

export async function seed() {
  try {
    const existing = await db.users.count()
    if (existing > 0) return

    console.log('🌱 Seeding initial admin user...')

    // Create admin user with PIN 123456 and sample inventory
    const pinHash = await sha256Hex('123456')
    
    await db.users.add({
      id: generateId(),
      fullName: 'Field Admin',
      role: 'admin',
      email: 'admin@local',
      pinHash,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    })

    // Seed sample inventory items
    const inventoryItems = [
      { itemName: 'Paracetamol 500mg', unit: 'tablets', onHandQty: 1000, reorderThreshold: 100 },
      { itemName: 'Ibuprofen 400mg', unit: 'tablets', onHandQty: 500, reorderThreshold: 50 },
      { itemName: 'Amoxicillin 250mg', unit: 'capsules', onHandQty: 200, reorderThreshold: 25 },
      { itemName: 'ORS Sachets', unit: 'sachets', onHandQty: 150, reorderThreshold: 20 },
      { itemName: 'Multivitamin', unit: 'tablets', onHandQty: 300, reorderThreshold: 30 },
      { itemName: 'Antacid Tablets', unit: 'tablets', onHandQty: 250, reorderThreshold: 25 }
    ]

    for (const item of inventoryItems) {
      await db.inventory.add({
        id: generateId(),
        ...item,
        updatedAt: new Date(),
        _dirty: 1
      })
    }
    // Mark admin setup as done
    await db.settings.put({ key: 'adminSetupDone', value: 'true' })

    console.log('✅ Admin user created with PIN: 123456')
    console.log('✅ Sample inventory seeded')
  } catch (error) {
    console.error('❌ Seeding failed:', error)
  }
}