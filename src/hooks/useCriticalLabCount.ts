import { useEffect, useState } from "react";
import { isSupabaseEnabled } from "@/lib/supabaseClient";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { getCriticalResults } from "@/services/labs";

/** How often the app shell re-reads unreviewed critical lab results. */
export const CRITICAL_LAB_POLL_MS = 60_000;

/**
 * Number of critical lab results not yet reviewed, read when the app shell
 * opens, every minute while online, and whenever the tab becomes visible,
 * so staff see a new critical result without opening or refreshing /labs.
 * null until the first successful read, and while offline, not set up or
 * not enabled. A failed re-read keeps the last known count: a passing
 * network error must not hide a critical result.
 */
export function useCriticalLabCount(enabled: boolean): number | null {
  const online = useOnlineStatus();
  const active = enabled && isSupabaseEnabled && online;
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!active) {
      setCount(null);
      return;
    }
    let live = true;
    const check = () => {
      getCriticalResults()
        .then((rows) => {
          if (live) setCount(rows.length);
        })
        .catch((error: unknown) => {
          console.warn(
            "[labs] Critical result check failed:",
            error instanceof Error ? error.name : "unknown",
          );
        });
    };
    check();
    const timer = window.setInterval(check, CRITICAL_LAB_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active]);

  return count;
}
