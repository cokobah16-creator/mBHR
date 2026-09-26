import { describe, it, expect, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import i18n from "@/i18n";
import { EmergencyHelp } from "./EmergencyHelp";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("EmergencyHelp", () => {
  it("keeps the emergency wording and the call link", () => {
    render(<EmergencyHelp onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Emergency help" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Call 112" })).toHaveAttribute("href", "tel:112");
    expect(screen.getByText("112 is Nigeria's free emergency number.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "If someone is badly hurt, cannot breathe, or is very unwell right now, call for help or go to the nearest hospital or health centre.",
      ),
    ).toBeInTheDocument();
  });
});
