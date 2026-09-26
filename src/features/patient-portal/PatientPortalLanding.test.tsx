import { describe, it, expect, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import { PatientPortalLanding } from "./PatientPortalLanding";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("PatientPortalLanding", () => {
  it("shows its wording, not message keys", () => {
    render(
      <MemoryRouter>
        <PatientPortalLanding />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Your health record, in your hands." })).toBeInTheDocument();
    expect(screen.getByText("Your medical records")).toBeInTheDocument();
    expect(screen.getByText("Use your record")).toBeInTheDocument();
    expect(screen.getByText("Can I use the portal in an emergency?")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/portal\.landing\./);
  });
});
