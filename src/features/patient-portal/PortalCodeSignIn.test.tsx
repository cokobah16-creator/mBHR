import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  verify: vi.fn(),
  complete: vi.fn(),
}));

vi.mock("@/lib/supabaseClient", () => ({ supabase: { auth: {} } }));

vi.mock("@/services/portalCodeSignIn", async (orig) => {
  const actual = await orig<typeof import("@/services/portalCodeSignIn")>();
  return { ...actual, sendPortalCode: mocks.send, verifyPortalCode: mocks.verify };
});

vi.mock("./account/completeSignIn", () => ({
  completePortalSignIn: mocks.complete,
}));

import { PortalCodeSignIn, RESEND_AFTER_SECONDS } from "./PortalCodeSignIn";
import type { CodeChannel } from "@/services/portalCodeSignIn";

function renderScreen(channels: CodeChannel[] = ["sms", "email"]) {
  return render(
    <MemoryRouter>
      <PortalCodeSignIn channels={channels} />
    </MemoryRouter>,
  );
}

async function sendToPhone(phone = "0803 123 4567") {
  fireEvent.change(screen.getByLabelText(/Phone number/), { target: { value: phone } });
  fireEvent.click(screen.getByRole("button", { name: "Send code" }));
}

function enterCode(code: string) {
  code.split("").forEach((digit, i) => {
    fireEvent.change(screen.getByLabelText(`Digit ${i + 1} of 6`), {
      target: { value: digit },
    });
  });
}

describe("PortalCodeSignIn", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage("en");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("says code sign-in is not available when no channel is switched on", () => {
    renderScreen([]);
    expect(screen.getByText(/not available yet/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Sign in with email and password" }),
    ).toHaveAttribute("href", "/patient/login");
  });

  it("asks for a valid Nigerian mobile number before sending", async () => {
    renderScreen(["sms"]);
    await sendToPhone("12345");
    expect(await screen.findByText(/Enter a Nigerian mobile number/)).toBeInTheDocument();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("sends the code and shows where it went, masked", async () => {
    mocks.send.mockResolvedValue({ ok: true });
    renderScreen();
    await sendToPhone();
    expect(
      await screen.findByRole("heading", { name: "Enter the code we sent you" }),
    ).toBeInTheDocument();
    expect(mocks.send).toHaveBeenCalledWith(expect.anything(), {
      channel: "sms",
      value: "+2348031234567",
    });
    const sentTo = screen.getByText(/We sent a 6-digit code to/);
    expect(sentTo.textContent).toContain("4567");
    expect(sentTo.textContent).not.toContain("8031234567");
  });

  it("says plainly when the code could not be sent and offers email instead", async () => {
    mocks.send.mockResolvedValue({ ok: false, reason: "delivery_failed" });
    renderScreen();
    await sendToPhone();
    expect(await screen.findByText(/We couldn't send the code to/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Enter the code we sent you" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Use email instead" }));
    expect(screen.getByLabelText(/Email address/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Email" })).toHaveAttribute("aria-checked", "true");
  });

  it("explains a wrong or expired code", async () => {
    mocks.send.mockResolvedValue({ ok: true });
    mocks.verify.mockResolvedValue({ ok: false, reason: "invalid" });
    renderScreen();
    await sendToPhone();
    await screen.findByRole("heading", { name: "Enter the code we sent you" });
    enterCode("123456");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText(/wrong or has expired/)).toBeInTheDocument();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("asks for every digit before checking the code", async () => {
    mocks.send.mockResolvedValue({ ok: true });
    renderScreen();
    await sendToPhone();
    await screen.findByRole("heading", { name: "Enter the code we sent you" });
    enterCode("123");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Enter all 6 digits of the code.")).toBeInTheDocument();
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it("finishes the portal sign-in and opens the dashboard", async () => {
    mocks.send.mockResolvedValue({ ok: true });
    mocks.verify.mockResolvedValue({ ok: true });
    mocks.complete.mockResolvedValue({ kind: "allowed" });
    renderScreen();
    await sendToPhone();
    await screen.findByRole("heading", { name: "Enter the code we sent you" });
    enterCode("123456");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("/patient/dashboard", { replace: true }),
    );
    expect(mocks.verify).toHaveBeenCalledWith(
      expect.anything(),
      { channel: "sms", value: "+2348031234567" },
      "123456",
    );
  });

  it("shows the server's reason when the portal refuses the sign-in", async () => {
    mocks.send.mockResolvedValue({ ok: true });
    mocks.verify.mockResolvedValue({ ok: true });
    mocks.complete.mockResolvedValue({
      kind: "refused",
      message: "Your online access is currently unavailable.",
    });
    renderScreen();
    await sendToPhone();
    await screen.findByRole("heading", { name: "Enter the code we sent you" });
    enterCode("123456");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      await screen.findByText("Your online access is currently unavailable."),
    ).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("lets the patient ask for a new code only after the wait", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.send.mockResolvedValue({ ok: true });
    renderScreen();
    await sendToPhone();
    await screen.findByRole("heading", { name: "Enter the code we sent you" });
    expect(screen.getByText(/You can ask for a new code in/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send a new code" })).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime((RESEND_AFTER_SECONDS + 1) * 1000);
    });
    fireEvent.click(screen.getByRole("button", { name: "Send a new code" }));
    expect(await screen.findByText(/We sent a new code/)).toBeInTheDocument();
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });
});
