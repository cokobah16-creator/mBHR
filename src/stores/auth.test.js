import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAuthStore } from './auth';
const mockDbUsers = {
    filter: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([])
    })
};
const mockDbSessions = {
    add: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined)
};
vi.mock('@/db', () => ({
    db: {
        users: mockDbUsers,
        sessions: mockDbSessions
    },
    generateId: () => 'test-id-123'
}));
vi.mock('@/utils/pin', () => ({
    verifyPin: vi.fn()
}));
vi.mock('@/lib/logger', () => ({
    error: vi.fn(),
    info: vi.fn()
}));
describe('useAuthStore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        useAuthStore.setState({
            currentUser: null,
            currentSession: null,
            isAuthenticated: false,
            failedAttempts: 0,
            lockoutUntil: null,
            sessionExpiresAt: null,
            lastActivityAt: null
        });
    });
    afterEach(() => {
        vi.useRealTimers();
    });
    describe('initial state', () => {
        it('should have correct initial state', () => {
            const state = useAuthStore.getState();
            expect(state.currentUser).toBeNull();
            expect(state.currentSession).toBeNull();
            expect(state.isAuthenticated).toBe(false);
            expect(state.failedAttempts).toBe(0);
            expect(state.lockoutUntil).toBeNull();
        });
    });
    describe('login validation', () => {
        it('should reject invalid PIN format', async () => {
            const result = await useAuthStore.getState().login('12345');
            expect(result).toBe(false);
            expect(useAuthStore.getState().failedAttempts).toBe(1);
        });
        it('should reject non-numeric PIN', async () => {
            const result = await useAuthStore.getState().login('abcdef');
            expect(result).toBe(false);
            expect(useAuthStore.getState().failedAttempts).toBe(1);
        });
        it('should reject PIN with spaces', async () => {
            const result = await useAuthStore.getState().login('123 45');
            expect(result).toBe(false);
        });
    });
    describe('failed attempts and lockout', () => {
        it('should increment failed attempts', () => {
            const store = useAuthStore.getState();
            expect(store.failedAttempts).toBe(0);
            store.incrementFailedAttempts();
            expect(useAuthStore.getState().failedAttempts).toBe(1);
            store.incrementFailedAttempts();
            expect(useAuthStore.getState().failedAttempts).toBe(2);
        });
        it('should trigger lockout after 5 failed attempts', () => {
            const store = useAuthStore.getState();
            for (let i = 0; i < 5; i++) {
                store.incrementFailedAttempts();
            }
            const state = useAuthStore.getState();
            expect(state.failedAttempts).toBe(5);
            expect(state.lockoutUntil).not.toBeNull();
        });
        it('should detect lockout correctly', () => {
            vi.useFakeTimers();
            const now = Date.now();
            vi.setSystemTime(now);
            useAuthStore.setState({
                lockoutUntil: now + 15 * 60 * 1000
            });
            expect(useAuthStore.getState().checkLockout()).toBe(true);
            vi.advanceTimersByTime(16 * 60 * 1000);
            expect(useAuthStore.getState().checkLockout()).toBe(false);
        });
        it('should reset failed attempts after lockout expires', () => {
            vi.useFakeTimers();
            const now = Date.now();
            vi.setSystemTime(now);
            useAuthStore.setState({
                failedAttempts: 5,
                lockoutUntil: now + 15 * 60 * 1000
            });
            vi.advanceTimersByTime(16 * 60 * 1000);
            useAuthStore.getState().checkLockout();
            const state = useAuthStore.getState();
            expect(state.failedAttempts).toBe(0);
            expect(state.lockoutUntil).toBeNull();
        });
        it('should reset failed attempts explicitly', () => {
            useAuthStore.setState({
                failedAttempts: 3,
                lockoutUntil: Date.now() + 1000
            });
            useAuthStore.getState().resetFailedAttempts();
            const state = useAuthStore.getState();
            expect(state.failedAttempts).toBe(0);
            expect(state.lockoutUntil).toBeNull();
        });
    });
    describe('logout', () => {
        it('should clear authentication state', async () => {
            useAuthStore.setState({
                currentUser: { id: 'user-1', fullName: 'Test User' },
                currentSession: { id: 'session-1' },
                isAuthenticated: true,
                sessionExpiresAt: Date.now() + 1000000,
                lastActivityAt: Date.now()
            });
            await useAuthStore.getState().logout();
            const state = useAuthStore.getState();
            expect(state.currentUser).toBeNull();
            expect(state.currentSession).toBeNull();
            expect(state.isAuthenticated).toBe(false);
            expect(state.sessionExpiresAt).toBeNull();
            expect(state.lastActivityAt).toBeNull();
        });
    });
    describe('setCurrentUser', () => {
        it('should set current user', () => {
            const user = { id: 'user-1', fullName: 'Test User' };
            useAuthStore.getState().setCurrentUser(user);
            expect(useAuthStore.getState().currentUser).toEqual(user);
        });
        it('should clear current user when set to null', () => {
            useAuthStore.setState({
                currentUser: { id: 'user-1' }
            });
            useAuthStore.getState().setCurrentUser(null);
            expect(useAuthStore.getState().currentUser).toBeNull();
        });
    });
    describe('session activity', () => {
        it('should update last activity time', () => {
            vi.useFakeTimers();
            const now = Date.now();
            vi.setSystemTime(now);
            useAuthStore.setState({
                sessionExpiresAt: now + 12 * 60 * 60 * 1000,
                lastActivityAt: now - 1000
            });
            useAuthStore.getState().updateActivity();
            expect(useAuthStore.getState().lastActivityAt).toBe(now);
        });
        it('should extend session if less than 1 hour remaining', () => {
            vi.useFakeTimers();
            const now = Date.now();
            vi.setSystemTime(now);
            const thirtyMinutesFromNow = now + 30 * 60 * 1000;
            useAuthStore.setState({
                sessionExpiresAt: thirtyMinutesFromNow,
                lastActivityAt: now - 1000
            });
            useAuthStore.getState().updateActivity();
            const state = useAuthStore.getState();
            expect(state.sessionExpiresAt).toBeGreaterThan(thirtyMinutesFromNow);
        });
    });
    describe('session expiry check', () => {
        it('should return false if not authenticated', () => {
            useAuthStore.setState({
                isAuthenticated: false,
                sessionExpiresAt: null
            });
            expect(useAuthStore.getState().checkSessionExpiry()).toBe(false);
        });
        it('should return false if session not expired', () => {
            vi.useFakeTimers();
            const now = Date.now();
            vi.setSystemTime(now);
            useAuthStore.setState({
                isAuthenticated: true,
                sessionExpiresAt: now + 1000000
            });
            expect(useAuthStore.getState().checkSessionExpiry()).toBe(false);
        });
        it('should return true and logout if session expired', async () => {
            vi.useFakeTimers();
            const now = Date.now();
            vi.setSystemTime(now);
            useAuthStore.setState({
                isAuthenticated: true,
                sessionExpiresAt: now - 1000,
                currentUser: { id: 'test' },
                currentSession: { id: 'session' }
            });
            const result = useAuthStore.getState().checkSessionExpiry();
            expect(result).toBe(true);
        });
    });
});
