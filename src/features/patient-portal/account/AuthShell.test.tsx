import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import { AuthShell } from "./AuthShell";

function renderShell() {
  return render(
    <MemoryRouter>
      <AuthShell>
        <p>Form</p>
      </AuthShell>
    </MemoryRouter>,
  );
}

function linkRow(name: string) {
  const nav = screen.getByRole("navigation", { name });
  return within(nav)
    .getAllByRole("link")
    .map((a) => [a.textContent, a.getAttribute("href")]);
}

describe("AuthShell", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("links to the portal home, privacy notice and terms", () => {
    renderShell();
    expect(linkRow("Portal links")).toEqual([
      ["Portal home", "/patient"],
      ["Privacy notice", "/privacy"],
      ["Terms of use", "/terms"],
    ]);
  });

  it("shows the whole link row in the chosen language", async () => {
    await i18n.changeLanguage("ha");
    renderShell();
    expect(linkRow("Hanyoyin tashar majiyyata")).toEqual([
      ["Babban shafin tashar majiyyata", "/patient"],
      ["Sanarwar sirri", "/privacy"],
      ["Sharuɗɗan amfani", "/terms"],
    ]);
  });
});
