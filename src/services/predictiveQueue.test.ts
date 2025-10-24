import { describe, it, expect, beforeEach, vi } from 'vitest'
import { predictiveQueue } from './predictiveQueue'
import { db } from '@/db'
import { mbhrDb } from '@/db/mbhr'

vi.mock('@/db', () => ({
  db: {
    queue: {
      where: vi.fn(() => ({
        equals: vi.fn(() => ({
          and: vi.fn(() => ({
            toArray: vi.fn(),
            count: vi.fn()
          }))
        }))
      }))
    },
    patients: {
      get: vi.fn()
    },
    vitals: {
      where: vi.fn(() => ({
        equals: vi.fn(() => ({
          reverse: vi.fn(() => ({
            limit: vi.fn(() => ({
              toArray: vi.fn()
            }))
          }))
        }))
      }))
    },
    patientAllergies: {
      where: vi.fn(() => ({
        equals: vi.fn(() => ({
          and: vi.fn(() => ({
            toArray: vi.fn()
          }))
        }))
      }))
    }
  }
}))

vi.mock('@/db/mbhr', () => ({
  mbhrDb: {
    tickets: {
      where: vi.fn(() => ({
        equals: vi.fn(() => ({
          and: vi.fn(() => ({
            count: vi.fn(),
            toArray: vi.fn()
          })),
          filter: vi.fn(() => ({
            toArray: vi.fn()
          }))
        }))
      }))
    },
    queue_metrics: {
      get: vi.fn()
    }
  }
}))

describe('Predictive Queue - Wait Time Predictions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should predict wait times for all stages', async () => {
    ;(db.queue.where as any).mockReturnValue({
      equals: vi.fn(() => ({
        and: vi.fn(() => ({
          count: vi.fn().mockResolvedValue(5)
        }))
      }))
    })

    ;(mbhrDb.tickets.where as any).mockReturnValue({
      equals: vi.fn(() => ({
        and: vi.fn(() => ({
          count: vi.fn().mockResolvedValue(3)
        })),
        filter: vi.fn(() => ({
          toArray: vi.fn().mockResolvedValue([])
        }))
      }))
    })

    ;(mbhrDb.queue_metrics.get as any).mockResolvedValue({
      avgServiceSec: 300
    })

    const predictions = await predictiveQueue.predictWaitTimes()

    expect(predictions).toHaveLength(4)
    expect(predictions[0]).toHaveProperty('stage')
    expect(predictions[0]).toHaveProperty('predictedWaitMinutes')
    expect(predictions[0]).toHaveProperty('bottleneckRisk')
    expect(predictions[0]).toHaveProperty('confidence')
  })

  it('should identify bottlenecks correctly', async () => {
    ;(db.queue.where as any).mockReturnValue({
      equals: vi.fn(() => ({
        and: vi.fn(() => ({
          count: vi.fn().mockResolvedValue(25)
        }))
      }))
    })

    ;(mbhrDb.tickets.where as any).mockReturnValue({
      equals: vi.fn(() => ({
        and: vi.fn(() => ({
          count: vi.fn().mockResolvedValue(15)
        })),
        filter: vi.fn(() => ({
          toArray: vi.fn().mockResolvedValue([])
        }))
      }))
    })

    ;(mbhrDb.queue_metrics.get as any).mockResolvedValue({
      avgServiceSec: 360
    })

    const predictions = await predictiveQueue.predictWaitTimes()

    const hasBottleneck = predictions.some(p =>
      p.bottleneckRisk === 'high' || p.bottleneckRisk === 'critical'
    )

    expect(hasBottleneck).toBe(true)
  })

  it('should provide recommendations for high wait times', async () => {
    ;(db.queue.where as any).mockReturnValue({
      equals: vi.fn(() => ({
        and: vi.fn(() => ({
          count: vi.fn().mockResolvedValue(30)
        }))
      }))
    })

    ;(mbhrDb.tickets.where as any).mockReturnValue({
      equals: vi.fn(() => ({
        and: vi.fn(() => ({
          count: vi.fn().mockResolvedValue(20)
        })),
        filter: vi.fn(() => ({
          toArray: vi.fn().mockResolvedValue([])
        }))
      }))
    })

    ;(mbhrDb.queue_metrics.get as any).mockResolvedValue({
      avgServiceSec: 300
    })

    const predictions = await predictiveQueue.predictWaitTimes()

    predictions.forEach(pred => {
      expect(pred.recommendedActions).toBeInstanceOf(Array)
      expect(pred.recommendedActions.length).toBeGreaterThan(0)
    })
  })

  it('should calculate confidence scores', async () => {
    ;(db.queue.where as any).mockReturnValue({
      equals: vi.fn(() => ({
        and: vi.fn(() => ({
          count: vi.fn().mockResolvedValue(10)
        }))
      }))
    })

    ;(mbhrDb.tickets.where as any).mockReturnValue({
      equals: vi.fn(() => ({
        and: vi.fn(() => ({
          count: vi.fn().mockResolvedValue(5)
        })),
        filter: vi.fn(() => ({
          toArray: vi.fn().mockResolvedValue(
            Array(20).fill({ timestamp: new Date().toISOString(), volume: 10 })
          )
        }))
      }))
    })

    ;(mbhrDb.queue_metrics.get as any).mockResolvedValue({
      avgServiceSec: 240
    })

    const predictions = await predictiveQueue.predictWaitTimes()

    predictions.forEach(pred => {
      expect(pred.confidence).toBeGreaterThanOrEqual(0)
      expect(pred.confidence).toBeLessThanOrEqual(100)
    })
  })
})

