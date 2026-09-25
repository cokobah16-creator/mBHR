import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createLabOrder,
  updateLabOrderStatus,
  addLabResult,
  getPatientLabOrders,
  getCriticalResults,
  reviewLabResult,
  reviewAndRelease,
  releaseLabResult,
  withholdLabResult,
  parseLabReleaseResult,
  isLabInterpretation,
  LabServiceError,
} from './labs';
import type { LabInterpretation } from './labs';

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(() => Promise.resolve({ data: { outcome: 'applied', result_id: 'r1' }, error: null })),
    auth: {
      getSession: vi.fn(() =>
        Promise.resolve({ data: { session: { user: { id: 'staff-1', email: 'staff@example.ng' } } } }),
      ),
    },
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
        priority: 'routine' as const,
        status: 'ordered' as const,
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
        priority: 'urgent' as const,
        status: 'ordered' as const,
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
        interpretation: 'normal' as const,
        resultDate: new Date('2025-10-24'),
      };

      const id = await addLabResult(result);
      expect(id).toBe('test-order-id');
    });

    it('should handle critical results', async () => {
      const result = {
        orderId: 'order-1',
        resultValue: '3.2',
        interpretation: 'critical' as const,
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

async function mockedSupabase() {
  const { supabase } = await import('../lib/supabase');
  return supabase as unknown as {
    rpc: ReturnType<typeof vi.fn>;
    from: ReturnType<typeof vi.fn>;
  };
}

async function caught(promise: Promise<unknown>): Promise<LabServiceError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(LabServiceError);
    return error as LabServiceError;
  }
  throw new Error('expected the call to fail');
}

describe('interpretation is required', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses a result with no interpretation before anything is written', async () => {
    const sb = await mockedSupabase();
    const err = await caught(
      addLabResult({
        orderId: 'order-1',
        resultValue: '5',
        interpretation: '' as unknown as LabInterpretation,
        resultDate: new Date(),
      }),
    );
    expect(err.code).toBe('INVALID_INTERPRETATION');
    expect(sb.from).not.toHaveBeenCalled();
  });

  it('accepts only the three interpretations', () => {
    expect(isLabInterpretation('normal')).toBe(true);
    expect(isLabInterpretation('critical')).toBe(true);
    expect(isLabInterpretation(undefined)).toBe(false);
    expect(isLabInterpretation('Normal')).toBe(false);
  });
});

