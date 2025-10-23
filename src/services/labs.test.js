import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createLabOrder, updateLabOrderStatus, addLabResult, getPatientLabOrders, getCriticalResults } from './labs';
vi.mock('../lib/supabase', () => ({
    supabase: {
        from: vi.fn(() => ({
            insert: vi.fn(() => ({
                select: vi.fn(() => ({
                    single: vi.fn(() => Promise.resolve({ data: { id: 'test-order-id' }, error: null })),
                })),
            })),
            update: vi.fn(() => ({
                eq: vi.fn(() => Promise.resolve({ error: null })),
            })),
            select: vi.fn(() => ({
                eq: vi.fn(() => ({
                    order: vi.fn(() => Promise.resolve({ data: [], error: null })),
                    is: vi.fn(() => ({
                        order: vi.fn(() => Promise.resolve({ data: [], error: null })),
                    })),
                })),
                in: vi.fn(() => ({
                    order: vi.fn(() => Promise.resolve({ data: [], error: null })),
                })),
            })),
        })),
    },
}));
describe('Lab Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });
    describe('createLabOrder', () => {
        it('should create a lab order successfully', async () => {
            const order = {
                patientId: 'patient-1',
                orderedBy: 'doctor-1',
                testName: 'Complete Blood Count',
                priority: 'routine',
                status: 'ordered',
            };
            const id = await createLabOrder(order);
            expect(id).toBe('test-order-id');
        });
        it('should handle optional fields', async () => {
            const order = {
                patientId: 'patient-1',
                visitId: 'visit-1',
                orderedBy: 'doctor-1',
                testName: 'Blood Sugar',
                testCode: 'BS-001',
                priority: 'urgent',
                status: 'ordered',
                specimenType: 'Blood',
                clinicalNotes: 'Fasting required',
            };
            const id = await createLabOrder(order);
            expect(id).toBe('test-order-id');
        });
    });
    describe('updateLabOrderStatus', () => {
        it('should update status to collected with timestamp', async () => {
            await updateLabOrderStatus('order-1', 'collected');
            const { supabase } = await import('../lib/supabase');
            expect(supabase.from).toHaveBeenCalledWith('lab_orders');
        });
        it('should update status to completed with timestamp', async () => {
            await updateLabOrderStatus('order-1', 'completed');
            const { supabase } = await import('../lib/supabase');
            expect(supabase.from).toHaveBeenCalledWith('lab_orders');
        });
        it('should update status to cancelled with timestamp', async () => {
            await updateLabOrderStatus('order-1', 'cancelled');
            const { supabase } = await import('../lib/supabase');
            expect(supabase.from).toHaveBeenCalledWith('lab_orders');
        });
    });
    describe('addLabResult', () => {
        it('should add lab result and update order status', async () => {
            const result = {
                orderId: 'order-1',
                resultValue: '12.5',
                resultUnit: 'g/dL',
                referenceRange: '12-16',
                interpretation: 'normal',
                resultDate: new Date('2025-10-24'),
            };
            const id = await addLabResult(result);
            expect(id).toBe('test-order-id');
        });
        it('should handle critical results', async () => {
            const result = {
                orderId: 'order-1',
                resultValue: '3.2',
                interpretation: 'critical',
                resultDate: new Date(),
            };
            await addLabResult(result);
            const { supabase } = await import('../lib/supabase');
            expect(supabase.from).toHaveBeenCalled();
        });
    });
    describe('getPatientLabOrders', () => {
        it('should return patient lab orders', async () => {
            const orders = await getPatientLabOrders('patient-1');
            expect(Array.isArray(orders)).toBe(true);
        });
    });
    describe('getCriticalResults', () => {
        it('should return unreviewed critical results', async () => {
            const results = await getCriticalResults();
            expect(Array.isArray(results)).toBe(true);
        });
    });
});
