import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import i18n from "@/i18n";

vi.mock("@/lib/supabaseClient", () => ({ supabase: null, isSupabaseEnabled: false }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => true }));

import { OutreachFinder } from "./OutreachFinder";
import {
  OUTREACH_CACHE_AT_KEY,
  OUTREACH_CACHE_KEY,
  localIsoDate,
} from "./account/outreachCache";

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

  afterEach(() => {
    localStorage.clear();
  });

  it("shows the full address, a directions link and a Today label on a saved list", async () => {
    localStorage.setItem(
      OUTREACH_CACHE_KEY,
      JSON.stringify([
        {
          id: "e1",
          event_name: "Igbodo Medical Outreach",
          event_date: localIsoDate(),
          start_time: "09:00:00",
          end_time: "15:00:00",
          status: "planned",
          sites: {
            name: "Igbodo Health Centre",
            address: "12 Market Road",
            lga: "Ika North East",
            state: "Delta",
          },
        },
      ]),
    );
    localStorage.setItem(OUTREACH_CACHE_AT_KEY, new Date().toISOString());

    render(<OutreachFinder />);
    expect(await screen.findByText("Igbodo Medical Outreach")).toBeInTheDocument();
    expect(screen.getByText("12 Market Road, Ika North East, Delta")).toBeInTheDocument();
    expect(screen.getByText("Today")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Get directions/ });
    expect(link.getAttribute("href")).toContain("google.com/maps/search");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });
});
