import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";

const mocks = vi.hoisted(() => ({ getMedications: vi.fn() }));

vi.mock("@/lib/supabaseClient", () => ({ isSupabaseEnabled: true, supabase: {} }));
vi.mock("@/services/patientService", () => ({ getMedications: mocks.getMedications }));
vi.mock("@/services/patientPortalData", () => ({ getPatientDashboard: vi.fn() }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => true }));

import { PrescriptionRefills } from "./PrescriptionRefills";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  mocks.getMedications.mockReset();
  localStorage.setItem(
    "patient_portal_user",
    JSON.stringify({ id: "u1", patientId: "p1", givenName: "Ada", familyName: "O" }),
  );
});

function renderPage() {
  return render(
    <MemoryRouter>
      <PrescriptionRefills />
    </MemoryRouter>,
  );
}

describe("PrescriptionRefills", () => {
  it("lists medicines and shows a date only when one was recorded", async () => {
    mocks.getMedications.mockResolvedValue({
      data: [
        { id: "m1", itemName: "Paracetamol", dosage: "500 mg", directions: null, dispensedAt: null, visitId: null },
        { id: "m2", itemName: "ORS", dosage: null, directions: null, dispensedAt: "2026-09-01T10:00:00Z", visitId: "v1" },
      ],
      error: null,
    });
    renderPage();
    expect(await screen.findByText("Paracetamol")).toBeInTheDocument();
    expect(screen.getAllByText(/^Given on /)).toHaveLength(1);
    expect(screen.getByRole("link", { name: "See the visit" })).toHaveAttribute(
      "href",
      "/patient/visit/v1",
    );
  });

  it("says the list did not load instead of showing it empty", async () => {
    mocks.getMedications.mockResolvedValue({ data: null, error: { code: "57014" } });
    renderPage();
    expect(
      await screen.findByText("We could not load your medicines. Please try again."),
    ).toBeInTheDocument();
    expect(screen.queryByText("No medicines recorded yet")).not.toBeInTheDocument();
  });
});