describe('review and release RPCs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reviews through lab_review_result without sending a reviewer id', async () => {
    const sb = await mockedSupabase();
    sb.rpc.mockResolvedValueOnce({
      data: { outcome: 'applied', result_id: 'r1', reviewed_at: '2026-09-20T10:00:00Z', reviewed_by: 'u1' },
      error: null,
    });
    const state = await reviewLabResult('r1');
    expect(sb.rpc).toHaveBeenCalledWith('lab_review_result', {
      p_result_id: 'r1',
      p_release: false,
      p_patient_note: null,
    });
    expect(state.reviewedBy).toBe('u1');
    expect(state.reviewedAt?.toISOString()).toBe('2026-09-20T10:00:00.000Z');
    expect(state.releasedToPatientAt).toBeUndefined();
  });

  it('reviews and releases in one call, trimming the patient note', async () => {
    const sb = await mockedSupabase();
    sb.rpc.mockResolvedValueOnce({
      data: {
        outcome: 'applied',
        result_id: 'r1',
        reviewed_at: '2026-09-20T10:00:00Z',
        released_to_patient_at: '2026-09-20T10:00:01Z',
        released_to_patient_by: 'u1',
      },
      error: null,
    });
    const state = await reviewAndRelease('r1', '  Come back in a week.  ');
    expect(sb.rpc).toHaveBeenCalledWith('lab_review_result', {
      p_result_id: 'r1',
      p_release: true,
      p_patient_note: 'Come back in a week.',
    });
    expect(state.releasedToPatientAt).toBeInstanceOf(Date);
  });

  it('releases through lab_release_result', async () => {
    const sb = await mockedSupabase();
    sb.rpc.mockResolvedValueOnce({
      data: { outcome: 'applied', already_released: true, released_to_patient_at: '2026-09-20T10:00:01Z' },
      error: null,
    });
    const state = await releaseLabResult('r1');
    expect(sb.rpc).toHaveBeenCalledWith('lab_release_result', { p_result_id: 'r1', p_patient_note: null });
    expect(state.alreadyDone).toBe(true);
  });

  it('reports a server refusal with its reason, not as success', async () => {
    const sb = await mockedSupabase();
    sb.rpc.mockResolvedValueOnce({ data: { outcome: 'rejected', reason: 'not_reviewed' }, error: null });
    const err = await caught(releaseLabResult('r1'));
    expect(err.code).toBe('REJECTED');
    expect(err.reason).toBe('not_reviewed');
    expect(err.operation).toBe('releaseLabResult');
  });

  it('treats a missing result as NO_ROWS', async () => {
    const sb = await mockedSupabase();
    sb.rpc.mockResolvedValueOnce({ data: { outcome: 'rejected', reason: 'not_found' }, error: null });
    const err = await caught(reviewLabResult('gone'));
    expect(err.code).toBe('NO_ROWS');
  });

  it('passes on a permission error code', async () => {
    const sb = await mockedSupabase();
    sb.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'secret row data' } });
    const err = await caught(withholdLabResult('r1', 'Discuss in person'));
    expect(err.code).toBe('42501');
    expect(err.message).not.toContain('secret');
  });

  it('refuses to withhold without a reason and sends nothing', async () => {
    const sb = await mockedSupabase();
    const err = await caught(withholdLabResult('r1', '   '));
    expect(err.reason).toBe('reason_required');
    expect(sb.rpc).not.toHaveBeenCalled();
  });

  it('withholds through lab_withhold_result', async () => {
    const sb = await mockedSupabase();
    sb.rpc.mockResolvedValueOnce({
      data: { outcome: 'applied', withheld_at: '2026-09-20T11:00:00Z', withheld_reason: 'Discuss in person' },
      error: null,
    });
    const state = await withholdLabResult('r1', ' Discuss in person ');
    expect(sb.rpc).toHaveBeenCalledWith('lab_withhold_result', { p_result_id: 'r1', p_reason: 'Discuss in person' });
    expect(state.withheldReason).toBe('Discuss in person');
    expect(state.releasedToPatientAt).toBeUndefined();
  });

  it('falls back to the direct review when the database has no review RPC yet', async () => {
    const sb = await mockedSupabase();
    sb.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'x' } });
    const eq = vi.fn(() => Promise.resolve({ error: null, count: 1 }));
    const update = vi.fn(() => ({ eq }));
    sb.from.mockImplementationOnce(() => ({ update }));
    const state = await reviewLabResult('r1');
    expect(sb.from).toHaveBeenCalledWith('lab_results');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ reviewed_by: 'staff-1' }),
      { count: 'exact' },
    );
    expect(eq).toHaveBeenCalledWith('id', 'r1');
    expect(state.reviewedBy).toBe('staff-1');
    expect(state.releasedToPatientAt).toBeUndefined();
  });

  it('reports a refused direct review instead of saying it was saved', async () => {
    const sb = await mockedSupabase();
    sb.rpc.mockResolvedValueOnce({ data: null, error: { code: '42883', message: 'x' } });
    const update = vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null, count: 0 })) }));
    sb.from.mockImplementationOnce(() => ({ update }));
    const err = await caught(reviewLabResult('r1'));
    expect(err.code).toBe('NO_ROWS');
  });

  it('never falls back to a direct write for a release', async () => {
    const sb = await mockedSupabase();
    sb.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'x' } });
    const err = await caught(reviewAndRelease('r1'));
    expect(err.code).toBe('PGRST202');
    expect(sb.from).not.toHaveBeenCalled();
  });

  it('never reads an unexpected answer as applied', () => {
    expect(() => parseLabReleaseResult('reviewLabResult', 'r1', null)).toThrow(LabServiceError);
    expect(() => parseLabReleaseResult('reviewLabResult', 'r1', { outcome: 'maybe' })).toThrow(
      LabServiceError,
    );
  });
});
