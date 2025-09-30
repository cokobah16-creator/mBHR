import Dexie, { Table } from 'dexie'
import { ulid } from 'ulid'

// Gamification Types
export interface GameTask {
  id: string
  code: string
  title: string
  description: string
  baseTokens: number
  estimatedMinutes: number
  validators: string[]
  activeFrom?: string
  activeTo?: string
  category: 'clinic-flow' | 'inventory' | 'knowledge' | 'community'
  requiredRole?: string[]
  cooldownMinutes?: number
  maxPerDay?: number
  updatedAt: string
}

export interface GameAttempt {
  id: string
  taskCode: string
  actorId: string
  payloadJson: string // JSON string of task-specific data
  startedAt: string
  finishedAt?: string
  score?: number
  tokens?: number
  multipliersJson?: string // JSON string of applied multipliers
  verifiedBy?: string
  verifiedAt?: string
  status: 'in_progress' | 'completed' | 'verified' | 'rejected'
  _dirty?: number
  _syncedAt?: string
}

export interface Badge {
  id: string
  code: string
  name: string
  description: string
  icon: string
  category: string
  requirements: string // JSON string of requirements
  rarity: 'common' | 'rare' | 'epic' | 'legendary'
}

export interface BadgeAward {
  id: string
  badgeCode: string
  actorId: string
  awardedAt: string
  reason?: string
  _dirty?: number
  _syncedAt?: string
}

export interface Wallet {
  actorId: string // Primary key
  tokens: number
  lifetimeTokens: number
  level: number
  streakDays: number
  lastActiveDate?: string
  updatedAt: string
  _dirty?: number
  _syncedAt?: string
}

export interface LeaderEvent {
  id: string
  actorId: string
  metric: string
  value: number
  metadata?: string // JSON string
  at: string
  _dirty?: number
  _syncedAt?: string
}

export interface TeamGoal {
  id: string
  title: string
  description: string
  targetValue: number
  currentValue: number
  metric: string
  bonusTokens: number
  startDate: string
  endDate: string
  status: 'active' | 'completed' | 'expired'
  participants: string[] // Array of actorIds
}

// Database class for gamification
export class GamificationDB extends Dexie {
  game_tasks!: Table<GameTask>
  game_attempts!: Table<GameAttempt>
  badges!: Table<Badge>
  badge_awards!: Table<BadgeAward>
  wallets!: Table<Wallet>
  leader_events!: Table<LeaderEvent>
  team_goals!: Table<TeamGoal>

  constructor() {
    super('gamification_db')
    
    this.version(1).stores({
      game_tasks: 'id, code, category, activeFrom, activeTo',
      game_attempts: 'id, taskCode, actorId, startedAt, finishedAt, status, _dirty, _syncedAt',
      badges: 'id, code, category, rarity',
      badge_awards: 'id, badgeCode, actorId, awardedAt, _dirty, _syncedAt',
      wallets: 'actorId, level, streakDays, updatedAt, _dirty, _syncedAt',
      leader_events: 'id, actorId, metric, at, _dirty, _syncedAt',
      team_goals: 'id, status, startDate, endDate, metric'
    })
  }
}

export const gamificationDb = new GamificationDB()

// Helper functions
export const generateGameId = () => ulid()

// Token calculation with multipliers
export function calculateTokens(
  baseTokens: number,
  multipliers: {
    streak?: number
    accuracy?: number
    teamBonus?: number
    speedBonus?: number
    qualityBonus?: number
  } = {}
): number {
  const {
    streak = 0,
    accuracy = 1.0,
    teamBonus = 0,
    speedBonus = 1.0,
    qualityBonus = 1.0
  } = multipliers

  // Streak multiplier: up to +50% for 5+ day streak
  const streakMult = 1 + Math.min(streak, 5) * 0.1
  
  // Accuracy multiplier: 0.8x to 1.3x
  const accMult = Math.max(0.8, Math.min(1.3, accuracy))
  
  const finalTokens = Math.round(
    baseTokens * streakMult * accMult * speedBonus * qualityBonus
  ) + teamBonus

  return Math.max(1, finalTokens) // Minimum 1 token
}

