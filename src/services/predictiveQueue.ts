import { db } from '@/db'
import { mbhrDb } from '@/db/mbhr'
import type { QueueItem, Patient } from '@/db'
import type { Ticket } from '@/db/mbhr'

export interface QueuePrediction {
  stage: string
  currentWaiting: number
  predictedWaitMinutes: number
  nextPatientETA: Date
  bottleneckRisk: 'none' | 'low' | 'moderate' | 'high' | 'critical'
  recommendedActions: string[]
  confidence: number
}

export interface StaffingRecommendation {
  stage: string
  currentStaff: number
  recommendedStaff: number
  reason: string
  urgency: 'low' | 'medium' | 'high'
}

export interface QueueOptimization {
  patientId: string
  currentPosition: number
  recommendedPosition: number
  reason: string
  priorityScore: number
}

export interface HistoricalPattern {
  timeOfDay: number
  dayOfWeek: number
  averageVolume: number
  peakTimes: string[]
  recommendations: string[]
}

export interface QueueMetrics {
  stage: string
  throughput: number
  averageServiceTime: number
  waitTimeVariance: number
  patientSatisfactionScore: number
  efficiency: number
}

class PredictiveQueueSystem {

  private readonly HISTORICAL_DAYS = 30
  private readonly PEAK_THRESHOLD = 1.5
  private readonly BOTTLENECK_THRESHOLD = 15

  async predictWaitTimes(): Promise<QueuePrediction[]> {
    const stages = ['registration', 'vitals', 'consult', 'pharmacy']
    const predictions: QueuePrediction[] = []

    for (const stage of stages) {
      const prediction = await this.predictStageWaitTime(stage)
      predictions.push(prediction)
    }

    return predictions
  }

  private async predictStageWaitTime(stage: string): Promise<QueuePrediction> {
    const waiting = await this.getWaitingCount(stage)
    const inProgress = await this.getInProgressCount(stage)
    const avgServiceTime = await this.getAverageServiceTime(stage)
    const historicalData = await this.getHistoricalData(stage)

    const currentHour = new Date().getHours()
    const dayOfWeek = new Date().getDay()

    const historicalVolume = historicalData.filter(d =>
      new Date(d.timestamp).getHours() === currentHour &&
      new Date(d.timestamp).getDay() === dayOfWeek
    )

    const avgVolume = historicalVolume.length > 0
      ? historicalVolume.reduce((sum, d) => sum + d.volume, 0) / historicalVolume.length
      : waiting

    const trendMultiplier = waiting > avgVolume ? 1.2 : 0.9

    const predictedWaitMinutes = Math.round(
      (waiting * avgServiceTime * trendMultiplier) / 60
    )

    const nextPatientETA = new Date(Date.now() + (avgServiceTime * 1000))

    const bottleneckRisk = this.assessBottleneckRisk(
      waiting,
      inProgress,
      avgServiceTime,
      avgVolume
    )

    const recommendedActions = this.generateRecommendations(
      stage,
      waiting,
      predictedWaitMinutes,
      bottleneckRisk
    )

    const confidence = this.calculateConfidence(historicalVolume.length, waiting)

    return {
      stage,
      currentWaiting: waiting,
      predictedWaitMinutes,
      nextPatientETA,
      bottleneckRisk,
      recommendedActions,
      confidence
    }
  }

  private assessBottleneckRisk(
    waiting: number,
    inProgress: number,
    avgServiceTime: number,
    avgVolume: number
  ): 'none' | 'low' | 'moderate' | 'high' | 'critical' {
    const waitMinutes = (waiting * avgServiceTime) / 60
    const volumeRatio = waiting / Math.max(avgVolume, 1)

    if (waitMinutes > 60 || volumeRatio > 3) return 'critical'
    if (waitMinutes > 45 || volumeRatio > 2) return 'high'
    if (waitMinutes > 30 || volumeRatio > 1.5) return 'moderate'
    if (waitMinutes > 15 || volumeRatio > 1.2) return 'low'
    return 'none'
  }

