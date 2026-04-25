import { create } from "zustand";
import { persist } from "zustand/middleware";

export type OperationType = "create" | "update" | "delete";
export type OperationEntity =
  | "patient"
  | "visit"
  | "vital"
  | "consultation"
  | "dispense"
  | "inventory";
export type OperationStatus = "pending" | "processing" | "completed" | "failed";
export type OperationPriority = "high" | "normal" | "low";

export interface PendingOperation {
  id: string;
  type: OperationType;
  entity: OperationEntity;
  entityId: string;
  data: Record<string, unknown>;
  priority: OperationPriority;
  status: OperationStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  lastAttemptAt?: number;
  nextRetryAt?: number;
  error?: string;
  userId?: string;
}

interface OperationsQueueState {
  operations: PendingOperation[];
  isProcessing: boolean;
  lastProcessedAt: number;
  totalProcessed: number;
  totalFailed: number;
}

interface OperationsQueueActions {
  addOperation: (
    operation: Omit<
      PendingOperation,
      "id" | "status" | "attempts" | "createdAt"
    >,
  ) => void;
  removeOperation: (id: string) => void;
  updateOperation: (id: string, updates: Partial<PendingOperation>) => void;
  markAsProcessing: (id: string) => void;
  markAsCompleted: (id: string) => void;
  markAsFailed: (id: string, error: string) => void;
  retryOperation: (id: string) => void;
  retryAllFailed: () => void;
  clearCompleted: () => void;
  clearAll: () => void;
  getNextOperation: () => PendingOperation | null;
  getPendingCount: () => number;
  getFailedCount: () => number;
  setProcessing: (processing: boolean) => void;
}

const generateId = () => crypto.randomUUID();

const MAX_COMPLETED_OPS = 100;

const getRetryDelay = (attempts: number): number => {
  const baseDelay = 1000;
  const maxDelay = 30000;
  return Math.min(baseDelay * Math.pow(2, attempts), maxDelay);
};

const initialState: OperationsQueueState = {
  operations: [],
  isProcessing: false,
  lastProcessedAt: 0,
  totalProcessed: 0,
  totalFailed: 0,
};

export const useOperationsQueue = create<
  OperationsQueueState & OperationsQueueActions
>()(
  persist(
    (set, get) => ({
      ...initialState,

      addOperation: (operation) => {
        const newOperation: PendingOperation = {
          ...operation,
          id: generateId(),
          status: "pending",
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
          operations: state.operations.map((op) =>
            op.id === id ? { ...op, ...updates } : op,
          ),
        }));
      },

      markAsProcessing: (id) => {
        set((state) => ({
          operations: state.operations.map((op) =>
            op.id === id
              ? {
                  ...op,
                  status: "processing" as OperationStatus,
                  lastAttemptAt: Date.now(),
                  attempts: op.attempts + 1,
                }
              : op,
          ),
        }));
      },

      markAsCompleted: (id) => {
        set((state) => {
          const updated = state.operations.map((op) =>
            op.id === id
              ? { ...op, status: "completed" as OperationStatus }
              : op,
          );
          // Auto-purge oldest completed ops to prevent localStorage quota exhaustion
          const completed = updated.filter((op) => op.status === "completed");
          const trimmed =
            completed.length > MAX_COMPLETED_OPS
              ? updated.filter(
                  (op) =>
                    op.status !== "completed" ||
                    completed.indexOf(op) >=
                      completed.length - MAX_COMPLETED_OPS,
                )
              : updated;
          return {
            operations: trimmed,
            lastProcessedAt: Date.now(),
            totalProcessed: state.totalProcessed + 1,
          };
        });
      },

      markAsFailed: (id, error) => {
        const operation = get().operations.find((op) => op.id === id);

        if (!operation) return;

        const shouldRetry = operation.attempts < operation.maxAttempts;
        const nextRetryAt = shouldRetry
          ? Date.now() + getRetryDelay(operation.attempts)
          : undefined;

        set((state) => ({
          operations: state.operations.map((op) =>
            op.id === id
              ? {
                  ...op,
                  status: shouldRetry
                    ? ("pending" as OperationStatus)
                    : ("failed" as OperationStatus),
                  error,
                  nextRetryAt,
                }
              : op,
          ),
          totalFailed: shouldRetry ? state.totalFailed : state.totalFailed + 1,
        }));
      },

      retryOperation: (id) => {
        set((state) => ({
          operations: state.operations.map((op) =>
            op.id === id
              ? {
                  ...op,
                  status: "pending" as OperationStatus,
                  error: undefined,
                  nextRetryAt: undefined,
                }
              : op,
          ),
        }));
      },

      retryAllFailed: () => {
        set((state) => ({
          operations: state.operations.map((op) =>
            op.status === "failed"
              ? {
                  ...op,
                  status: "pending" as OperationStatus,
                  attempts: 0,
                  error: undefined,
                  nextRetryAt: undefined,
                }
              : op,
          ),
        }));
      },

      clearCompleted: () => {
        set((state) => ({
          operations: state.operations.filter(
            (op) => op.status !== "completed",
          ),
        }));
      },

      clearAll: () => {
        set({ operations: [], totalProcessed: 0, totalFailed: 0 });
      },

      getNextOperation: () => {
        const now = Date.now();
        const operations = get().operations;

        const pendingOps = operations.filter(
          (op) =>
            op.status === "pending" &&
            (!op.nextRetryAt || op.nextRetryAt <= now),
        );

        if (pendingOps.length === 0) return null;

        const priorityOrder = { high: 0, normal: 1, low: 2 };

        return pendingOps.sort((a, b) => {
          if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
            return priorityOrder[a.priority] - priorityOrder[b.priority];
          }
          return a.createdAt - b.createdAt;
        })[0];
      },

      getPendingCount: () => {
        return get().operations.filter(
          (op) => op.status === "pending" || op.status === "processing",
        ).length;
      },

      getFailedCount: () => {
        return get().operations.filter((op) => op.status === "failed").length;
      },

      setProcessing: (processing) => {
        set({ isProcessing: processing });
      },
    }),
    {
      name: "mbhr-operations-queue",
      partialize: (state) => ({
        operations: state.operations,
        totalProcessed: state.totalProcessed,
        totalFailed: state.totalFailed,
      }),
    },
  ),
);

export async function processQueue(
  processor: (operation: PendingOperation) => Promise<void>,
): Promise<void> {
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
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        store.markAsFailed(operation.id, errorMessage);
      }

      operation = store.getNextOperation();
    }
  } finally {
    store.setProcessing(false);
  }
}
