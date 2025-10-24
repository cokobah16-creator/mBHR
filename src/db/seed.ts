import { db, User, generateId } from './index'
import { derivePinHash, newSaltB64 } from '@/utils/pin'
import { epochDay, bumpDailyCount } from './index'
import { seedVitalsRanges } from './seedVitalsRanges'

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

        console.log(`Creating user: ${userData.fullName}, PIN: ${userData.pin}`)
        console.log(`  Salt: ${pinSalt.substring(0, 10)}...`)
        console.log(`  Hash: ${pinHash.substring(0, 20)}...`)

        const userId = generateId()
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
          updatedAt: new Date()
        })

        // Verify the user was created correctly
        const createdUser = await db.users.get(userId)
        if (createdUser) {
          console.log(`✓ User created: ${createdUser.fullName}, Active: ${createdUser.isActive}, HasHash: ${!!createdUser.pinHash}, HasSalt: ${!!createdUser.pinSalt}`)
        }
      }

      console.log('✅ Users created with PINs: 123456, 234567, 345678, 456789, 567890, 070398')

      // Final verification
      const allUsers = await db.users.where('isActive').equals(1).toArray()
      console.log(`✅ Verified ${allUsers.length} active users in database`)
      allUsers.forEach(u => {
        console.log(`  - ${u.fullName} (${u.role}) - Hash: ${u.pinHash?.substring(0, 10)}..., Salt: ${u.pinSalt?.substring(0, 10)}...`)
      })
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
      console.log('🌱 Adding comprehensive vitals reference ranges...')
      await seedVitalsRanges()
      const finalCount = await db.vitalsRanges.count()
      console.log(`✅ Vitals ranges created: ${finalCount} reference ranges`)
    }
    
    // Seed daily counts for the last 7 days
    const dailyCountsCount = await db.dailyCounts.count()
    if (dailyCountsCount === 0) {
      console.log('📊 Creating demo daily counts...')
      
      for (let i = 6; i >= 0; i--) {
        const date = new Date()
        date.setDate(date.getDate() - i)
        const day = epochDay(date)
        
        // Generate realistic demo data
        const registrations = Math.floor(Math.random() * 20) + 10 // 10-30 registrations
        const vitals = Math.floor(registrations * 0.8) // 80% get vitals
        const consultations = Math.floor(vitals * 0.9) // 90% of vitals get consults
        const dispenses = Math.floor(consultations * 0.7) // 70% get medications
        const visits = registrations // Same as registrations
        
        await db.dailyCounts.add({
          day,
          registrations,
          vitals,
          consultations,
          dispenses,
          visits
        })
      }
      
      console.log('✅ Daily counts seeded for last 7 days')
    }
    
    console.log('✅ Database seeded successfully')
  } catch (error) {
    console.error('❌ Seeding failed:', error)
    throw error
  }
}