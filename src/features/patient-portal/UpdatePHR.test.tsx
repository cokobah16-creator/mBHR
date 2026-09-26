import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";

const mocks = vi.hoisted(() => ({
  patient: {} as Record<string, unknown>,
}));

vi.mock("@/lib/supabaseClient", () => {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve({ data: mocks.patient, error: null }),
  };
  return { isSupabaseEnabled: true, supabase: { from: () => builder } };
});
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => true }));

import { UpdatePHR } from "./UpdatePHR";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  mocks.patient = {
    id: "p1",
    given_name: "Ada",
    family_name: "O",
    dob: "1990-01-01",
    phone: "08000000000",
    blood_type: "O+",
    notes: "Seen at outreach",
  };
  localStorage.setItem(
    "patient_portal_user",
    JSON.stringify({ id: "u1", patientId: "p1", givenName: "Ada", familyName: "O" }),
  );
});

describe("UpdatePHR", () => {
  it("lets the patient edit contact details but not blood type or medical notes", async () => {
    render(
      <MemoryRouter>
        <UpdatePHR />
      </MemoryRouter>,
    );
    expect(await screen.findByText("O+")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Phone number" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Blood type" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit Medical notes" })).toBeNull();
    // Date of birth, blood type and medical notes.
    expect(screen.getAllByText("Only clinic staff can change this.")).toHaveLength(3);
  });
});
