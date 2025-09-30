// src/db/mbhr.ts
import Dexie, { Table } from 'dexie'

// ---------- Types ----------
export type ISO = string

export interface InventoryNM {
  id: string
  itemName: string
  unit: string
  onHandQty: number
  reorderThreshold: number
  minQty?: number
  maxQty?: number
  updatedAt: ISO
  siteId?: string
}

export interface StockMoveNM {
  id: string
  itemId: string
  qtyDelta: number               // +restock | -consume | -adjust
  reason: 'restock'|'consume'|'adjust'
  actorId?: string
  note?: string
  createdAt: ISO
  approvedBy?: string
  approvedAt?: ISO
}

export interface Gamification {
  id: string
  volunteerId: string
  tokens: number
  badges: string[]
  updatedAt: ISO
}

export interface RestockSession {
  id: string
  volunteerId: string
  startedAt: ISO
  finishedAt?: ISO
  deltas: Array<{ itemId: string; qty: number }>
  tokensEarned: number
  committed: boolean
}

export interface AlertNM {
  id: string
  itemId: string
  level: 'low'|'critical'
  triggeredAt: ISO
  clearedAt?: ISO
}

export interface PharmacyItem {
  id: string
  medName: string
  form: string            // 'tab' | 'cap' | 'syrup' | ...
  strength: string        // '500mg'
  unit: string            // 'tabs'
  onHandQty: number
  reorderThreshold: number
  isControlled?: boolean
  updatedAt: ISO
}

export interface PharmacyBatch {
  id: string
  itemId: string
  lotNumber: string
  expiryDate: ISO
  qtyOnHand: number
  receivedAt: ISO
  supplier?: string
}

export interface Prescription {
  id: string
  visitId: string
  patientId: string
  prescriberId: string
  lines: Array<{
    itemId: string
    dosage: string
    frequency: string
    durationDays: number
    qty: number
    notes?: string
  }>
  createdAt: ISO
  status: 'open'|'dispensed'|'partial'|'void'
}

export interface Dispense {
  id: string
  prescriptionId: string
  patientId: string
  itemId: string
  batchId: string
  qty: number
  dispensedBy: string
  dispensedAt: ISO
}

export interface StockMoveRX {
  id: string
  itemId: string
  batchId?: string
  qtyDelta: number               // +receipt | -dispense | -adjust
  reason: 'receipt'|'dispense'|'adjust'
  actorId?: string
  createdAt: ISO
}

export interface Ticket {
  id: string
  number: string                 // e.g., A-104
  patientId?: string
  category: 'adult'|'child'|'antenatal'|'other'
  priority: 'urgent'|'normal'|'low'
  createdAt: ISO
  siteId: string
  state: 'waiting'|'in_progress'|'done'|'skipped'
  currentStage: 'registration'|'vitals'|'consult'|'pharmacy'
}

export interface StageEvent {
  id: string
  ticketId: string
  stage: string
  startedAt?: ISO
  finishedAt?: ISO
  actorId?: string
}

export interface QueueMetric {
  id: string
  stage: 'registration'|'vitals'|'consult'|'pharmacy'
  avgServiceSec: number
  updatedAt: ISO
}

export interface Notification {
  id: string
  ticketId: string
  channel: 'push'|'sms'|'display'
  payload: any
  sentAt?: ISO
  status: 'queued'|'sent'|'failed'
}

export interface DailyCounter {
  id: string                      // `${siteId}:${date}:${category}`
  siteId: string
  dateStr: string                 // YYYY-MM-DD
  category: string
  seq: number
}

// ---------- DB ----------
export class MBHRDB extends Dexie {
  inventory_nm!: Table<InventoryNM, string>
  stock_moves_nm!: Table<StockMoveNM, string>
  gamification!: Table<Gamification, string>
  restock_sessions!: Table<RestockSession, string>
  alerts_nm!: Table<AlertNM, string>

  pharmacy_items!: Table<PharmacyItem, string>
  pharmacy_batches!: Table<PharmacyBatch, string>
  prescriptions!: Table<Prescription, string>
  dispenses!: Table<Dispense, string>
  stock_moves_rx!: Table<StockMoveRX, string>

  tickets!: Table<Ticket, string>
  stage_events!: Table<StageEvent, string>
  queue_metrics!: Table<QueueMetric, string>
  notifications!: Table<Notification, string>
  daily_counters!: Table<DailyCounter, string>

  constructor() {
    super('mbhr')

    // v1 initial schemas
    this.version(1).stores({
      // non-med inventory
      inventory_nm: 'id, itemName, updatedAt, reorderThreshold',
      stock_moves_nm: 'id, itemId, createdAt',
      gamification: 'id, volunteerId, updatedAt',
      restock_sessions: 'id, volunteerId, committed',
      alerts_nm: 'id, itemId, level, triggeredAt',

      // pharmacy
      pharmacy_items: 'id, medName, updatedAt, reorderThreshold',
      pharmacy_batches: 'id, itemId, expiryDate',
      prescriptions: 'id, patientId, createdAt, status',
      dispenses: 'id, prescriptionId, patientId, dispensedAt',
      stock_moves_rx: 'id, itemId, batchId, createdAt',

      // ticketing
      tickets: 'id, number, currentStage, state, createdAt',
      stage_events: 'id, ticketId, stage, startedAt, finishedAt',
      queue_metrics: 'id, stage, updatedAt',
      notifications: 'id, ticketId, channel, status, sentAt',
      daily_counters: 'id, siteId, dateStr, category'
    })
  }
}

export const mbhrDb = new MBHRDB()

// ---------- Helpers ----------
export const ulid = () =>
  // ULID-ish (enough for client use)
  Date.now().toString(36) + Math.random().toString(36).slice(2, 10)

// low-stock watcher (call after each movement)
export async function refreshAlertsFor(itemId: string) {
  const it = await mbhrDb.inventory_nm.get(itemId)
  if (!it) return
  const level: AlertNM['level'] | null =
    it.onHandQty <= Math.max(1, it.reorderThreshold / 3) ? 'critical'
    : it.onHandQty <= it.reorderThreshold ? 'low'
    : null

  // clear existing
  const existing = await mbhrDb.alerts_nm.where('itemId').equals(itemId).toArray()
  await mbhrDb.alerts_nm.bulkDelete(existing.map(a => a.id))

  if (level) {
    await mbhrDb.alerts_nm.add({
      id: ulid(),
      itemId,
      level,
      triggeredAt: new Date().toISOString()
    })
  }
}