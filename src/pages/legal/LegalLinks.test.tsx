import type { ReactElement } from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import { LegalLinks } from "./LegalLinks";

function renderLinks(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("LegalLinks", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("links to the privacy notice and the terms of use", () => {
    renderLinks(<LegalLinks />);
    const nav = screen.getByRole("navigation", { name: "Legal" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Privacy notice", "/privacy"],
      ["Terms of use", "/terms"],
    ]);
  });

  it("shows its labels in the chosen language", async () => {
    await i18n.changeLanguage("ha");
    renderLinks(<LegalLinks />);
    const nav = screen.getByRole("navigation", { name: "Bayanan doka" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((a) => [a.textContent, a.getAttribute("href")]),
    ).toEqual([
      ["Sanarwar sirri", "/privacy"],
      ["Sharuɗɗan amfani", "/terms"],
    ]);
  });

  it("puts extra links first and keeps the separators out of reach of screen readers", () => {
    renderLinks(
      <LegalLinks
        label="Portal links"
        before={[{ to: "/patient", label: "Portal home" }]}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Portal links" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((a) => a.getAttribute("href")),
    ).toEqual(["/patient", "/privacy", "/terms"]);
    const dots = Array.from(nav.querySelectorAll("span"));
    expect(dots).toHaveLength(2);
    for (const dot of dots) {
      expect(dot).toHaveAttribute("aria-hidden");
    }
  });
});
