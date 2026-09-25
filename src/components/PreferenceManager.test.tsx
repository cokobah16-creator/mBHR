import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    getPatientPreference: vi.fn(),
    createOrUpdatePreference: vi.fn(),
    pushToast: vi.fn(),
  },
}));

vi.mock("../services/preferences", () => ({
  getPatientPreference: (...args: unknown[]) =>
    mocks.getPatientPreference(...args),
  createOrUpdatePreference: (...args: unknown[]) =>
    mocks.createOrUpdatePreference(...args),
}));

vi.mock("../db", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
  generateId: () => "toast-id",
}));

vi.mock("@/stores/auth", () => {
  const state = { currentUser: { role: "nurse" } };
  const useAuthStore = (selector: (s: typeof state) => unknown) =>
    selector(state);
  useAuthStore.getState = () => state;
  return { useAuthStore };
});

vi.mock("@/stores/toast", () => ({
  useToast: () => ({ push: mocks.pushToast }),
}));

vi.mock("@/sync/adapter", () => ({ isOnlineSyncEnabled: () => false }));

import { PreferenceManager } from "./PreferenceManager";

// A preference as enhancedSync stores it after a pull: the server's
// booleans, copied unchanged, instead of this device's 1 and 0.
const PULLED = {
  id: "pref-1",
  patientId: "p1",
  appointmentReminders: true,
  medicationReminders: false,
  createdAt: new Date("2026-09-01T10:00:00"),
  updatedAt: new Date("2026-09-01T10:00:00"),
};

/** The On/Off badge beside a reminder label. */
function reminderBadge(label: string): string | null {
  const row = screen.getByText(label).parentElement as HTMLElement;
  return within(row).getByText(/^(On|Off)$/).textContent;
}

describe("PreferenceManager reminder settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPatientPreference.mockResolvedValue(PULLED);
    mocks.createOrUpdatePreference.mockResolvedValue("pref-1");
  });

  it("shows a setting pulled from the server as true as On", async () => {
    render(<PreferenceManager patientId="p1" />);

    await screen.findByText("Appointment reminders");
    expect(reminderBadge("Appointment reminders")).toBe("On");
    expect(reminderBadge("Medication reminders")).toBe("Off");
  });

  it("keeps a pulled true on when the form is saved", async () => {
    render(<PreferenceManager patientId="p1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Send appointment reminders")).toBeChecked();
    expect(
      screen.getByLabelText("Send medication reminders"),
    ).not.toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));

    await waitFor(() =>
      expect(mocks.createOrUpdatePreference).toHaveBeenCalledTimes(1),
    );
    // Saved in this device's form: 1 for on, 0 for off.
    expect(mocks.createOrUpdatePreference).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: "p1",
        appointmentReminders: 1,
        medicationReminders: 0,
      }),
    );
  });
});