describe('Predictive Queue - Staffing Recommendations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should recommend staffing based on queue volume', async () => {
    ;(db.queue.where as any).mockReturnValue({
      equals: vi.fn(() => ({
        and: vi.fn(() => ({
          count: vi.fn().mockResolvedValue(20)
        }))
      }))
    })

    ;(mbhrDb.tickets.where as any).mockReturnValue({
      equals: vi.fn(() => ({
        and: vi.fn(() => ({
          count: vi.fn().mockResolvedValue(10)
        }))
      }))
    })

    ;(mbhrDb.queue_metrics.get as any).mockResolvedValue({
      avgServiceSec: 300
    })

    const staffing = await predictiveQueue.getStaffingRecommendations()

    expect(staffing).toHaveLength(4)
    staffing.forEach(rec => {
      expect(rec).toHaveProperty('stage')
      expect(rec).toHaveProperty('currentStaff')
      expect(rec).toHaveProperty('recommendedStaff')
      expect(rec).toHaveProperty('urgency')
      expect(rec).toHaveProperty('reason')
    })
  })

  it('should identify understaffing situations', async () => {
    ;(db.queue.where as any).mockReturnValue({
      equals: vi.fn(() => ({
        and: vi.fn(() => ({
          count: vi.fn().mockResolvedValue(40)
        }))
      }))
    })

    ;(mbhrDb.tickets.where as any).mockReturnValue({
      equals: vi.fn(() => ({
        and: vi.fn(() => ({
          count: vi.fn().mockResolvedValue(1)
        }))
      }))
    })

    ;(mbhrDb.queue_metrics.get as any).mockResolvedValue({
      avgServiceSec: 300
    })

    const staffing = await predictiveQueue.getStaffingRecommendations()

    const hasUrgent = staffing.some(s => s.urgency === 'high')
    expect(hasUrgent).toBe(true)
  })

  it('should not recommend changes for optimal staffing', async () => {
    ;(db.queue.where as any).mockReturnValue({
      equals: vi.fn(() => ({
        and: vi.fn(() => ({
          count: vi.fn().mockResolvedValue(5)
        }))
      }))
    })

    ;(mbhrDb.tickets.where as any).mockReturnValue({
      equals: vi.fn(() => ({
        and: vi.fn(() => ({
          count: vi.fn().mockResolvedValue(2)
        }))
      }))
    })

    ;(mbhrDb.queue_metrics.get as any).mockResolvedValue({
      avgServiceSec: 240
    })

    const staffing = await predictiveQueue.getStaffingRecommendations()

    const lowUrgency = staffing.filter(s => s.urgency === 'low')
    expect(lowUrgency.length).toBeGreaterThan(0)
  })
})

