import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import i18n from "@/i18n";

vi.mock("@/lib/supabaseClient", () => ({ supabase: null, isSupabaseEnabled: false }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => true }));

import { OutreachFinder } from "./OutreachFinder";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("OutreachFinder", () => {
  it("says plainly when the device is not connected to the calendar", async () => {
    render(<OutreachFinder />);
    expect(
      await screen.findByText(/This device is not connected to the online outreach calendar\./),
    ).toBeInTheDocument();
    expect(screen.getByText(/Ask clinic staff about upcoming outreaches\./)).toBeInTheDocument();
    expect(screen.getByText("No upcoming outreaches listed")).toBeInTheDocument();
  });
});
