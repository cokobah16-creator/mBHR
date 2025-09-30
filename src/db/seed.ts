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
        { fullName: 'Kristopher Okobah', role: 'admin' as const, pin: '070398', adminAccess: true, adminPermanent: true }
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
    
    // Seed gamification data if needed
    const walletCount = await db.gamificationWallets.count()
    if (walletCount === 0) {
      console.log('🎮 Creating demo gamification wallets...')
      
      const users = await db.users.where('isActive').equals(1).toArray()
      for (const user of users) {
        await db.gamificationWallets.add({
          volunteerId: user.id,
          tokens: Math.floor(Math.random() * 200) + 50, // 50-250 tokens
          badges: ['first_quest'],
          level: 1,
          streakDays: Math.floor(Math.random() * 7),
          lifetimeTokens: Math.floor(Math.random() * 500) + 100,
          lastActiveDate: new Date(),
          updatedAt: new Date(),
          _dirty: 1
        })
      }
      
      console.log('✅ Gamification wallets created for', users.length, 'users')
    }
    
    // Seed vitals ranges if needed
    const rangesCount = await db.vitalsRanges.count()
    if (rangesCount === 0) {
      console.log('🌱 Adding vitals ranges...')
      
      const vitalsRanges = [
        // Adult ranges
        { sex: 'M', metric: 'hr', ageMin: 18, ageMax: 65, min: 60, max: 100, source: 'AHA Guidelines' },
        { sex: 'F', metric: 'hr', ageMin: 18, ageMax: 65, min: 60, max: 100, source: 'AHA Guidelines' },
        { sex: 'M', metric: 'temp', ageMin: 18, ageMax: 65, min: 36.1, max: 37.2, source: 'Clinical Standard' },
        { sex: 'F', metric: 'temp', ageMin: 18, ageMax: 65, min: 36.1, max: 37.2, source: 'Clinical Standard' },
        { sex: 'M', metric: 'sbp', ageMin: 18, ageMax: 65, min: 90, max: 140, source: 'AHA Guidelines' },
        { sex: 'F', metric: 'sbp', ageMin: 18, ageMax: 65, min: 90, max: 140, source: 'AHA Guidelines' },
        { sex: 'M', metric: 'dbp', ageMin: 18, ageMax: 65, min: 60, max: 90, source: 'AHA Guidelines' },
        { sex: 'F', metric: 'dbp', ageMin: 18, ageMax: 65, min: 60, max: 90, source: 'AHA Guidelines' },
        { sex: 'M', metric: 'rr', ageMin: 18, ageMax: 65, min: 12, max: 20, source: 'Clinical Standard' },
        { sex: 'F', metric: 'rr', ageMin: 18, ageMax: 65, min: 12, max: 20, source: 'Clinical Standard' },
        { sex: 'M', metric: 'spo2', ageMin: 18, ageMax: 65, min: 95, max: 100, source: 'Clinical Standard' },
        { sex: 'F', metric: 'spo2', ageMin: 18, ageMax: 65, min: 95, max: 100, source: 'Clinical Standard' },
        
        // Pediatric ranges (simplified)
        { sex: 'M', metric: 'hr', ageMin: 1, ageMax: 17, min: 80, max: 120, source: 'Pediatric Guidelines' },
        { sex: 'F', metric: 'hr', ageMin: 1, ageMax: 17, min: 80, max: 120, source: 'Pediatric Guidelines' },
        { sex: 'M', metric: 'temp', ageMin: 1, ageMax: 17, min: 36.1, max: 37.2, source: 'Pediatric Guidelines' },
        { sex: 'F', metric: 'temp', ageMin: 1, ageMax: 17, min: 36.1, max: 37.2, source: 'Pediatric Guidelines' },
        { sex: 'M', metric: 'sbp', ageMin: 1, ageMax: 17, min: 85, max: 110, source: 'Pediatric Guidelines' },
        { sex: 'F', metric: 'sbp', ageMin: 1, ageMax: 17, min: 85, max: 110, source: 'Pediatric Guidelines' },
        { sex: 'M', metric: 'dbp', ageMin: 1, ageMax: 17, min: 50, max: 70, source: 'Pediatric Guidelines' },
        { sex: 'F', metric: 'dbp', ageMin: 1, ageMax: 17, min: 50, max: 70, source: 'Pediatric Guidelines' },
        { sex: 'M', metric: 'rr', ageMin: 1, ageMax: 17, min: 20, max: 30, source: 'Pediatric Guidelines' },
        { sex: 'F', metric: 'rr', ageMin: 1, ageMax: 17, min: 20, max: 30, source: 'Pediatric Guidelines' },
        { sex: 'M', metric: 'spo2', ageMin: 1, ageMax: 17, min: 95, max: 100, source: 'Pediatric Guidelines' },
        { sex: 'F', metric: 'spo2', ageMin: 1, ageMax: 17, min: 95, max: 100, source: 'Pediatric Guidelines' }
      ]
      
      for (const range of vitalsRanges) {
        await db.vitalsRanges.add({
          id: generateId(),
          sex: range.sex as 'M' | 'F' | 'U',
          metric: range.metric as 'hr' | 'rr' | 'temp' | 'sbp' | 'dbp' | 'spo2',
          ageMin: range.ageMin,
          ageMax: range.ageMax,
          min: range.min,
          max: range.max,
          source: range.source,
          updatedAt: new Date()
        })
      }
      
      console.log('✅ Vitals ranges created:', vitalsRanges.length)
    }
    
    console.log('✅ Database seeded successfully')
  } catch (error) {
    console.error('❌ Seeding failed:', error)
    throw error
  }
}