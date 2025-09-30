import { create } from 'zustand'
import { db as mbhrDb, ulid } from '@/db/mbhr'

type Period = 'all' | 'weekly'

type GamState = {
  // derived at runtime
  wallet: number
  loading: boolean
  ensureWallet: (volunteerId: string) => Promise<void>
  addTokens: (volunteerId: string, amount: number, badge?: string) => Promise<void>
  spendTokens: (volunteerId: string, cost: number) => Promise<boolean>
  addBadge: (volunteerId: string, badge: string) => Promise<void>
  leaderboard: (period?: Period, limit?: number) => Promise<Array<{ volunteerId: string; tokens: number }>>
}

export const useGam = create<GamState>((set, get) => ({
  wallet: 0,
  loading: false,

  ensureWallet: async (volunteerId) => {
    set({ loading: true })
    let row = await mbhrDb.gamification.get(volunteerId)
    if (!row) {
      const now = new Date().toISOString()
      await mbhrDb.gamification.add({
        id: volunteerId,
        volunteerId,
        tokens: 0,
        badges: [],
        updatedAt: now
      })
      row = await mbhrDb.gamification.get(volunteerId)
    }
    set({ wallet: row?.tokens ?? 0, loading: false })
  },

  addTokens: async (volunteerId, amount, badge) => {
    const row = await mbhrDb.gamification.get(volunteerId)
    const now = new Date().toISOString()
    if (!row) {
      await mbhrDb.gamification.add({ id: volunteerId, volunteerId, tokens: amount, badges: badge ? [badge] : [], updatedAt: now })
      set({ wallet: amount })
      return
    }
    const next = (row.tokens ?? 0) + amount
    const badges = new Set(row.badges ?? [])
    if (badge) badges.add(badge)
    await mbhrDb.gamification.update(volunteerId, { tokens: next, badges: Array.from(badges), updatedAt: now })
    set({ wallet: next })
  },

  spendTokens: async (volunteerId, cost) => {
    const row = await mbhrDb.gamification.get(volunteerId)
    if (!row || row.tokens < cost) return false
    const next = row.tokens - cost
    await mbhrDb.gamification.update(volunteerId, { tokens: next, updatedAt: new Date().toISOString() })
    set({ wallet: next })
    return true
  },

  addBadge: async (volunteerId, badge) => {
    const row = await mbhrDb.gamification.get(volunteerId)
    if (!row) return
    const badges = new Set(row.badges ?? [])
    badges.add(badge)
    await mbhrDb.gamification.update(volunteerId, { badges: Array.from(badges), updatedAt: new Date().toISOString() })
  },

  leaderboard: async (period = 'all', limit = 20) => {
    // For now "weekly" === all (server could aggregate weekly later)
    const rows = await mbhrDb.gamification.toArray()
    return rows
      .map(r => ({ volunteerId: r.volunteerId, tokens: r.tokens || 0 }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, limit)
  },
}))