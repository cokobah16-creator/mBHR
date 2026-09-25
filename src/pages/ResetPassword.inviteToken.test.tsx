import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// The documented invitation template links to the page with a token_hash that
// is redeemed only when the person presses Continue, so a mail scanner that
// opens the link cannot use it up. services/passwordReset captures the landing
// URL when it is first imported, so it is set before the page loads.
const { INVITE_URL } = vi.hoisted(() => {
  const url = "/reset-password?for=staff&link=invite&token_hash=abc&type=invite";
  window.history.replaceState(null, "", url);
  return { INVITE_URL: url };
});

const onAuthStateChange = vi.fn();
const getSession = vi.fn();
const verifyOtp = vi.fn();
const updateUser = vi.fn();
const signOut = vi.fn();
const from = vi.fn();

vi.mock("@/lib/supabaseClient", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (...a: unknown[]) => onAuthStateChange(...a),
      getSession: (...a: unknown[]) => getSession(...a),
      verifyOtp: (...a: unknown[]) => verifyOtp(...a),
      updateUser: (...a: unknown[]) => updateUser(...a),
      signOut: (...a: unknown[]) => signOut(...a),
    },
    from: (...a: unknown[]) => from(...a),
  },
  isSupabaseEnabled: true,
}));

import ResetPassword from "./ResetPassword";

const invitee = { user: { id: "u1" } };

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[INVITE_URL]}>
      <ResetPassword />
    </MemoryRouter>,
  );
}

describe("ResetPassword with an invitation token_hash", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    // Someone else is already signed in on this browser; that session must not be used.
    getSession.mockResolvedValue({ data: { session: { user: { id: "admin-1" } } } });
    verifyOtp.mockResolvedValue({ data: { user: invitee.user, session: invitee }, error: null });
    updateUser.mockResolvedValue({ error: null });
    signOut.mockResolvedValue({ error: null });
  });

  it("shows a Continue button and does not use the link on load", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Set your password" })).toBeTruthy();
    expect(
      screen.getByText("Welcome to mBHR. Press Continue to set your password."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/^new password/i)).toBeNull();
  });

  it("redeems the link when Continue is pressed, then sets the password", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(screen.getByLabelText(/^new password/i)).toBeTruthy());
    expect(verifyOtp).toHaveBeenCalledTimes(1);
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "abc", type: "invite" });

    fireEvent.change(screen.getByLabelText(/^new password/i), {
      target: { value: "brand-new-pass" },
    });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: "brand-new-pass" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save password" }));
    await waitFor(() => expect(screen.getByText("Your password is set.")).toBeTruthy());

    expect(updateUser).toHaveBeenCalledWith({
      password: "brand-new-pass",
      data: { mbhr_password_set_at: expect.any(String) },
    });
    expect(from).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /go to sign in/i })).toHaveAttribute("href", "/login");
  });

  it("explains an expired invitation and offers no new reset link", async () => {
    verifyOtp.mockResolvedValue({
      data: { user: null, session: null },
      error: { status: 403, code: "otp_expired", message: "Email link is invalid or has expired" },
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "This invitation link has expired or was already used. Ask your administrator to send a new one.",
      ),
    );
    expect(screen.queryByRole("link", { name: /request a new link/i })).toBeNull();
    expect(screen.getByRole("link", { name: /back to sign in/i })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.queryByLabelText(/^new password/i)).toBeNull();
  });

  it("lets the person press Continue again after a failure that did not use the link", async () => {
    verifyOtp.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Could not check your invitation link. Press Continue to try again.",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(screen.getByLabelText(/^new password/i)).toBeTruthy());
    expect(verifyOtp).toHaveBeenCalledTimes(2);
  });
});
