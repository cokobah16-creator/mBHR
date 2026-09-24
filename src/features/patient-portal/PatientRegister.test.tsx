import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
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
import {
  PRIVACY_VERSION,
  TERMS_VERSION,
  UNDER_18_SIGN_UP_MESSAGE,
} from "@/pages/legal/policyMeta";

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

const CONSENT_BOX_IDS = ["consent-terms", "consent-privacy", "consent-records"];

function consentBox(id: string) {
  return document.getElementById(id) as HTMLInputElement;
}

function tickConsents(ids: string[] = CONSENT_BOX_IDS) {
  for (const id of ids) fireEvent.click(consentBox(id));
}

/** 1 January, ten years ago: someone under 18 whatever today's date is. */
function childDob(): string {
  return `${new Date().getFullYear() - 10}-01-01`;
}

function fillValidForm() {
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
    tickConsents();
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
    tickConsents();
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
    tickConsents();
    fireEvent.submit(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => expect(capturedArgs.length).toBeGreaterThan(0));
    // PIN (6th arg, index 5) must be passed through
    expect(capturedArgs[5]).toBe("555444");
    // email and dob also forwarded correctly
    expect(capturedArgs[1]).toBe("ada@test.com");
    expect(capturedArgs[2]).toBe("1990-01-01");
  });

  it("shows three separate consent boxes, all unticked", () => {
    renderRegister();
    const terms = screen.getByRole("checkbox", {
      name: /i agree to the terms of use/i,
    }) as HTMLInputElement;
    const privacy = screen.getByRole("checkbox", {
      name: /i have read the privacy notice/i,
    }) as HTMLInputElement;
    const records = screen.getByRole("checkbox", {
      name: /i consent to seeing my health records in this portal/i,
    }) as HTMLInputElement;

    expect(terms.checked).toBe(false);
    expect(privacy.checked).toBe(false);
    expect(records.checked).toBe(false);
    // Each box links to its own document (the page footer has links too).
    const linkIn = (id: string) =>
      within(document.querySelector(`label[for="${id}"]`) as HTMLElement)
        .getByRole("link")
        .getAttribute("href");
    expect(linkIn("consent-terms")).toBe("/terms");
    expect(linkIn("consent-privacy")).toBe("/privacy");
  });

  it.each(CONSENT_BOX_IDS)(
    "does not create the account while %s is unticked",
    async (missing) => {
      renderRegister();
      fillValidForm();
      tickConsents(CONSENT_BOX_IDS.filter((id) => id !== missing));
      fireEvent.submit(screen.getByRole("button", { name: /create account/i }));

      await waitFor(() => {
        expect(consentBox(missing).getAttribute("aria-invalid")).toBe("true");
      });
      expect(screen.getByText(/tick this box/i)).toBeTruthy();
      expect(registerPatientPortalAccount).not.toHaveBeenCalled();
    },
  );

  it("passes the accepted terms and privacy versions with the time", async () => {
    let capturedArgs: unknown[] = [];
    vi.mocked(registerPatientPortalAccount).mockImplementation(
      async (...args) => {
        capturedArgs = args;
        return { success: false, error: "test" };
      },
    );

    renderRegister();
    fillValidForm();
    tickConsents();
    const before = Date.now();
    fireEvent.submit(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => expect(capturedArgs.length).toBeGreaterThan(0));
    const acceptance = capturedArgs[6] as {
      termsVersion: string;
      privacyVersion: string;
      acceptedAt: string;
    };
    expect(acceptance.termsVersion).toBe(TERMS_VERSION);
    expect(acceptance.privacyVersion).toBe(PRIVACY_VERSION);
    expect(Date.parse(acceptance.acceptedAt)).toBeGreaterThanOrEqual(before - 1000);
  });

  it("requires a date of birth", async () => {
    renderRegister();
    fillValidForm();
    fireEvent.change(screen.getByLabelText(/date of birth/i), {
      target: { value: "" },
    });
    tickConsents();
    fireEvent.submit(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText("Date of birth is required")).toBeTruthy();
    });
    expect(registerPatientPortalAccount).not.toHaveBeenCalled();
  });

  it("does not create an account for someone under 18", async () => {
    renderRegister();
    fillValidForm();
    fireEvent.change(screen.getByLabelText(/date of birth/i), {
      target: { value: childDob() },
    });
    tickConsents();
    fireEvent.submit(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText(UNDER_18_SIGN_UP_MESSAGE)).toBeTruthy();
    });
    // The message points to the caregiver option in a parent's account.
    expect(UNDER_18_SIGN_UP_MESSAGE).toMatch(/people you care for/i);
    expect(
      screen.getByLabelText(/date of birth/i).getAttribute("aria-invalid"),
    ).toBe("true");
    expect(registerPatientPortalAccount).not.toHaveBeenCalled();
  });

  it("does not accept a date of birth in the future", async () => {
    renderRegister();
    fillValidForm();
    fireEvent.change(screen.getByLabelText(/date of birth/i), {
      target: { value: `${new Date().getFullYear() + 1}-01-01` },
    });
    tickConsents();
    fireEvent.submit(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText(/real date of birth/i)).toBeTruthy();
    });
    expect(registerPatientPortalAccount).not.toHaveBeenCalled();
  });
});
