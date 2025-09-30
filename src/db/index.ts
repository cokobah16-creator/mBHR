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
  isActive: boolean
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
    
    // v1 — KEEP SAME PK 'id' everywhere; add only secondary indexes in future versions
    this.version(1).stores({
      patients:      'id, familyName, phone, state, lga, createdAt, updatedAt',
      vitals:        'id, patientId, visitId, takenAt, systolic, diastolic',
      consultations: 'id, patientId, visitId, createdAt, providerName',
      dispenses:     'id, patientId, visitId, dispensedAt, itemName',
      inventory:     'id, itemName, updatedAt, onHandQty',
      visits:        'id, patientId, startedAt, status, siteName',
      queue:         'id, patientId, stage, position, status, updatedAt',
      auditLogs:     'id, actorRole, entity, entityId, at',
      users:         'id, fullName, role, email, isActive, createdAt, updatedAt',
      sessions:      'id, userId, createdAt, lastSeenAt',
      settings:      'key'
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