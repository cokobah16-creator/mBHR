import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useQueue } from './queue'

const mockTickets: Map<string, any> = new Map()
const mockCounters: Map<string, any> = new Map()
const mockMetrics: Map<string, any> = new Map()

vi.mock('@/db/mbhr', () => ({
  db: {
    tickets: {
      add: vi.fn((t: any) => {
        mockTickets.set(t.id, t)
        return Promise.resolve(t.id)
      }),
      update: vi.fn((id: string, updates: any) => {
        const ticket = mockTickets.get(id)
        if (ticket) {
          mockTickets.set(id, { ...ticket, ...updates })
        }
        return Promise.resolve(1)
      }),
      where: vi.fn((field: string) => ({
        equals: vi.fn((value: string) => ({
          toArray: vi.fn(() => {
            const results: any[] = []
            mockTickets.forEach((ticket) => {
              if (ticket[field] === value) {
                results.push(ticket)
              }
            })
            return Promise.resolve(results)
          })
        }))
      }))
    },
    daily_counters: {
      get: vi.fn((id: string) => Promise.resolve(mockCounters.get(id))),
      add: vi.fn((counter: any) => {
        mockCounters.set(counter.id, counter)
        return Promise.resolve()
      }),
      update: vi.fn((id: string, updates: any) => {
        const counter = mockCounters.get(id)
        if (counter) {
          mockCounters.set(id, { ...counter, ...updates })
        }
        return Promise.resolve(1)
      })
    },
    queue_metrics: {
      get: vi.fn((id: string) => Promise.resolve(mockMetrics.get(id))),
      add: vi.fn((metric: any) => {
        mockMetrics.set(metric.id, metric)
        return Promise.resolve()
      }),
      update: vi.fn((id: string, updates: any) => {
        const metric = mockMetrics.get(id)
        if (metric) {
          mockMetrics.set(id, { ...metric, ...updates })
        }
        return Promise.resolve(1)
      })
    }
  },
  ulid: () => `test-${Date.now()}-${Math.random().toString(36).slice(2)}`
}))

