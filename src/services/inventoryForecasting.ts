import { db } from '@/db'

export interface DemandForecast {
  itemId: string
  itemName: string
  currentStock: number
  predictedDemand: number
  daysUntilStockout: number
  recommendedOrderQuantity: number
  confidence: number
  trend: 'increasing' | 'stable' | 'decreasing'
}

export interface ExpiryAlert {
  itemId: string
  itemName: string
  batchId: string
  expiryDate: Date
  daysUntilExpiry: number
  quantity: number
  urgency: 'critical' | 'high' | 'medium' | 'low'
  recommendations: string[]
}

export interface InventoryOptimization {
  itemId: string
  itemName: string
  currentStock: number
  optimalStock: number
  status: 'understock' | 'optimal' | 'overstock'
  actionRequired: string
  costImpact: number
}

export interface SeasonalPattern {
  item: string
  month: number
  averageDemand: number
  peakMonths: number[]
  recommendations: string[]
}

class InventoryForecastingSystem {

  async forecastDemand(days: number = 30): Promise<DemandForecast[]> {
    const inventory = await db.inventory.toArray()
    const forecasts: DemandForecast[] = []

    for (const item of inventory) {
      const historicalDispenses = await this.getHistoricalDispenses(item.id, 90)

      const avgDailyDemand = historicalDispenses.length / 90
      const predictedDemand = Math.ceil(avgDailyDemand * days)

      const daysUntilStockout = item.onHandQty > 0
        ? Math.floor(item.onHandQty / Math.max(avgDailyDemand, 0.1))
        : 0

      const trend = this.analyzeTrend(historicalDispenses)

      let adjustedDemand = predictedDemand
      if (trend === 'increasing') adjustedDemand = Math.ceil(predictedDemand * 1.2)
      if (trend === 'decreasing') adjustedDemand = Math.ceil(predictedDemand * 0.8)

      const safetyStock = Math.ceil(avgDailyDemand * 7)
      const recommendedOrderQuantity = Math.max(0, adjustedDemand + safetyStock - item.onHandQty)

      const confidence = this.calculateConfidence(historicalDispenses.length, avgDailyDemand)

      forecasts.push({
        itemId: item.id,
        itemName: item.itemName,
        currentStock: item.onHandQty,
        predictedDemand: adjustedDemand,
        daysUntilStockout,
        recommendedOrderQuantity,
        confidence,
        trend
      })
    }

    return forecasts.sort((a, b) => a.daysUntilStockout - b.daysUntilStockout)
  }

  private async getHistoricalDispenses(itemId: string, days: number): Promise<Date[]> {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - days)

    const dispenses = await db.dispenses
      .where('dispensedAt')
      .above(cutoffDate)
      .toArray()

    const dates: Date[] = []
    for (const dispense of dispenses) {
      if (dispense.itemName.toLowerCase().includes(itemId.toLowerCase())) {
        dates.push(new Date(dispense.dispensedAt))
      }
    }

