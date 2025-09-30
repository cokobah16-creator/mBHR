import { db, generateId } from './index'
import { generateSalt, hashPin, saltToString } from '@/utils/crypto'

export async function seed() {
  try {
    const existing = await db.users.count()
    if (existing > 0) return

    console.log('🌱 Seeding initial admin user...')

    // Create admin user with PIN 123456
    const salt = await generateSalt()
    const pinHash = await hashPin('123456', salt)
    
    await db.users.add({
      id: generateId(),
      fullName: 'Field Admin',
      role: 'admin',
      email: 'admin@local',
      pinHash,
      pinSalt: saltToString(salt),
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    })

    // Mark admin setup as done
    await db.settings.put({ key: 'adminSetupDone', value: 'true' })

    console.log('✅ Admin user created with PIN: 123456')
  } catch (error) {
    console.error('❌ Seeding failed:', error)
  }
}