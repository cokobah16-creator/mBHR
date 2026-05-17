import { describe, expect, it, vi } from "vitest";
import type { PostgrestError } from "@supabase/supabase-js";
import { runQuery, ServiceError } from "./supabaseQuery";

vi.mock("@/lib/logger", () => ({
  captureError: vi.fn(),
}));

function pgError(code: string, message: string): PostgrestError {
  return {
    code,
    message,
    details: "",
    hint: "",
    name: "PostgrestError",
  } as unknown as PostgrestError;
}

describe("runQuery", () => {
  it("returns data on success", async () => {
    const r = await runQuery(
      async () => ({ data: { id: "p1" }, error: null }),
      { label: "test.success" },
    );
    expect(r.data).toEqual({ id: "p1" });
    expect(r.error).toBeNull();
  });

  it("classifies PGRST301 as session_expired", async () => {
    const r = await runQuery(
      async () => ({ data: null, error: pgError("PGRST301", "JWT expired") }),
      { label: "test.jwt", silent: true },
    );
    expect(r.error).toBeInstanceOf(ServiceError);
    expect(r.error?.kind).toBe("session_expired");
    expect(r.error?.label).toBe("test.jwt");
  });

  it("classifies 42501 as rls_denied", async () => {
    const r = await runQuery(
      async () => ({
        data: null,
        error: pgError("42501", "permission denied for table patients"),
      }),
      { label: "test.rls", silent: true },
    );
    expect(r.error?.kind).toBe("rls_denied");
  });

  it("classifies PGRST116 as not_found", async () => {
    const r = await runQuery(
      async () => ({ data: null, error: pgError("PGRST116", "no rows") }),
      { label: "test.notfound", silent: true },
    );
    expect(r.error?.kind).toBe("not_found");
  });

  it("required:true converts null data to not_found", async () => {
    const r = await runQuery(async () => ({ data: null, error: null }), {
      label: "test.required",
      required: true,
      silent: true,
    });
    expect(r.error?.kind).toBe("not_found");
  });

  it("treats a TypeError 'fetch failed' as network", async () => {
    const r = await runQuery(
      async () => {
        throw new TypeError("Failed to fetch");
      },
      { label: "test.net", silent: true },
    );
    expect(r.error?.kind).toBe("network");
  });

  it("falls back to unknown for unexpected errors", async () => {
    const r = await runQuery(
      async () => {
        throw new Error("kaboom");
      },
      { label: "test.unknown", silent: true },
    );
    expect(r.error?.kind).toBe("unknown");
    expect(r.error?.message).toBe("kaboom");
  });
});
