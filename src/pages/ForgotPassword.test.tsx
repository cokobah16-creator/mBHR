import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/lib/supabaseClient", () => ({
  supabase: {},
  isSupabaseEnabled: true,
}));

const mockRequest = vi.fn();
vi.mock("@/services/passwordReset", async (orig) => {
  const actual = await orig<typeof import("@/services/passwordReset")>();
  return { ...actual, requestPasswordReset: (...a: unknown[]) => mockRequest(...a) };
});

import ForgotPassword from "./ForgotPassword";

function renderPage(audience: "staff" | "patient" = "patient") {
  return render(
    <MemoryRouter>
      <ForgotPassword audience={audience} />
    </MemoryRouter>,
  );
}

describe("ForgotPassword", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the same confirmation once the request succeeds", async () => {
    mockRequest.mockResolvedValue({ ok: true });
    renderPage("staff");
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "nurse@clinic.ng" },
    });
    fireEvent.click(screen.getByRole("button", { name: /email me a reset link/i }));

    await waitFor(() => expect(screen.getByText(/check your email/i)).toBeTruthy());
    expect(mockRequest).toHaveBeenCalledWith("nurse@clinic.ng", "staff");
    expect(screen.getByRole("button", { name: /send again in/i })).toBeDisabled();
  });

  it("shows the error and stays on the form when the request fails", async () => {
    mockRequest.mockResolvedValue({
      ok: false,
      reason: "network",
      message: "Could not reach the server. Check your connection and try again.",
    });
    renderPage();
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "patient@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /email me a reset link/i }));

    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeTruthy());
    expect(screen.queryByText(/check your email/i)).toBeNull();
  });

  it("links back to the right login page", () => {
    renderPage("patient");
    expect(screen.getByRole("link", { name: /back to sign in/i })).toHaveAttribute(
      "href",
      "/patient/login",
    );
  });
});
