// src/db/mbhr.ts
import Dexie, { Table } from 'dexie'
import { ulid as _ulid } from 'ulid'

export interface Ticket {
  id: string
  number: string
  patientId?: string
  category: 'adult'|'child'|'antenatal'|string
  priority: 'urgent'|'normal'|'low'|string
  createdAt: string
  siteId: string
  state: 'waiting'|'in_progress'|'done'|'skipped'
  currentStage: 'registration'|'vitals'|'consult'|'pharmacy'|string
}

export interface InventoryNM {
  id: string
  itemName: string
  unit: string
  onHandQty: number
  reorderThreshold: number
  minQty?: number
  maxQty?: number
  updatedAt: string
  siteId?: string
}

export interface PharmacyItem {
  id: string
  medName: string
  form: string
  strength: string
  unit: string
  onHandQty: number
  reorderThreshold: number
  isControlled?: boolean
  updatedAt: string
}

export interface PharmacyBatch {
  id: string
  itemId: string
  lotNumber: string
  expiryDate: string
  qtyOnHand: number
  receivedAt: string
  supplier?: string
}

export interface Gamification {
  id: string
  volunteerId: string
  tokens: number
  badges: string[]
  updatedAt: string
}

export interface QueueMetric {
  id: string
  stage: 'registration'|'vitals'|'consult'|'pharmacy'
  avgServiceSec: number
  updatedAt: string
}

export interface DailyCounter {
  id: string
  siteId: string
  dateStr: string
  category: string
  seq: number
}

class MBHRDB extends Dexie {
  tickets!: Table<Ticket, string>
  inventory_nm!: Table<InventoryNM, string>
  pharmacy_items!: Table<PharmacyItem, string>
  pharmacy_batches!: Table<PharmacyBatch, string>
  gamification!: Table<Gamification, string>
  queue_metrics!: Table<QueueMetric, string>
  daily_counters!: Table<DailyCounter, string>

  constructor() {
    super('mbhr')
    // Keep indexes minimal and compatible with the screens we added
    this.version(1).stores({
      tickets: 'id, number, currentStage, state, createdAt',
      inventory_nm: 'id, itemName, updatedAt, reorderThreshold',
      pharmacy_items: 'id, medName, updatedAt',
      pharmacy_batches: 'id, itemId, expiryDate',
      gamification: 'id, volunteerId, updatedAt',
      queue_metrics: 'id, stage, updatedAt',
      daily_counters: 'id, siteId, dateStr, category'
    })
  }
}

export const db = new MBHRDB()

// small helper passthrough so other files can do `import { ulid } from '@/db/mbhr'`
export const ulid = () => _ulid()