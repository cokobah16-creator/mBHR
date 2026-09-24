import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { isRealtimeAvailable } from "@/lib/realtimeAvailable";
import type { LiveStatus } from "./messagingModel";

export interface LiveSource {
  table: string;
  /** Supabase realtime filter, e.g. "recipient_id=eq.abc". */
  filter?: string;
}

// Each subscription gets its own channel name: removeChannel is async, and
// reusing a name while the previous channel is closing can hand back the
// old, already-subscribed channel.
let channelSeq = 0;

/**
 * Subscribes to Supabase realtime changes on the given tables and calls
 * `onChange` when any row changes. Returns "live" only once the channel
 * reports SUBSCRIBED; otherwise "off" (realtime unavailable on this device,
 * blocked, failed or disabled) or "connecting". Callers keep polling as a
 * backstop because a subscribed channel does not guarantee every table is
 * published for realtime.
 */
export function useLiveMessageUpdates(
  channelName: string,
  sources: LiveSource[],
  enabled: boolean,
  onChange: () => void,
): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>("off");
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // A stable key so a new array each render does not resubscribe.
  const sourcesKey = sources
    .map((s) => `${s.table}|${s.filter ?? ""}`)
    .join(";");

  useEffect(() => {
    const client = supabase;
    if (!enabled || !client || !sourcesKey || !isRealtimeAvailable()) {
      setStatus("off");
      return;
    }

    setStatus("connecting");
    let cancelled = false;
    let channel: ReturnType<typeof client.channel> | null = null;
    const notify = () => {
      if (!cancelled) onChangeRef.current();
    };

    try {
      channelSeq += 1;
      let ch = client.channel(`${channelName}-${channelSeq}`);
      for (const part of sourcesKey.split(";")) {
        const [table, filter] = part.split("|");
        ch = filter
          ? ch.on(
              "postgres_changes",
              { event: "*", schema: "public", table, filter },
              notify,
            )
          : ch.on(
              "postgres_changes",
              { event: "*", schema: "public", table },
              notify,
            );
      }
      channel = ch.subscribe((state: string) => {
        if (cancelled) return;
        if (state === "SUBSCRIBED") setStatus("live");
        else if (
          state === "CHANNEL_ERROR" ||
          state === "TIMED_OUT" ||
          state === "CLOSED"
        ) {
          setStatus("off");
        }
      });
    } catch (err) {
      // Safari Private Browsing and locked-down WebViews can throw here.
      console.warn(
        "[messaging] Live updates unavailable:",
        err instanceof Error ? err.name : "unknown",
      );
      setStatus("off");
    }

    return () => {
      cancelled = true;
      if (channel) {
        try {
          void client.removeChannel(channel);
        } catch {
          // The socket may already be gone; nothing else to clean up.
        }
      }
    };
  }, [channelName, sourcesKey, enabled]);

  return status;
}