  private generateRecommendations(
    stage: string,
    waiting: number,
    predictedWait: number,
    bottleneckRisk: string
  ): string[] {
    const recommendations: string[] = []

    if (bottleneckRisk === 'critical' || bottleneckRisk === 'high') {
      recommendations.push(`URGENT: Add ${Math.ceil(waiting / 10)} more staff to ${stage}`)
      recommendations.push('Consider opening fast-track lane for urgent patients')
      recommendations.push('Alert management of critical queue buildup')
    }

    if (bottleneckRisk === 'moderate') {
      recommendations.push(`Consider adding 1-2 staff members to ${stage}`)
      recommendations.push('Monitor queue closely for next 30 minutes')
    }

    if (predictedWait > 45) {
      recommendations.push('Inform waiting patients of estimated wait time')
      recommendations.push('Set up patient comfort stations with water/seating')
    }

    if (waiting > 20 && stage === 'vitals') {
      recommendations.push('Deploy mobile vitals team to expedite processing')
    }

    if (waiting > 15 && stage === 'registration') {
      recommendations.push('Enable self-service registration kiosks')
      recommendations.push('Pre-fill forms for patients with appointments')
    }

    if (recommendations.length === 0) {
      recommendations.push('Queue operating normally - maintain current staffing')
    }

    return recommendations
  }

  private calculateConfidence(historicalPoints: number, currentVolume: number): number {
    const dataConfidence = Math.min(historicalPoints / 20, 1)
    const volumeConfidence = currentVolume > 0 ? 1 : 0.5
    return Math.round((dataConfidence * volumeConfidence) * 100)
  }

  async getStaffingRecommendations(): Promise<StaffingRecommendation[]> {
    const stages = ['registration', 'vitals', 'consult', 'pharmacy']
    const recommendations: StaffingRecommendation[] = []

    for (const stage of stages) {
      const waiting = await this.getWaitingCount(stage)
      const avgServiceTime = await this.getAverageServiceTime(stage)
      const currentStaff = await this.getCurrentStaffCount(stage)

      const idealStaff = Math.ceil(waiting / (3600 / avgServiceTime))

      let urgency: 'low' | 'medium' | 'high' = 'low'
      let reason = 'Current staffing adequate for queue volume'

      if (idealStaff > currentStaff + 2) {
        urgency = 'high'
        reason = 'Severe understaffing - queue building rapidly'
      } else if (idealStaff > currentStaff + 1) {
        urgency = 'medium'
        reason = 'Moderate understaffing - wait times increasing'
      } else if (idealStaff < currentStaff - 1) {
        reason = 'Possible overstaffing - consider reallocation'
      }

      recommendations.push({
        stage,
        currentStaff,
        recommendedStaff: Math.max(1, idealStaff),
        reason,
        urgency
      })
    }

    return recommendations
  }

  async optimizeQueueOrder(stage: string): Promise<QueueOptimization[]> {
    const queue = await db.queue
      .where('stage').equals(stage as any)
      .and(item => item.status === 'waiting')
      .toArray()

    const optimizations: QueueOptimization[] = []

    for (let i = 0; i < queue.length; i++) {
      const item = queue[i]
      const patient = await db.patients.get(item.patientId)

      if (!patient) continue

      const priorityScore = await this.calculatePriorityScore(patient, item)

      const idealPosition = this.calculateIdealPosition(queue, priorityScore)

      if (idealPosition !== i + 1 && Math.abs(idealPosition - (i + 1)) > 2) {
        optimizations.push({
          patientId: item.patientId,
          currentPosition: i + 1,
          recommendedPosition: idealPosition,
          reason: this.explainPriorityReason(patient, priorityScore),
          priorityScore
        })
      }
    }

    return optimizations.sort((a, b) => b.priorityScore - a.priorityScore)
  }

