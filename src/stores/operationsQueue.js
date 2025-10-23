import { create } from 'zustand';
import { persist } from 'zustand/middleware';
const generateId = () => {
    return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};
const getRetryDelay = (attempts) => {
    const baseDelay = 1000;
    const maxDelay = 30000;
    return Math.min(baseDelay * Math.pow(2, attempts), maxDelay);
};
const initialState = {
    operations: [],
    isProcessing: false,
    lastProcessedAt: 0,
    totalProcessed: 0,
    totalFailed: 0,
};
export const useOperationsQueue = create()(persist((set, get) => ({
    ...initialState,
    addOperation: (operation) => {
        const newOperation = {
            ...operation,
            id: generateId(),
            status: 'pending',
            attempts: 0,
            createdAt: Date.now(),
        };
        set((state) => ({
            operations: [...state.operations, newOperation],
        }));
    },
    removeOperation: (id) => {
        set((state) => ({
            operations: state.operations.filter((op) => op.id !== id),
        }));
    },
    updateOperation: (id, updates) => {
        set((state) => ({
            operations: state.operations.map((op) => op.id === id ? { ...op, ...updates } : op),
        }));
    },
    markAsProcessing: (id) => {
        set((state) => ({
            operations: state.operations.map((op) => op.id === id
                ? {
                    ...op,
                    status: 'processing',
                    lastAttemptAt: Date.now(),
                    attempts: op.attempts + 1,
                }
                : op),
        }));
    },
    markAsCompleted: (id) => {
        set((state) => ({
            operations: state.operations.map((op) => op.id === id ? { ...op, status: 'completed' } : op),
            lastProcessedAt: Date.now(),
            totalProcessed: state.totalProcessed + 1,
        }));
    },
    markAsFailed: (id, error) => {
        const operation = get().operations.find((op) => op.id === id);
        if (!operation)
            return;
        const shouldRetry = operation.attempts < operation.maxAttempts;
        const nextRetryAt = shouldRetry
            ? Date.now() + getRetryDelay(operation.attempts)
            : undefined;
        set((state) => ({
            operations: state.operations.map((op) => op.id === id
                ? {
                    ...op,
                    status: shouldRetry ? 'pending' : 'failed',
                    error,
                    nextRetryAt,
                }
                : op),
            totalFailed: shouldRetry ? state.totalFailed : state.totalFailed + 1,
        }));
    },
    retryOperation: (id) => {
        set((state) => ({
            operations: state.operations.map((op) => op.id === id
                ? {
                    ...op,
                    status: 'pending',
                    error: undefined,
                    nextRetryAt: undefined,
                }
                : op),
        }));
    },
    retryAllFailed: () => {
        set((state) => ({
            operations: state.operations.map((op) => op.status === 'failed'
                ? {
                    ...op,
                    status: 'pending',
                    attempts: 0,
                    error: undefined,
                    nextRetryAt: undefined,
                }
                : op),
        }));
    },
    clearCompleted: () => {
        set((state) => ({
            operations: state.operations.filter((op) => op.status !== 'completed'),
        }));
    },
    clearAll: () => {
        set({ operations: [], totalProcessed: 0, totalFailed: 0 });
    },
    getNextOperation: () => {
        const now = Date.now();
        const operations = get().operations;
        const pendingOps = operations.filter((op) => op.status === 'pending' &&
            (!op.nextRetryAt || op.nextRetryAt <= now));
        if (pendingOps.length === 0)
            return null;
        const priorityOrder = { high: 0, normal: 1, low: 2 };
        return pendingOps.sort((a, b) => {
            if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
                return priorityOrder[a.priority] - priorityOrder[b.priority];
            }
            return a.createdAt - b.createdAt;
        })[0];
    },
    getPendingCount: () => {
        return get().operations.filter((op) => op.status === 'pending' || op.status === 'processing').length;
    },
    getFailedCount: () => {
        return get().operations.filter((op) => op.status === 'failed').length;
    },
    setProcessing: (processing) => {
        set({ isProcessing: processing });
    },
}), {
    name: 'mbhr-operations-queue',
    partialize: (state) => ({
        operations: state.operations,
        totalProcessed: state.totalProcessed,
        totalFailed: state.totalFailed,
    }),
}));
export async function processQueue(processor) {
    const store = useOperationsQueue.getState();
    if (store.isProcessing) {
        return;
    }
    store.setProcessing(true);
    try {
        let operation = store.getNextOperation();
        while (operation) {
            store.markAsProcessing(operation.id);
            try {
                await processor(operation);
                store.markAsCompleted(operation.id);
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                store.markAsFailed(operation.id, errorMessage);
            }
            operation = store.getNextOperation();
        }
    }
    finally {
        store.setProcessing(false);
    }
}
