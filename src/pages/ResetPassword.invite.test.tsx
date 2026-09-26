import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// A staff invitation sent with Supabase's default email template lands like a
// reset link, with type=invite in the hash. services/passwordReset captures the
// landing URL when it is first imported, so it is set before the page loads.
// The token is JWT-shaped with sub "u1", the invited account.
const { INVITE_URL } = vi.hoisted(() => {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: "u1" })}.signature`;
  const url = `/reset-password?for=staff&link=invite#access_token=${token}&refresh_token=def&type=invite&expires_in=3600`;
  window.history.replaceState(null, "", url);
  return { INVITE_URL: url };
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

const DONE_TEXT =
  "Sign in with your email and this password. The first time you sign in on a device, you'll also choose a PIN for offline use.";

function renderPage(route = INVITE_URL) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ResetPassword />
    </MemoryRouter>,
  );
}

async function setPassword() {
  await waitFor(() => expect(screen.getByLabelText(/^new password/i)).toBeTruthy());
  fireEvent.change(screen.getByLabelText(/^new password/i), {
    target: { value: "brand-new-pass" },
  });
  fireEvent.change(screen.getByLabelText(/confirm new password/i), {
    target: { value: "brand-new-pass" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save password" }));
  await waitFor(() => expect(screen.getByText("Your password is set.")).toBeTruthy());
}

describe("ResetPassword with an invitation link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    getSession.mockResolvedValue({ data: { session } });
    updateUser.mockResolvedValue({ error: null });
    signOut.mockResolvedValue({ error: null });
  });

  it("uses invitation wording while the link is checked", () => {
    getSession.mockResolvedValue({ data: { session: null } });
    renderPage();

    expect(screen.getByRole("heading", { name: "Set your password" })).toBeTruthy();
    expect(screen.getByRole("status")).toHaveTextContent(/checking your invitation link/i);
  });

  it("becomes ready when the invited person is signed in", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    renderPage();

    const handler = onAuthStateChange.mock.calls[0][0] as (
      event: string,
      s: typeof session | null,
    ) => void;
    act(() => handler("SIGNED_IN", session));

    await waitFor(() => expect(screen.getByLabelText(/^new password/i)).toBeTruthy());
    expect(screen.getByRole("button", { name: "Save password" })).toBeTruthy();
  });

  it("sets the password, records it and explains the next step", async () => {
    renderPage();
    await setPassword();

    expect(screen.getByText(DONE_TEXT)).toBeTruthy();
    expect(updateUser).toHaveBeenCalledWith({
      password: "brand-new-pass",
      data: { mbhr_password_set_at: expect.any(String) },
    });
    expect(signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(screen.getByRole("link", { name: /go to sign in/i })).toHaveAttribute("href", "/login");
  });

  it("records the password as set when the router lost ?for=staff but the landing still says invite", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    renderPage("/reset-password");
    await setPassword();

    expect(from).toHaveBeenCalledWith("app_users");
    expect(updateUser).toHaveBeenCalledWith({
      password: "brand-new-pass",
      data: { mbhr_password_set_at: expect.any(String) },
    });
  });

  it("refuses a session for another account and offers no new reset link", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "someone-else" } } } });
    renderPage();

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "This link is for a different account than the one signed in on this browser. Sign out, then open the link again.",
      ),
    );
    expect(screen.queryByLabelText(/^new password/i)).toBeNull();
    expect(screen.queryByRole("link", { name: /request a new link/i })).toBeNull();
    expect(screen.getByRole("link", { name: /back to sign in/i })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(updateUser).not.toHaveBeenCalled();
  });
});
