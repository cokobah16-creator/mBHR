import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";

// An online deployment where sign-ups are not switched on.
vi.mock("@/lib/supabaseClient", () => ({ supabase: {}, isSupabaseEnabled: true }));

import { PatientPortalLanding } from "./PatientPortalLanding";
import { portalSignupOpen } from "./signupOpen";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("portal sign-up links while sign-ups are closed", () => {
  it("are hidden and point patients to clinic staff", () => {
    expect(portalSignupOpen()).toBe(false);
    render(
      <MemoryRouter>
        <PatientPortalLanding />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link", { name: /Create an account/ })).toBeNull();
    expect(
      screen.getAllByText("New to the portal? Clinic staff can set up your account at your next visit.").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Get your account from the clinic")).toBeInTheDocument();
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href")).not.toBe("/patient/register");
    }
  });
});
