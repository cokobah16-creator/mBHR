import { useEffect, useState } from "react";
import { isSupabaseEnabled } from "@/lib/supabaseClient";
import { describeServerStatus, type ServerStatus } from "./serverStatus";

/**
 * Tracks whether the server can be reached from this device, updating when
 * the browser goes on- or offline. `navigator.onLine` only says a network is
 * present, so callers must still handle request failures.
 */
export function useServerStatus(): ServerStatus {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return describeServerStatus(isSupabaseEnabled, online);
}
