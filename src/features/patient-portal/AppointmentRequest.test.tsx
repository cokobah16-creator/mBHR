import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  cancel: vi.fn(),
  rows: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase", () => {
  const builder = {
    select: (cols: string) => {
      mocks.select(cols);
      return builder;
    },
    eq: () => builder,
    order: () => builder,
    limit: () => Promise.resolve({ data: mocks.rows, error: null }),
  };
  return { supabase: { from: () => builder } };
});
vi.mock("@/services/appointments", () => ({
  getPatientAppointments: vi.fn(() => Promise.resolve([])),
}));
vi.mock("@/services/televisits", () => ({ cancelTelevisitRequest: mocks.cancel }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => true }));

import { AppointmentRequest } from "./AppointmentRequest";

const PENDING = {
  id: "r1",
  appointment_type: "Follow-up Visit",
  preferred_date_1: "2026-10-02",
  preferred_time_1: null,
  status: "pending",
  review_notes: null,
  visit_mode: "in_person",
  created_at: "2026-09-25T10:00:00Z",
};

beforeEach(() => {
  mocks.select.mockReset();
  mocks.cancel.mockReset();
  mocks.rows = [PENDING, { ...PENDING, id: "r2", status: "approved" }];
  localStorage.setItem(
    "patient_portal_user",
    JSON.stringify({ id: "u1", patientId: "p1", givenName: "Ada", familyName: "O" }),
  );
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/patient/appointments"]}>
      <AppointmentRequest />
    </MemoryRouter>,
  );
}

describe("AppointmentRequest", () => {
  it("reads only the request columns the page shows", async () => {
    renderPage();
    await screen.findAllByText("Follow-up Visit");
    const cols = mocks.select.mock.calls.map((c) => c[0]);
    expect(cols).not.toContain("*");
    expect(cols[0]).not.toMatch(/(^|[ ,])notes([ ,]|$)/);
  });

  it("lets the patient cancel a request still waiting for the clinic, after confirming", async () => {
    mocks.cancel.mockResolvedValue(undefined);
    renderPage();
    const buttons = await screen.findAllByRole("button", { name: "Cancel request" });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    fireEvent.click(screen.getByRole("button", { name: "Yes, cancel" }));
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith("r1"));
    expect(await screen.findByText("Your request has been cancelled.")).toBeInTheDocument();
  });

  it("says so when the cancel did not go through", async () => {
    mocks.cancel.mockRejectedValue(new Error("nope"));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel request" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, cancel" }));
    expect(
      await screen.findByText(
        "The request was not cancelled. Check your connection and try again.",
      ),
    ).toBeInTheDocument();
  });
});
