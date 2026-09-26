import { describe, it, expect } from "vitest";
import {
  edgeFunctionErrorBody,
  edgeFunctionJsonBody,
  edgeFunctionStatus,
  staffAuthRefusal,
} from "./edgeFunctionErrors";

/** The shape supabase.functions.invoke returns for a non-2xx reply. */
function httpError(status: number, body?: unknown) {
  return {
    name: "FunctionsHttpError",
    message: "Edge Function returned a non-2xx status code",
    context: new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  };
}

describe("edgeFunctionStatus", () => {
  it("reads the status of the Response in context", () => {
    expect(edgeFunctionStatus(httpError(401))).toBe(401);
    expect(edgeFunctionStatus(httpError(503))).toBe(503);
  });

  it("falls back to a status on the error itself", () => {
    expect(edgeFunctionStatus({ name: "FunctionsHttpError", status: 403 })).toBe(
      403,
    );
  });

  it("returns null when the request never got an answer", () => {
    expect(edgeFunctionStatus({ name: "FunctionsFetchError", context: {} })).toBeNull();
    expect(edgeFunctionStatus(new TypeError("Failed to fetch"))).toBeNull();
    expect(edgeFunctionStatus(null)).toBeNull();
    expect(edgeFunctionStatus("boom")).toBeNull();
  });
});

describe("staffAuthRefusal", () => {
  it("maps 401 to not signed in and 403 to not permitted", () => {
    expect(staffAuthRefusal(httpError(401))).toBe("not_signed_in");
    expect(staffAuthRefusal(httpError(403))).toBe("not_permitted");
  });

  it("ignores other failures", () => {
    expect(staffAuthRefusal(httpError(400))).toBeNull();
    expect(staffAuthRefusal(httpError(500))).toBeNull();
    expect(staffAuthRefusal({ message: "fn error" })).toBeNull();
  });
});

describe("edgeFunctionErrorBody", () => {
  it("returns the code and message the function sent", async () => {
    const body = await edgeFunctionErrorBody(
      httpError(400, {
        success: false,
        error: "invalid_otp",
        message: "A 4 to 8 digit code is required.",
      }),
    );
    expect(body).toEqual({
      error: "invalid_otp",
      message: "A 4 to 8 digit code is required.",
    });
  });

  it("returns null for a body that is not JSON or was already read", async () => {
    const notJson = {
      context: new Response("Internal Server Error", { status: 500 }),
    };
    expect(await edgeFunctionErrorBody(notJson)).toBeNull();

    const used = httpError(400, { error: "x" });
    await used.context.text();
    expect(await edgeFunctionErrorBody(used)).toBeNull();
  });

  it("returns null when there is no Response", async () => {
    expect(await edgeFunctionErrorBody({ message: "fn error" })).toBeNull();
    expect(await edgeFunctionErrorBody(undefined)).toBeNull();
  });
});

describe("edgeFunctionJsonBody", () => {
  it("returns the whole reply, including fn and the error code", async () => {
    const body = await edgeFunctionJsonBody(
      httpError(409, {
        success: false,
        error: "own_account",
        message: "You can't disable your own account.",
        fn: "staff-admin",
      }),
    );
    expect(body).toEqual({
      success: false,
      error: "own_account",
      message: "You can't disable your own account.",
      fn: "staff-admin",
    });
  });

  it("keeps extra fields such as retry_after_seconds", async () => {
    const body = await edgeFunctionJsonBody(
      httpError(429, { fn: "staff-admin", error: "rate_limited", retry_after_seconds: 120 }),
    );
    expect(body?.fn).toBe("staff-admin");
    expect(body?.retry_after_seconds).toBe(120);
  });

  it("returns null for a body that is not a JSON object", async () => {
    const notJson = {
      context: new Response("<html>Not Found</html>", { status: 404 }),
    };
    expect(await edgeFunctionJsonBody(notJson)).toBeNull();
    expect(await edgeFunctionJsonBody(httpError(500, ["a", "b"]))).toBeNull();
    expect(await edgeFunctionJsonBody(httpError(500, "text"))).toBeNull();
    expect(await edgeFunctionJsonBody(httpError(500, null))).toBeNull();
  });

  it("returns null when the body was already read or there is no Response", async () => {
    const used = httpError(400, { fn: "staff-admin" });
    await used.context.text();
    expect(await edgeFunctionJsonBody(used)).toBeNull();
    expect(await edgeFunctionJsonBody({ message: "fn error" })).toBeNull();
    expect(await edgeFunctionJsonBody(undefined)).toBeNull();
  });
});
