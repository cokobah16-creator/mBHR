import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";

const mocks = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  select: vi.fn(),
}));

vi.mock("@/lib/supabaseClient", () => {
  const builder = {
    select: (cols: string) => {
      mocks.select(cols);
      return builder;
    },
    eq: () => builder,
    order: () => Promise.resolve({ data: mocks.rows, error: null }),
  };
  return { isSupabaseEnabled: true, supabase: { from: () => builder } };
});
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => true }));

import { Referrals } from "./Referrals";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  mocks.select.mockClear();
  mocks.rows = [
    {
      id: "r1",
      referring_provider: "Outreach clinic",
      specialist_name: "Bello",
      specialty: "Cardiology",
      reason: "Follow-up",
      referral_date: "2026-09-01",
      status: "pending",
      priority: "urgent",
    },
  ];
  localStorage.setItem(
    "patient_portal_user",
    JSON.stringify({ id: "u1", patientId: "p1", givenName: "Ada", familyName: "O" }),
  );
});

describe("Referrals", () => {
  it("asks only for the columns it shows and lists the referral", async () => {
    render(
      <MemoryRouter>
        <Referrals />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Cardiology")).toBeInTheDocument();
    expect(mocks.select).toHaveBeenCalledWith(expect.not.stringContaining("*"));
    expect(screen.getByText("Dr. Bello")).toBeInTheDocument();
    expect(screen.getByText("Urgent")).toBeInTheDocument();
    expect(screen.getByText("Not booked yet")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Cardiology"));
    expect(screen.getByText("Referral details")).toBeInTheDocument();
    expect(screen.getByText("Action needed:")).toBeInTheDocument();
  });
});
