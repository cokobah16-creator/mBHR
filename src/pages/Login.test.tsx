import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const { authState, mocks } = vi.hoisted(() => {
  const mocks = {
    offlineSignInState: vi.fn(),
    deviceAccount: vi.fn(),
    isOnlineSyncEnabled: vi.fn(),
    setDevicePin: vi.fn(),
    pullStaffRoster: vi.fn(),
  };
  const authState = {
    currentUser: null as null | Record<string, unknown>,
    isAuthenticated: false,
    failedAttempts: 0,
    lockoutUntil: null as number | null,
    login: vi.fn(),
    loginOnline: vi.fn(),
    logout: vi.fn(),
    setCurrentUser: vi.fn(),
    signInRefusal: null as null | string,
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

vi.mock("@/sync/staffRoster", () => ({
  pullStaffRoster: () => mocks.pullStaffRoster(),
}));

vi.mock("@/db/offlineAccess", () => ({
  offlineSignInState: () => mocks.offlineSignInState(),
  deviceAccount: (id: string) => mocks.deviceAccount(id),
  hasDevicePin: (u: { pinHash?: string; pinSalt?: string } | null | undefined) =>
    !!u?.pinHash && !!u?.pinSalt,
}));

vi.mock("@/db/devicePin", () => ({
  setDevicePin: (...args: unknown[]) => mocks.setDevicePin(...args),
}));

// The real translations, so the legal links show their English labels.
import "@/i18n";
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

const NOT_SET_UP = "This device hasn't been set up for mBHR yet.";
const NO_PINS =
  "Offline sign-in hasn't been set up on this device yet. Sign in online once to create your offline PIN.";

const ada = {
  id: "u-ada",
  fullName: "Ada Okafor",
  role: "doctor",
  pinHash: "hash",
  pinSalt: "salt",
  isActive: 1,
};
const chidi = {
  id: "u-chidi",
  fullName: "Chidi Eze",
  role: "pharmacist",
  pinHash: "hash2",
  pinSalt: "salt2",
  isActive: 1,
};

function signInOnline() {
  fireEvent.change(screen.getByLabelText(/email/i), {
    target: { value: "amina@clinic.ng" },
  });
  fireEvent.change(screen.getByLabelText(/password/i), {
    target: { value: "correct horse" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.currentUser = null;
  authState.isAuthenticated = false;
  authState.failedAttempts = 0;
  authState.lockoutUntil = null;
  authState.signInRefusal = null;
  mocks.isOnlineSyncEnabled.mockReturnValue(true);
  mocks.pullStaffRoster.mockResolvedValue({ ok: true, staff: 3, deactivated: 0 });
  mocks.deviceAccount.mockResolvedValue(undefined);
});

describe("Login on a device that has never been set up", () => {
  beforeEach(() => {
    mocks.offlineSignInState.mockResolvedValue({ kind: "not-set-up" });
  });

  it("asks for an online sign-in and does not offer local setup", async () => {
    renderLogin();

    expect(await screen.findByText(NOT_SET_UP)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Offline PIN" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: "Set up this device" })).toBeNull();
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

    expect(await screen.findByText(NOT_SET_UP)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign In" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Set up this device" }),
    ).toHaveAttribute("href", "/setup");
  });

  it("syncs the staff list and requires a device PIN after the first online sign-in", async () => {
    const signedIn = { ...ada, pinHash: "", pinSalt: "" };
    authState.loginOnline.mockImplementation(async () => {
      authState.currentUser = signedIn;
      return true;
    });
    mocks.deviceAccount.mockResolvedValue(signedIn);
    const withPin = { ...ada };
    mocks.setDevicePin.mockResolvedValue(withPin);

    renderLogin();
    await screen.findByText(NOT_SET_UP);
    signInOnline();

    expect(
      await screen.findByRole("heading", { name: "Choose a PIN for this device" }),
    ).toBeInTheDocument();
    expect(mocks.pullStaffRoster).toHaveBeenCalled();
    // Enrollment cannot be skipped into the app.
    expect(screen.queryByRole("button", { name: /skip/i })).toBeNull();

    fireEvent.change(screen.getByLabelText("New PIN"), {
      target: { value: "482913" },
    });
    fireEvent.change(screen.getByLabelText("Confirm PIN"), {
      target: { value: "482913" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save PIN and continue" }));

    await waitFor(() =>
      expect(screen.getByText("Dashboard stub")).toBeInTheDocument(),
    );
    expect(mocks.setDevicePin).toHaveBeenCalledWith({
      userId: "u-ada",
      pin: "482913",
      confirmPin: "482913",
    });
    expect(authState.setCurrentUser).toHaveBeenCalledWith(withPin);
  });

  it("signs the person out if they cancel enrollment", async () => {
    authState.loginOnline.mockImplementation(async () => {
      authState.currentUser = { ...ada, pinHash: "", pinSalt: "" };
      return true;
    });

    renderLogin();
    await screen.findByText(NOT_SET_UP);
    signInOnline();
    await screen.findByRole("heading", { name: "Choose a PIN for this device" });

    fireEvent.click(screen.getByRole("button", { name: "Cancel and sign out" }));

    await waitFor(() => expect(authState.logout).toHaveBeenCalled());
    expect(screen.queryByText("Dashboard stub")).toBeNull();
  });
});

describe("Login on a device with staff but no PINs", () => {
  it("keeps Offline PIN visible but disabled, with the reason", async () => {
    mocks.offlineSignInState.mockResolvedValue({ kind: "no-pins", knownStaff: 12 });
    renderLogin();

    expect(await screen.findByText(NO_PINS)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Offline PIN" })).toBeDisabled();
    expect(screen.queryByText(NOT_SET_UP)).toBeNull();
  });
});

describe("Login on a device with enrolled staff", () => {
  beforeEach(() => {
    mocks.offlineSignInState.mockResolvedValue({ kind: "ready", accounts: [ada, chidi] });
  });

  it("asks who is signing in, then checks only that person's PIN", async () => {
    authState.login.mockResolvedValue(true);
    renderLogin();

    expect(await screen.findByText("Who's signing in?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Offline PIN" })).toBeEnabled();
    expect(screen.queryByLabelText("PIN")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Chidi Eze/ }));
    expect(screen.getByText("Signing in as")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "135790" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() =>
      expect(screen.getByText("Dashboard stub")).toBeInTheDocument(),
    );
    expect(authState.login).toHaveBeenCalledWith("u-chidi", "135790");
  });

  it("goes back to the list with Not you?", async () => {
    renderLogin();
    fireEvent.click(await screen.findByRole("button", { name: /Ada Okafor/ }));
    fireEvent.click(screen.getByRole("button", { name: "Not you?" }));
    expect(screen.getByText("Who's signing in?")).toBeInTheDocument();
  });

  it("goes straight to the dashboard after an online sign-in by someone with a PIN", async () => {
    authState.loginOnline.mockImplementation(async () => {
      authState.currentUser = ada;
      return true;
    });
    mocks.deviceAccount.mockResolvedValue(ada);
    renderLogin();
    await screen.findByText("Who's signing in?");

    fireEvent.click(screen.getByRole("button", { name: "Online" }));
    signInOnline();

    await waitFor(() =>
      expect(screen.getByText("Dashboard stub")).toBeInTheDocument(),
    );
  });

  it("resumes enrollment for someone signed in online without a PIN", async () => {
    authState.isAuthenticated = true;
    authState.currentUser = { ...ada, pinHash: "", pinSalt: "" };
    mocks.deviceAccount.mockResolvedValue({ ...ada, pinHash: "", pinSalt: "" });
    renderLogin();

    expect(
      await screen.findByRole("heading", { name: "Choose a PIN for this device" }),
    ).toBeInTheDocument();
  });
});

describe("Login explains refusals and replaces a forgotten PIN", () => {
  beforeEach(() => {
    mocks.offlineSignInState.mockResolvedValue({ kind: "ready", accounts: [ada, chidi] });
  });

  it("says the account was switched off on this device, not that the password is wrong", async () => {
    authState.loginOnline.mockImplementation(async () => {
      authState.signInRefusal = "deactivated_on_device";
      return false;
    });
    renderLogin();
    await screen.findByText("Who's signing in?");
    fireEvent.click(screen.getByRole("button", { name: "Online" }));
    signInOnline();

    expect(
      await screen.findByText("This account is switched off on this device"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Invalid email or password")).not.toBeInTheDocument();
  });

  it("says a server-deactivated account cannot sign in", async () => {
    authState.loginOnline.mockImplementation(async () => {
      authState.signInRefusal = "deactivated";
      return false;
    });
    renderLogin();
    await screen.findByText("Who's signing in?");
    fireEvent.click(screen.getByRole("button", { name: "Online" }));
    signInOnline();

    expect(await screen.findByText("This account has been deactivated")).toBeInTheDocument();
  });

  it("Forgot PIN: signs in online, then asks for a new PIN even though one exists", async () => {
    authState.loginOnline.mockImplementation(async () => {
      authState.currentUser = ada;
      authState.isAuthenticated = true;
      return true;
    });
    mocks.deviceAccount.mockResolvedValue(ada);
    renderLogin();
    await screen.findByText("Who's signing in?");
    fireEvent.click(screen.getByRole("button", { name: /Ada Okafor/ }));
    fireEvent.click(screen.getByRole("button", { name: "Forgot PIN?" }));
    signInOnline();

    expect(
      await screen.findByRole("heading", { name: "Choose a new PIN for this device" }),
    ).toBeInTheDocument();
  });

  it("shows when the chosen person was last verified online", async () => {
    mocks.offlineSignInState.mockResolvedValue({
      kind: "ready",
      accounts: [{ ...ada, lastOnlineVerifiedAt: new Date("2026-09-23T10:00:00Z") }],
    });
    renderLogin();
    await screen.findByText("Who's signing in?");
    fireEvent.click(screen.getByRole("button", { name: /Ada Okafor/ }));

    expect(screen.getByText(/Last verified online: 23 Sep 2026/)).toBeInTheDocument();
  });
});
