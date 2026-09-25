import { useEffect, useRef } from "react";
import { IDLE_CHECK_MS } from "@/auth/idle";

/** Input that counts as someone using the screen. */
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart", "wheel"] as const;

/**
 * Calls onIdle once after `ms` without a touch, click or key press, while
 * `enabled` (the clock starts again when it turns on). Checked on a timer
 * and whenever the page becomes visible again, since timers stop while a
 * tablet sleeps.
 */
export function useIdleTimeout(ms: number, onIdle: () => void, enabled = true): void {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!enabled) return;
    let lastActivity = Date.now();
    let fired = false;
    const touch = () => {
      lastActivity = Date.now();
    };
    const check = () => {
      if (fired || Date.now() - lastActivity < ms) return;
      fired = true;
      onIdleRef.current();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, touch, { passive: true });
    }
    const timer = window.setInterval(check, Math.min(IDLE_CHECK_MS, ms));
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, touch);
      }
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ms, enabled]);
}