// Badge checking logic
export async function checkBadgeEligibility(actorId: string, taskCode: string): Promise<string[]> {
  const newBadges: string[] = []
  
  try {
    const attempts = await gamificationDb.game_attempts
      .where('actorId')
      .equals(actorId)
      .and(attempt => attempt.status === 'verified' || attempt.status === 'completed')
      .toArray()

    const wallet = await gamificationDb.wallets.get(actorId)
    const existingBadges = await gamificationDb.badge_awards
      .where('actorId')
      .equals(actorId)
      .toArray()

    const existingBadgeCodes = new Set(existingBadges.map(b => b.badgeCode))

    // Check various badge conditions
    const taskAttempts = attempts.filter(a => a.taskCode === taskCode)
    const totalAttempts = attempts.length
    const totalTokens = wallet?.lifetimeTokens || 0

    // First completion badges
    if (taskAttempts.length === 1 && !existingBadgeCodes.has('first_quest')) {
      newBadges.push('first_quest')
    }

    // Streak badges
    if (wallet?.streakDays >= 7 && !existingBadgeCodes.has('week_warrior')) {
      newBadges.push('week_warrior')
    }

    // Token milestone badges
    if (totalTokens >= 1000 && !existingBadgeCodes.has('token_collector')) {
      newBadges.push('token_collector')
    }

    // Task-specific badges
    if (taskCode === 'queue_maestro') {
      const queueAttempts = attempts.filter(a => a.taskCode === 'queue_maestro')
      if (queueAttempts.length >= 50 && !existingBadgeCodes.has('flow_master')) {
        newBadges.push('flow_master')
      }
    }

    // Award new badges
    for (const badgeCode of newBadges) {
      await gamificationDb.badge_awards.add({
        id: generateGameId(),
        badgeCode,
        actorId,
        awardedAt: new Date().toISOString(),
        reason: `Earned through ${taskCode}`,
        _dirty: 1
      })
    }

  } catch (error) {
    console.error('Error checking badge eligibility:', error)
  }

  return newBadges
}

// Update wallet with tokens and streak
export async function updateWallet(
  actorId: string, 
  tokensEarned: number,
  maintainStreak: boolean = true
): Promise<Wallet> {
  const now = new Date().toISOString()
  const today = now.split('T')[0]
  
  let wallet = await gamificationDb.wallets.get(actorId)
  
  if (!wallet) {
    wallet = {
      actorId,
      tokens: 0,
      lifetimeTokens: 0,
      level: 1,
      streakDays: 0,
      updatedAt: now,
      _dirty: 1
    }
  }

  // Update tokens
  wallet.tokens += tokensEarned
  wallet.lifetimeTokens += tokensEarned

  // Update streak
  const lastActiveDate = wallet.lastActiveDate?.split('T')[0]
  if (maintainStreak) {
    if (!lastActiveDate || lastActiveDate === today) {
      // Same day or first time - maintain current streak
    } else {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const yesterdayStr = yesterday.toISOString().split('T')[0]
      
      if (lastActiveDate === yesterdayStr) {
        // Consecutive day - increment streak
        wallet.streakDays += 1
      } else {
        // Streak broken - reset to 1
        wallet.streakDays = 1
      }
    }
  }

  // Update level based on lifetime tokens
  wallet.level = Math.floor(wallet.lifetimeTokens / 500) + 1

  wallet.lastActiveDate = now
  wallet.updatedAt = now
  wallet._dirty = 1

  await gamificationDb.wallets.put(wallet)
  return wallet
}

