import { useEffect, useCallback, useRef } from "react";
import { realtimeSyncService, RealtimePayload } from "@/services/realtimeSync";

type SubscriptionType =
  | "vitals"
  | "consultations"
  | "appointments"
  | "messages"
  | "notifications"
  | "queue"
  | "submissions";

interface UseRealtimeOptions {
  patientId?: string;
  stage?: string;
  onInsert?: (data: Record<string, unknown>) => void;
  onUpdate?: (
    data: Record<string, unknown>,
    old: Record<string, unknown>,
  ) => void;
  onDelete?: (old: Record<string, unknown>) => void;
  onChange?: () => void;
  enabled?: boolean;
}

export function useRealtimeSubscription(
  type: SubscriptionType,
  options: UseRealtimeOptions = {},
): void {
  const {
    patientId,
    stage,
    onInsert,
    onUpdate,
    onDelete,
    onChange,
    enabled = true,
  } = options;

  const callbacksRef = useRef({ onInsert, onUpdate, onDelete, onChange });
  callbacksRef.current = { onInsert, onUpdate, onDelete, onChange };

  const handlePayload = useCallback((payload: RealtimePayload) => {
    const { onInsert, onUpdate, onDelete, onChange } = callbacksRef.current;

    switch (payload.eventType) {
      case "INSERT":
        onInsert?.(payload.new);
        break;
      case "UPDATE":
        onUpdate?.(payload.new, payload.old);
        break;
      case "DELETE":
        onDelete?.(payload.old);
        break;
    }

    onChange?.();
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let unsubscribe: (() => void) | undefined;

    switch (type) {
      case "vitals":
        unsubscribe = patientId
          ? realtimeSyncService.subscribeToVitals(patientId, handlePayload)
          : realtimeSyncService.subscribeToAllVitals(handlePayload);
        break;
      case "consultations":
        unsubscribe = patientId
          ? realtimeSyncService.subscribeToConsultations(
              patientId,
              handlePayload,
            )
          : realtimeSyncService.subscribeToAllConsultations(handlePayload);
        break;
      case "appointments":
        unsubscribe = patientId
          ? realtimeSyncService.subscribeToAppointments(
              patientId,
              handlePayload,
            )
          : realtimeSyncService.subscribeToAllAppointments(handlePayload);
        break;
      case "messages":
        if (patientId) {
          unsubscribe = realtimeSyncService.subscribeToMessages(
            patientId,
            handlePayload,
          );
        }
        break;
      case "notifications":
        if (patientId) {
          unsubscribe = realtimeSyncService.subscribeToNotifications(
            patientId,
            handlePayload,
          );
        }
        break;
      case "queue":
        unsubscribe = realtimeSyncService.subscribeToQueue(
          stage,
          handlePayload,
        );
        break;
      case "submissions":
        unsubscribe =
          realtimeSyncService.subscribeToPatientSubmissions(handlePayload);
        break;
    }

    return () => {
      unsubscribe?.();
    };
  }, [type, patientId, stage, enabled, handlePayload]);
}

export function useVitalsRealtime(
  patientId: string,
  onChange: () => void,
): void {
  useRealtimeSubscription("vitals", { patientId, onChange });
}

export function useConsultationsRealtime(
  patientId: string,
  onChange: () => void,
): void {
  useRealtimeSubscription("consultations", { patientId, onChange });
}

export function useAppointmentsRealtime(
  patientId: string,
  onChange: () => void,
): void {
  useRealtimeSubscription("appointments", { patientId, onChange });
}

export function useMessagesRealtime(
  patientId: string,
  onChange: () => void,
): void {
  useRealtimeSubscription("messages", { patientId, onChange });
}

export function useQueueRealtime(stage?: string, onChange?: () => void): void {
  useRealtimeSubscription("queue", { stage, onChange });
}
