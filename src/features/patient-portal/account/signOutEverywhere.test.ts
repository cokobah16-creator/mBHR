import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/clearApiCaches", () => ({
  clearApiCaches: vi.fn(async () => {}),
}));

import { signOutEverywhere } from "./signOutEverywhere";
import { PORTAL_USER_KEY } from "../portalSession";

function client(signOut: () => Promise<{ error: Error | null }>) {
  return { auth: { signOut: vi.fn(signOut) } } as never;
}

describe("signOutEverywhere", () => {
  beforeEach(() => {
    localStorage.setItem(PORTAL_USER_KEY, JSON.stringify({ id: "u1" }));
  });

  it("asks the server to end every sign-in, then clears this device", async () => {
    const c = client(async () => ({ error: null }));
    await expect(signOutEverywhere(c)).resolves.toBe(true);
    expect((c as any).auth.signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(localStorage.getItem(PORTAL_USER_KEY)).toBeNull();
  });

  it("keeps this device signed in when the server refuses", async () => {
    const c = client(async () => ({ error: new Error("refused") }));
    await expect(signOutEverywhere(c)).resolves.toBe(false);
    expect(localStorage.getItem(PORTAL_USER_KEY)).not.toBeNull();
  });

  it("keeps this device signed in when the server does not answer", async () => {
    const c = client(() => new Promise(() => {}));
    await expect(signOutEverywhere(c, 10)).resolves.toBe(false);
    expect(localStorage.getItem(PORTAL_USER_KEY)).not.toBeNull();
  });

  it("keeps this device signed in when the request throws", async () => {
    const c = client(async () => {
      throw new Error("network");
    });
    await expect(signOutEverywhere(c)).resolves.toBe(false);
    expect(localStorage.getItem(PORTAL_USER_KEY)).not.toBeNull();
  });
});
