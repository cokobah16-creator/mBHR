import { create } from 'zustand'
import { db, Patient, Visit, QueueItem, generateId, createAuditLog, createPatientDraft, epochDay, bumpDailyCount } from '@/db'

interface PatientsState {
  patients: Patient[]
  currentPatient: Patient | null
  searchQuery: string
  
  // Actions
  loadPatients: () => Promise<void>
  searchPatients: (query: string) => Promise<Patient[]>
  addPatient: (patient: Omit<Patient, 'id' | 'createdAt' | 'updatedAt'>) => Promise<string>
  updatePatient: (id: string, updates: Partial<Patient>) => Promise<void>
  setCurrentPatient: (patient: Patient | null) => void
  setSearchQuery: (query: string) => void
  startVisit: (patientId: string, siteName: string) => Promise<string>
  checkForDuplicates: (patientData: Omit<Patient, 'id' | 'createdAt' | 'updatedAt'>) => Promise<{ patient: Patient; candidates: Patient[] }>
}

export const usePatientsStore = create<PatientsState>((set, get) => ({
  patients: [],
  currentPatient: null,
  searchQuery: '',

  loadPatients: async () => {
    try {
      const patients = await db.patients.orderBy('createdAt').reverse().toArray()
      console.log('Loaded patients from database:', patients.length, patients)
      set({ patients })
    } catch (error) {
      console.error('Error loading patients:', error)
    }
  },

  searchPatients: async (query: string) => {
    if (!query.trim()) {
      return get().patients
    }
    
    try {
      const results = await db.patients
        .filter(patient => 
          patient.givenName.toLowerCase().includes(query.toLowerCase()) ||
          patient.familyName.toLowerCase().includes(query.toLowerCase()) ||
          patient.phone.includes(query)
        )
        .toArray()
      
      return results
    } catch (error) {
      console.error('Error searching patients:', error)
      return []
    }
  },

  addPatient: async (patientData) => {
    try {
      // Check for duplicates first
      const { rec, candidates } = await createPatientDraft({
        givenName: patientData.givenName,
        familyName: patientData.familyName,
        phone: patientData.phone,
        dob: new Date(patientData.dob),
        sex: patientData.sex,
        address: patientData.address,
        state: patientData.state,
        lga: patientData.lga
      })
      
      // If duplicates found, return for user resolution
      if (candidates.length > 0) {
        throw new Error(`DUPLICATES_FOUND:${JSON.stringify({ patient: rec, candidates })}`)
      }
      
      const patient: Patient = {
        ...rec,
        photoUrl: patientData.photoUrl
      }
      
      await db.patients.add(patient)
      console.log('Patient added to database:', patient)
      
      // Bump daily count
      await bumpDailyCount(epochDay(new Date()), 'registrations')
      
      // Add to queue for registration
      const queueItem: QueueItem = {
        id: generateId(),
        patientId: patient.id,
        stage: 'registration',
        position: await db.queue.count() + 1,
        status: 'waiting',
        updatedAt: new Date()
      }
      
      await db.queue.add(queueItem)
      console.log('Queue item added:', queueItem)
      
      // Audit log
      await createAuditLog('system', 'create', 'patient', patient.id)
      
      // Refresh patients list
      await get().loadPatients()
      console.log('Patients list refreshed')
      
      return patient.id
    } catch (error) {
      console.error('Error adding patient:', error)
      throw error
    }
  },

  updatePatient: async (id: string, updates: Partial<Patient>) => {
    try {
      await db.patients.update(id, {
        ...updates,
        updatedAt: new Date()
      })
      
      await createAuditLog('system', 'update', 'patient', id)
      get().loadPatients()
    } catch (error) {
      console.error('Error updating patient:', error)
      throw error
    }
  },

  setCurrentPatient: (patient: Patient | null) => {
    set({ currentPatient: patient })
  },

  setSearchQuery: (query: string) => {
    set({ searchQuery: query })
  },

  startVisit: async (patientId: string, siteName: string) => {
    try {
      const visit: Visit = {
        id: generateId(),
        patientId,
        startedAt: new Date(),
        siteName,
        status: 'open'
      }
      
      await db.visits.add(visit)
      await createAuditLog('system', 'create', 'visit', visit.id)
      
      return visit.id
    } catch (error) {
      console.error('Error starting visit:', error)
      throw error
    }
  }

  checkForDuplicates: async (patientData) => {
    return createPatientDraft({
      givenName: patientData.givenName,
      familyName: patientData.familyName,
      phone: patientData.phone,
      dob: new Date(patientData.dob),
      sex: patientData.sex,
      address: patientData.address,
      state: patientData.state,
      lga: patientData.lga
    })
  }
}))