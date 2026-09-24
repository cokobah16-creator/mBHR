import { useCallback, useEffect, useState } from "react";

/**
 * One-second countdown for a game round. Ticks only while `running` is true
 * and stops at 0; the caller decides what happens when time runs out.
 */
export function useCountdown(initialSeconds: number, running: boolean) {
  const [secondsLeft, setSecondsLeft] = useState(initialSeconds);

  useEffect(() => {
    if (!running || secondsLeft <= 0) return;
    const timer = setTimeout(
      () => setSecondsLeft((s) => Math.max(0, s - 1)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [running, secondsLeft]);

  const reset = useCallback((seconds: number) => setSecondsLeft(seconds), []);

  return { secondsLeft, reset };
}
