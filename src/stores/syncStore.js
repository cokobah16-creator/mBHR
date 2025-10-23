import { create } from 'zustand';
import { persist } from 'zustand/middleware';
const initialState = {
    status: 'idle',
    pendingCount: 0,
    lastSuccessAt: 0,
    lastErrorAt: 0,
    retries: 0,
    errorMessage: null,
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
};
export const useSyncStore = create()(persist((set) => ({
    ...initialState,
    setStatus: (status) => set({ status }),
    setPendingCount: (count) => set({ pendingCount: count }),
    setLastSuccessAt: (timestamp) => set({
        lastSuccessAt: timestamp,
        status: 'ok',
        retries: 0,
        errorMessage: null,
    }),
    setLastErrorAt: (timestamp, message) => set({
        lastErrorAt: timestamp,
        status: 'error',
        errorMessage: message,
    }),
    incrementRetries: () => set((state) => ({ retries: state.retries + 1 })),
    resetRetries: () => set({ retries: 0 }),
    setOnline: (online) => set({ isOnline: online }),
    reset: () => set(initialState),
}), {
    name: 'mbhr-sync-store',
    partialize: (state) => ({
        lastSuccessAt: state.lastSuccessAt,
        lastErrorAt: state.lastErrorAt,
        pendingCount: state.pendingCount,
    }),
}));
// Initialize online/offline listeners
if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
        useSyncStore.getState().setOnline(true);
        useSyncStore.getState().setStatus('idle');
    });
    window.addEventListener('offline', () => {
        useSyncStore.getState().setOnline(false);
        useSyncStore.getState().setStatus('idle');
    });
}
// Helper to get retry delay with exponential backoff
export function getRetryDelay(retries) {
    const baseDelay = 1000; // 1 second
    const maxDelay = 8000; // 8 seconds
    const delay = Math.min(baseDelay * Math.pow(2, retries), maxDelay);
    return delay;
}