    return dates
  }

  private analyzeTrend(dispenses: Date[]): 'increasing' | 'stable' | 'decreasing' {
    if (dispenses.length < 10) return 'stable'

    const midpoint = Math.floor(dispenses.length / 2)
    const firstHalf = dispenses.slice(0, midpoint).length
    const secondHalf = dispenses.slice(midpoint).length

    const ratio = secondHalf / Math.max(firstHalf, 1)

    if (ratio > 1.2) return 'increasing'
    if (ratio < 0.8) return 'decreasing'
    return 'stable'
  }

  private calculateConfidence(dataPoints: number, avgDemand: number): number {
    let confidence = 50

    if (dataPoints > 50) confidence += 30
    else if (dataPoints > 20) confidence += 20
    else if (dataPoints > 10) confidence += 10

    if (avgDemand > 5) confidence += 10
    else if (avgDemand > 2) confidence += 5

    return Math.min(confidence, 95)
  }

  async getExpiryAlerts(): Promise<ExpiryAlert[]> {
    const inventory = await db.inventory.toArray()
    const alerts: ExpiryAlert[] = []
    const today = new Date()

    for (const item of inventory) {
      const expiryDate = new Date(item.updatedAt)
      expiryDate.setDate(expiryDate.getDate() + 180)
      const daysUntilExpiry = Math.floor((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

      if (daysUntilExpiry <= 90) {
        const urgency = this.calculateExpiryUrgency(daysUntilExpiry, item.onHandQty)
        const recommendations = this.generateExpiryRecommendations(daysUntilExpiry, item.onHandQty)

        alerts.push({
          itemId: item.id,
          itemName: item.itemName,
          batchId: item.id,
          expiryDate,
          daysUntilExpiry,
          quantity: item.onHandQty,
          urgency,
          recommendations
        })
      }
    }

    return alerts.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry)
  }

  private calculateExpiryUrgency(daysUntilExpiry: number, quantity: number): ExpiryAlert['urgency'] {
    if (daysUntilExpiry <= 14) return 'critical'
    if (daysUntilExpiry <= 30) return 'high'
    if (daysUntilExpiry <= 60) return 'medium'
    return 'low'
  }

  private generateExpiryRecommendations(daysUntilExpiry: number, quantity: number): string[] {
    const recommendations: string[] = []

    if (daysUntilExpiry <= 7) {
      recommendations.push('URGENT: Prioritize dispensing immediately')
      recommendations.push('Consider donation to nearby clinic if unused')
    } else if (daysUntilExpiry <= 14) {
      recommendations.push('High priority for dispensing')
      recommendations.push('Place at front of shelf (FEFO)')
    } else if (daysUntilExpiry <= 30) {
      recommendations.push('Monitor usage closely')
      recommendations.push('Consider promotional campaign if high stock')
    } else {
      recommendations.push('Include in routine FEFO rotation')
    }

    if (quantity > 100) {
      recommendations.push('High volume - may need aggressive dispensing strategy')
    }

    return recommendations
  }

  async optimizeInventory(): Promise<InventoryOptimization[]> {
    const inventory = await db.inventory.toArray()
    const optimizations: InventoryOptimization[] = []

    for (const item of inventory) {
      const historicalDispenses = await this.getHistoricalDispenses(item.id, 90)
      const avgDailyDemand = historicalDispenses.length / 90

      const optimalStock = Math.ceil(avgDailyDemand * 30) + Math.ceil(avgDailyDemand * 7)

      let status: InventoryOptimization['status']
      let actionRequired: string
      let costImpact: number

      const stockRatio = item.onHandQty / Math.max(optimalStock, 1)

      if (stockRatio < 0.5) {
        status = 'understock'
        actionRequired = `Order ${Math.ceil(optimalStock - item.onHandQty)} units immediately`
        costImpact = -500
      } else if (stockRatio < 0.8) {
        status = 'understock'
        actionRequired = `Order ${Math.ceil(optimalStock - item.onHandQty)} units soon`
        costImpact = -200
      } else if (stockRatio > 2.0) {
        status = 'overstock'
        actionRequired = 'Reduce ordering quantity next cycle'
        costImpact = 300
      } else if (stockRatio > 1.5) {
        status = 'overstock'
        actionRequired = 'Monitor closely - may have excess'
        costImpact = 150
      } else {
        status = 'optimal'
        actionRequired = 'Maintain current ordering pattern'
        costImpact = 0
      }

      optimizations.push({
        itemId: item.id,
        itemName: item.itemName,
        currentStock: item.onHandQty,
        optimalStock,
        status,
        actionRequired,
        costImpact
      })
    }

    return optimizations.sort((a, b) => {
      const priority = { 'understock': 0, 'overstock': 1, 'optimal': 2 }
      return priority[a.status] - priority[b.status]
    })
  }

  async analyzeSeasonalPatterns(): Promise<SeasonalPattern[]> {
    const inventory = await db.inventory.toArray()
    const patterns: SeasonalPattern[] = []

    for (const item of inventory) {
      const monthlyDemand = await this.getMonthlyDemand(item.id)

      const avgDemand = Object.values(monthlyDemand).reduce((a, b) => a + b, 0) / 12
      const peakMonths = Object.entries(monthlyDemand)
        .filter(([_, demand]) => demand > avgDemand * 1.3)
        .map(([month]) => parseInt(month))

      const recommendations: string[] = []

      if (peakMonths.length > 0) {
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        const peakNames = peakMonths.map(m => monthNames[m])
        recommendations.push(`Increase stock before peak months: ${peakNames.join(', ')}`)
        recommendations.push('Order 30% extra inventory 1 month before peaks')
      }

      patterns.push({
        item: item.itemName,
        month: new Date().getMonth(),
        averageDemand: Math.round(avgDemand),
        peakMonths,
        recommendations
      })
    }

    return patterns
  }

  private async getMonthlyDemand(itemId: string): Promise<Record<number, number>> {
    const dispenses = await this.getHistoricalDispenses(itemId, 365)

    const monthlyCount: Record<number, number> = {}
    for (let i = 0; i < 12; i++) {
      monthlyCount[i] = 0
    }

    dispenses.forEach(date => {
      const month = date.getMonth()
      monthlyCount[month]++
    })

    return monthlyCount
  }

  async generateOrderList(): Promise<{
    itemName: string
    currentStock: number
    orderQuantity: number
    priority: 'urgent' | 'high' | 'normal'
    estimatedCost: number
  }[]> {
    const forecasts = await this.forecastDemand(30)

    return forecasts
      .filter(f => f.recommendedOrderQuantity > 0)
      .map(f => ({
        itemName: f.itemName,
        currentStock: f.currentStock,
        orderQuantity: f.recommendedOrderQuantity,
        priority: (f.daysUntilStockout < 7 ? 'urgent' :
                  f.daysUntilStockout < 14 ? 'high' : 'normal') as 'urgent' | 'high' | 'normal',
        estimatedCost: f.recommendedOrderQuantity * 10
      }))
      .sort((a, b) => {
        const priorityWeight = { urgent: 0, high: 1, normal: 2 }
        return priorityWeight[a.priority] - priorityWeight[b.priority]
      })
  }
}

export const inventoryForecasting = new InventoryForecastingSystem()
