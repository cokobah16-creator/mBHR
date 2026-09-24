import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const RECOVERY_HASH = "#access_token=abc&refresh_token=def&type=recovery&expires_in=3600";

// services/passwordReset captures the landing URL when it is first imported,
// so the recovery token has to be in the URL before the page module loads.
vi.hoisted(() => {
  window.history.replaceState(
    null,
    "",
    "/reset-password#access_token=abc&refresh_token=def&type=recovery&expires_in=3600",
  );
});

const onAuthStateChange = vi.fn();
const getSession = vi.fn();
const updateUser = vi.fn();
const signOut = vi.fn();
const maybeSingle = vi.fn();
const from = vi.fn((_table: string) => ({
  select: () => ({ eq: () => ({ maybeSingle: () => maybeSingle() }) }),
}));

vi.mock("@/lib/supabaseClient", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (...a: unknown[]) => onAuthStateChange(...a),
      getSession: (...a: unknown[]) => getSession(...a),
      updateUser: (...a: unknown[]) => updateUser(...a),
      signOut: (...a: unknown[]) => signOut(...a),
    },
    from: (table: string) => from(table),
  },
  isSupabaseEnabled: true,
}));

import ResetPassword from "./ResetPassword";

const session = { user: { id: "user-1" } };

function renderPage(route = `/reset-password${RECOVERY_HASH}`) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ResetPassword />
    </MemoryRouter>,
  );
}

async function setNewPassword() {
  await waitFor(() => expect(screen.getByLabelText(/^new password/i)).toBeTruthy());
  fireEvent.change(screen.getByLabelText(/^new password/i), {
    target: { value: "brand-new-pass" },
  });
  fireEvent.change(screen.getByLabelText(/confirm new password/i), {
    target: { value: "brand-new-pass" },
  });
  fireEvent.click(screen.getByRole("button", { name: /save new password/i }));
  await waitFor(() => expect(screen.getByText(/password updated/i)).toBeTruthy());
}

describe("ResetPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    getSession.mockResolvedValue({ data: { session } });
    updateUser.mockResolvedValue({ error: null });
    signOut.mockResolvedValue({ error: null });
  });

  it("sends a staff account to the staff sign-in after the reset", async () => {
    maybeSingle.mockResolvedValue({ data: { role: "nurse" }, error: null });
    renderPage();
    await setNewPassword();

    expect(from).toHaveBeenCalledWith("app_users");
    expect(updateUser).toHaveBeenCalledWith({ password: "brand-new-pass" });
    expect(screen.getByRole("link", { name: /go to sign in/i })).toHaveAttribute("href", "/login");
  });

  it("sends a patient account to the patient portal sign-in after the reset", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    renderPage();
    await setNewPassword();

    expect(screen.getByRole("link", { name: /go to sign in/i })).toHaveAttribute(
      "href",
      "/patient/login",
    );
  });

  it("honours the ?for= hint on older links without looking the account up", async () => {
    renderPage(`/reset-password?for=staff${RECOVERY_HASH}`);
    await setNewPassword();

    expect(from).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /go to sign in/i })).toHaveAttribute("href", "/login");
  });

  it("also accepts the session when it arrives through the auth event", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    maybeSingle.mockResolvedValue({ data: null, error: null });
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent(/checking your reset link/i);

    const handler = onAuthStateChange.mock.calls[0][0] as (
      event: string,
      s: typeof session | null,
    ) => void;
    act(() => handler("PASSWORD_RECOVERY", session));

    await setNewPassword();
    expect(from).toHaveBeenCalledWith("app_users");
  });
});
