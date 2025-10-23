import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { db, generateId } from '@/db';
import { verifyPin } from '@/utils/pin';
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes
export const useAuthStore = create()(persist((set, get) => ({
    currentUser: null,
    currentSession: null,
    isAuthenticated: false,
    failedAttempts: 0,
    lockoutUntil: null,
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
                        set({
                            currentUser: user,
                            currentSession: session,
                            isAuthenticated: true,
                            failedAttempts: 0,
                            lockoutUntil: null
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
            console.error('Login error:', error);
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
                console.error('Supabase not configured');
                return false;
            }
            // TODO: Implement actual Supabase auth login
            // This would use supabase.auth.signInWithPassword({ email, password })
            // For now, return false as it requires Supabase auth setup
            console.log('Online login not fully implemented yet');
            return false;
        }
        catch (error) {
            console.error('Online login error:', error);
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
            isAuthenticated: false
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
    }
}), {
    name: 'mbhr-auth',
    partialize: (state) => ({
        failedAttempts: state.failedAttempts,
        lockoutUntil: state.lockoutUntil
    })
}));
