import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// A browser that is merely signed in must not reach the password form by
// opening /reset-password with a bare ?type=recovery. The landing URL is
// captured when the page module is first imported, so it is set before that.
vi.hoisted(() => {
  window.history.replaceState(null, "", "/reset-password?type=recovery");
});

const onAuthStateChange = vi.fn();
const getSession = vi.fn();
const updateUser = vi.fn();

vi.mock("@/lib/supabaseClient", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (...a: unknown[]) => onAuthStateChange(...a),
      getSession: (...a: unknown[]) => getSession(...a),
      updateUser: (...a: unknown[]) => updateUser(...a),
      signOut: vi.fn(),
    },
    from: vi.fn(),
  },
  isSupabaseEnabled: true,
}));

import ResetPassword from "./ResetPassword";

describe("ResetPassword without a recovery token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    getSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } } });
  });

  it("refuses an ordinary signed-in session that only claims type=recovery", async () => {
    render(
      <MemoryRouter initialEntries={["/reset-password?type=recovery"]}>
        <ResetPassword />
      </MemoryRouter>,
    );

    await waitFor(
      () =>
        expect(screen.getByRole("alert")).toHaveTextContent(
          /open this page from the link in your password reset email/i,
        ),
      { timeout: 4000 },
    );
    expect(screen.queryByLabelText(/^new password/i)).toBeNull();
    expect(getSession).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });
});
