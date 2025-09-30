// src/db/seedMbhr.ts
import { db as mbhrDb, ulid } from './mbhr'

export async function seedDemo() {
  const hasItems = await mbhrDb.inventory_nm.count()
  if (hasItems) return

  const now = new Date().toISOString()
  await mbhrDb.inventory_nm.bulkAdd([
    { id: ulid(), itemName: 'Water (0.5L)', unit: 'bottles', onHandQty: 120, reorderThreshold: 60, updatedAt: now },
    { id: ulid(), itemName: 'Volunteer T-shirt (L)', unit: 'pcs', onHandQty: 18, reorderThreshold: 40, updatedAt: now },
    { id: ulid(), itemName: 'Wristbands', unit: 'pcs', onHandQty: 5, reorderThreshold: 30, updatedAt: now }
  ])

  await mbhrDb.pharmacy_items.bulkAdd([
    { id: ulid(), medName: 'Paracetamol', form: 'tab', strength: '500mg', unit: 'tabs', onHandQty: 520, reorderThreshold: 100, updatedAt: now },
    { id: ulid(), medName: 'Amoxicillin', form: 'cap', strength: '500mg', unit: 'caps', onHandQty: 180, reorderThreshold: 60, updatedAt: now }
  ])

  // Add some sample batches
  const paracetamolItem = await mbhrDb.pharmacy_items.where('medName').equals('Paracetamol').first()
  const amoxicillinItem = await mbhrDb.pharmacy_items.where('medName').equals('Amoxicillin').first()

  if (paracetamolItem) {
    await mbhrDb.pharmacy_batches.add({
      id: ulid(),
      itemId: paracetamolItem.id,
      lotNumber: 'PAR2024001',
      expiryDate: '2025-12-31',
      qtyOnHand: 520,
      receivedAt: now,
      supplier: 'MedSupply Co'
    })
  }

  if (amoxicillinItem) {
    await mbhrDb.pharmacy_batches.add({
      id: ulid(),
      itemId: amoxicillinItem.id,
      lotNumber: 'AMX2024001',
      expiryDate: '2025-06-30',
      qtyOnHand: 180,
      receivedAt: now,
      supplier: 'PharmaCorp'
    })
  }

  // Add demo gamification record
  await mbhrDb.gamification.add({
    id: 'demo',
    volunteerId: 'demo',
    tokens: 450,
    badges: ['first_restock', 'team_player'],
    updatedAt: now
  })

  // Add queue metrics
  const stages: Array<'registration'|'vitals'|'consult'|'pharmacy'> = ['registration', 'vitals', 'consult', 'pharmacy']
  for (const stage of stages) {
    await mbhrDb.queue_metrics.add({
      id: `m-${stage}`,
      stage,
      avgServiceSec: 240,
      updatedAt: now
    })
  }

  console.log('✅ MBHR demo data seeded')
}