  private async calculatePriorityScore(patient: Patient, queueItem: QueueItem): Promise<number> {
    let score = 50

    const recentVitals = await db.vitals
      .where('patientId')
      .equals(patient.id)
      .reverse()
      .limit(1)
      .toArray()

    if (recentVitals.length > 0) {
      const vitals = recentVitals[0]

      if (vitals.tempC && vitals.tempC > 39.5) score += 30
      else if (vitals.tempC && vitals.tempC > 38.5) score += 20

      if (vitals.systolic && (vitals.systolic > 180 || vitals.systolic < 90)) score += 30
      else if (vitals.systolic && (vitals.systolic > 160 || vitals.systolic < 100)) score += 20

      if (vitals.spo2 && vitals.spo2 < 90) score += 40
      else if (vitals.spo2 && vitals.spo2 < 94) score += 25
    }

    const allergies = await db.patientAllergies
      .where('patientId')
      .equals(patient.id)
      .and(a => a.isActive === 1)
      .toArray()

    if (allergies.some(a => a.severity === 'life-threatening')) score += 15

    if (patient.dob) {
      const age = Math.floor((Date.now() - new Date(patient.dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
      if (age < 5) score += 10
      if (age > 65) score += 10
    }

    const waitTime = Date.now() - queueItem.updatedAt.getTime()
    const waitMinutes = waitTime / (60 * 1000)
    if (waitMinutes > 60) score += 20
    else if (waitMinutes > 45) score += 15
    else if (waitMinutes > 30) score += 10

    return Math.min(score, 100)
  }

  private calculateIdealPosition(queue: QueueItem[], priorityScore: number): number {
    if (priorityScore >= 80) return 1
    if (priorityScore >= 70) return Math.min(3, Math.ceil(queue.length * 0.2))
    if (priorityScore >= 60) return Math.min(5, Math.ceil(queue.length * 0.3))

    return Math.ceil(queue.length * (1 - priorityScore / 100))
  }

  private explainPriorityReason(patient: Patient, score: number): string {
    if (score >= 80) return 'Critical vital signs or severe symptoms requiring immediate attention'
    if (score >= 70) return 'High-risk patient with concerning vital signs'
    if (score >= 60) return 'Vulnerable population (elderly/pediatric) or extended wait time'
    if (score >= 55) return 'Moderate risk factors present'
    return 'Routine priority'
  }

  async analyzeHistoricalPatterns(): Promise<HistoricalPattern[]> {
    const patterns: HistoricalPattern[] = []
    const stages = ['registration', 'vitals', 'consult', 'pharmacy']

    for (const stage of stages) {
      const historicalData = await this.getHistoricalData(stage)

      const hourlyVolume = new Map<number, number[]>()
      const dailyVolume = new Map<number, number[]>()

      historicalData.forEach(d => {
        const hour = new Date(d.timestamp).getHours()
        const day = new Date(d.timestamp).getDay()

        if (!hourlyVolume.has(hour)) hourlyVolume.set(hour, [])
        if (!dailyVolume.has(day)) dailyVolume.set(day, [])

        hourlyVolume.get(hour)!.push(d.volume)
        dailyVolume.get(day)!.push(d.volume)
      })

      const avgByHour = new Map<number, number>()
      hourlyVolume.forEach((volumes, hour) => {
        avgByHour.set(hour, volumes.reduce((a, b) => a + b, 0) / volumes.length)
      })

      const overallAvg = Array.from(avgByHour.values()).reduce((a, b) => a + b, 0) / avgByHour.size

      const peakTimes: string[] = []
      avgByHour.forEach((avg, hour) => {
        if (avg > overallAvg * this.PEAK_THRESHOLD) {
          const endHour = (hour + 1) % 24
          peakTimes.push(`${hour}:00 - ${endHour}:00`)
        }
      })

      const recommendations: string[] = []
      if (peakTimes.length > 0) {
        recommendations.push(`Peak times identified: ${peakTimes.join(', ')}`)
        recommendations.push('Consider scheduling additional staff during peak hours')
      }

      const currentHour = new Date().getHours()
      const currentAvg = avgByHour.get(currentHour) || 0
      if (currentAvg > overallAvg * this.PEAK_THRESHOLD) {
        recommendations.push('Currently in peak period - maintain full staffing')
      }

      patterns.push({
        timeOfDay: currentHour,
        dayOfWeek: new Date().getDay(),
        averageVolume: Math.round(overallAvg),
        peakTimes,
        recommendations
      })
    }

    return patterns
  }

  async getQueueMetrics(stage: string): Promise<QueueMetrics> {
    const historicalData = await this.getHistoricalData(stage)

    const completedToday = historicalData.filter(d => {
      const date = new Date(d.timestamp)
      const today = new Date()
      return date.toDateString() === today.toDateString()
    })

    const throughput = completedToday.reduce((sum, d) => sum + d.volume, 0)

    const serviceTimes = completedToday.map(d => d.serviceTime || 0)
    const averageServiceTime = serviceTimes.length > 0
      ? serviceTimes.reduce((a, b) => a + b, 0) / serviceTimes.length
      : 0

    const variance = this.calculateVariance(serviceTimes)

    const targetServiceTime = 300
    const efficiency = averageServiceTime > 0
      ? Math.min(100, Math.round((targetServiceTime / averageServiceTime) * 100))
      : 0

    const waitTimes = completedToday.map(d => d.waitTime || 0)
    const avgWaitTime = waitTimes.length > 0
      ? waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length
      : 0

    const satisfactionScore = this.calculateSatisfactionScore(avgWaitTime, averageServiceTime)

    return {
      stage,
      throughput,
      averageServiceTime: Math.round(averageServiceTime),
      waitTimeVariance: Math.round(variance),
      patientSatisfactionScore: satisfactionScore,
      efficiency
    }
  }

  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2))
    return squaredDiffs.reduce((a, b) => a + b, 0) / values.length
  }

