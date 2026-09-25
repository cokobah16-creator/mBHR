import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const { authState, mocks } = vi.hoisted(() => {
  const mocks = {
    needsFirstRunSetup: vi.fn(),
    isOnlineSyncEnabled: vi.fn(),
    setDevicePin: vi.fn(),
  };
  const authState = {
    currentUser: null as null | Record<string, unknown>,
    failedAttempts: 0,
    lockoutUntil: null as number | null,
    login: vi.fn(),
    loginOnline: vi.fn(),
    setCurrentUser: vi.fn(),
  };
  return { authState, mocks };
});

vi.mock("@/stores/auth", () => {
  const useAuthStore = (selector: (state: typeof authState) => unknown) =>
    selector(authState);
  useAuthStore.getState = () => authState;
  return { useAuthStore };
});

vi.mock("@/stores/syncStore", () => ({
  useSyncStore: (selector: (state: { isOnline: boolean }) => unknown) =>
    selector({ isOnline: true }),
}));

vi.mock("@/sync/adapter", () => ({
  isOnlineSyncEnabled: () => mocks.isOnlineSyncEnabled(),
}));

vi.mock("@/db/firstRun", () => ({
  needsFirstRunSetup: () => mocks.needsFirstRunSetup(),
}));

vi.mock("@/db/devicePin", () => ({
  setDevicePin: (...args: unknown[]) => mocks.setDevicePin(...args),
}));

import Login from "./Login";

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/setup" element={<p>Setup page stub</p>} />
        <Route path="/dashboard" element={<p>Dashboard stub</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const FRESH_DEVICE_NOTICE = "No staff account is stored on this device yet.";

describe("Login on a device with no staff account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.currentUser = null;
    authState.failedAttempts = 0;
    authState.lockoutUntil = null;
    mocks.needsFirstRunSetup.mockResolvedValue(true);
    mocks.isOnlineSyncEnabled.mockReturnValue(true);
  });

  it("offers online sign-in and first-run setup instead of redirecting", async () => {
    renderLogin();

    expect(await screen.findByText(FRESH_DEVICE_NOTICE)).toBeInTheDocument();
    expect(screen.queryByText("Setup page stub")).toBeNull();

    // Online is the only sign-in that can work here, so it is selected.
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Offline PIN" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sign In" })).toBeInTheDocument();

    expect(
      screen.getByRole("link", { name: "Set up this device" }),
    ).toHaveAttribute("href", "/setup");
  });

  it("links to the privacy notice and the terms of use", async () => {
    renderLogin();

    expect(await screen.findByText(FRESH_DEVICE_NOTICE)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Privacy notice" }),
    ).toHaveAttribute("href", "/privacy");
    expect(
      screen.getByRole("link", { name: "Terms of use" }),
    ).toHaveAttribute("href", "/terms");
  });

  it("leaves only setup when online sign-in is not built in", async () => {
    mocks.isOnlineSyncEnabled.mockReturnValue(false);
    renderLogin();

    expect(await screen.findByText(FRESH_DEVICE_NOTICE)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign In" })).toBeNull();
    expect(screen.queryByLabelText("PIN")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Set up this device" }),
    ).toHaveAttribute("href", "/setup");
  });

  it("offers a device PIN after an online sign-in adds the person", async () => {
    const signedIn = {
      id: "auth-user-1",
      fullName: "Amina Bello",
      role: "nurse",
      pinHash: "",
      pinSalt: "",
      isActive: 1,
    };
    authState.loginOnline.mockImplementation(async () => {
      authState.currentUser = signedIn;
      return true;
    });
    const withPin = { ...signedIn, pinHash: "hash", pinSalt: "salt" };
    mocks.setDevicePin.mockResolvedValue(withPin);

    renderLogin();
    await screen.findByText(FRESH_DEVICE_NOTICE);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "amina@clinic.ng" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "correct horse" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    expect(
      await screen.findByRole("heading", {
        name: "Choose a PIN for this device",
      }),
    ).toBeInTheDocument();
    expect(authState.loginOnline).toHaveBeenCalledWith(
      "amina@clinic.ng",
      "correct horse",
    );

    fireEvent.change(screen.getByLabelText("New PIN"), {
      target: { value: "482913" },
    });
    fireEvent.change(screen.getByLabelText("Confirm PIN"), {
      target: { value: "482913" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save PIN and continue" }),
    );

    await waitFor(() =>
      expect(screen.getByText("Dashboard stub")).toBeInTheDocument(),
    );
    expect(mocks.setDevicePin).toHaveBeenCalledWith({
      userId: "auth-user-1",
      pin: "482913",
      confirmPin: "482913",
    });
    expect(authState.setCurrentUser).toHaveBeenCalledWith(withPin);
  });

  it("lets the person skip the device PIN", async () => {
    authState.loginOnline.mockImplementation(async () => {
      authState.currentUser = { id: "auth-user-1", pinHash: "" };
      return true;
    });

    renderLogin();
    await screen.findByText(FRESH_DEVICE_NOTICE);
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "amina@clinic.ng" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "correct horse" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
    await screen.findByRole("heading", { name: "Choose a PIN for this device" });

    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));

    await waitFor(() =>
      expect(screen.getByText("Dashboard stub")).toBeInTheDocument(),
    );
    expect(mocks.setDevicePin).not.toHaveBeenCalled();
    expect(authState.setCurrentUser).not.toHaveBeenCalled();
  });
});

describe("Login on a provisioned device", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.currentUser = null;
    mocks.needsFirstRunSetup.mockResolvedValue(false);
    mocks.isOnlineSyncEnabled.mockReturnValue(true);
  });

  it("shows the PIN form and no setup link", async () => {
    renderLogin();

    expect(await screen.findByLabelText("PIN")).toBeInTheDocument();
    expect(screen.queryByText(FRESH_DEVICE_NOTICE)).toBeNull();
    expect(screen.queryByRole("link", { name: "Set up this device" })).toBeNull();
    expect(screen.getByRole("button", { name: "Offline PIN" })).toBeEnabled();
  });

  it("goes straight to the dashboard after an online sign-in by someone with a PIN", async () => {
    authState.loginOnline.mockImplementation(async () => {
      authState.currentUser = { id: "u1", pinHash: "hash", pinSalt: "salt" };
      return true;
    });
    renderLogin();
    await screen.findByLabelText("PIN");

    fireEvent.click(screen.getByRole("button", { name: "Online" }));
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "amina@clinic.ng" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "correct horse" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() =>
      expect(screen.getByText("Dashboard stub")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("heading", { name: "Choose a PIN for this device" }),
    ).toBeNull();
  });
});
