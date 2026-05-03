/**
 * Synchronously probe whether `new WebSocket(...)` is usable in this context.
 *
 * Safari Private Browsing throws `SecurityError: The operation is insecure.`
 * from the WebSocket constructor itself. Some corporate proxies and locked-down
 * WebViews raise similar synchronous errors. When that happens, every Supabase
 * realtime channel.subscribe() call eventually surfaces an unhandled error
 * (sometimes async, via the Phoenix socket timer) and brings down the React
 * tree. Probing once at module load lets every call site short-circuit cleanly.
 */
let cached: boolean | null = null;

export function isRealtimeAvailable(): boolean {
  if (cached !== null) return cached;
  if (typeof WebSocket === "undefined") {
    cached = false;
    return false;
  }
  try {
    // `.invalid` TLD is reserved (RFC2606) and never resolves. Safari Private
    // Browsing throws synchronously here; healthy environments construct fine
    // and we close immediately before the DNS lookup completes.
    const ws = new WebSocket("wss://mbhr-realtime-probe.invalid/");
    try {
      ws.close();
    } catch {
      /* noop */
    }
    cached = true;
  } catch {
    cached = false;
  }
  return cached;
}
