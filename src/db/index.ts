import Dexie, { Table } from 'dexie'
import { ulid } from 'ulid'

// Types
export interface User {
  id: string
  fullName: string
  role: 'admin' | 'doctor' | 'nurse' | 'pharmacist' | 'volunteer'
  email?: string
  phone?: string
  pinHash: string
  pinSalt: string
  createdAt: Date
  updatedAt: Date
  isActive: 0 | 1
}

export interface Session {
  id: string
  userId: string
  createdAt: Date
  deviceKey: string
  lastSeenAt: Date
}

export interface Setting {
  key: string
  value: string
}

export interface Patient {
  id: string
  givenName: string
  familyName: string
  sex: 'male' | 'female' | 'other'
  dob: string
  phone: string
  address: string
  state: string
  lga: string
  photoUrl?: string
  familyId?: string
  createdAt: Date
  updatedAt: Date
  _dirty?: number
  _syncedAt?: string
}

export interface Vital {
  id: string
  patientId: string
  visitId: string
  heightCm?: number
  weightKg?: number
  tempC?: number
  pulseBpm?: number
  systolic?: number
  diastolic?: number
  spo2?: number
  bmi?: number
  flags: string[]
  takenAt: Date
  _dirty?: number
  _syncedAt?: string
}

export interface Consultation {
  id: string
  patientId: string
  visitId: string
  providerName: string
  soapSubjective: string
  soapObjective: string
  soapAssessment: string
  soapPlan: string
  provisionalDx: string[]
  createdAt: Date
  _dirty?: number
  _syncedAt?: string
}

export interface Dispense {
  id: string
  patientId: string
  visitId: string
  itemName: string
  qty: number
  dosage: string
  directions: string
  dispensedBy: string
  dispensedAt: Date
  _dirty?: number
  _syncedAt?: string
}

export interface InventoryItem {
  id: string
  itemName: string
  unit: string
  onHandQty: number
  reorderThreshold: number
  updatedAt: Date
  _dirty?: number
  _syncedAt?: string
}

export interface Visit {
  id: string
  patientId: string
  startedAt: Date
  siteName: string
  status: 'open' | 'closed'
  _dirty?: number
  _syncedAt?: string
}

export interface QueueItem {
  id: string
  patientId: string
  stage: 'registration' | 'vitals' | 'consult' | 'pharmacy'
  position: number
  status: 'waiting' | 'in_progress' | 'done'
  updatedAt: Date
  _dirty?: number
  _syncedAt?: string
}

export interface AuditLog {
  id: string
  actorRole: string
  action: string
  entity: string
  entityId: string
  at: Date
}

// Database name - bumped to avoid incompatible older store
export const DB_NAME = 'mbhr_v3'

// Database class
export class MBHRDatabase extends Dexie {
  users!: Table<User>
  sessions!: Table<Session>
  settings!: Table<Setting>
  patients!: Table<Patient>
  vitals!: Table<Vital>
  consultations!: Table<Consultation>
  dispenses!: Table<Dispense>
  inventory!: Table<InventoryItem>
  visits!: Table<Visit>
  queue!: Table<QueueItem>
  auditLogs!: Table<AuditLog>