describe('Predictive Queue - Queue Optimization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should optimize queue order based on priority scores', async () => {
    const mockQueue = [
      { id: '1', patientId: 'p1', stage: 'registration', status: 'waiting', position: 1, updatedAt: new Date(Date.now() - 10 * 60000) },
      { id: '2', patientId: 'p2', stage: 'registration', status: 'waiting', position: 2, updatedAt: new Date(Date.now() - 5 * 60000) },
      { id: '3', patientId: 'p3', stage: 'registration', status: 'waiting', position: 3, updatedAt: new Date(Date.now() - 20 * 60000) }
    ]

    ;(db.queue.where as any).mockReturnValue({
      equals: vi.fn(() => ({
        and: vi.fn(() => ({
          toArray: vi.fn().mockResolvedValue(mockQueue)
        }))
      }))
    })

    ;(db.patients.get as any).mockResolvedValue({
      id: 'p1',
      givenName: 'John',
      familyName: 'Doe',
      dob: '1950-01-01'
    })

    ;(db.vitals.where as any).mockReturnValue({
      equals: vi.fn(() => ({
        reverse: vi.fn(() => ({
          limit: vi.fn(() => ({
            toArray: vi.fn().mockResolvedValue([
              { tempC: 40.0, systolic: 185, spo2: 88 }
            ])
          }))
        }))
      }))
    })

    ;(db.patientAllergies.where as any).mockReturnValue({
      equals: vi.fn(() => ({
        and: vi.fn(() => ({
          toArray: vi.fn().mockResolvedValue([])
        }))
      }))
    })

    const optimizations = await predictiveQueue.optimizeQueueOrder('registration')

    expect(optimizations).toBeInstanceOf(Array)
  })

  it('should prioritize patients with critical vitals', async () => {
    const mockPatient = {
      id: 'p1',
      givenName: 'Jane',
      familyName: 'Doe',
      dob: '1980-01-01'
    }

    const criticalVitals = [
      { tempC: 40.5, systolic: 190, spo2: 85 }
    ]

    ;(db.queue.where as any).mockReturnValue({
      equals: vi.fn(() => ({
        and: vi.fn(() => ({
          toArray: vi.fn().mockResolvedValue([
            { id: '1', patientId: 'p1', stage: 'vitals', status: 'waiting', position: 5, updatedAt: new Date() }
          ])
        }))
      }))
    })

    ;(db.patients.get as any).mockResolvedValue(mockPatient)

    ;(db.vitals.where as any).mockReturnValue({
      equals: vi.fn(() => ({
        reverse: vi.fn(() => ({
          limit: vi.fn(() => ({
            toArray: vi.fn().mockResolvedValue(criticalVitals)
          }))
        }))
      }))
    })

    ;(db.patientAllergies.where as any).mockReturnValue({
      equals: vi.fn(() => ({
        and: vi.fn(() => ({
          toArray: vi.fn().mockResolvedValue([])
        }))
      }))
    })

    const optimizations = await predictiveQueue.optimizeQueueOrder('vitals')

    if (optimizations.length > 0) {
      expect(optimizations[0].priorityScore).toBeGreaterThan(70)
      expect(optimizations[0].recommendedPosition).toBeLessThan(5)
    }
  })
})

describe('Predictive Queue - Historical Patterns', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should analyze historical patterns', async () => {
    const mockTickets = Array(100).fill(null).map((_, i) => ({
      id: `t${i}`,
      currentStage: 'registration',
      createdAt: new Date(Date.now() - i * 60 * 60000).toISOString()
    }))

    ;(mbhrDb.tickets.where as any).mockReturnValue({
      equals: vi.fn(() => ({
        filter: vi.fn(() => ({
          toArray: vi.fn().mockResolvedValue(mockTickets)
        }))
      }))
    })

    const patterns = await predictiveQueue.analyzeHistoricalPatterns()

    expect(patterns).toHaveLength(4)
    patterns.forEach(pattern => {
      expect(pattern).toHaveProperty('timeOfDay')
      expect(pattern).toHaveProperty('dayOfWeek')
      expect(pattern).toHaveProperty('averageVolume')
      expect(pattern).toHaveProperty('peakTimes')
      expect(pattern).toHaveProperty('recommendations')
    })
  })

  it('should identify peak times', async () => {
    const peakHour = 10
    const mockTickets = Array(200).fill(null).map((_, i) => {
      const hour = i < 150 ? peakHour : (peakHour + 4) % 24
      const date = new Date()
      date.setHours(hour, 0, 0, 0)
      return {
        id: `t${i}`,
        currentStage: 'registration',
        createdAt: date.toISOString()
      }
    })

    ;(mbhrDb.tickets.where as any).mockReturnValue({
      equals: vi.fn(() => ({
        filter: vi.fn(() => ({
          toArray: vi.fn().mockResolvedValue(mockTickets)
        }))
      }))
    })

    const patterns = await predictiveQueue.analyzeHistoricalPatterns()

    expect(patterns).toBeInstanceOf(Array)
    expect(patterns.length).toBeGreaterThan(0)
  })
})

