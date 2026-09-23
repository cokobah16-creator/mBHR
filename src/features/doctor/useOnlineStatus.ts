import { useEffect, useState } from "react";

/**
 * Tracks navigator.onLine and re-renders when the browser reports the
 * connection going up or down. It reflects the device's network interface,
 * not whether the online service is reachable, so callers still handle
 * request failures.
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

/** Current connection state without subscribing (for use inside handlers). */
export function isDeviceOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}
