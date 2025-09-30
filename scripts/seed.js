const { db, generateId } = require('../src/db')
const { generateSalt, hashPin, saltToString } = require('../src/utils/crypto')

async function seedDatabase() {
  console.log('🌱 Seeding database...')

  try {
    // Check if already seeded
    const userCount = await db.users.count()
    if (userCount > 0) {
      console.log('Database already seeded')
      return
    }

    // Create sample users
    const adminSalt = await generateSalt()
    const adminPinHash = await hashPin('123456', adminSalt)
    
    const nurseSalt = await generateSalt()
    const nursePinHash = await hashPin('111111', nurseSalt)
    
    const doctorSalt = await generateSalt()
    const doctorPinHash = await hashPin('222222', doctorSalt)

    const users = [
      {
        id: generateId(),
        fullName: 'Dr. Admin User',
        role: 'admin',
        email: 'admin@mbhr.org',
        phone: '+2348012345678',
        pinHash: adminPinHash,
        pinSalt: saltToString(adminSalt),
        createdAt: new Date(),
        updatedAt: new Date(),
        isActive: true
      },
      {
        id: generateId(),
        fullName: 'Nurse Mary',
        role: 'nurse',
        phone: '+2348012345679',
        pinHash: nursePinHash,
        pinSalt: saltToString(nurseSalt),
        createdAt: new Date(),
        updatedAt: new Date(),
        isActive: true
      },
      {
        id: generateId(),
        fullName: 'Dr. John Smith',
        role: 'doctor',
        email: 'doctor@mbhr.org',
        phone: '+2348012345680',
        pinHash: doctorPinHash,
        pinSalt: saltToString(doctorSalt),
        createdAt: new Date(),
        updatedAt: new Date(),
        isActive: true
      }
    ]

    await db.users.bulkAdd(users)

    // Create sample inventory
    const inventory = [
      {
        id: generateId(),
        itemName: 'Paracetamol 500mg',
        unit: 'tablets',
        onHandQty: 1000,
        reorderThreshold: 100,
        updatedAt: new Date()
      },
      {
        id: generateId(),
        itemName: 'Amoxicillin 250mg',
        unit: 'capsules',
        onHandQty: 500,
        reorderThreshold: 50,
        updatedAt: new Date()
      },
      {
        id: generateId(),
        itemName: 'ORS Sachets',
        unit: 'sachets',
        onHandQty: 200,
        reorderThreshold: 20,
        updatedAt: new Date()
      },
      {
        id: generateId(),
        itemName: 'Multivitamin Syrup',
        unit: 'bottles',
        onHandQty: 50,
        reorderThreshold: 10,
        updatedAt: new Date()
      },
      {
        id: generateId(),
        itemName: 'Bandages',
        unit: 'rolls',
        onHandQty: 25,
        reorderThreshold: 5,
        updatedAt: new Date()
      }
    ]

    await db.inventory.bulkAdd(inventory)

    // Create sample patients
    const patients = [
      {
        id: generateId(),
        givenName: 'Amina',
        familyName: 'Ibrahim',
        sex: 'female',
        dob: '1985-03-15',
        phone: '+2348123456789',
        address: '123 Market Street, Kano',
        state: 'Kano',
        lga: 'Kano Municipal',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: generateId(),
        givenName: 'Chidi',
        familyName: 'Okafor',
        sex: 'male',
        dob: '1990-07-22',
        phone: '+2348123456790',
        address: '456 Lagos Road, Ikeja',
        state: 'Lagos',
        lga: 'Ikeja',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: generateId(),
        givenName: 'Fatima',
        familyName: 'Yusuf',
        sex: 'female',
        dob: '1978-11-08',
        phone: '+2348123456791',
        address: '789 Central Avenue, Abuja',
        state: 'FCT',
        lga: 'Municipal Area Council',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]

    await db.patients.bulkAdd(patients)

    // Mark admin setup as done
    await db.settings.put({ key: 'adminSetupDone', value: 'true' })

    console.log('✅ Database seeded successfully!')
    console.log('👤 Users created:')
    console.log('   - Admin: PIN 123456')
    console.log('   - Nurse: PIN 111111') 
    console.log('   - Doctor: PIN 222222')
    console.log('📦 Inventory items: 5')
    console.log('👥 Sample patients: 3')

  } catch (error) {
    console.error('❌ Seeding failed:', error)
  }
}

// Run if called directly
if (require.main === module) {
  seedDatabase()
}

module.exports = { seedDatabase }