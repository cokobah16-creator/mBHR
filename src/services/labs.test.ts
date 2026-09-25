import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createLabOrder,
  updateLabOrderStatus,
  addLabResult,
  getPatientLabOrders,
  getPendingLabOrders,
  getCriticalResults,
  getLabWorklist,
  LAB_WORKLIST_CLOSED_LIMIT,
  LAB_WORKLIST_MAX_ROWS,
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

function orderRow(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    patient_id: 'patient-1',
    visit_id: null,
    ordered_by: 'doctor-1',
    test_name: 'Full blood count',
    test_code: null,
    priority: 'routine',
    status: 'ordered',
    specimen_type: null,
    clinical_notes: null,
    ordered_at: '2026-09-20T08:00:00Z',
    collected_at: null,
    completed_at: null,
    cancelled_at: null,
    lab_results: [],
    ...extra,
  };
}

function resultRow(id: string, orderId: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    order_id: orderId,
    result_value: '4.8',
    result_unit: 'g/dL',
    reference_range: null,
    interpretation: 'normal',
    result_date: '2026-09-20T10:00:00Z',
    reviewed_by: null,
    reviewed_at: null,
    notes: null,
    lab_orders: orderRow(orderId, { status: 'completed' }),
    ...extra,
  };
}

describe('recording a result', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses a blank value before anything is written', async () => {
    const sb = await mockedSupabase();
    const err = await caught(
      addLabResult({
        orderId: 'order-1',
        resultValue: '   ',
        interpretation: 'normal',
        resultDate: new Date(),
      }),
    );
    expect(err.code).toBe('EMPTY_VALUE');
    expect(sb.from).not.toHaveBeenCalled();
  });

  it('stores the value as typed without surrounding spaces, and blank extras as empty', async () => {
    const sb = await mockedSupabase();
    const single = vi.fn(() => Promise.resolve({ data: { id: 'r1' }, error: null }));
    const insert = vi.fn(() => ({ select: vi.fn(() => ({ single })) }));
    sb.from.mockImplementationOnce(() => ({ insert }));
    await addLabResult({
      orderId: 'order-1',
      resultValue: '  Positive ',
      resultUnit: '  ',
      referenceRange: ' Negative ',
      interpretation: 'abnormal',
      resultDate: new Date('2026-09-20T10:00:00Z'),
      notes: '',
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        result_value: 'Positive',
        result_unit: null,
        reference_range: 'Negative',
        interpretation: 'abnormal',
        notes: null,
      }),
    );
  });
});

describe('getPendingLabOrders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists STAT, then urgent, then routine, oldest first within each', async () => {
    const sb = await mockedSupabase();
    // As the database returns them: oldest first.
    const rows = [
      orderRow('routine-old', { priority: 'routine', ordered_at: '2026-09-20T08:00:00Z' }),
      orderRow('urgent-old', { priority: 'urgent', ordered_at: '2026-09-20T09:00:00Z' }),
      orderRow('stat-old', { priority: 'stat', ordered_at: '2026-09-21T10:00:00Z' }),
      orderRow('routine-new', { priority: 'routine', ordered_at: '2026-09-21T11:00:00Z' }),
      orderRow('stat-new', { priority: 'stat', ordered_at: '2026-09-22T10:00:00Z' }),
    ];
    sb.from.mockImplementationOnce(() => ({
      select: () => ({
        in: () => ({ order: () => Promise.resolve({ data: rows, error: null }) }),
      }),
    }));
    const orders = await getPendingLabOrders();
    expect(orders.map((o) => o.id)).toEqual([
      'stat-old',
      'stat-new',
      'urgent-old',
      'routine-old',
      'routine-new',
    ]);
  });
});

describe('getCriticalResults filters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('asks only for critical results nobody has reviewed', async () => {
    const sb = await mockedSupabase();
    const order = vi.fn(() => Promise.resolve({ data: [], error: null }));
    const is = vi.fn(() => ({ order }));
    const eq = vi.fn(() => ({ is }));
    sb.from.mockImplementationOnce(() => ({ select: () => ({ eq }) }));
    await getCriticalResults();
    expect(sb.from).toHaveBeenCalledWith('lab_results');
    expect(eq).toHaveBeenCalledWith('interpretation', 'critical');
    expect(is).toHaveBeenCalledWith('reviewed_at', null);
  });
});

interface WorklistQuery {
  table: string;
  statuses: string[];
  criticalOnly: boolean;
}

interface WorklistPage {
  data: unknown[];
  count: number | null;
}

interface FakeBuilder {
  select: () => FakeBuilder;
  is: () => FakeBuilder;
  order: () => FakeBuilder;
  in: (column: string, values: string[]) => FakeBuilder;
  eq: (column: string, value: string) => FakeBuilder;
  range: (start: number, end: number) => Promise<WorklistPage & { error: null }>;
  limit: (n: number) => Promise<WorklistPage & { error: null }>;
}

/**
 * Stands in for the Supabase query builder: answers every worklist query
 * from `respond` and records each page asked for.
 */
function worklistClient(
  respond: (q: WorklistQuery, start: number, end: number) => WorklistPage,
) {
  const pages: { q: WorklistQuery; start: number; end: number }[] = [];
  const from = (table: string) => {
    const q: WorklistQuery = { table, statuses: [], criticalOnly: false };
    const answer = (start: number, end: number) => {
      pages.push({ q, start, end });
      return Promise.resolve({ ...respond(q, start, end), error: null as null });
    };
    const builder: FakeBuilder = {
      select: () => builder,
      is: () => builder,
      order: () => builder,
      in: (_column, values) => {
        q.statuses = values;
        return builder;
      },
      eq: (column, value) => {
        if (column === 'interpretation' && value === 'critical') q.criticalOnly = true;
        return builder;
      },
      range: (start, end) => answer(start, end),
      limit: (n) => answer(0, n - 1),
    };
    return builder;
  };
  return { from, pages };
}

