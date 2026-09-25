// PatientRegister with Supabase configured (online sign-up with a password).
// The schema is chosen when the module loads, so online mode needs its own
// file; PatientRegister.test.tsx covers offline mode.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

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

// Online mode without a client: sign-up goes through the mocked useAuth, and
// the profile lookup after it is skipped.
vi.mock("@/lib/supabaseClient", () => ({
  supabase: null,
  isSupabaseEnabled: true,
}));

vi.mock("@/services/patientPortalAuth", () => ({
  registerPatientPortalAccount: vi.fn(),
}));

vi.mock("@/services/patientService", () => ({
  getPatientProfile: vi.fn(),
  getPatientProfileByEmail: vi.fn(),
}));

import { PatientRegister } from "./PatientRegister";
import { UNDER_18_SIGN_UP_MESSAGE } from "@/pages/legal/policyMeta";

function renderRegister() {
  return render(
    <MemoryRouter>
      <PatientRegister />
    </MemoryRouter>,
  );
}

/** 1 January, ten years ago: someone under 18 whatever today's date is. */
function childDob(): string {
  return `${new Date().getFullYear() - 10}-01-01`;
}

function fillForm(dob: string) {
  fireEvent.change(screen.getByLabelText(/full name/i), {
    target: { value: "Ada Obi" },
  });
  fireEvent.change(screen.getByLabelText(/email/i), {
    target: { value: "ada@test.com" },
  });
  fireEvent.change(screen.getByLabelText(/date of birth/i), {
    target: { value: dob },
  });
  fireEvent.change(screen.getByLabelText(/^password/i), {
    target: { value: "long-enough" },
  });
  fireEvent.change(screen.getByLabelText(/confirm password/i), {
    target: { value: "long-enough" },
  });
  for (const id of ["consent-terms", "consent-privacy", "consent-records"]) {
    fireEvent.click(document.getElementById(id) as HTMLInputElement);
  }
}

function submit() {
  fireEvent.submit(screen.getByRole("button", { name: /create account/i }));
}

describe("PatientRegister (online mode)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockSignup.mockResolvedValue(null);
  });

  it("marks date of birth as required", () => {
    renderRegister();
    const dob = screen.getByLabelText(/date of birth \*/i);
    expect(dob.getAttribute("aria-required")).toBe("true");
    expect(screen.queryByText(/date of birth \(optional\)/i)).toBeNull();
  });

  it("does not sign up without a date of birth", async () => {
    renderRegister();
    fillForm("");
    submit();

    await waitFor(() => {
      expect(screen.getByText("Date of birth is required")).toBeTruthy();
    });
    expect(mockSignup).not.toHaveBeenCalled();
  });

  it("does not sign up someone under 18", async () => {
    renderRegister();
    fillForm(childDob());
    submit();

    await waitFor(() => {
      expect(screen.getByText(UNDER_18_SIGN_UP_MESSAGE)).toBeTruthy();
    });
    expect(mockSignup).not.toHaveBeenCalled();
  });

  it("passes the date of birth to sign-up for an adult", async () => {
    renderRegister();
    fillForm("1990-01-01");
    submit();

    await waitFor(() => expect(mockSignup).toHaveBeenCalledTimes(1));
    expect(mockSignup.mock.calls[0][0]).toMatchObject({
      email: "ada@test.com",
      dob: "1990-01-01",
    });
  });
});
