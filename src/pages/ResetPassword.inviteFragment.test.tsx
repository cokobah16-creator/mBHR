import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// An invitation link that lost its whole query string on the way (a
// relocated link, or one that went through the default site address): only
// the hash is left, with type=invite. services/passwordReset captures the
// landing URL when it is first imported, so it is set before the page loads.
// The token is JWT-shaped with sub "u1", the invited account.
const { BARE_INVITE_URL } = vi.hoisted(() => {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: "u1" })}.signature`;
  const url = `/reset-password#access_token=${token}&refresh_token=def&type=invite&expires_in=3600`;
  window.history.replaceState(null, "", url);
  return { BARE_INVITE_URL: url };
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

const session = { user: { id: "u1" } };

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[BARE_INVITE_URL]}>
      <ResetPassword />
    </MemoryRouter>,
  );
}

describe("ResetPassword with an invitation link that has only its hash", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    getSession.mockResolvedValue({ data: { session } });
    updateUser.mockResolvedValue({ error: null });
    signOut.mockResolvedValue({ error: null });
    maybeSingle.mockResolvedValue({ data: null, error: null });
  });

  it("uses invitation wording from type=invite in the hash", () => {
    getSession.mockResolvedValue({ data: { session: null } });
    renderPage();

    expect(screen.getByRole("heading", { name: "Set your password" })).toBeTruthy();
    expect(screen.getByRole("status")).toHaveTextContent(/checking your invitation link/i);
  });

  it("sets the password and records it as set", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByLabelText(/^new password/i)).toBeTruthy());
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
  });
});