  constructor() {
    super(DB_NAME)
    
    // v1 — Initial schema with stable PKs
    this.version(1).stores({
      patients:      'id, familyName, phone, state, lga, createdAt, updatedAt',
      vitals:        'id, patientId, visitId, takenAt, systolic, diastolic',
      consultations: 'id, patientId, visitId, createdAt, providerName',
      dispenses:     'id, patientId, visitId, dispensedAt, itemName',
      inventory:     'id, itemName, updatedAt, onHandQty',
      visits:        'id, patientId, startedAt, status, siteName',
      queue:         'id, patientId, stage, position, status, updatedAt',
      auditLogs:     'id, actorRole, entity, entityId, at',
      users:         'id, fullName, role, email, pinHash, createdAt, updatedAt',
      sessions:      'id, userId, createdAt, lastSeenAt',
      settings:      'key'
    })

    // v2 — Add sync indexes for _dirty and _syncedAt
    this.version(2).stores({
      patients:      'id, familyName, phone, state, lga, createdAt, updatedAt, _dirty, _syncedAt',
      vitals:        'id, patientId, visitId, takenAt, systolic, diastolic, _dirty, _syncedAt',
      consultations: 'id, patientId, visitId, createdAt, providerName, _dirty, _syncedAt',
      dispenses:     'id, patientId, visitId, dispensedAt, itemName, _dirty, _syncedAt',
      inventory:     'id, itemName, updatedAt, onHandQty, _dirty, _syncedAt',
      visits:        'id, patientId, startedAt, status, siteName, _dirty, _syncedAt',
      queue:         'id, patientId, stage, position, status, updatedAt, _dirty, _syncedAt',
      auditLogs:     'id, actorRole, entity, entityId, at',
      users:         'id, fullName, role, email, pinHash, createdAt, updatedAt',
      sessions:      'id, userId, createdAt, lastSeenAt',
      settings:      'key'
    })

    // v3 — Add isActive index to users table
    this.version(3).stores({
      patients:      'id, familyName, phone, state, lga, createdAt, updatedAt, _dirty, _syncedAt',
      vitals:        'id, patientId, visitId, takenAt, systolic, diastolic, _dirty, _syncedAt',
      consultations: 'id, patientId, visitId, createdAt, providerName, _dirty, _syncedAt',
      dispenses:     'id, patientId, visitId, dispensedAt, itemName, _dirty, _syncedAt',
      inventory:     'id, itemName, updatedAt, onHandQty, _dirty, _syncedAt',
      visits:        'id, patientId, startedAt, status, siteName, _dirty, _syncedAt',
      queue:         'id, patientId, stage, position, status, updatedAt, _dirty, _syncedAt',
      auditLogs:     'id, actorRole, entity, entityId, at',
      users:         'id, fullName, role, email, pinHash, pinSalt, isActive, createdAt, updatedAt',
      sessions:      'id, userId, createdAt, lastSeenAt',
      settings:      'key'
    }).upgrade(async tx => {
      // Set default isActive = true for existing users that lack this field
      await tx.table('users').toCollection().modify(user => {
        if (typeof (user as any).isActive === 'undefined') {
          (user as any).isActive = 1
        }
      })
    })

    // v4 — Convert isActive boolean to numeric (0/1) for IndexedDB compatibility
    this.version(4).stores({
      patients:      'id, familyName, phone, state, lga, createdAt, updatedAt, _dirty, _syncedAt',
      vitals:        'id, patientId, visitId, takenAt, systolic, diastolic, _dirty, _syncedAt',
      consultations: 'id, patientId, visitId, createdAt, providerName, _dirty, _syncedAt',
      dispenses:     'id, patientId, visitId, dispensedAt, itemName, _dirty, _syncedAt',
      inventory:     'id, itemName, updatedAt, onHandQty, _dirty, _syncedAt',
      visits:        'id, patientId, startedAt, status, siteName, _dirty, _syncedAt',
      queue:         'id, patientId, stage, position, status, updatedAt, _dirty, _syncedAt',
      auditLogs:     'id, actorRole, entity, entityId, at',
      users:         'id, fullName, role, email, pinHash, pinSalt, isActive, createdAt, updatedAt',
      sessions:      'id, userId, createdAt, lastSeenAt',
      settings:      'key'
    }).upgrade(async tx => {
      // Convert boolean isActive values to numeric (0/1)
      await tx.table('users').toCollection().modify(user => {
        if (typeof (user as any).isActive === 'boolean') {
          (user as any).isActive = (user as any).isActive ? 1 : 0
        }
      })
    })
  }
}

export const db = new MBHRDatabase()

// Helper functions
export const generateId = () => ulid()

export const createAuditLog = async (
  actorRole: string,
  action: string,
  entity: string,
  entityId: string
) => {
  await db.auditLogs.add({
    id: generateId(),
    actorRole,
    action,
    entity,
    entityId,
    at: new Date()
  })
}