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

export interface StockMoveNM {
  id: string
  itemId: string
  qtyDelta: number
  reason: 'restock' | 'consume' | 'adjust'
  actorId?: string
  note?: string
  createdAt: string
  approvedBy?: string
  approvedAt?: string
}

export interface StockMoveRx {
  id: string
  itemId: string
  batchId?: string
  qtyDelta: number
  reason: 'receipt' | 'dispense' | 'adjust'
  actorId?: string
  createdAt: string
}

export interface RestockSession {
  id: string
  volunteerId: string
  startedAt: string
  finishedAt?: string
  deltas: Array<{ itemId: string; qty: number }>
  tokensEarned: number
  committed: boolean
}

export interface AlertNM {
  id: string
  itemId: string
  level: 'low' | 'critical'
  triggeredAt: string
  clearedAt?: string
}

export interface StageEvent {
  id: string
  ticketId: string
  stage: string
  startedAt?: string
  finishedAt?: string
  actorId?: string
}

export interface Notification {
  id: string
  ticketId: string
  channel: string
  payload: Record<string, unknown>
  sentAt?: string
  status: string
}

export interface Prescription {
  id: string
  visitId: string
  patientId: string
  prescriberId: string
  createdAt: string
  status: 'open' | 'dispensed'
  lines: Array<{
    itemId: string
    dosage: string
    frequency: string
    durationDays: number
    qty: number
    notes?: string
  }>
}

export interface Dispense {
  id: string
  prescriptionId: string
  patientId: string
  itemId: string
  batchId: string
  qty: number
  dispensedBy: string
  dispensedAt: string
}
class MBHRDB extends Dexie {
  tickets!: Table<Ticket, string>
  inventory_nm!: Table<InventoryNM, string>
  pharmacy_items!: Table<PharmacyItem, string>
  pharmacy_batches!: Table<PharmacyBatch, string>
  gamification!: Table<Gamification, string>
  queue_metrics!: Table<QueueMetric, string>
  daily_counters!: Table<DailyCounter, string>
  stock_moves_nm!: Table<StockMoveNM, string>
  stock_moves_rx!: Table<StockMoveRx, string>
  prescriptions!: Table<Prescription, string>
  dispenses!: Table<Dispense, string>
  restock_sessions!: Table<RestockSession, string>
  alerts_nm!: Table<AlertNM, string>
  stage_events!: Table<StageEvent, string>
  notifications!: Table<Notification, string>

  constructor() {
    super('mbhr')
    this.version(1).stores({
      tickets: 'id, number, currentStage, state, createdAt',
      inventory_nm: 'id, itemName, updatedAt, reorderThreshold',
      pharmacy_items: 'id, medName, updatedAt',
      pharmacy_batches: 'id, itemId, expiryDate',
      gamification: 'id, volunteerId, updatedAt',
      queue_metrics: 'id, stage, updatedAt',
      daily_counters: 'id, siteId, dateStr, category',
      stock_moves_nm: 'id, itemId, createdAt',
      stock_moves_rx: 'id, itemId, batchId, createdAt',
      prescriptions: 'id, patientId, status, createdAt',
      dispenses: 'id, prescriptionId, patientId, dispensedAt',
    })
    this.version(2).stores({
      tickets: 'id, number, currentStage, state, createdAt',
      inventory_nm: 'id, itemName, updatedAt, reorderThreshold',
      pharmacy_items: 'id, medName, updatedAt',
      pharmacy_batches: 'id, itemId, expiryDate',
      gamification: 'id, volunteerId, updatedAt',
      queue_metrics: 'id, stage, updatedAt',
      daily_counters: 'id, siteId, dateStr, category',
      stock_moves_nm: 'id, itemId, createdAt',
      stock_moves_rx: 'id, itemId, batchId, createdAt',
      prescriptions: 'id, patientId, status, createdAt',
      dispenses: 'id, prescriptionId, patientId, dispensedAt',
      restock_sessions: 'id, volunteerId, startedAt',
      alerts_nm: 'id, itemId, triggeredAt',
      stage_events: 'id, ticketId, stage',
      notifications: 'id, ticketId, status',
    })
  }
}

export const db = new MBHRDB()

// small helper passthrough so other files can do `import { ulid } from '@/db/mbhr'`
export const ulid = () => _ulid()

// ✅ add alias export so `import { mbhrDb } ...` works
export const mbhrDb = db
export default db