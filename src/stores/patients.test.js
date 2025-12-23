import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePatientsStore } from './patients';
const mockPatients = new Map();
const mockQueue = [];
const mockVisits = [];
vi.mock('@/db', () => ({
    db: {
        patients: {
            orderBy: vi.fn(() => ({
                reverse: vi.fn(() => ({
                    toArray: vi.fn(() => Promise.resolve(Array.from(mockPatients.values())))
                }))
            })),
            filter: vi.fn((filterFn) => ({
                toArray: vi.fn(() => {
                    const results = Array.from(mockPatients.values()).filter(filterFn);
                    return Promise.resolve(results);
                })
            })),
            add: vi.fn((patient) => {
                mockPatients.set(patient.id, patient);
                return Promise.resolve(patient.id);
            }),
            update: vi.fn((id, updates) => {
                const patient = mockPatients.get(id);
                if (patient) {
                    mockPatients.set(id, { ...patient, ...updates });
                }
                return Promise.resolve(1);
            }),
            count: vi.fn(() => Promise.resolve(mockPatients.size))
        },
        queue: {
            add: vi.fn((item) => {
                mockQueue.push(item);
                return Promise.resolve(item.id);
            }),
            count: vi.fn(() => Promise.resolve(mockQueue.length))
        },
        visits: {
            add: vi.fn((visit) => {
                mockVisits.push(visit);
                return Promise.resolve(visit.id);
            })
        }
    },
    generateId: () => `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createAuditLog: vi.fn(() => Promise.resolve()),
    createPatientDraft: vi.fn(async (data) => ({
        rec: {
            id: `patient-${Date.now()}`,
            ...data,
            dob: data.dob.toISOString().split('T')[0],
            createdAt: new Date(),
            updatedAt: new Date()
        },
        candidates: []
    })),
    epochDay: vi.fn(() => 19000),
    bumpDailyCount: vi.fn(() => Promise.resolve())
}));
describe('usePatientsStore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockPatients.clear();
        mockQueue.length = 0;
        mockVisits.length = 0;
        usePatientsStore.setState({
            patients: [],
            currentPatient: null,
            searchQuery: ''
        });
    });
    describe('initial state', () => {
        it('should have empty initial state', () => {
            const state = usePatientsStore.getState();
            expect(state.patients).toEqual([]);
            expect(state.currentPatient).toBeNull();
            expect(state.searchQuery).toBe('');
        });
    });
    describe('loadPatients', () => {
        it('should load patients from database', async () => {
            mockPatients.set('p1', {
                id: 'p1',
                givenName: 'John',
                familyName: 'Doe',
                createdAt: new Date()
            });
            mockPatients.set('p2', {
                id: 'p2',
                givenName: 'Jane',
                familyName: 'Smith',
                createdAt: new Date()
            });
            await usePatientsStore.getState().loadPatients();
            const state = usePatientsStore.getState();
            expect(state.patients).toHaveLength(2);
        });
    });
    describe('searchPatients', () => {
        beforeEach(() => {
            mockPatients.set('p1', {
                id: 'p1',
                givenName: 'John',
                familyName: 'Doe',
                phone: '08012345678'
            });
            mockPatients.set('p2', {
                id: 'p2',
                givenName: 'Jane',
                familyName: 'Smith',
                phone: '08087654321'
            });
            mockPatients.set('p3', {
                id: 'p3',
                givenName: 'Johnson',
                familyName: 'Williams',
                phone: '07011112222'
            });
            usePatientsStore.setState({
                patients: Array.from(mockPatients.values())
            });
        });
        it('should return all patients for empty query', async () => {
            const results = await usePatientsStore.getState().searchPatients('');
            expect(results).toHaveLength(3);
        });
        it('should search by given name', async () => {
            const results = await usePatientsStore.getState().searchPatients('John');
            expect(results.length).toBeGreaterThan(0);
            expect(results.some(p => p.givenName === 'John')).toBe(true);
        });
        it('should search by family name', async () => {
            const results = await usePatientsStore.getState().searchPatients('Smith');
            expect(results).toHaveLength(1);
            expect(results[0].familyName).toBe('Smith');
        });
        it('should search by phone number', async () => {
            const results = await usePatientsStore.getState().searchPatients('08012345678');
            expect(results).toHaveLength(1);
            expect(results[0].phone).toBe('08012345678');
        });
        it('should be case insensitive', async () => {
            const results = await usePatientsStore.getState().searchPatients('john');
            expect(results.length).toBeGreaterThan(0);
        });
        it('should return empty array for no matches', async () => {
            const results = await usePatientsStore.getState().searchPatients('xyz123');
            expect(results).toHaveLength(0);
        });
    });
    describe('setCurrentPatient', () => {
        it('should set current patient', () => {
            const patient = { id: 'p1', givenName: 'Test' };
            usePatientsStore.getState().setCurrentPatient(patient);
            expect(usePatientsStore.getState().currentPatient).toEqual(patient);
        });
        it('should clear current patient when set to null', () => {
            usePatientsStore.setState({
                currentPatient: { id: 'p1' }
            });
            usePatientsStore.getState().setCurrentPatient(null);
            expect(usePatientsStore.getState().currentPatient).toBeNull();
        });
    });
    describe('setSearchQuery', () => {
        it('should set search query', () => {
            usePatientsStore.getState().setSearchQuery('test query');
            expect(usePatientsStore.getState().searchQuery).toBe('test query');
        });
    });
    describe('startVisit', () => {
        it('should create a new visit', async () => {
            const visitId = await usePatientsStore.getState().startVisit('patient-1', 'Test Clinic');
            expect(visitId).toBeDefined();
            expect(mockVisits).toHaveLength(1);
            expect(mockVisits[0].patientId).toBe('patient-1');
            expect(mockVisits[0].siteName).toBe('Test Clinic');
            expect(mockVisits[0].status).toBe('open');
        });
    });
    describe('updatePatient', () => {
        it('should update patient in database', async () => {
            mockPatients.set('p1', {
                id: 'p1',
                givenName: 'John',
                familyName: 'Doe',
                phone: '08012345678'
            });
            await usePatientsStore.getState().updatePatient('p1', { phone: '08099999999' });
            const updated = mockPatients.get('p1');
            expect(updated.phone).toBe('08099999999');
        });
    });
});
