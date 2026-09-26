import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const pingStaffAdmin = vi.fn();
const getStaffOverview = vi.fn();
const probeAuthHealth = vi.fn();

vi.mock("@/services/staffAccounts", () => ({
  pingStaffAdmin: () => pingStaffAdmin(),
  getStaffOverview: () => getStaffOverview(),
  probeAuthHealth: () => probeAuthHealth(),
}));

vi.mock("@/sync/adapter", () => ({ isOnlineSyncEnabled: () => true }));

import { useStaffAccounts } from "./useStaffAccounts";
import { STAFF_COPY } from "./staffAccountView";

const OVERVIEW = { checkedAt: "2026-09-25T00:00:00.000Z", accounts: [], roles: ["nurse"] };

function failure(kind: string, message = "Something went wrong.") {
  return { ok: false, failure: kind, code: null, message, body: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  pingStaffAdmin.mockResolvedValue({ ok: true, data: { version: "1" } });
  getStaffOverview.mockResolvedValue({ ok: true, data: OVERVIEW });
  probeAuthHealth.mockResolvedValue(false);
});

describe("useStaffAccounts", () => {
  it("pings, then loads the overview", async () => {
    const { result } = renderHook(() => useStaffAccounts(true));
    expect(result.current.state).toBe("checking");
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current.overview).toEqual(OVERVIEW);
    expect(pingStaffAdmin).toHaveBeenCalledTimes(1);
    expect(getStaffOverview).toHaveBeenCalledTimes(1);
  });

  it("asks nothing in device mode", async () => {
    const { result } = renderHook(() => useStaffAccounts(false));
    await waitFor(() => expect(result.current.state).toBe("device_mode"));
    expect(pingStaffAdmin).not.toHaveBeenCalled();
    expect(result.current.overview).toBeNull();
  });

  it("says not deployed when the server answers but the function does not", async () => {
    pingStaffAdmin.mockResolvedValue(failure("unreachable"));
    probeAuthHealth.mockResolvedValue(true);
    const { result } = renderHook(() => useStaffAccounts(true));
    await waitFor(() => expect(result.current.state).toBe("not_deployed"));
    expect(getStaffOverview).not.toHaveBeenCalled();
  });

  it("says unreachable when nothing answers", async () => {
    pingStaffAdmin.mockResolvedValue(failure("unreachable"));
    const { result } = renderHook(() => useStaffAccounts(true));
    await waitFor(() => expect(result.current.state).toBe("unreachable"));
    expect(probeAuthHealth).toHaveBeenCalledTimes(1);
  });

  it("passes on not signed in and not deployed from the server", async () => {
    getStaffOverview.mockResolvedValue(failure("not_signed_in"));
    const first = renderHook(() => useStaffAccounts(true));
    await waitFor(() => expect(first.result.current.state).toBe("not_signed_in"));

    pingStaffAdmin.mockResolvedValue(failure("not_deployed"));
    const second = renderHook(() => useStaffAccounts(true));
    await waitFor(() => expect(second.result.current.state).toBe("not_deployed"));
  });

  it("shows other failures as an error with the server's message", async () => {
    getStaffOverview.mockResolvedValue(
      failure(
        "server_error",
        "The staff account service had an error. Check the list before trying again.",
      ),
    );
    const { result } = renderHook(() => useStaffAccounts(true));
    await waitFor(() => expect(result.current.state).toBe("error"));
    expect(result.current.failureMessage).toBe(
      "The staff account service had an error. Check the list before trying again.",
    );
  });

  it("says the list was loaded too often, not that changes were made, when first loading is limited", async () => {
    getStaffOverview.mockResolvedValue({
      ...failure("rate_limited", "Too many staff account changes. Try again in 2 minutes."),
      retryAfterSeconds: 90,
    });
    const { result } = renderHook(() => useStaffAccounts(true));
    await waitFor(() => expect(result.current.state).toBe("error"));
    expect(result.current.failureMessage).toBe(
      "The staff list was loaded too many times in a short time. Wait 2 minutes, then press Try again.",
    );
  });

  it("keeps the list it has when a refresh is rate limited", async () => {
    const { result } = renderHook(() => useStaffAccounts(true));
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current.notice).toBeNull();

    getStaffOverview.mockResolvedValue(
      failure("rate_limited", "Too many staff account changes. Try again in 2 minutes."),
    );
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.state).toBe("ready");
    expect(result.current.overview).toEqual(OVERVIEW);
    expect(result.current.failureMessage).toBeNull();
    expect(result.current.notice).toBe(STAFF_COPY.staleList);

    getStaffOverview.mockResolvedValue({ ok: true, data: OVERVIEW });
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.state).toBe("ready");
    expect(result.current.notice).toBeNull();
  });

  it("clears the list when the sign-in is gone", async () => {
    const { result } = renderHook(() => useStaffAccounts(true));
    await waitFor(() => expect(result.current.state).toBe("ready"));

    getStaffOverview.mockResolvedValue(failure("not_signed_in"));
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.state).toBe("not_signed_in");
    expect(result.current.overview).toBeNull();
  });

  it("goes offline with the browser and reloads when it is back", async () => {
    const { result } = renderHook(() => useStaffAccounts(true));
    await waitFor(() => expect(result.current.state).toBe("ready"));

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current.state).toBe("offline");
    expect(result.current.overview).toEqual(OVERVIEW);

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(getStaffOverview).toHaveBeenCalledTimes(2);
  });
});
