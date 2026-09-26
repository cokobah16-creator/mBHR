import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import i18n from "@/i18n";
import { PortalField } from "./PortalField";

describe("PortalField", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("labels the control with a visible label, not a placeholder", () => {
    render(
      <PortalField label="Phone number" hint="We send codes to this number.">
        {(props) => <input type="tel" {...props} />}
      </PortalField>,
    );
    const input = screen.getByLabelText("Phone number");
    expect(input).toHaveAccessibleDescription("We send codes to this number.");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("links and announces an error", () => {
    render(
      <PortalField label="Reason for appointment" required error="Tell us why you need to be seen.">
        {(props) => <textarea {...props} />}
      </PortalField>,
    );
    const box = screen.getByRole("textbox", { name: /Reason for appointment/ });
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box).toBeRequired();
    expect(box).toHaveAccessibleDescription("Tell us why you need to be seen.");
    expect(screen.getByRole("alert")).toHaveTextContent("Tell us why you need to be seen.");
  });

  it("marks optional fields in words", () => {
    render(
      <PortalField label="Notes" optional>
        {(props) => <input {...props} />}
      </PortalField>,
    );
    expect(screen.getByText("(optional)")).toBeInTheDocument();
  });
});
