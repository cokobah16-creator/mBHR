import { describe, it, expect, vi, beforeAll } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import { PortalHome } from "./PortalHome";
import type { HomeExtras } from "./home/homeData";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

function renderHome(props: Partial<Parameters<typeof PortalHome>[0]> = {}) {
  return render(
    <MemoryRouter>
      <PortalHome name="Ada" {...props} />
    </MemoryRouter>,
  );
}

const complete: HomeExtras = { labs: [], unreadMessages: 0, requests: [], outreach: null };

describe("PortalHome", () => {
  it("links the next appointment to the appointments page", () => {
    renderHome({
      nextAppointment: { scheduledAt: new Date("2026-10-02T09:30:00"), type: "Follow-up" },
    });
    expect(screen.getByText("Follow-up")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View appointment" })).toHaveAttribute(
      "href",
      "/patient/appointments",
    );
  });

  it("leaves out What's new where it cannot be loaded", () => {
    renderHome();
    expect(screen.queryByRole("heading", { name: "What's new" })).not.toBeInTheDocument();
  });

  it("says nothing is new only when every block loaded", () => {
    renderHome({ updates: complete });
    expect(screen.getByText("Nothing new right now.")).toBeInTheDocument();
    expect(screen.queryByText("Some updates could not load.")).not.toBeInTheDocument();
  });

  it("lists new results, unread messages and open requests", () => {
    renderHome({
      updates: {
        ...complete,
        unreadMessages: 2,
        labs: [{ resultId: "r1", testName: "Malaria RDT", availableAt: new Date("2026-09-20") }],
        requests: [
          {
            id: "q1",
            kind: "televisit",
            status: "submitted",
            storedStatus: "pending",
            sentAt: new Date("2026-09-24"),
          },
        ],
      },
    });
    expect(screen.getByText("Unread messages: 2")).toBeInTheDocument();
    expect(screen.getByText("Lab result available")).toBeInTheDocument();
    expect(screen.getByText(/Malaria RDT/)).toBeInTheDocument();
    expect(screen.getByText("Video visit request")).toBeInTheDocument();
    expect(screen.queryByText("Nothing new right now.")).not.toBeInTheDocument();
  });

  it("names a block that failed instead of saying nothing is new, and offers a retry", () => {
    const onRetry = vi.fn();
    renderHome({ updates: { ...complete, labs: undefined }, onRetryUpdates: onRetry });
    expect(screen.getByText("Some updates could not load.")).toBeInTheDocument();
    expect(screen.queryByText("Nothing new right now.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("shows the next outreach on the outreach row", () => {
    renderHome({
      updates: {
        ...complete,
        outreach: { id: "o1", name: "", date: "2026-10-01", place: "Zaria" },
      },
    });
    expect(screen.getByText(/^Next: Medical outreach, .*Zaria$/)).toBeInTheDocument();
  });
});
