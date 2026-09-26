import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";

vi.mock("./account/portalSession", async (orig) => ({
  ...(await orig<typeof import("./account/portalSession")>()),
  readPortalUser: () => ({ id: "u1", patientId: "p1", givenName: "Ada", familyName: "O" }),
}));
vi.mock("./account/caregiverAccess", async (orig) => ({
  ...(await orig<typeof import("./account/caregiverAccess")>()),
  hasLocalPortalAccount: () => true,
  listManagedPatients: () => [],
  syncSessionManagedPatients: () => {},
}));

import { CaregiverSetup } from "./CaregiverSetup";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("CaregiverSetup", () => {
  it("shows its labels and form errors in words, not keys", async () => {
    render(
      <MemoryRouter>
        <CaregiverSetup />
      </MemoryRouter>,
    );
    expect(screen.getByText("You are not looking after anyone's profile")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "My child" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Review and add/ }));
    expect(await screen.findByText("First name is required")).toBeInTheDocument();
    expect(screen.getByText("Last name is required")).toBeInTheDocument();
  });
});
