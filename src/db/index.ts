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
  dob: Date
  phone: string
  address: string
  state: string
  lga: string
  photoUrl?: string
  familyId?: string
  createdAt: Date
  updatedAt: Date
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
}

export interface InventoryItem {
  id: string
  itemName: string
  unit: string
  onHandQty: number
  reorderThreshold: number
  updatedAt: Date
}

export interface Visit {
  id: string
  patientId: string
  startedAt: Date
  siteName: string
  status: 'open' | 'closed'
}

export interface QueueItem {
  id: string
  patientId: string
  stage: 'registration' | 'vitals' | 'consult' | 'pharmacy'
  position: number
  status: 'waiting' | 'in_progress' | 'done'
  updatedAt: Date
}

export interface AuditLog {
  id: string
  actorRole: string
  action: string
  entity: string
  entityId: string
  at: Date
}

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
    super('MBHRDatabase')
    
    this.version(1).stores({
      users: 'id, role, email, phone, isActive',
      sessions: 'id, userId, deviceKey',
      settings: 'key',
      patients: 'id, givenName, familyName, phone, familyId',
      vitals: 'id, patientId, visitId, takenAt',
      consultations: 'id, patientId, visitId, createdAt',
      dispenses: 'id, patientId, visitId, dispensedAt',
      inventory: 'id, itemName',
      visits: 'id, patientId, status',
      queue: 'id, patientId, stage, status, position',
      auditLogs: 'id, actorRole, entity, at'
    })

    // Version 2 migration scaffold
    this.version(2).stores({
      users: 'id, role, email, phone, isActive',
      sessions: 'id, userId, deviceKey',
      settings: 'key',
      patients: 'id, givenName, familyName, phone, familyId',
      vitals: 'id, patientId, visitId, takenAt',
      consultations: 'id, patientId, visitId, createdAt',
      dispenses: 'id, patientId, visitId, dispensedAt',
      inventory: 'id, itemName',
      visits: 'id, patientId, status',
      queue: 'id, patientId, stage, status, position',
      auditLogs: 'id, actorRole, entity, at'
    }).upgrade(tx => {
      // Future migration logic here
      console.log('Upgrading to version 2')
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