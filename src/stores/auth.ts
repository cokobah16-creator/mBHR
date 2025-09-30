import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { db, User, Session, generateId } from '@/db'
import { verifyPin } from '@/utils/pin'

interface AuthState {
  currentUser: User | null
  currentSession: Session | null
  isAuthenticated: boolean
  failedAttempts: number
  lockoutUntil: number | null
  
  // Actions
  login: (pin: string) => Promise<boolean>
  loginOnline: (email: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
  setCurrentUser: (user: User | null) => void
  incrementFailedAttempts: () => void
  resetFailedAttempts: () => void
  checkLockout: () => boolean
}

const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_DURATION = 15 * 60 * 1000 // 15 minutes

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      currentUser: null,
      currentSession: null,
      isAuthenticated: false,
      failedAttempts: 0,
      lockoutUntil: null,

      login: async (pin: string) => {
        const state = get()
        
        // Check lockout
        if (state.checkLockout()) {
          return false
        }

        if (!/^\d{6}$/.test(pin)) {
          state.incrementFailedAttempts()
          return false
        }

        try {
          // Get all active users
          const users = await db.users.filter(u => u.isActive).toArray()
          
          for (const user of users) {
            if (user.pinSalt && user.pinHash) {
              const isValid = await verifyPin(pin, user.pinHash, user.pinSalt)
              
              if (isValid) {
                // Create session
                const session: Session = {
                  id: generateId(),
                  userId: user.id,
                  createdAt: new Date(),
                  deviceKey: generateId(),
                  lastSeenAt: new Date()
                }
                
                await db.sessions.add(session)
                
                set({
                  currentUser: user,
                  currentSession: session,
                  isAuthenticated: true,
                  failedAttempts: 0,
                  lockoutUntil: null
                })
                
                return true
              }
            }
          }
          
          // PIN not found - increment failed attempts
          state.incrementFailedAttempts()
          return false
          
        } catch (error) {
          console.error('Login error:', error)
          return false
        }
      },

      loginOnline: async (email: string, password: string) => {
        // TODO: Implement Supabase authentication
        // For now, return false to force offline PIN login
        return false
      },

      logout: async () => {
        const state = get()
        
        if (state.currentSession) {
          await db.sessions.delete(state.currentSession.id)
        }
        
        set({
          currentUser: null,
          currentSession: null,
          isAuthenticated: false
        })
      },

      setCurrentUser: (user: User | null) => {
        set({ currentUser: user })
      },

      incrementFailedAttempts: () => {
        const state = get()
        const newAttempts = state.failedAttempts + 1
        
        let lockoutUntil = null
        if (newAttempts >= MAX_FAILED_ATTEMPTS) {
          lockoutUntil = Date.now() + LOCKOUT_DURATION
        }
        
        set({
          failedAttempts: newAttempts,
          lockoutUntil
        })
      },

      resetFailedAttempts: () => {
        set({
          failedAttempts: 0,
          lockoutUntil: null
        })
      },

      checkLockout: () => {
        const state = get()
        if (state.lockoutUntil && Date.now() < state.lockoutUntil) {
          return true
        }
        
        if (state.lockoutUntil && Date.now() >= state.lockoutUntil) {
          // Lockout expired, reset
          set({
            failedAttempts: 0,
            lockoutUntil: null
          })
        }
        
        return false
      }
    }),
    {
      name: 'mbhr-auth',
      partialize: (state) => ({
        failedAttempts: state.failedAttempts,
        lockoutUntil: state.lockoutUntil
      })
    }
  )
)