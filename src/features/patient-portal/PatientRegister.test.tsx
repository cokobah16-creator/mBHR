import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// --- mocks ---
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useSearchParams: () => [new URLSearchParams()],
  };
});

const mockSignup = vi.fn();
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ signup: mockSignup }),
}));

vi.mock("@/lib/supabaseClient", () => ({
  supabase: null,
  isSupabaseEnabled: false,
}));

vi.mock("@/services/patientPortalAuth", () => ({
  registerPatientPortalAccount: vi.fn(),
}));

vi.mock("@/services/patientService", () => ({
  getPatientProfile: vi.fn(),
}));

import { PatientRegister } from "./PatientRegister";
import { registerPatientPortalAccount } from "@/services/patientPortalAuth";

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

function renderRegister() {
  return render(
    <MemoryRouter>
      <PatientRegister />
    </MemoryRouter>,
  );
}

describe("PatientRegister (offline mode)", () => {
  beforeEach(() => {
    sessionStore = {};
    localStore = {};
    vi.resetAllMocks();
  });

  it("renders PIN and Confirm PIN fields", () => {
    renderRegister();
    expect(screen.getByLabelText(/6-digit pin/i)).toBeTruthy();
    expect(screen.getByLabelText(/confirm pin/i)).toBeTruthy();
  });

  it("shows error when PINs do not match", async () => {
    renderRegister();
    fireEvent.change(screen.getByLabelText(/full name/i), {
      target: { value: "Ada Obi" },
    });
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "ada@test.com" },
    });
    fireEvent.change(screen.getByLabelText(/date of birth/i), {
      target: { value: "1990-01-01" },
    });
    fireEvent.change(screen.getByLabelText(/6-digit pin/i), {
      target: { value: "123456" },
    });
    fireEvent.change(screen.getByLabelText(/confirm pin/i), {
      target: { value: "654321" },
    });
    fireEvent.click(document.getElementById("consent")!);
    fireEvent.submit(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText(/pins do not match/i)).toBeTruthy();
    });
  });

  it("shows error when PIN is not 6 digits", async () => {
    renderRegister();
    fireEvent.change(screen.getByLabelText(/6-digit pin/i), {
      target: { value: "12" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /create account/i }));
    await waitFor(() => {
      expect(screen.getByText(/6 digits/i)).toBeTruthy();
    });
  });

  it("stores token in sessionStorage (not localStorage) on success", async () => {
    vi.mocked(registerPatientPortalAccount).mockResolvedValue({
      success: true,
      sessionToken: "reg-tok",
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

    renderRegister();
    fireEvent.change(screen.getByLabelText(/full name/i), {
      target: { value: "Ada Obi" },
    });
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "ada@test.com" },
    });
    fireEvent.change(screen.getByLabelText(/date of birth/i), {
      target: { value: "1990-01-01" },
    });
    fireEvent.change(screen.getByLabelText(/6-digit pin/i), {
      target: { value: "112233" },
    });
    fireEvent.change(screen.getByLabelText(/confirm pin/i), {
      target: { value: "112233" },
    });
    fireEvent.click(document.getElementById("consent")!);
    fireEvent.submit(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(sessionStore["patient_session_token"]).toBe("reg-tok");
      expect(localStore["patient_session_token"]).toBeUndefined();
    });
  });

  it("passes the PIN to registerPatientPortalAccount", async () => {
    let capturedArgs: unknown[] = [];
    vi.mocked(registerPatientPortalAccount).mockImplementation(
      async (...args) => {
        capturedArgs = args;
        return { success: false, error: "test" };
      },
    );

    renderRegister();
    fireEvent.change(screen.getByLabelText(/full name/i), {
      target: { value: "Ada Obi" },
    });
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "ada@test.com" },
    });
    fireEvent.change(screen.getByLabelText(/date of birth/i), {
      target: { value: "1990-01-01" },
    });
    fireEvent.change(screen.getByLabelText(/6-digit pin/i), {
      target: { value: "555444" },
    });
    fireEvent.change(screen.getByLabelText(/confirm pin/i), {
      target: { value: "555444" },
    });
    fireEvent.click(document.getElementById("consent")!);
    fireEvent.submit(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => expect(capturedArgs.length).toBeGreaterThan(0));
    // PIN (6th arg, index 5) must be passed through
    expect(capturedArgs[5]).toBe("555444");
    // email and dob also forwarded correctly
    expect(capturedArgs[1]).toBe("ada@test.com");
    expect(capturedArgs[2]).toBe("1990-01-01");
  });
});
