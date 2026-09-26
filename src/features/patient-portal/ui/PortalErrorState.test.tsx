import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import i18n from "@/i18n";
import { PortalErrorState } from "./PortalErrorState";

describe("PortalErrorState", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("says what could not load and why, and offers a retry", () => {
    const retry = vi.fn();
    render(<PortalErrorState kind="offline" what="your lab results" onRetry={retry} />);
    expect(screen.getByText("You're offline")).toBeInTheDocument();
    expect(
      screen.getByText(
        "We couldn't load your lab results. Check your internet connection and try again.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("tells a slow connection apart from a failed request", () => {
    const { unmount } = render(<PortalErrorState kind="timeout" what="your visits" />);
    expect(screen.getByText("This is taking too long")).toBeInTheDocument();
    unmount();
    render(<PortalErrorState kind="failed" what="your visits" />);
    expect(screen.getByText("We couldn't load your visits")).toBeInTheDocument();
    // A failure is announced straight away.
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("uses the care-team wording when online access is off, with no retry", () => {
    render(<PortalErrorState kind="accessOff" onRetry={vi.fn()} />);
    expect(
      screen.getByText("Your online access is currently unavailable"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Please contact the care team for assistance."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows a busy retry button while retrying", () => {
    render(<PortalErrorState kind="failed" onRetry={vi.fn()} retrying />);
    expect(screen.getByRole("button", { name: "Trying again…" })).toBeDisabled();
  });
});
