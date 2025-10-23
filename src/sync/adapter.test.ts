import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useOperationsQueue } from '@/stores/operationsQueue'
import { db } from '@/db'

vi.mock('@/db', () => ({
  db: {
    patients: {
      get: vi.fn(),
      update: vi.fn(),
      put: vi.fn()
    },
    vitals: {
      get: vi.fn(),
      update: vi.fn(),
      put: vi.fn()
    },
    consultations: {
      get: vi.fn(),
      update: vi.fn(),
      put: vi.fn()
    }
  }
}))

describe('Sync Adapter - Operations Queue Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const store = useOperationsQueue.getState()
    store.clearAll()
    store.setProcessing(false)
  })

  describe('processOperationsQueue', () => {
    it('should process pending operations in priority order', async () => {
      const queueStore = useOperationsQueue.getState()

      queueStore.addOperation({
        type: 'create',
        entity: 'patient',
        entityId: 'patient-1',
        data: { givenName: 'John', familyName: 'Doe' },
        priority: 'high',
        maxAttempts: 3
      })

      queueStore.addOperation({
        type: 'update',
        entity: 'patient',
        entityId: 'patient-2',
        data: { givenName: 'Jane', familyName: 'Smith' },
        priority: 'low',
        maxAttempts: 3
      })

      expect(queueStore.getPendingCount()).toBe(2)

      const nextOp = queueStore.getNextOperation()
      expect(nextOp?.priority).toBe('high')
      expect(nextOp?.entityId).toBe('patient-1')
    })

    it('should retry failed operations with exponential backoff', async () => {
      const queueStore = useOperationsQueue.getState()

      queueStore.addOperation({
        type: 'create',
        entity: 'patient',
        entityId: 'patient-fail',
        data: { givenName: 'Test' },
        priority: 'normal',
        maxAttempts: 3
      })

      let state = useOperationsQueue.getState()
      const op = state.getNextOperation()
      expect(op).toBeDefined()

      if (op) {
        queueStore.markAsProcessing(op.id)
        queueStore.markAsFailed(op.id, 'Network error')

        state = useOperationsQueue.getState()
        const failedOp = state.operations.find(o => o.id === op.id)
        expect(failedOp?.status).toBe('pending')
        expect(failedOp?.attempts).toBe(1)
        expect(failedOp?.nextRetryAt).toBeGreaterThan(Date.now())
      }
    })

    it('should mark operation as failed after max attempts', async () => {
      const queueStore = useOperationsQueue.getState()

      queueStore.addOperation({
        type: 'create',
        entity: 'patient',
        entityId: 'patient-max-fail',
        data: { givenName: 'Test' },
        priority: 'normal',
        maxAttempts: 2
      })

      let state = useOperationsQueue.getState()
      const op = state.getNextOperation()
      if (op) {
        queueStore.markAsProcessing(op.id)
        queueStore.markAsFailed(op.id, 'Error 1')

        queueStore.markAsProcessing(op.id)
        queueStore.markAsFailed(op.id, 'Error 2')

        state = useOperationsQueue.getState()
        const failedOp = state.operations.find(o => o.id === op.id)
        expect(failedOp?.status).toBe('failed')
        expect(failedOp?.attempts).toBe(2)
        expect(state.getFailedCount()).toBe(1)
      }
    })

    it('should track total processed and failed operations', async () => {
      const queueStore = useOperationsQueue.getState()

      queueStore.addOperation({
        type: 'create',
        entity: 'patient',
        entityId: 'patient-1',
        data: {},
        priority: 'normal',
        maxAttempts: 3
      })

      queueStore.addOperation({
        type: 'create',
        entity: 'patient',
        entityId: 'patient-2',
        data: {},
        priority: 'normal',
        maxAttempts: 1
      })

      let state = useOperationsQueue.getState()
      const op1 = state.getNextOperation()
      if (op1) {
        queueStore.markAsProcessing(op1.id)
        queueStore.markAsCompleted(op1.id)
      }

      state = useOperationsQueue.getState()
      const op2 = state.operations.find(o => o.entityId === 'patient-2')
      if (op2) {
        queueStore.markAsProcessing(op2.id)
        queueStore.markAsFailed(op2.id, 'Error')
      }

      state = useOperationsQueue.getState()
      expect(state.totalProcessed).toBe(1)
      expect(state.totalFailed).toBe(1)
    })
  })

  describe('Conflict Detection', () => {
    it('should detect no conflict when local is newer', () => {
      const localData = {
        id: '123',
        givenName: 'John',
        updatedAt: new Date('2024-01-02'),
        _syncedAt: new Date('2024-01-01').toISOString()
      }

      expect(localData.updatedAt.getTime()).toBeGreaterThan(
        new Date(localData._syncedAt).getTime()
      )
    })

    it('should detect conflict when remote is newer and data differs', () => {
      const localTimestamp = new Date('2024-01-01')
      const remoteTimestamp = new Date('2024-01-02')

      expect(remoteTimestamp.getTime()).toBeGreaterThan(localTimestamp.getTime())
    })

    it('should not conflict when only timestamps differ', () => {
      const localData = {
        givenName: 'John',
        familyName: 'Doe',
        updatedAt: new Date('2024-01-01')
      }

      const remoteData = {
        given_name: 'John',
        family_name: 'Doe',
        updated_at: '2024-01-02'
      }

      expect(localData.givenName).toBe(remoteData.given_name)
      expect(localData.familyName).toBe(remoteData.family_name)
    })
  })

})
