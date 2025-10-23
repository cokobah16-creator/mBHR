import { describe, it, expect, beforeEach } from 'vitest'
import { useOperationsQueue, processQueue, PendingOperation } from './operationsQueue'

describe('Operations Queue Store', () => {
  beforeEach(() => {
    const store = useOperationsQueue.getState()
    store.clearAll()
    store.setProcessing(false)
  })

  describe('addOperation', () => {
    it('should add operation with generated id and defaults', () => {
      const store = useOperationsQueue.getState()

      store.addOperation({
        type: 'create',
        entity: 'patient',
        entityId: 'p1',
        data: { name: 'Test' },
        priority: 'high',
        maxAttempts: 3
      })

      const op = store.operations[0]
      expect(op.id).toMatch(/^op_/)
      expect(op.status).toBe('pending')
      expect(op.attempts).toBe(0)
      expect(op.createdAt).toBeGreaterThan(0)
    })

    it('should support all entity types', () => {
      const store = useOperationsQueue.getState()
      const entities = ['patient', 'visit', 'vital', 'consultation', 'dispense', 'inventory'] as const

      entities.forEach(entity => {
        store.addOperation({
          type: 'create',
          entity,
          entityId: `${entity}-1`,
          data: {},
          priority: 'normal',
          maxAttempts: 3
        })
      })

      expect(store.operations).toHaveLength(6)
      entities.forEach((entity, i) => {
        expect(store.operations[i].entity).toBe(entity)
      })
    })

    it('should support all operation types', () => {
      const store = useOperationsQueue.getState()
      const types = ['create', 'update', 'delete'] as const

      types.forEach(type => {
        store.addOperation({
          type,
          entity: 'patient',
          entityId: 'p1',
          data: {},
          priority: 'normal',
          maxAttempts: 3
        })
      })

      expect(store.operations).toHaveLength(3)
      types.forEach((type, i) => {
        expect(store.operations[i].type).toBe(type)
      })
    })
  })

  describe('getNextOperation', () => {
    it('should return null when queue is empty', () => {
      const store = useOperationsQueue.getState()
      expect(store.getNextOperation()).toBeNull()
    })

    it('should prioritize high priority operations', () => {
      const store = useOperationsQueue.getState()

      store.addOperation({
        type: 'create',
        entity: 'patient',
        entityId: 'low',
        data: {},
        priority: 'low',
        maxAttempts: 3
      })

      store.addOperation({
        type: 'create',
        entity: 'patient',
        entityId: 'high',
        data: {},
        priority: 'high',
        maxAttempts: 3
      })

      store.addOperation({
        type: 'create',
        entity: 'patient',
        entityId: 'normal',
        data: {},
        priority: 'normal',
        maxAttempts: 3
      })

      const next = store.getNextOperation()
      expect(next?.entityId).toBe('high')
    })

    it('should use FIFO for same priority', () => {
      const store = useOperationsQueue.getState()

      store.addOperation({
        type: 'create',
        entity: 'patient',
        entityId: 'first',
        data: {},
        priority: 'normal',
        maxAttempts: 3
      })

      store.addOperation({
        type: 'create',
        entity: 'patient',
        entityId: 'second',
        data: {},
        priority: 'normal',
        maxAttempts: 3
      })

      const next = store.getNextOperation()
      expect(next?.entityId).toBe('first')
    })

    it('should skip operations with future retry time', () => {
      const store = useOperationsQueue.getState()

      store.addOperation({
        type: 'create',
        entity: 'patient',
        entityId: 'retry-later',
        data: {},
        priority: 'high',
        maxAttempts: 3
      })

      store.addOperation({
        type: 'create',
        entity: 'patient',
        entityId: 'ready-now',
        data: {},
        priority: 'normal',
        maxAttempts: 3
      })

      const op1 = store.operations[0]
      store.updateOperation(op1.id, {
        nextRetryAt: Date.now() + 10000
      })

      const next = store.getNextOperation()
      expect(next?.entityId).toBe('ready-now')
    })
  })

  describe('markAsProcessing', () => {
    it('should increment attempts and set timestamp', () => {
      const store = useOperationsQueue.getState()

      store.addOperation({
        type: 'create',
        entity: 'patient',
        entityId: 'p1',
        data: {},
        priority: 'normal',
        maxAttempts: 3
      })

      const op = store.operations[0]
      const beforeAttempts = op.attempts

      store.markAsProcessing(op.id)

      const updated = store.operations[0]
      expect(updated.status).toBe('processing')
      expect(updated.attempts).toBe(beforeAttempts + 1)
      expect(updated.lastAttemptAt).toBeDefined()
    })
  })

  describe('markAsCompleted', () => {
    it('should update status and increment counter', () => {
      const store = useOperationsQueue.getState()

      store.addOperation({
        type: 'create',
        entity: 'patient',
        entityId: 'p1',
        data: {},
        priority: 'normal',
        maxAttempts: 3
      })

      const initialCount = store.totalProcessed
      const op = store.operations[0]

      store.markAsCompleted(op.id)

      expect(store.operations[0].status).toBe('completed')
      expect(store.totalProcessed).toBe(initialCount + 1)
      expect(store.lastProcessedAt).toBeGreaterThan(0)
    })
  })

  describe('markAsFailed', () => {
    it('should retry if under max attempts', () => {
      const store = useOperationsQueue.getState()

      store.addOperation({
        type: 'create',
        entity: 'patient',
        entityId: 'p1',
        data: {},
        priority: 'normal',
        maxAttempts: 3
      })

      const op = store.operations[0]
      store.markAsProcessing(op.id)
      store.markAsFailed(op.id, 'Network error')

      const failed = store.operations[0]
      expect(failed.status).toBe('pending')
      expect(failed.error).toBe('Network error')
      expect(failed.nextRetryAt).toBeGreaterThan(Date.now())
    })

    it('should mark as failed if max attempts reached', () => {
      const store = useOperationsQueue.getState()

      store.addOperation({
        type: 'create',
        entity: 'patient',
        entityId: 'p1',
        data: {},
        priority: 'normal',
        maxAttempts: 1
      })

      const op = store.operations[0]
      store.markAsProcessing(op.id)
      store.markAsFailed(op.id, 'Error')

      const failed = store.operations[0]
      expect(failed.status).toBe('failed')
      expect(store.totalFailed).toBe(1)
    })

    it('should calculate exponential backoff', () => {
      const store = useOperationsQueue.getState()

      store.addOperation({
        type: 'create',
        entity: 'patient',
        entityId: 'p1',
        data: {},
        priority: 'normal',
        maxAttempts: 5
      })

      const op = store.operations[0]

      for (let i = 0; i < 3; i++) {
        store.markAsProcessing(op.id)
        store.markAsFailed(op.id, `Error ${i}`)
      }

      const failed = store.operations[0]
      expect(failed.attempts).toBe(3)
      expect(failed.nextRetryAt).toBeGreaterThan(Date.now())
    })
  })

  describe('getPendingCount', () => {
    it('should count pending and processing operations', () => {
      const store = useOperationsQueue.getState()

      store.addOperation({
        type: 'create',
        entity: 'patient',
        entityId: 'p1',
        data: {},
        priority: 'normal',
        maxAttempts: 3
      })

      store.addOperation({
        type: 'create',
        entity: 'patient',
        entityId: 'p2',
        data: {},
        priority: 'normal',
        maxAttempts: 3
      })

      expect(store.getPendingCount()).toBe(2)

      store.markAsProcessing(store.operations[0].id)
      expect(store.getPendingCount()).toBe(2)

      store.markAsCompleted(store.operations[0].id)
      expect(store.getPendingCount()).toBe(1)
    })
  })

  describe('getFailedCount', () => {
    it('should count failed operations', () => {
      const store = useOperationsQueue.getState()

      store.addOperation({
        type: 'create',
        entity: 'patient',
        entityId: 'p1',
        data: {},
        priority: 'normal',
        maxAttempts: 1
      })

      store.addOperation({
        type: 'create',
        entity: 'patient',
        entityId: 'p2',
        data: {},
        priority: 'normal',
        maxAttempts: 1
      })

      store.markAsProcessing(store.operations[0].id)
      store.markAsFailed(store.operations[0].id, 'Error')

      expect(store.getFailedCount()).toBe(1)

      store.markAsProcessing(store.operations[1].id)
      store.markAsFailed(store.operations[1].id, 'Error')

      expect(store.getFailedCount()).toBe(2)
    })
  })

  describe('retryOperation', () => {
    it('should reset operation to pending', () => {
      const store = useOperationsQueue.getState()

      store.addOperation({
        type: 'create',
        entity: 'patient',
        entityId: 'p1',
        data: {},
        priority: 'normal',
        maxAttempts: 1
      })

      const op = store.operations[0]
      store.markAsProcessing(op.id)
      store.markAsFailed(op.id, 'Error')

      expect(store.operations[0].status).toBe('failed')

      store.retryOperation(op.id)

      expect(store.operations[0].status).toBe('pending')
      expect(store.operations[0].error).toBeUndefined()
      expect(store.operations[0].nextRetryAt).toBeUndefined()
    })
  })

  describe('processQueue', () => {
    it('should process operations in sequence', async () => {
      const store = useOperationsQueue.getState()
      const processed: string[] = []

      store.addOperation({
        type: 'create',
        entity: 'patient',
        entityId: 'p1',
        data: {},
        priority: 'normal',
        maxAttempts: 3
      })

      store.addOperation({
        type: 'create',
        entity: 'patient',
        entityId: 'p2',
        data: {},
        priority: 'normal',
        maxAttempts: 3
      })

      await processQueue(async (op: PendingOperation) => {
        processed.push(op.entityId)
      })

      expect(processed).toEqual(['p1', 'p2'])
      expect(store.operations.filter(op => op.status === 'completed')).toHaveLength(2)
    })

    it('should handle processor errors', async () => {
      const store = useOperationsQueue.getState()

      store.addOperation({
        type: 'create',
        entity: 'patient',
        entityId: 'fail',
        data: {},
        priority: 'normal',
        maxAttempts: 3
      })

      await processQueue(async () => {
        throw new Error('Processor error')
      })

      const op = store.operations[0]
      expect(op.status).toBe('pending')
      expect(op.error).toBe('Processor error')
    })

    it('should not start if already processing', async () => {
      const store = useOperationsQueue.getState()
      store.setProcessing(true)

      let called = false
      await processQueue(async () => {
        called = true
      })

      expect(called).toBe(false)
      store.setProcessing(false)
    })
  })
})
