import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { AppUpdateBanner } from "./AppUpdateBanner";
import { useAppUpdateStore } from "@/stores/appUpdate";

describe("AppUpdateBanner", () => {
  beforeEach(() => {
    useAppUpdateStore.setState({
      reloadToUpdate: null,
      updatePutOff: false,
      databaseClosed: null,
    });
  });

  it("shows nothing while there is no new version", () => {
    const { container } = render(<AppUpdateBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers the new version and reloads only when asked", () => {
    const reload = vi.fn();
    render(<AppUpdateBanner />);
    act(() => useAppUpdateStore.getState().setUpdateReady(reload));

    expect(screen.getByText(/new version of mBHR is ready/i)).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /reload now/i }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("can be put off until later", () => {
    const reload = vi.fn();
    useAppUpdateStore.getState().setUpdateReady(reload);
    render(<AppUpdateBanner />);

    fireEvent.click(screen.getByRole("button", { name: /later/i }));

    expect(screen.queryByText(/new version of mBHR is ready/i)).toBeNull();
    expect(reload).not.toHaveBeenCalled();

    // News about the update (another window switched to it) shows it again.
    act(() => useAppUpdateStore.getState().setUpdateReady(vi.fn()));
    expect(screen.getByText(/new version of mBHR is ready/i)).toBeInTheDocument();
  });

  it("says this window can no longer save once another window upgraded the database", () => {
    useAppUpdateStore.getState().setUpdateReady(vi.fn());
    useAppUpdateStore.getState().setDatabaseClosed("upgraded");
    render(<AppUpdateBanner />);

    expect(screen.getByRole("alert")).toHaveTextContent(/can no longer save/i);
    expect(screen.queryByRole("button", { name: /later/i })).toBeNull();
  });
});
