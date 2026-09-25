import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { InteropRpcClient } from "@/services/interopRpc";

const { net } = vi.hoisted(() => ({ net: { online: true } }));

vi.mock("@/lib/supabaseClient", () => ({ supabase: null, isSupabaseEnabled: false }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => net.online }));

import { PrivacyConsentSection } from "./PrivacyConsentSection";
import { BANNED_WORDS } from "./privacyCopy";

const ID = "0b6f3c1e-8f7a-4c1d-9a55-2d7f1e3b4c01";

const activeRecord = {
  id: ID,
  patient_id: "01HXINTERNALID",
  status: "active",
  scope: "patient-privacy",
  category: "sharing",
  effective_from: "2026-01-02T00:00:00Z",
  recorded_at: "2026-01-02T00:00:00Z",
  withdrawn: false,
  withdrawn_at: null,
  provisions: [{ provision_type: "permit", actor_type: "external_system", purpose: "PATRQT" }],
};

function makeClient(handlers: Record<string, () => { data: unknown; error: unknown }>) {
  const rpc = vi.fn((fn: string) => Promise.resolve(handlers[fn]()));
  return { client: { rpc } as unknown as InteropRpcClient, rpc };
}

describe("PrivacyConsentSection", () => {
  beforeEach(() => {
    net.online = true;
  });

  it("explains in plain words and shows a neutral note when the list is not available yet", async () => {
    const { client } = makeClient({
      interop_my_consents: () => ({ data: null, error: { code: "PGRST202", message: "x" } }),
    });
    render(<PrivacyConsentSection client={client} />);
    expect(
      screen.getByText("The mBHR care team uses your records to care for you."),
    ).toBeInTheDocument();
    expect(await screen.findByText("This list is not available yet.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("does not call the server while offline", async () => {
    net.online = false;
    const { client, rpc } = makeClient({
      interop_my_consents: () => ({ data: [], error: null }),
    });
    render(<PrivacyConsentSection client={client} />);
    expect(
      await screen.findByText("You are offline. Connect to the internet to see this list."),
    ).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("lists permissions and withdraws one after confirmation, then refreshes", async () => {
    let withdrawn = false;
    const { client, rpc } = makeClient({
      interop_my_consents: () => ({
        data: [
          withdrawn
            ? {
                ...activeRecord,
                status: "inactive",
                withdrawn: true,
                withdrawn_at: "2026-09-25T10:00:00Z",
              }
            : activeRecord,
        ],
        error: null,
      }),
      interop_withdraw_consent: () => {
        withdrawn = true;
        return { data: true, error: null };
      },
    });
    render(<PrivacyConsentSection client={client} />);

    expect(await screen.findByText(/Sharing your records outside mBHR/)).toBeInTheDocument();
    expect(screen.getByText("In place")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("01HXINTERNALID");

    fireEvent.click(screen.getByRole("button", { name: /^Withdraw:/ }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText(/Why are you withdrawing it/), {
      target: { value: "No longer needed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Withdraw permission" }));

    expect(await screen.findByText("Your permission was withdrawn.")).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("interop_withdraw_consent", {
      p_consent_id: ID,
      p_reason: "No longer needed",
    });
    await waitFor(() => expect(screen.getByText("Withdrawn")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^Withdraw:/ })).not.toBeInTheDocument();
  });

  it("keeps the dialog open with a plain message when withdrawing is not possible yet", async () => {
    const { client } = makeClient({
      interop_my_consents: () => ({ data: [activeRecord], error: null }),
      interop_withdraw_consent: () => ({ data: null, error: { code: "PGRST202" } }),
    });
    render(<PrivacyConsentSection client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: /^Withdraw:/ }));
    fireEvent.click(screen.getByRole("button", { name: "Withdraw permission" }));
    expect(
      await screen.findByText("This cannot be changed here yet. Ask clinic staff to help you."),
    ).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("never shows technical words", async () => {
    const { client } = makeClient({
      interop_my_consents: () => ({ data: [activeRecord], error: null }),
    });
    render(<PrivacyConsentSection client={client} />);
    await screen.findByText(/Sharing your records outside mBHR/);
    const text = document.body.textContent ?? "";
    for (const w of BANNED_WORDS) {
      expect(new RegExp(`\\b${w}\\b`, "i").test(text)).toBe(false);
    }
  });
});
