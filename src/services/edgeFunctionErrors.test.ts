import { describe, it, expect } from "vitest";
import {
  edgeFunctionErrorBody,
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
