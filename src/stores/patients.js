import { create } from 'zustand';
import { db, generateId, createAuditLog, createPatientDraft, epochDay, bumpDailyCount } from '@/db';
export const usePatientsStore = create((set, get) => ({
    patients: [],
    currentPatient: null,
    searchQuery: '',
    loadPatients: async () => {
        try {
            const patients = await db.patients.orderBy('createdAt').reverse().toArray();
            console.log('Loaded patients from database:', patients.length, patients);
            set({ patients });
        }
        catch (error) {
            console.error('Error loading patients:', error);
        }
    },
    searchPatients: async (query) => {
        if (!query.trim()) {
            return get().patients;
        }
        try {
            const results = await db.patients
                .filter(patient => patient.givenName.toLowerCase().includes(query.toLowerCase()) ||
                patient.familyName.toLowerCase().includes(query.toLowerCase()) ||
                patient.phone.includes(query))
                .toArray();
            return results;
        }
        catch (error) {
            console.error('Error searching patients:', error);
            return [];
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
            });
            // If duplicates found, return for user resolution
            if (candidates.length > 0) {
                throw new Error(`DUPLICATES_FOUND:${JSON.stringify({ patient: rec, candidates })}`);
            }
            const patient = {
                ...rec,
                photoUrl: patientData.photoUrl
            };
            await db.patients.add(patient);
            console.log('Patient added to database:', patient);
            // Bump daily count
            await bumpDailyCount(epochDay(new Date()), 'registrations');
            // Add to queue for registration
            const queueItem = {
                id: generateId(),
                patientId: patient.id,
                stage: 'registration',
                position: await db.queue.count() + 1,
                status: 'waiting',
                priority: 'normal',
                queuedAt: new Date(),
                updatedAt: new Date(),
                _dirty: 1
            };
            await db.queue.add(queueItem);
            console.log('Queue item added:', queueItem);
            // Audit log
            await createAuditLog('system', 'create', 'patient', patient.id);
            // Refresh patients list
            await get().loadPatients();
            console.log('Patients list refreshed');
            return patient.id;
        }
        catch (error) {
            console.error('Error adding patient:', error);
            throw error;
        }
    },
    updatePatient: async (id, updates) => {
        try {
            await db.patients.update(id, {
                ...updates,
                updatedAt: new Date()
            });
            await createAuditLog('system', 'update', 'patient', id);
            get().loadPatients();
        }
        catch (error) {
            console.error('Error updating patient:', error);
            throw error;
        }
    },
    setCurrentPatient: (patient) => {
        set({ currentPatient: patient });
    },
    setSearchQuery: (query) => {
        set({ searchQuery: query });
    },
    startVisit: async (patientId, siteName) => {
        try {
            const visit = {
                id: generateId(),
                patientId,
                startedAt: new Date(),
                siteName,
                status: 'open'
            };
            await db.visits.add(visit);
            await createAuditLog('system', 'create', 'visit', visit.id);
            return visit.id;
        }
        catch (error) {
            console.error('Error starting visit:', error);
            throw error;
        }
    },
    checkForDuplicates: async (patientData) => {
        const result = await createPatientDraft({
            givenName: patientData.givenName,
            familyName: patientData.familyName,
            phone: patientData.phone,
            dob: new Date(patientData.dob),
            sex: patientData.sex,
            address: patientData.address,
            state: patientData.state,
            lga: patientData.lga
        });
        return { patient: result.rec, candidates: result.candidates };
    }
}));
