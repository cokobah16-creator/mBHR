import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

const getCriticalResults = vi.fn();

vi.mock("@/lib/supabaseClient", () => ({ isSupabaseEnabled: true }));
vi.mock("@/services/labs", () => ({
  getCriticalResults: () => getCriticalResults(),
}));

import { CRITICAL_LAB_POLL_MS, useCriticalLabCount } from "./useCriticalLabCount";

const critical = (id: string) => ({ id, patientId: "p1", testName: "Haemoglobin" });

describe("useCriticalLabCount", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getCriticalResults.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows a new critical result without a manual refresh", async () => {
    getCriticalResults.mockResolvedValueOnce([]).mockResolvedValue([critical("r1")]);
    const { result } = renderHook(() => useCriticalLabCount(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CRITICAL_LAB_POLL_MS);
    });
    expect(result.current).toBe(1);
  });

  it("keeps the last count when a re-read fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    getCriticalResults
      .mockResolvedValueOnce([critical("r1")])
      .mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useCriticalLabCount(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CRITICAL_LAB_POLL_MS);
    });
    expect(result.current).toBe(1);
  });

  it("does not read when not enabled", () => {
    const { result } = renderHook(() => useCriticalLabCount(false));
    expect(result.current).toBeNull();
    expect(getCriticalResults).not.toHaveBeenCalled();
  });
});
