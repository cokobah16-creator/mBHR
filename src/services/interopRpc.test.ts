import { describe, it, expect } from "vitest";
import {
  callInteropRpc,
  classifyRpcError,
  rpcErrorLabel,
  toCount,
  toTimestamp,
  type InteropRpcClient,
} from "./interopRpc";

describe("classifyRpcError", () => {
  it("treats a function that is not deployed as missing", () => {
    expect(classifyRpcError({ code: "PGRST202", message: "Could not find the function" })).toBe(
      "missing",
    );
    expect(classifyRpcError({ code: "42883", message: "function does not exist" })).toBe("missing");
    expect(classifyRpcError({ message: "Not Found" }, 404)).toBe("missing");
    expect(classifyRpcError({ status: 404 })).toBe("missing");
  });

  it("sorts refusals, expired sign-ins and network failures", () => {
    expect(classifyRpcError({ code: "42501" })).toBe("denied");
    expect(classifyRpcError({}, 403)).toBe("denied");
    expect(classifyRpcError({ code: "PGRST301" })).toBe("signed_out");
    expect(classifyRpcError(new TypeError("Failed to fetch"))).toBe("offline");
    expect(classifyRpcError({ message: "TypeError: Failed to fetch" })).toBe("offline");
    expect(classifyRpcError({ code: "22023" })).toBe("failed");
    expect(classifyRpcError(null)).toBe("failed");
  });
});

describe("rpcErrorLabel", () => {
  it("never returns a message", () => {
    expect(rpcErrorLabel({ code: "42501", message: "patient 123 is not yours" })).toBe("42501");
    expect(rpcErrorLabel(new RangeError("secret detail"))).toBe("RangeError");
    expect(rpcErrorLabel("text")).toBe("unknown");
  });
});

describe("callInteropRpc", () => {
  const client = (result: { data: unknown; error: unknown } | Error): InteropRpcClient => ({
    rpc: () =>
      result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
  });

  it("does not call when offline or without a client", async () => {
    let called = false;
    const spy: InteropRpcClient = {
      rpc: () => {
        called = true;
        return Promise.resolve({ data: null, error: null });
      },
    };
    expect(await callInteropRpc(spy, "f", undefined, false)).toEqual({
      ok: false,
      reason: "offline",
      code: "offline",
    });
    expect(called).toBe(false);
    expect((await callInteropRpc(null, "f", undefined, true)).ok).toBe(false);
  });

  it("returns data, sorted errors, and never throws", async () => {
    expect(await callInteropRpc(client({ data: [1], error: null }), "f", undefined, true)).toEqual({
      ok: true,
      data: [1],
    });
    expect(
      await callInteropRpc(client({ data: null, error: { code: "PGRST202" } }), "f", undefined, true),
    ).toEqual({ ok: false, reason: "missing", code: "PGRST202" });
    expect(
      await callInteropRpc(client(new TypeError("Failed to fetch")), "f", undefined, true),
    ).toEqual({ ok: false, reason: "offline", code: "TypeError" });
  });
});

describe("toCount / toTimestamp", () => {
  it("keeps only whole non-negative numbers", () => {
    expect(toCount(3)).toBe(3);
    expect(toCount("7")).toBe(7);
    expect(toCount(2.9)).toBe(2);
    expect(toCount(-1)).toBeNull();
    expect(toCount(null)).toBeNull();
    expect(toCount("abc")).toBeNull();
  });

  it("keeps only parseable timestamps", () => {
    expect(toTimestamp("2026-09-01T10:00:00Z")).toBe("2026-09-01T10:00:00Z");
    expect(toTimestamp("yesterday")).toBeNull();
    expect(toTimestamp(5)).toBeNull();
  });
});
