import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import { PortalMobileNavigation } from "./PortalMobileNavigation";
import type { PortalProfileProps } from "./PortalHeader";

const profile: PortalProfileProps = {
  name: "Chinyere",
  displayName: "Chinyere",
  managedPatients: [],
  activePatientId: null,
  onSelectSelf: vi.fn(),
  onSelectProfile: vi.fn(),
};

function renderNav(pathname = "/patient/dashboard", onSignOut = vi.fn()) {
  render(
    <MemoryRouter initialEntries={[pathname]}>
      <PortalMobileNavigation
        pathname={pathname}
        profile={profile}
        signingOut={false}
        onSignOut={onSignOut}
      />
    </MemoryRouter>,
  );
  return { onSignOut };
}

describe("PortalMobileNavigation", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("shows four places and More, and marks the current page", () => {
    renderNav("/patient/messages");
    const bar = screen.getByRole("navigation", { name: "Portal menu" });
    const links = within(bar).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual([
      "Home",
      "Visits",
      "Messages",
      "Appointments",
    ]);
    expect(within(bar).getByRole("link", { name: "Messages" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(bar).getByRole("button", { name: "More" })).toBeInTheDocument();
  });

  it("opens More as a dialog with the other sections and sign out", () => {
    const { onSignOut } = renderNav();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const sheet = screen.getByRole("dialog", { name: "More" });
    expect(within(sheet).getByRole("link", { name: "Lab Results" })).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "My health data" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close menu" })).toHaveFocus();
    fireEvent.click(within(sheet).getByRole("button", { name: "Logout" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("closes More on Escape and returns focus to the More button", () => {
    renderNav();
    const more = screen.getByRole("button", { name: "More" });
    fireEvent.click(more);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(more).toHaveFocus();
  });
});
