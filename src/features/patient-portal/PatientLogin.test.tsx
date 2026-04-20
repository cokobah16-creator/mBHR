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

vi.mock("@/lib/supabaseClient", () => ({
  supabase: null,
  isSupabaseEnabled: false,
}));

vi.mock("@/services/patientPortalAuth", () => ({
  loginPatientPortal: vi.fn(),
}));

vi.mock("@/services/patientService", () => ({
  getPatientProfile: vi.fn(),
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
