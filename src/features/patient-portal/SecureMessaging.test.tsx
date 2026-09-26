import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  rows: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase", () => {
  const builder = {
    select: (cols: string) => {
      mocks.select(cols);
      return builder;
    },
    eq: () => builder,
    order: () => Promise.resolve({ data: mocks.rows, error: null }),
  };
  return { supabase: { from: () => builder } };
});
vi.mock("@/lib/realtimeAvailable", () => ({ isRealtimeAvailable: () => false }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => true }));

import { SecureMessaging } from "./SecureMessaging";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  mocks.select.mockReset();
  mocks.rows = [
    {
      id: "m1",
      subject: "Your visit",
      body: "Please come on Monday.",
      from_patient: false,
      from_name: "Outreach team",
      created_at: "2026-09-25T10:00:00Z",
      read: false,
      patient_id: "p1",
      staff_id: null,
    },
  ];
  localStorage.setItem(
    "patient_portal_user",
    JSON.stringify({ id: "u1", patientId: "p1", givenName: "Ada", familyName: "O" }),
  );
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/patient/messages"]}>
      <SecureMessaging />
    </MemoryRouter>,
  );
}

describe("SecureMessaging", () => {
  it("reads only the message columns the page shows", async () => {
    renderPage();
    await screen.findByText("Your visit");
    const cols = mocks.select.mock.calls.map((c) => c[0]);
    expect(cols).not.toContain("*");
    expect(cols[0]).not.toMatch(/is_archived/);
  });

  it("shows who a clinic message is from and that it is new", async () => {
    renderPage();
    expect(await screen.findByText("From Outreach team")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
  });
});
