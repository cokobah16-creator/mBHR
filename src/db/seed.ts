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

export async function seed() {
  try {
    console.log('🌱 Starting database seeding...')
    
    // Check existing data
    const [userCount, inventoryCount] = await Promise.all([
      db.users.count(),
      db.inventory.count()
    ])
    
    console.log('Existing counts - Users:', userCount, 'Inventory:', inventoryCount)
    
    // Seed users if needed
    if (userCount === 0) {
      console.log('🌱 Creating demo users...')
      
      const users = [
        { fullName: 'Admin User', role: 'admin' as const, pin: '123456', adminAccess: true, adminPermanent: false },
        { fullName: 'Dr. Sarah Johnson', role: 'doctor' as const, pin: '234567', adminAccess: false, adminPermanent: false },
        { fullName: 'Nurse Mary', role: 'nurse' as const, pin: '345678', adminAccess: false, adminPermanent: false },
        { fullName: 'Pharmacist John', role: 'pharmacist' as const, pin: '456789', adminAccess: false, adminPermanent: false },
        { fullName: 'Volunteer Mike', role: 'volunteer' as const, pin: '567890', adminAccess: false, adminPermanent: false },
        { fullName: 'User 070398', role: 'admin' as const, pin: '070398', adminAccess: true, adminPermanent: false }
      ]
      
      for (const userData of users) {
        const pinSalt = newSaltB64()
        const pinHash = await derivePinHash(userData.pin, pinSalt)
        
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
          updatedAt: new Date()
        })
      }
      
      console.log('✅ Users created with PINs: 123456, 234567, 345678, 456789, 567890, 070398')
    }

    // Seed inventory if needed
    if (inventoryCount === 0) {
      console.log('🌱 Adding inventory items...')
      
      for (const item of INVENTORY_ITEMS) {
        await db.inventory.add({
          id: generateId(),
          ...item,
          updatedAt: new Date()
        })
      }
      
      console.log('✅ Inventory items created:', INVENTORY_ITEMS.length)
    }
    
    console.log('✅ Database seeded successfully')
  } catch (error) {
    console.error('❌ Seeding failed:', error)
    throw error
  }
}