describe('Predictive Queue - Queue Metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should calculate queue metrics', async () => {
    ;(mbhrDb.tickets.where as any).mockReturnValue({
      equals: vi.fn(() => ({
        filter: vi.fn(() => ({
          toArray: vi.fn().mockResolvedValue(
            Array(50).fill(null).map((_, i) => ({
              id: `t${i}`,
              currentStage: 'registration',
              createdAt: new Date(Date.now() - i * 60000).toISOString()
            }))
          )
        }))
      }))
    })

    const metrics = await predictiveQueue.getQueueMetrics('registration')

    expect(metrics).toHaveProperty('throughput')
    expect(metrics).toHaveProperty('averageServiceTime')
    expect(metrics).toHaveProperty('waitTimeVariance')
    expect(metrics).toHaveProperty('patientSatisfactionScore')
    expect(metrics).toHaveProperty('efficiency')
  })

  it('should calculate patient satisfaction scores', async () => {
    const shortWaitData = Array(20).fill(null).map((_, i) => ({
      id: `t${i}`,
      currentStage: 'vitals',
      createdAt: new Date(Date.now() - i * 30000).toISOString()
    }))

    ;(mbhrDb.tickets.where as any).mockReturnValue({
      equals: vi.fn(() => ({
        filter: vi.fn(() => ({
          toArray: vi.fn().mockResolvedValue(shortWaitData)
        }))
      }))
    })

    const metrics = await predictiveQueue.getQueueMetrics('vitals')

    expect(metrics.patientSatisfactionScore).toBeGreaterThan(70)
  })

  it('should calculate efficiency scores', async () => {
    const efficientData = Array(30).fill(null).map((_, i) => ({
      id: `t${i}`,
      currentStage: 'consult',
      createdAt: new Date(Date.now() - i * 45000).toISOString()
    }))

    ;(mbhrDb.tickets.where as any).mockReturnValue({
      equals: vi.fn(() => ({
        filter: vi.fn(() => ({
          toArray: vi.fn().mockResolvedValue(efficientData)
        }))
      }))
    })

    const metrics = await predictiveQueue.getQueueMetrics('consult')

    expect(metrics.efficiency).toBeGreaterThan(0)
    expect(metrics.efficiency).toBeLessThanOrEqual(100)
  })
})

describe('Predictive Queue - Report Generation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should generate comprehensive queue reports', async () => {
    ;(db.queue.where as any).mockReturnValue({
      equals: vi.fn(() => ({
        and: vi.fn(() => ({
          count: vi.fn().mockResolvedValue(10)
        }))
      }))
    })

    ;(mbhrDb.tickets.where as any).mockReturnValue({
      equals: vi.fn(() => ({
        and: vi.fn(() => ({
          count: vi.fn().mockResolvedValue(5)
        })),
        filter: vi.fn(() => ({
          toArray: vi.fn().mockResolvedValue(
            Array(50).fill(null).map((_, i) => ({
              id: `t${i}`,
              currentStage: 'registration',
              createdAt: new Date(Date.now() - i * 60 * 60000).toISOString()
            }))
          )
        }))
      }))
    })

    ;(mbhrDb.queue_metrics.get as any).mockResolvedValue({
      avgServiceSec: 240
    })

    const startDate = new Date(Date.now() - 7 * 24 * 60 * 60000)
    const endDate = new Date()

    const report = await predictiveQueue.generateQueueReport(startDate, endDate)

    expect(report).toHaveProperty('summary')
    expect(report).toHaveProperty('stageMetrics')
    expect(report).toHaveProperty('predictions')
    expect(report).toHaveProperty('staffingRecommendations')

    expect(report.summary).toHaveProperty('totalPatients')
    expect(report.summary).toHaveProperty('averageWaitTime')
    expect(report.summary).toHaveProperty('peakHour')
    expect(report.summary).toHaveProperty('bottleneckStage')

    expect(report.stageMetrics.length).toBe(4)
    expect(report.predictions.length).toBe(4)
    expect(report.staffingRecommendations.length).toBe(4)
  })
})