// Seed initial game tasks and badges
export async function seedGamificationData() {
  try {
    // Check if already seeded
    const taskCount = await gamificationDb.game_tasks.count()
    if (taskCount > 0) return

    console.log('🎮 Seeding gamification data...')

    // Seed game tasks
    const tasks: GameTask[] = [
      {
        id: generateGameId(),
        code: 'queue_maestro',
        title: 'Queue Maestro',
        description: 'Process patients efficiently through care stages',
        baseTokens: 15,
        estimatedMinutes: 5,
        validators: ['service_time', 'handoff_clean'],
        category: 'clinic-flow',
        requiredRole: ['nurse', 'volunteer', 'admin'],
        cooldownMinutes: 2,
        maxPerDay: 50,
        updatedAt: new Date().toISOString()
      },
      {
        id: generateGameId(),
        code: 'vitals_precision',
        title: 'Vitals Precision',
        description: 'Capture accurate vital signs with validation',
        baseTokens: 12,
        estimatedMinutes: 3,
        validators: ['completeness', 'range_check'],
        category: 'clinic-flow',
        requiredRole: ['nurse', 'volunteer', 'admin'],
        cooldownMinutes: 1,
        maxPerDay: 100,
        updatedAt: new Date().toISOString()
      },
      {
        id: generateGameId(),
        code: 'restock_blitz',
        title: 'Restock Blitz',
        description: 'Restock low inventory items quickly and accurately',
        baseTokens: 8,
        estimatedMinutes: 2,
        validators: ['quantity_check', 'combo_meter'],
        category: 'inventory',
        requiredRole: ['volunteer', 'nurse', 'admin'],
        cooldownMinutes: 0,
        maxPerDay: 20,
        updatedAt: new Date().toISOString()
      },
      {
        id: generateGameId(),
        code: 'knowledge_blitz',
        title: 'Knowledge Blitz',
        description: '60-second quiz on protocols and procedures',
        baseTokens: 10,
        estimatedMinutes: 1,
        validators: ['accuracy', 'speed'],
        category: 'knowledge',
        cooldownMinutes: 60,
        maxPerDay: 5,
        updatedAt: new Date().toISOString()
      },
      {
        id: generateGameId(),
        code: 'shelf_sleuth',
        title: 'Shelf Sleuth',
        description: 'Verify inventory counts and find discrepancies',
        baseTokens: 20,
        estimatedMinutes: 8,
        validators: ['accuracy', 'discoveries'],
        category: 'inventory',
        requiredRole: ['volunteer', 'nurse', 'pharmacist', 'admin'],
        cooldownMinutes: 30,
        maxPerDay: 10,
        updatedAt: new Date().toISOString()
      }
    ]

    await gamificationDb.game_tasks.bulkAdd(tasks)

    // Seed badges
    const badges: Badge[] = [
      {
        id: generateGameId(),
        code: 'first_quest',
        name: 'First Quest',
        description: 'Complete your first gamified task',
        icon: '🌟',
        category: 'milestone',
        requirements: JSON.stringify({ totalAttempts: 1 }),
        rarity: 'common'
      },
      {
        id: generateGameId(),
        code: 'week_warrior',
        name: 'Week Warrior',
        description: 'Maintain a 7-day activity streak',
        icon: '🔥',
        category: 'streak',
        requirements: JSON.stringify({ streakDays: 7 }),
        rarity: 'rare'
      },
      {
        id: generateGameId(),
        code: 'flow_master',
        name: 'Flow Master',
        description: 'Complete 50 Queue Maestro challenges',
        icon: '⚡',
        category: 'expertise',
        requirements: JSON.stringify({ taskCode: 'queue_maestro', count: 50 }),
        rarity: 'epic'
      },
      {
        id: generateGameId(),
        code: 'token_collector',
        name: 'Token Collector',
        description: 'Earn 1,000 lifetime tokens',
        icon: '💰',
        category: 'milestone',
        requirements: JSON.stringify({ lifetimeTokens: 1000 }),
        rarity: 'rare'
      },
      {
        id: generateGameId(),
        code: 'eagle_eye',
        name: 'Eagle Eye',
        description: 'Achieve 100% accuracy in vitals for a week',
        icon: '👁️',
        category: 'precision',
        requirements: JSON.stringify({ taskCode: 'vitals_precision', accuracy: 1.0, days: 7 }),
        rarity: 'epic'
      },
      {
        id: generateGameId(),
        code: 'stock_sleuth',
        name: 'Stock Sleuth',
        description: 'Discover 10 inventory discrepancies',
        icon: '🔍',
        category: 'discovery',
        requirements: JSON.stringify({ discoveries: 10 }),
        rarity: 'rare'
      }
    ]

    await gamificationDb.badges.bulkAdd(badges)

    console.log('✅ Gamification data seeded successfully')
  } catch (error) {
    console.error('❌ Failed to seed gamification data:', error)
  }
}