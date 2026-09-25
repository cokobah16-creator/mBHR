import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useIdleTimeout } from "./useIdleTimeout";

const MINUTE = 60_000;

describe("useIdleTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires once after the time without any input, and input restarts the clock", () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimeout(MINUTE, onIdle));

    act(() => {
      vi.advanceTimersByTime(45_000);
      window.dispatchEvent(new KeyboardEvent("keydown"));
      vi.advanceTimersByTime(45_000);
    });
    expect(onIdle).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(onIdle).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(5 * MINUTE);
    });
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("never fires while turned off", () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimeout(MINUTE, onIdle, false));

    act(() => {
      vi.advanceTimersByTime(10 * MINUTE);
    });
    expect(onIdle).not.toHaveBeenCalled();
  });
});