describe('useQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTickets.clear()
    mockCounters.clear()
    mockMetrics.clear()
  })

  describe('issueTicket', () => {
    it('should create a ticket with correct number format for adult category', async () => {
      const queue = useQueue.getState()

      const ticket = await queue.issueTicket({
        siteId: 'site-1',
        category: 'adult'
      })

      expect(ticket.number).toMatch(/^A-\d{3}$/)
      expect(ticket.category).toBe('adult')
      expect(ticket.priority).toBe('normal')
      expect(ticket.state).toBe('waiting')
      expect(ticket.currentStage).toBe('registration')
      expect(ticket.siteId).toBe('site-1')
    })

    it('should create a ticket with correct prefix for child category', async () => {
      const queue = useQueue.getState()

      const ticket = await queue.issueTicket({
        siteId: 'site-1',
        category: 'child'
      })

      expect(ticket.number).toMatch(/^B-\d{3}$/)
      expect(ticket.category).toBe('child')
    })

    it('should create a ticket with correct prefix for antenatal category', async () => {
      const queue = useQueue.getState()

      const ticket = await queue.issueTicket({
        siteId: 'site-1',
        category: 'antenatal'
      })

      expect(ticket.number).toMatch(/^C-\d{3}$/)
      expect(ticket.category).toBe('antenatal')
    })

    it('should respect priority setting', async () => {
      const queue = useQueue.getState()

      const ticket = await queue.issueTicket({
        siteId: 'site-1',
        category: 'adult',
        priority: 'urgent'
      })

      expect(ticket.priority).toBe('urgent')
    })

    it('should respect stage setting', async () => {
      const queue = useQueue.getState()

      const ticket = await queue.issueTicket({
        siteId: 'site-1',
        category: 'adult',
        stage: 'vitals'
      })

      expect(ticket.currentStage).toBe('vitals')
    })

    it('should associate patient ID when provided', async () => {
      const queue = useQueue.getState()

      const ticket = await queue.issueTicket({
        siteId: 'site-1',
        category: 'adult',
        patientId: 'patient-123'
      })

      expect(ticket.patientId).toBe('patient-123')
    })

    it('should increment sequence number for same category and day', async () => {
      const queue = useQueue.getState()

      const ticket1 = await queue.issueTicket({
        siteId: 'site-1',
        category: 'adult'
      })

      const ticket2 = await queue.issueTicket({
        siteId: 'site-1',
        category: 'adult'
      })

      const num1 = parseInt(ticket1.number.split('-')[1])
      const num2 = parseInt(ticket2.number.split('-')[1])

      expect(num2).toBe(num1 + 1)
    })
  })

  describe('callNext', () => {
    it('should return null when no tickets are waiting', async () => {
      const queue = useQueue.getState()

      const next = await queue.callNext('registration')

      expect(next).toBeNull()
    })

    it('should return next waiting ticket and mark as in_progress', async () => {
      const queue = useQueue.getState()

      await queue.issueTicket({
        siteId: 'site-1',
        category: 'adult',
        stage: 'registration'
      })

      const next = await queue.callNext('registration')

      expect(next).not.toBeNull()
      expect(next?.state).toBe('in_progress')
    })

    it('should prioritize urgent tickets over normal', async () => {
      const queue = useQueue.getState()

      await queue.issueTicket({
        siteId: 'site-1',
        category: 'adult',
        priority: 'normal',
        stage: 'vitals'
      })

      const urgentTicket = await queue.issueTicket({
        siteId: 'site-1',
        category: 'adult',
        priority: 'urgent',
        stage: 'vitals'
      })

      const next = await queue.callNext('vitals')

      expect(next?.id).toBe(urgentTicket.id)
    })

    it('should prioritize normal tickets over low', async () => {
      const queue = useQueue.getState()

      const lowTicket = await queue.issueTicket({
        siteId: 'site-1',
        category: 'adult',
        priority: 'low',
        stage: 'consult'
      })

      const normalTicket = await queue.issueTicket({
        siteId: 'site-1',
        category: 'adult',
        priority: 'normal',
        stage: 'consult'
      })

      const next = await queue.callNext('consult')

      expect(next?.id).toBe(normalTicket.id)
      expect(next?.id).not.toBe(lowTicket.id)
    })
  })

  describe('completeCurrent', () => {
    it('should mark in_progress ticket as done', async () => {
      const queue = useQueue.getState()

      const ticket = await queue.issueTicket({
        siteId: 'site-1',
        category: 'adult',
        stage: 'pharmacy'
      })

      await queue.callNext('pharmacy')
      await queue.completeCurrent('pharmacy', 120)

      const updatedTicket = mockTickets.get(ticket.id)
      expect(updatedTicket?.state).toBe('done')
    })

    it('should update queue metrics with service time', async () => {
      const queue = useQueue.getState()

      await queue.issueTicket({
        siteId: 'site-1',
        category: 'adult',
        stage: 'registration'
      })

      await queue.callNext('registration')
      await queue.completeCurrent('registration', 180)

      const metric = mockMetrics.get('m-registration')
      expect(metric).toBeDefined()
      expect(metric.avgServiceSec).toBeGreaterThan(0)
    })
  })

  describe('estimateTailMinutes', () => {
    it('should return 0 when no tickets waiting', async () => {
      const queue = useQueue.getState()

      const estimate = await queue.estimateTailMinutes('vitals')

      expect(estimate).toBe(0)
    })

    it('should calculate estimate based on waiting count and average service time', async () => {
      const queue = useQueue.getState()

      mockMetrics.set('m-consult', { avgServiceSec: 300 })

      await queue.issueTicket({
        siteId: 'site-1',
        category: 'adult',
        stage: 'consult'
      })
      await queue.issueTicket({
        siteId: 'site-1',
        category: 'adult',
        stage: 'consult'
      })

      const estimate = await queue.estimateTailMinutes('consult')

      expect(estimate).toBe(10)
    })

    it('should use default 240 seconds if no metrics available', async () => {
      const queue = useQueue.getState()

      await queue.issueTicket({
        siteId: 'site-1',
        category: 'adult',
        stage: 'pharmacy'
      })
      await queue.issueTicket({
        siteId: 'site-1',
        category: 'adult',
        stage: 'pharmacy'
      })
      await queue.issueTicket({
        siteId: 'site-1',
        category: 'adult',
        stage: 'pharmacy'
      })

      const estimate = await queue.estimateTailMinutes('pharmacy')

      expect(estimate).toBe(12)
    })
  })
})
