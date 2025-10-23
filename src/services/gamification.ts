// Core gamification services
import { db, generateId, GameSession, GamificationWallet } from '@/db'

export interface GameResult {
  score: number
  tokensEarned: number
  badges: string[]
  multipliers: {
    streak?: number
    accuracy?: number
    speed?: number
    quality?: number
  }
}

export class GamificationService {
  // Calculate tokens with multipliers
  static calculateTokens(
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

  // Start a new game session
  static async startSession(
    type: GameSession['type'],
    volunteerId: string,
    payload: any = {}
  ): Promise<GameSession> {
    const session: GameSession = {
      id: generateId(),
      type,
      volunteerId,
      startedAt: new Date(),
      score: 0,
      tokensEarned: 0,
      payloadJson: JSON.stringify(payload),
      committed: false,
      _dirty: 1
    }

    await db.gameSessions.add(session)
    return session
  }

  // Complete a game session (pending approval)
  static async completeSession(
    sessionId: string,
    result: GameResult
  ): Promise<void> {
    await db.gameSessions.update(sessionId, {
      finishedAt: new Date(),
      score: result.score,
      tokensEarned: result.tokensEarned,
      payloadJson: JSON.stringify({
        ...JSON.parse((await db.gameSessions.get(sessionId))?.payloadJson || '{}'),
        result,
        badges: result.badges
      }),
      _dirty: 1
    })
  }

  // Approve session and mint tokens (admin/lead only)
  static async approveSession(sessionId: string, approverId: string): Promise<void> {
    const session = await db.gameSessions.get(sessionId)
    if (!session || session.committed) return

    // Update wallet
    await this.updateWallet(session.volunteerId, session.tokensEarned)

    // Mark as committed
    await db.gameSessions.update(sessionId, {
      committed: true,
      _dirty: 1
    })

    // Audit log
    await db.auditLogs.add({
      id: generateId(),
      actorRole: 'admin',
      action: 'approve_game_session',
      entity: 'game_session',
      entityId: sessionId,
      at: new Date()
    })
  }

  // Update wallet with tokens and streak
  static async updateWallet(
    volunteerId: string,
    tokensEarned: number,
    maintainStreak: boolean = true
  ): Promise<GamificationWallet> {
    const now = new Date()
    const today = now.toISOString().split('T')[0]
    
    let wallet = await db.gamificationWallets.get(volunteerId)
    
    if (!wallet) {
      wallet = {
        volunteerId,
        tokens: 0,
        badges: [],
        level: 1,
        streakDays: 0,
        lifetimeTokens: 0,
        updatedAt: now,
        _dirty: 1
      }
    }

    // Update tokens
    wallet.tokens += tokensEarned
    wallet.lifetimeTokens += tokensEarned

    // Update streak
    const lastActiveDate = wallet.lastActiveDate?.toISOString().split('T')[0]
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

    await db.gamificationWallets.put(wallet)
    return wallet
  }

  // Get leaderboard
  static async getLeaderboard(
    period: 'daily' | 'weekly' | 'all' = 'all',
    limit: number = 20
  ): Promise<Array<{ volunteerId: string; tokens: number; name: string }>> {
    try {
      const wallets = await db.gamificationWallets.orderBy('tokens').reverse().limit(limit).toArray()
      
      // Get user names
      const userIds = wallets.map(w => w.volunteerId)
      const users = await db.users.where('id').anyOf(userIds).toArray()
      const userMap = new Map(users.map(u => [u.id, u.fullName]))

      return wallets.map(wallet => ({
        volunteerId: wallet.volunteerId,
        tokens: wallet.tokens,
        name: userMap.get(wallet.volunteerId) || wallet.volunteerId
      }))
    } catch (error) {
      console.error('Error getting leaderboard:', error)
      return []
    }
  }

  // Check badge eligibility
  static async checkBadgeEligibility(volunteerId: string, gameType: string): Promise<string[]> {
    const newBadges: string[] = []
    
    try {
      const sessions = await db.gameSessions
        .where('volunteerId')
        .equals(volunteerId)
        .and(session => session.committed)
        .toArray()

      const wallet = await db.gamificationWallets.get(volunteerId)
      const gameTypeSessions = sessions.filter(s => s.type === gameType)

      // First completion badges
      if (gameTypeSessions.length === 1) {
        newBadges.push('first_quest')
      }

      // Streak badges
      if (wallet?.streakDays >= 7) {
        newBadges.push('week_warrior')
      }

      // Token milestone badges
      if (wallet?.lifetimeTokens >= 1000) {
        newBadges.push('token_collector')
      }

      // Game-specific badges
      if (gameType === 'vitals' && gameTypeSessions.length >= 100) {
        newBadges.push('vitals_master')
      }

      if (gameType === 'shelf' && gameTypeSessions.length >= 50) {
        newBadges.push('shelf_sleuth')
      }

      // Award new badges
      if (wallet && newBadges.length > 0) {
        const updatedBadges = [...new Set([...wallet.badges, ...newBadges])]
        await db.gamificationWallets.update(volunteerId, {
          badges: updatedBadges,
          _dirty: 1
        })
      }

    } catch (error) {
      console.error('Error checking badge eligibility:', error)
    }

    return newBadges
  }
}