  private calculateSatisfactionScore(avgWaitTime: number, avgServiceTime: number): number {
    let score = 100

    if (avgWaitTime > 60 * 60) score -= 40
    else if (avgWaitTime > 45 * 60) score -= 30
    else if (avgWaitTime > 30 * 60) score -= 20
    else if (avgWaitTime > 15 * 60) score -= 10

    if (avgServiceTime > 600) score -= 10
    else if (avgServiceTime > 480) score -= 5

    return Math.max(0, score)
  }

  private async getWaitingCount(stage: string): Promise<number> {
    const count1 = await db.queue
      .where('stage').equals(stage as any)
      .and(item => item.status === 'waiting')
      .count()

    const count2 = await mbhrDb.tickets
      .where('currentStage').equals(stage as any)
      .and(t => t.state === 'waiting')
      .count()

    return count1 + count2
  }

  private async getInProgressCount(stage: string): Promise<number> {
    const count1 = await db.queue
      .where('stage').equals(stage as any)
      .and(item => item.status === 'in_progress')
      .count()

    const count2 = await mbhrDb.tickets
      .where('currentStage').equals(stage as any)
      .and(t => t.state === 'in_progress')
      .count()

    return count1 + count2
  }

  private async getAverageServiceTime(stage: string): Promise<number> {
    const metric = await mbhrDb.queue_metrics.get(`m-${stage}`)
    return metric?.avgServiceSec || 240
  }

  private async getCurrentStaffCount(stage: string): Promise<number> {
    const inProgress = await this.getInProgressCount(stage)
    return Math.max(1, inProgress)
  }

  private async getHistoricalData(stage: string): Promise<Array<{
    timestamp: string
    volume: number
    serviceTime?: number
    waitTime?: number
  }>> {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - this.HISTORICAL_DAYS)

    const tickets = await mbhrDb.tickets
      .where('currentStage').equals(stage as any)
      .filter(t => new Date(t.createdAt) >= thirtyDaysAgo)
      .toArray()

    const hourlyData = new Map<string, number>()

    tickets.forEach(ticket => {
      const date = new Date(ticket.createdAt)
      const hourKey = `${date.toISOString().slice(0, 13)}:00:00`

      hourlyData.set(hourKey, (hourlyData.get(hourKey) || 0) + 1)
    })

    return Array.from(hourlyData.entries()).map(([timestamp, volume]) => ({
      timestamp,
      volume,
      serviceTime: 240,
      waitTime: 300
    }))
  }

  async generateQueueReport(startDate: Date, endDate: Date): Promise<{
    summary: {
      totalPatients: number
      averageWaitTime: number
      peakHour: string
      bottleneckStage: string
    }
    stageMetrics: QueueMetrics[]
    predictions: QueuePrediction[]
    staffingRecommendations: StaffingRecommendation[]
  }> {
    const stages = ['registration', 'vitals', 'consult', 'pharmacy']

    const stageMetrics = await Promise.all(
      stages.map(stage => this.getQueueMetrics(stage))
    )

    const predictions = await this.predictWaitTimes()
    const staffingRecommendations = await this.getStaffingRecommendations()

    const totalPatients = stageMetrics.reduce((sum, m) => sum + m.throughput, 0)
    const avgWaitTime = stageMetrics.reduce((sum, m) => sum + m.averageServiceTime, 0) / stages.length

    const bottleneckStage = stageMetrics.reduce((worst, current) =>
      current.averageServiceTime > worst.averageServiceTime ? current : worst
    ).stage

    const peakHour = await this.identifyPeakHour()

    return {
      summary: {
        totalPatients,
        averageWaitTime: Math.round(avgWaitTime),
        peakHour,
        bottleneckStage
      },
      stageMetrics,
      predictions,
      staffingRecommendations
    }
  }

  private async identifyPeakHour(): Promise<string> {
    const stages = ['registration', 'vitals', 'consult', 'pharmacy']
    const hourlyVolumes = new Map<number, number>()

    for (const stage of stages) {
      const data = await this.getHistoricalData(stage)
      data.forEach(d => {
        const hour = new Date(d.timestamp).getHours()
        hourlyVolumes.set(hour, (hourlyVolumes.get(hour) || 0) + d.volume)
      })
    }

    let peakHour = 9
    let maxVolume = 0

    hourlyVolumes.forEach((volume, hour) => {
      if (volume > maxVolume) {
        maxVolume = volume
        peakHour = hour
      }
    })

    return `${peakHour}:00 - ${(peakHour + 1) % 24}:00`
  }
}

export const predictiveQueue = new PredictiveQueueSystem()
