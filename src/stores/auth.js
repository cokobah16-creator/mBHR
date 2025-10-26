import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { db, generateId } from '@/db';
import { verifyPin } from '@/utils/pin';
import * as logger from '@/lib/logger';
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes
const STAFF_SESSION_DURATION = 12 * 60 * 60 * 1000; // 12 hours
export const useAuthStore = create()(persist((set, get) => ({
    currentUser: null,
    currentSession: null,
    isAuthenticated: false,
    failedAttempts: 0,
    lockoutUntil: null,
    sessionExpiresAt: null,
    lastActivityAt: null,
    login: async (pin) => {
        const state = get();
        // Check lockout
        if (state.checkLockout()) {
            console.log('Account locked out');
            return false;
        }
        if (!/^\d{6}$/.test(pin)) {
            console.log('Invalid PIN format:', pin);
            state.incrementFailedAttempts();
            return false;
        }
        try {
            // Get all active users
            const users = await db.users.filter(u => u.isActive === 1).toArray();
            console.log('[auth] Found users:', users.length);
            console.log('[auth] User details:', users.map(u => ({
                id: u.id,
                fullName: u.fullName,
                role: u.role,
                hasPin: !!u.pinHash,
                hasSalt: !!u.pinSalt
            })));
            for (const user of users) {
                if (user.pinHash && user.pinSalt) {
                    console.log('[auth] Checking PIN for user:', user.fullName, user.role);
                    console.log('[auth]   User salt:', user.pinSalt.substring(0, 15), '...');
                    console.log('[auth]   User hash:', user.pinHash.substring(0, 20), '...');
                    console.log('[auth]   Entered PIN:', pin);
                    const isValid = await verifyPin(pin, user.pinHash, user.pinSalt);
                    console.log('[auth] PIN valid for', user.fullName, ':', isValid);
                    if (isValid) {
                        // Create session
                        const session = {
                            id: generateId(),
                            userId: user.id,
                            createdAt: new Date(),
                            deviceKey: generateId(),
                            lastSeenAt: new Date()
                        };
                        await db.sessions.add(session);
                        const now = Date.now();
                        const expiresAt = now + STAFF_SESSION_DURATION;
                        set({
                            currentUser: user,
                            currentSession: session,
                            isAuthenticated: true,
                            failedAttempts: 0,
                            lockoutUntil: null,
                            sessionExpiresAt: expiresAt,
                            lastActivityAt: now
                        });
                        return true;
                    }
                }
            }
            // PIN not found - increment failed attempts
            console.log('No matching PIN found for:', pin);
            state.incrementFailedAttempts();
            return false;
        }
        catch (error) {
            logger.error('Login error:', error);
            state.incrementFailedAttempts();
            return false;
        }
    },
    loginOnline: async (email, password) => {
        const state = get();
        // Check lockout
        if (state.checkLockout()) {
            console.log('Account locked out');
            return false;
        }
        try {
            const { supabaseSync } = await import('@/services/supabaseSync');
            if (!supabaseSync.isInitialized()) {
                logger.error('Supabase not configured');
                return false;
            }
            // NOTE: Supabase auth login requires email/password authentication
            // Current implementation uses offline PIN-based auth which is more suitable for field operations
            // To enable online auth, implement: supabase.auth.signInWithPassword({ email, password })
            logger.info('Online login with Supabase auth not enabled - using offline PIN auth');
            return false;
        }
        catch (error) {
            logger.error('Online login error:', error);
            state.incrementFailedAttempts();
            return false;
        }
    },
    logout: async () => {
        const state = get();
        if (state.currentSession) {
            await db.sessions.delete(state.currentSession.id);
        }
        set({
            currentUser: null,
            currentSession: null,
            isAuthenticated: false,
            sessionExpiresAt: null,
            lastActivityAt: null
        });
    },
    setCurrentUser: (user) => {
        set({ currentUser: user });
    },
    incrementFailedAttempts: () => {
        const state = get();
        const newAttempts = state.failedAttempts + 1;
        let lockoutUntil = null;
        if (newAttempts >= MAX_FAILED_ATTEMPTS) {
            lockoutUntil = Date.now() + LOCKOUT_DURATION;
        }
        set({
            failedAttempts: newAttempts,
            lockoutUntil
        });
    },
    resetFailedAttempts: () => {
        set({
            failedAttempts: 0,
            lockoutUntil: null
        });
    },
    checkLockout: () => {
        const state = get();
        if (state.lockoutUntil && Date.now() < state.lockoutUntil) {
            return true;
        }
        if (state.lockoutUntil && Date.now() >= state.lockoutUntil) {
            // Lockout expired, reset
            set({
                failedAttempts: 0,
                lockoutUntil: null
            });
        }
        return false;
    },
    updateActivity: () => {
        const now = Date.now();
        set({ lastActivityAt: now });
    },
    checkSessionExpiry: () => {
        const state = get();
        if (!state.sessionExpiresAt || !state.isAuthenticated) {
            return false;
        }
        const now = Date.now();
        if (now >= state.sessionExpiresAt) {
            // Session expired
            logger.info('[Auth] Session expired');
            state.logout();
            return true;
        }
        return false;
    }
}), {
    name: 'mbhr-auth',
    partialize: (state) => ({
        failedAttempts: state.failedAttempts,
        lockoutUntil: state.lockoutUntil,
        currentUser: state.currentUser,
        currentSession: state.currentSession,
        isAuthenticated: state.isAuthenticated,
        sessionExpiresAt: state.sessionExpiresAt,
        lastActivityAt: state.lastActivityAt
    })
}));
