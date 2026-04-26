import { supabase } from "@/lib/supabase";
import { RealtimeChannel } from "@supabase/supabase-js";
import * as logger from "@/lib/logger";

type RealtimeEvent = "INSERT" | "UPDATE" | "DELETE" | "*";

interface SubscriptionConfig {
  table: string;
  event?: RealtimeEvent;
  filter?: string;
  callback: (payload: RealtimePayload) => void;
}

interface RealtimePayload {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: Record<string, unknown>;
  old: Record<string, unknown>;
  table: string;
}

type SubscriptionCallback = (payload: RealtimePayload) => void;

class RealtimeSyncService {
  private channels: Map<string, RealtimeChannel> = new Map();
  private channelReconnectAttempts: Map<string, number> = new Map();
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000;
  private isConnected: boolean = false;
  private listeners: Map<string, Set<SubscriptionCallback>> = new Map();

  async connect(): Promise<boolean> {
    if (!supabase) {
      logger.warn("Supabase not initialized, skipping realtime connection");
      return false;
    }

    try {
      this.isConnected = true;
      this.channelReconnectAttempts.clear();
      logger.log("Realtime sync service connected");
      return true;
    } catch (error) {
      logger.error("Failed to connect realtime sync:", error);
      return false;
    }
  }

  subscribe(config: SubscriptionConfig): () => void {
    if (!supabase) {
      logger.warn("Supabase not initialized, cannot subscribe");
      return () => {};
    }

    const client = supabase;
    const channelKey = `${config.table}:${config.filter || "all"}`;

    if (!this.listeners.has(channelKey)) {
      this.listeners.set(channelKey, new Set());
    }
    this.listeners.get(channelKey)!.add(config.callback);

    if (!this.channels.has(channelKey)) {
      const handlePayload = (payload: unknown) => {
        const p = payload as {
          eventType: string;
          new: Record<string, unknown>;
          old: Record<string, unknown>;
        };
        const realtimePayload: RealtimePayload = {
          eventType: p.eventType as "INSERT" | "UPDATE" | "DELETE",
          new: p.new || {},
          old: p.old || {},
          table: config.table,
        };

        const listeners = this.listeners.get(channelKey);
        if (listeners) {
          listeners.forEach((cb) => cb(realtimePayload));
        }
      };

      const pgConfig = config.filter
        ? {
            event: config.event || "*",
            schema: "public",
            table: config.table,
            filter: config.filter,
          }
        : { event: config.event || "*", schema: "public", table: config.table };

      const channel = client
        .channel(channelKey)
        .on("postgres_changes", pgConfig, handlePayload)
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            logger.log(`Subscribed to ${channelKey}`);
            this.channelReconnectAttempts.delete(channelKey);
          } else if (status === "CHANNEL_ERROR") {
            logger.error(`Channel error for ${channelKey}`);
            this.handleReconnect(channelKey, config);
          }
        });

      this.channels.set(channelKey, channel);
    }

    return () => {
      const listeners = this.listeners.get(channelKey);
      if (listeners) {
        listeners.delete(config.callback);
        if (listeners.size === 0) {
          this.unsubscribe(channelKey);
        }
      }
    };
  }

  private unsubscribe(channelKey: string): void {
    const channel = this.channels.get(channelKey);
    if (channel && supabase) {
      supabase.removeChannel(channel);
      this.channels.delete(channelKey);
      this.listeners.delete(channelKey);
      logger.log(`Unsubscribed from ${channelKey}`);
    }
  }

  private async handleReconnect(
    channelKey: string,
    config: SubscriptionConfig,
  ): Promise<void> {
    const attempts = this.channelReconnectAttempts.get(channelKey) || 0;
    if (attempts >= this.maxReconnectAttempts) {
      logger.error(`Max reconnect attempts reached for ${channelKey}`);
      this.channelReconnectAttempts.delete(channelKey);
      return;
    }

    this.channelReconnectAttempts.set(channelKey, attempts + 1);
    const delay = this.reconnectDelay * Math.pow(2, attempts);

    logger.log(
      `Reconnecting to ${channelKey} in ${delay}ms (attempt ${attempts + 1})`,
    );

    await new Promise((resolve) => setTimeout(resolve, delay));

    // Save listeners before unsubscribing (unsubscribe deletes the listeners map entry)
    const savedListeners = new Set(this.listeners.get(channelKey) || []);
    this.unsubscribe(channelKey);
    savedListeners.forEach((callback) => {
      this.subscribe({ ...config, callback });
    });
  }

  subscribeToVitals(
    patientId: string,
    callback: SubscriptionCallback,
  ): () => void {
    return this.subscribe({
      table: "vitals",
      filter: `patient_id=eq.${patientId}`,
      callback,
    });
  }

  subscribeToAllVitals(callback: SubscriptionCallback): () => void {
    return this.subscribe({
      table: "vitals",
      callback,
    });
  }

  subscribeToConsultations(
    patientId: string,
    callback: SubscriptionCallback,
  ): () => void {
    return this.subscribe({
      table: "consultations",
      filter: `patient_id=eq.${patientId}`,
      callback,
    });
  }

  subscribeToAllConsultations(callback: SubscriptionCallback): () => void {
    return this.subscribe({
      table: "consultations",
      callback,
    });
  }

  subscribeToAppointments(
    patientId: string,
    callback: SubscriptionCallback,
  ): () => void {
    return this.subscribe({
      table: "appointments",
      filter: `patient_id=eq.${patientId}`,
      callback,
    });
  }

  subscribeToAllAppointments(callback: SubscriptionCallback): () => void {
    return this.subscribe({
      table: "appointments",
      callback,
    });
  }

  subscribeToMessages(
    patientId: string,
    callback: SubscriptionCallback,
  ): () => void {
    return this.subscribe({
      table: "patient_secure_messages",
      filter: `patient_id=eq.${patientId}`,
      callback,
    });
  }

  subscribeToNotifications(
    _patientId: string,
    _callback: SubscriptionCallback,
  ): () => void {
    // patient_notifications table does not exist in this schema; no-op.
    return () => {};
  }

  subscribeToQueue(
    stage?: string,
    callback?: SubscriptionCallback,
  ): () => void {
    const config: SubscriptionConfig = {
      table: "queue",
      callback: callback || (() => {}),
    };
    if (stage) {
      config.filter = `stage=eq.${stage}`;
    }
    return this.subscribe(config);
  }

  subscribeToPatientSubmissions(callback: SubscriptionCallback): () => void {
    return this.subscribe({
      table: "patient_submitted_data",
      callback,
    });
  }

  disconnect(): void {
    this.channels.forEach((channel, key) => {
      if (supabase) {
        supabase.removeChannel(channel);
      }
      logger.log(`Disconnected from ${key}`);
    });
    this.channels.clear();
    this.listeners.clear();
    this.isConnected = false;
    logger.log("Realtime sync service disconnected");
  }

  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  getActiveSubscriptions(): string[] {
    return Array.from(this.channels.keys());
  }
}

export const realtimeSyncService = new RealtimeSyncService();

export type { RealtimePayload, SubscriptionCallback };
