import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db";
import { outboxDb } from "@/db/outbox";
import {
  fromDeviceMessage,
  type OutboxItem,
} from "@/features/notifications/smsOutbox";

/**
 * Tracks navigator.onLine. It reflects the device's network interface, not
 * whether the server is reachable, so callers still handle request errors.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine !== false,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}

/** Current time, refreshed on an interval so "due" and "stuck" stay current. */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Every SMS stored on this device (dispense outbox and send queue), live.
 * `items` is undefined while loading. Pass `enabled: false` to skip reading.
 */
export function useDeviceOutbox(
  options: { patientId?: string; enabled?: boolean } = {},
): OutboxItem[] | undefined {
  const { patientId, enabled = true } = options;

  const outbox = useLiveQuery(async () => {
    if (!enabled) return [];
    return patientId
      ? outboxDb.outboundMessages.where("patientId").equals(patientId).toArray()
      : outboxDb.outboundMessages.toArray();
  }, [patientId, enabled]);

  const queue = useLiveQuery(async () => {
    if (!enabled) return [];
    return patientId
      ? db.outboundMessages.where("patientId").equals(patientId).toArray()
      : db.outboundMessages.toArray();
  }, [patientId, enabled]);

  return useMemo(() => {
    if (outbox === undefined || queue === undefined) return undefined;
    return [
      ...outbox
        .filter((m) => m.channel === "sms")
        .map((m) => fromDeviceMessage(m, "outbox")),
      ...queue
        .filter((m) => m.channel === "sms")
        .map((m) => fromDeviceMessage(m, "queue")),
    ];
  }, [outbox, queue]);
}
