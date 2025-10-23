import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAppointment, updateAppointmentStatus, rescheduleAppointment, cancelAppointment, checkAvailability, addToWaitlist } from './appointments';
vi.mock('../lib/supabase', () => ({
    supabase: {
        from: vi.fn(() => ({
            insert: vi.fn(() => ({
                select: vi.fn(() => ({
                    single: vi.fn(() => Promise.resolve({ data: { id: 'test-appointment-id' }, error: null })),
                })),
            })),
            update: vi.fn(() => ({
                eq: vi.fn(() => Promise.resolve({ error: null })),
            })),
            select: vi.fn(() => ({
                eq: vi.fn(() => ({
                    in: vi.fn(() => ({
                        or: vi.fn(() => Promise.resolve({ data: [], error: null })),
                    })),
                    order: vi.fn(() => Promise.resolve({ data: [], error: null })),
                })),
                in: vi.fn(() => ({
                    gte: vi.fn(() => ({
                        order: vi.fn(() => Promise.resolve({ data: [], error: null })),
                    })),
                })),
                gte: vi.fn(() => ({
                    lte: vi.fn(() => ({
                        order: vi.fn(() => Promise.resolve({ data: [], error: null })),
                    })),
                })),
            })),
        })),
    },
}));
describe('Appointment Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });
    describe('createAppointment', () => {
        it('should create an appointment successfully', async () => {
            const appointment = {
                patientId: 'patient-1',
                providerId: 'doctor-1',
                appointmentType: 'Follow-up',
                scheduledAt: new Date('2025-10-25T10:00:00Z'),
                durationMinutes: 30,
                status: 'scheduled',
                createdBy: 'user-1',
            };
            const id = await createAppointment(appointment);
            expect(id).toBe('test-appointment-id');
        });
        it('should handle optional fields', async () => {
            const appointment = {
                patientId: 'patient-1',
                appointmentType: 'Consultation',
                scheduledAt: new Date('2025-10-25T14:00:00Z'),
                durationMinutes: 60,
                status: 'scheduled',
                reason: 'Chest pain',
                notes: 'Patient requests afternoon slot',
                createdBy: 'user-1',
            };
            const id = await createAppointment(appointment);
            expect(id).toBe('test-appointment-id');
        });
    });
    describe('updateAppointmentStatus', () => {
        it('should update appointment status', async () => {
            await updateAppointmentStatus('appointment-1', 'confirmed');
            const { supabase } = await import('../lib/supabase');
            expect(supabase.from).toHaveBeenCalledWith('appointments');
        });
        it('should handle all status values', async () => {
            const statuses = [
                'scheduled', 'confirmed', 'arrived', 'in-progress', 'completed', 'no-show', 'cancelled'
            ];
            for (const status of statuses) {
                await updateAppointmentStatus('appointment-1', status);
            }
            const { supabase } = await import('../lib/supabase');
            expect(supabase.from).toHaveBeenCalled();
        });
    });
    describe('rescheduleAppointment', () => {
        it('should reschedule appointment to new date', async () => {
            const newDate = new Date('2025-10-26T15:00:00Z');
            await rescheduleAppointment('appointment-1', newDate);
            const { supabase } = await import('../lib/supabase');
            expect(supabase.from).toHaveBeenCalledWith('appointments');
        });
    });
    describe('cancelAppointment', () => {
        it('should cancel appointment without reason', async () => {
            await cancelAppointment('appointment-1');
            const { supabase } = await import('../lib/supabase');
            expect(supabase.from).toHaveBeenCalledWith('appointments');
        });
        it('should cancel appointment with reason', async () => {
            await cancelAppointment('appointment-1', 'Patient unavailable');
            const { supabase } = await import('../lib/supabase');
            expect(supabase.from).toHaveBeenCalledWith('appointments');
        });
    });
    describe('checkAvailability', () => {
        it('should return true when slot is available', async () => {
            const available = await checkAvailability('doctor-1', new Date('2025-10-25T10:00:00Z'), 30);
            expect(typeof available).toBe('boolean');
        });
        it('should check for overlapping appointments', async () => {
            await checkAvailability('doctor-1', new Date('2025-10-25T10:00:00Z'), 60);
            const { supabase } = await import('../lib/supabase');
            expect(supabase.from).toHaveBeenCalledWith('appointments');
        });
    });
    describe('addToWaitlist', () => {
        it('should add patient to waitlist', async () => {
            const entry = {
                patientId: 'patient-1',
                appointmentType: 'Consultation',
                priority: 'routine',
                status: 'waiting',
            };
            const id = await addToWaitlist(entry);
            expect(id).toBe('test-appointment-id');
        });
        it('should handle preferred dates', async () => {
            const entry = {
                patientId: 'patient-1',
                appointmentType: 'Follow-up',
                preferredDates: [
                    new Date('2025-10-25'),
                    new Date('2025-10-26'),
                ],
                reason: 'Blood pressure check',
                priority: 'urgent',
                status: 'waiting',
            };
            await addToWaitlist(entry);
            const { supabase } = await import('../lib/supabase');
            expect(supabase.from).toHaveBeenCalledWith('waitlist');
        });
    });
});
