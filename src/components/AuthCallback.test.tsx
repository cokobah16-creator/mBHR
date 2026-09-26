import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  complete: vi.fn(),
}));

vi.mock("@/lib/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: auth.getSession,
      onAuthStateChange: auth.onAuthStateChange,
    },
  },
}));

vi.mock("@/services/portalCompleteSignIn", () => ({
  completePortalSignIn: auth.complete,
}));

import { AuthCallback } from "./AuthCallback";

function renderCallback() {
  return render(
    <MemoryRouter>
      <AuthCallback />
    </MemoryRouter>,
  );
}

describe("AuthCallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
  });

  it("finishes the portal sign-in and opens the dashboard", async () => {
    auth.complete.mockResolvedValue({ kind: "allowed" });
    renderCallback();
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("/patient/dashboard", { replace: true }),
    );
    expect(auth.complete).toHaveBeenCalledTimes(1);
  });

  it("explains a refusal instead of silently returning to sign in", async () => {
    auth.complete.mockResolvedValue({
      kind: "refused",
      message: "We could not find a clinic record that matches your details.",
    });
    renderCallback();
    expect(
      await screen.findByText("We could not find a clinic record that matches your details."),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("finishes only once when the sign-in event and the stored session both arrive", async () => {
    auth.complete.mockResolvedValue({ kind: "allowed" });
    auth.onAuthStateChange.mockImplementation((cb: (event: string) => void) => {
      cb("SIGNED_IN");
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    renderCallback();
    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(auth.complete).toHaveBeenCalledTimes(1);
  });
});