/** Rows start..end of a list of `total` rows made by `make`. */
function slice<T>(total: number, start: number, end: number, make: (i: number) => T): T[] {
  const last = Math.min(end, total - 1);
  return Array.from({ length: Math.max(0, last - start + 1) }, (_, i) => make(start + i));
}

const isOpen = (q: WorklistQuery) => q.table === 'lab_orders' && q.statuses.includes('ordered');
const isClosed = (q: WorklistQuery) =>
  q.table === 'lab_orders' && q.statuses.includes('completed');
const EMPTY: WorklistPage = { data: [], count: 0 };

describe('getLabWorklist', () => {
  let original: ((...args: unknown[]) => unknown) | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    original = (await mockedSupabase()).from.getMockImplementation();
  });

  afterEach(async () => {
    (await mockedSupabase()).from.mockImplementation(original);
  });

  it('reads every open order page by page, so newer orders past the first page are listed', async () => {
    const sb = await mockedSupabase();
    const fake = worklistClient((q, start, end) =>
      isOpen(q)
        ? { data: slice(700, start, end, (i) => orderRow(`open-${i}`)), count: 700 }
        : EMPTY,
    );
    sb.from.mockImplementation(fake.from);
    const worklist = await getLabWorklist();
    expect(worklist.orders).toHaveLength(700);
    expect(worklist.orders.some((o) => o.id === 'open-699')).toBe(true);
    expect(worklist.openTruncated).toBe(false);
    expect(worklist.truncated).toBe(false);
    expect(fake.pages.filter((p) => isOpen(p.q)).map((p) => p.start)).toEqual([0, 500]);
  });

  it('keeps reading when the server sends fewer rows than asked for', async () => {
    const sb = await mockedSupabase();
    const fake = worklistClient((q, start) =>
      isOpen(q)
        ? { data: slice(250, start, start + 99, (i) => orderRow(`open-${i}`)), count: 250 }
        : EMPTY,
    );
    sb.from.mockImplementation(fake.from);
    const worklist = await getLabWorklist();
    expect(worklist.orders).toHaveLength(250);
    expect(worklist.openTruncated).toBe(false);
  });

  it('says so when there are more open orders than it reads', async () => {
    const sb = await mockedSupabase();
    const total = LAB_WORKLIST_MAX_ROWS + 1;
    const fake = worklistClient((q, start, end) =>
      isOpen(q)
        ? { data: slice(total, start, end, (i) => orderRow(`open-${i}`)), count: total }
        : EMPTY,
    );
    sb.from.mockImplementation(fake.from);
    const worklist = await getLabWorklist();
    expect(worklist.orders).toHaveLength(LAB_WORKLIST_MAX_ROWS);
    expect(worklist.openTruncated).toBe(true);
  });

  it('reads unreviewed critical results on their own when there are too many unreviewed results', async () => {
    const sb = await mockedSupabase();
    const total = LAB_WORKLIST_MAX_ROWS + 1;
    const fake = worklistClient((q, start, end) => {
      if (q.table !== 'lab_results') return EMPTY;
      if (q.criticalOnly) {
        return {
          data: [resultRow('critical-1', 'order-critical', { interpretation: 'critical' })],
          count: 1,
        };
      }
      return {
        data: slice(total, start, end, (i) => resultRow(`r-${i}`, `order-${i}`)),
        count: total,
      };
    });
    sb.from.mockImplementation(fake.from);
    const worklist = await getLabWorklist();
    const critical = worklist.orders.find((o) => o.id === 'order-critical');
    expect(critical?.results.map((r) => r.interpretation)).toEqual(['critical']);
    expect(worklist.unreviewedTruncated).toBe(true);
    expect(worklist.criticalTruncated).toBe(false);
  });

  it('makes no extra read when every unreviewed result was read', async () => {
    const sb = await mockedSupabase();
    const fake = worklistClient((q) =>
      q.table === 'lab_results'
        ? { data: [resultRow('r-1', 'order-1', { interpretation: 'critical' })], count: 1 }
        : EMPTY,
    );
    sb.from.mockImplementation(fake.from);
    const worklist = await getLabWorklist();
    expect(fake.pages.some((p) => p.q.criticalOnly)).toBe(false);
    expect(worklist.orders.map((o) => o.id)).toEqual(['order-1']);
    expect(worklist.unreviewedTruncated).toBe(false);
    expect(worklist.criticalTruncated).toBe(false);
  });

  it('flags only the finished orders as cut off when the closed list is full', async () => {
    const sb = await mockedSupabase();
    const fake = worklistClient((q, start, end) =>
      isClosed(q)
        ? {
            data: slice(LAB_WORKLIST_CLOSED_LIMIT + 50, start, end, (i) =>
              orderRow(`closed-${i}`, { status: 'completed' }),
            ),
            count: null,
          }
        : EMPTY,
    );
    sb.from.mockImplementation(fake.from);
    const worklist = await getLabWorklist();
    expect(worklist.orders).toHaveLength(LAB_WORKLIST_CLOSED_LIMIT);
    expect(worklist.truncated).toBe(true);
    expect(worklist.openTruncated).toBe(false);
    expect(worklist.unreviewedTruncated).toBe(false);
  });
});
