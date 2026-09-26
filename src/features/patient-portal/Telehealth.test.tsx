import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";

const mocks = vi.hoisted(() => ({
  visits: vi.fn(),
  requests: vi.fn(),
}));

vi.mock("@/services/televisits", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/services/televisits")>();
  return {
    ...real,
    isTelevisitServiceAvailable: () => true,
    getPatientTelevisits: mocks.visits,
    getPatientTelevisitRequests: mocks.requests,
    requestTelevisit: vi.fn(),
    cancelTelevisitRequest: vi.fn(),
  };
});

import { Telehealth } from "./Telehealth";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  mocks.visits.mockReset();
  mocks.requests.mockReset();
  localStorage.setItem(
    "patient_portal_user",
    JSON.stringify({ id: "u1", patientId: "p1", givenName: "Ada", familyName: "O" }),
  );
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/patient/telehealth"]}>
      <Telehealth />
    </MemoryRouter>,
  );
}

describe("Telehealth", () => {
  it("shows a pending request with its preferred time of day and a cancel button", async () => {
    mocks.visits.mockResolvedValue([]);
    mocks.requests.mockResolvedValue([
      {
        id: "r1",
        patientId: "p1",
        reason: "Cough",
        preferredDate: "2026-10-02",
        preferredTime: "morning",
        status: "pending",
        createdAt: new Date(2026, 8, 25),
      },
    ]);
    renderPage();
    expect(await screen.findByText("Video visit request")).toBeInTheDocument();
    expect(screen.getByText(/Morning \(8:00 AM - 12:00 PM\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel request" })).toBeInTheDocument();
  });

  it("offers a retry when the visits cannot be loaded", async () => {
    mocks.visits.mockRejectedValue(new Error("offline"));
    mocks.requests.mockResolvedValue([]);
    renderPage();
    expect(
      await screen.findByText("We could not load your video visits. Please try again."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
