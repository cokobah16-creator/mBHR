import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// --- mocks ---
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockLogin = vi.fn();
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ login: mockLogin }),
}));

// Offline mode by default; the online tests switch the server on.
const online = vi.hoisted(() => ({
  enabled: false,
  signOut: vi.fn(),
  getUser: vi.fn(),
  fetchStatus: vi.fn(),
  link: vi.fn(),
  clearAuth: vi.fn(),
  getProfile: vi.fn(),
  getProfileByEmail: vi.fn(),
}));

vi.mock("@/lib/supabaseClient", () => ({
  get supabase() {
    return online.enabled
      ? { auth: { signOut: online.signOut, getUser: online.getUser } }
      : null;
  },
  get isSupabaseEnabled() {
    return online.enabled;
  },
}));

vi.mock("@/lib/supabaseAuthStorage", () => ({
  clearStoredSupabaseAuth: online.clearAuth,
}));

vi.mock("@/services/portalSignIn", () => ({
  fetchPortalAccessStatus: online.fetchStatus,
  linkPortalAccount: online.link,
  linkDetailsFromUser: () => ({ dob: "1990-01-01" }),
}));

vi.mock("@/services/patientPortalAuth", () => ({
  loginPatientPortal: vi.fn(),
}));

vi.mock("@/services/patientService", () => ({
  getPatientProfile: online.getProfile,
  getPatientProfileByEmail: online.getProfileByEmail,
}));

import { PatientLogin } from "./PatientLogin";
import { loginPatientPortal } from "@/services/patientPortalAuth";

let sessionStore: Record<string, string> = {};
vi.stubGlobal("sessionStorage", {
  getItem: (k: string) => sessionStore[k] ?? null,
  setItem: (k: string, v: string) => {
    sessionStore[k] = v;
  },
  removeItem: (k: string) => {
    delete sessionStore[k];
  },
  clear: () => {
    sessionStore = {};
  },
});

let localStore: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem: (k: string) => localStore[k] ?? null,
  setItem: (k: string, v: string) => {
    localStore[k] = v;
  },
  removeItem: (k: string) => {
    delete localStore[k];
  },
  clear: () => {
    localStore = {};
  },
});

function renderLogin() {
  return render(
    <MemoryRouter>
      <PatientLogin />
    </MemoryRouter>,
  );
}

describe("PatientLogin (offline mode)", () => {
  beforeEach(() => {
    sessionStore = {};
    localStore = {};
    vi.clearAllMocks();
    online.enabled = false;
  });

  it("renders PIN input, not date-of-birth input", () => {
    renderLogin();
    expect(screen.getByLabelText(/6-digit pin/i)).toBeTruthy();
    expect(screen.queryByPlaceholderText(/yyyy-mm-dd/i)).toBeNull();
  });

  it("shows validation error when PIN is not 6 digits", async () => {
    renderLogin();
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "ada@test.com" },
    });
    fireEvent.change(screen.getByLabelText(/6-digit pin/i), {
      target: { value: "123" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /login/i }));
    await waitFor(() => {
      expect(screen.getByText(/6 digits/i)).toBeTruthy();
    });
  });

  it("stores token in sessionStorage and navigates on success", async () => {
    vi.mocked(loginPatientPortal).mockResolvedValue({
      success: true,
      sessionToken: "tok-abc",
      portalUser: {
        id: "u1",
        patientId: "p1",
        phoneNumber: "",
        phoneVerified: false,
        emailVerified: false,
        accountStatus: "active",
        failedLoginAttempts: 0,
        consentGiven: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      patient: {
        id: "p1",
        givenName: "Ada",
        familyName: "Obi",
        dob: "1990-01-01",
        sex: "female",
      },
    });

    renderLogin();
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "ada@test.com" },
    });
    fireEvent.change(screen.getByLabelText(/6-digit pin/i), {
      target: { value: "654321" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /login/i }));

    await waitFor(() => {
      expect(sessionStore["patient_session_token"]).toBe("tok-abc");
      expect(mockNavigate).toHaveBeenCalledWith("/patient/dashboard");
    });
  });

  it("shows error message on failed login", async () => {
    vi.mocked(loginPatientPortal).mockResolvedValue({
      success: false,
      error: "Incorrect PIN. Please try again.",
    });

    renderLogin();
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "ada@test.com" },
    });
    fireEvent.change(screen.getByLabelText(/6-digit pin/i), {
      target: { value: "000000" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /login/i }));

    await waitFor(() => {
      expect(screen.getByText(/incorrect pin/i)).toBeTruthy();
    });
  });

  it("does NOT store token in localStorage", async () => {
    vi.mocked(loginPatientPortal).mockResolvedValue({
      success: true,
      sessionToken: "tok-xyz",
      portalUser: {
        id: "u1",
        patientId: "p1",
        phoneNumber: "",
        phoneVerified: false,
        emailVerified: false,
        accountStatus: "active",
        failedLoginAttempts: 0,
        consentGiven: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      patient: {
        id: "p1",
        givenName: "Ada",
        familyName: "Obi",
        dob: "1990-01-01",
        sex: "female",
      },
    });

    renderLogin();
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "ada@test.com" },
    });
    fireEvent.change(screen.getByLabelText(/6-digit pin/i), {
      target: { value: "654321" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /login/i }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(localStore["patient_session_token"]).toBeUndefined();
  });
});

describe("PatientLogin (online: the server decides portal access)", () => {
  beforeEach(() => {
    sessionStore = {};
    localStore = {};
    vi.clearAllMocks();
    online.enabled = true;
    mockLogin.mockResolvedValue(null);
    online.signOut.mockResolvedValue({ error: null });
    online.getUser.mockResolvedValue({
      data: { user: { id: "auth-1", email: "ada@test.com", user_metadata: {} } },
    });
    online.link.mockResolvedValue({ linked: true });
  });

  function submitOnline() {
    renderLogin();
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "ada@test.com" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "correct-horse" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /login/i }));
  }

  it("signs out and refuses when the server has portal access off", async () => {
    online.fetchStatus.mockResolvedValue({ kind: "not_enabled" });

    submitOnline();

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(
        /not turned on portal access/i,
      );
    });
    expect(online.signOut).toHaveBeenCalled();
    expect(online.clearAuth).toHaveBeenCalled();
    expect(localStore["patient_portal_user"]).toBeUndefined();
    expect(online.getProfile).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("refuses when the server cannot be asked", async () => {
    online.fetchStatus.mockResolvedValue({ kind: "unavailable" });

    submitOnline();

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/could not check/i);
    });
    expect(online.signOut).toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("links an unlinked account first and refuses with the server's reason", async () => {
    online.fetchStatus.mockResolvedValue({ kind: "not_linked" });
    online.link.mockResolvedValue({
      linked: false,
      message: "More than one clinic record matches your details.",
    });

    submitOnline();

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/more than one clinic record/i);
    });
    expect(online.link).toHaveBeenCalled();
    expect(online.clearAuth).toHaveBeenCalled();
    expect(localStore["patient_portal_user"]).toBeUndefined();
  });

  it("opens the portal when the server says access is on", async () => {
    online.fetchStatus.mockResolvedValue({ kind: "allowed", patientIds: ["p1"] });
    online.getProfile.mockResolvedValue({
      data: { id: "p1", givenName: "Ada", familyName: "Obi", email: "ada@test.com" },
    });

    submitOnline();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/patient/dashboard"));
    expect(JSON.parse(localStore["patient_portal_user"]).patientId).toBe("p1");
    expect(online.signOut).not.toHaveBeenCalled();
  });
});
