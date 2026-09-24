import { describe, it, expect, vi } from "vitest";
import { recoveryLandingPath, relocateRecoveryLanding } from "./recoveryLanding";

const TOKEN_HASH = "#access_token=abc&refresh_token=def&type=recovery&expires_in=3600";

describe("recoveryLandingPath", () => {
  it("moves a recovery token that landed on the home page to the reset page", () => {
    expect(recoveryLandingPath(`https://app.test/${TOKEN_HASH}`)).toBe(
      `/reset-password${TOKEN_HASH}`,
    );
  });

  it("moves a recovery token that landed on any other page", () => {
    expect(recoveryLandingPath(`https://app.test/patient/login${TOKEN_HASH}`)).toBe(
      `/reset-password${TOKEN_HASH}`,
    );
  });

  it("keeps the query string", () => {
    expect(recoveryLandingPath(`https://app.test/?for=staff${TOKEN_HASH}`)).toBe(
      `/reset-password?for=staff${TOKEN_HASH}`,
    );
  });

  it("leaves the reset page alone", () => {
    expect(recoveryLandingPath(`https://app.test/reset-password${TOKEN_HASH}`)).toBeNull();
    expect(recoveryLandingPath(`https://app.test/reset-password/${TOKEN_HASH}`)).toBeNull();
  });

  it("ignores other auth callbacks and errors", () => {
    expect(recoveryLandingPath("https://app.test/#access_token=abc&type=signup")).toBeNull();
    expect(
      recoveryLandingPath(
        "https://app.test/#error=access_denied&error_code=otp_expired&error_description=x",
      ),
    ).toBeNull();
    expect(recoveryLandingPath("https://app.test/#type=recovery")).toBeNull();
    expect(recoveryLandingPath("https://app.test/")).toBeNull();
    expect(recoveryLandingPath("not a url")).toBeNull();
  });
});

describe("relocateRecoveryLanding", () => {
  it("rewrites the URL in place without adding a history entry", () => {
    const replaceState = vi.fn();
    const pushState = vi.fn();
    const win = {
      location: { href: `https://app.test/${TOKEN_HASH}` },
      history: { replaceState, pushState, state: { from: "test" } },
    } as unknown as Pick<Window, "location" | "history">;

    expect(relocateRecoveryLanding(win)).toBe(true);
    expect(replaceState).toHaveBeenCalledWith({ from: "test" }, "", `/reset-password${TOKEN_HASH}`);
    expect(pushState).not.toHaveBeenCalled();
  });

  it("does nothing on an ordinary page load", () => {
    const replaceState = vi.fn();
    const win = {
      location: { href: "https://app.test/patient/login" },
      history: { replaceState, state: null },
    } as unknown as Pick<Window, "location" | "history">;

    expect(relocateRecoveryLanding(win)).toBe(false);
    expect(replaceState).not.toHaveBeenCalled();
  });
});
