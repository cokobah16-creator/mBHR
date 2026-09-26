import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { InteropRpcClient } from "@/services/interopRpc";

const { net } = vi.hoisted(() => ({ net: { online: true } }));

vi.mock("@/lib/supabaseClient", () => ({ supabase: null, isSupabaseEnabled: false }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => net.online }));

import { PrivacyConsentSection } from "./PrivacyConsentSection";
import { BANNED_WORDS } from "./privacyCopy";

const ID = "0b6f3c1e-8f7a-4c1d-9a55-2d7f1e3b4c01";
const ID_DENY = "0b6f3c1e-8f7a-4c1d-9a55-2d7f1e3b4c02";
const ID_MIXED = "0b6f3c1e-8f7a-4c1d-9a55-2d7f1e3b4c03";
const ID_ADR = "0b6f3c1e-8f7a-4c1d-9a55-2d7f1e3b4c04";
const ID_TREAT = "0b6f3c1e-8f7a-4c1d-9a55-2d7f1e3b4c05";
const ID_CARE = "0b6f3c1e-8f7a-4c1d-9a55-2d7f1e3b4c06";
const ID_ASK = "0b6f3c1e-8f7a-4c1d-9a55-2d7f1e3b4c07";
const ID_RESEARCH = "0b6f3c1e-8f7a-4c1d-9a55-2d7f1e3b4c08";
const PATIENT = "01HXPAGEPATIENT";

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

const denyRecord = {
  ...activeRecord,
  id: ID_DENY,
  provisions: [{ provision_type: "deny", actor_type: "external_system", purpose: null }],
};
const mixedRecord = {
  ...activeRecord,
  id: ID_MIXED,
  provisions: [
    { provision_type: "permit", actor_type: "external_system", purpose: "PATRQT" },
    { provision_type: "deny", actor_type: "organization", purpose: "HRESCH" },
  ],
};
const adrRecord = { ...activeRecord, id: ID_ADR, scope: "adr", provisions: [] };
/** A "do not" rule for the care team only: not a refusal to share outside mBHR. */
const careTeamDenyRecord = {
  ...activeRecord,
  id: ID_CARE,
  provisions: [{ provision_type: "deny", actor_type: "care_team", purpose: null }],
};
/** A "do not" rule about requests the patient makes. */
const askDenyRecord = {
  ...activeRecord,
  id: ID_ASK,
  provisions: [{ provision_type: "deny", actor_type: "external_system", purpose: "PATRQT" }],
};
const researchDenyRecord = {
  ...activeRecord,
  id: ID_RESEARCH,
  scope: "research",
  provisions: [{ provision_type: "deny", actor_type: "organization", purpose: "HRESCH" }],
};
const treatmentRecord = {
  ...activeRecord,
  id: ID_TREAT,
  scope: "treatment",
  provisions: [{ provision_type: "permit", actor_type: "practitioner", purpose: "TREAT" }],
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
    render(<PrivacyConsentSection patientId={PATIENT} client={client} />);
    expect(
      screen.getByText("The mBHR care team uses your records to care for you."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("It is separate from your sharing choices further down this page."),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/does not share your records/i);
    expect(await screen.findByText("This list is not available yet.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("asks for the page's patient only, and says so plainly when the list is empty", async () => {
    const { client, rpc } = makeClient({
      interop_my_consents: () => ({ data: [], error: null }),
    });
    render(<PrivacyConsentSection patientId={PATIENT} client={client} />);
    expect(await screen.findByText("No choices are recorded here.")).toBeInTheDocument();
    expect(screen.getByText("Your recorded choices")).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("interop_my_consents", { p_patient_id: PATIENT });
  });

  it("does not call the server without a patient id", async () => {
    const { client, rpc } = makeClient({
      interop_my_consents: () => ({ data: [], error: null }),
    });
    render(<PrivacyConsentSection patientId="" client={client} />);
    expect(await screen.findByText("Sign in online to see this list.")).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows a refusal as the patient's refusal, with no Withdraw button", async () => {
    const { client } = makeClient({
      interop_my_consents: () => ({ data: [denyRecord, mixedRecord], error: null }),
    });
    render(<PrivacyConsentSection patientId={PATIENT} client={client} />);
    expect(
      await screen.findByText("You asked us not to share your records outside mBHR"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("You asked us not to share your records outside mBHR (for research)"),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Ask clinic staff if you want to change this\./)).toHaveLength(2);
    expect(screen.getByText(/This choice also allows some sharing\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Withdraw/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Sharing your records outside mBHR/)).not.toBeInTheDocument();
  });

  it("names a refusal only when it is for someone outside mBHR, in plain words", async () => {
    const { client } = makeClient({
      interop_my_consents: () => ({
        data: [careTeamDenyRecord, askDenyRecord, researchDenyRecord],
        error: null,
      }),
    });
    render(<PrivacyConsentSection patientId={PATIENT} client={client} />);
    expect(
      await screen.findByText("You asked us not to use your records for research"),
    ).toBeInTheDocument();
    // The care team rule and the rule about requests the patient makes are
    // not named as a refusal to share outside mBHR.
    expect(screen.getAllByText("A choice about how your records are shared")).toHaveLength(2);
    expect(screen.getAllByText("Ask clinic staff about it.")).toHaveLength(2);
    expect(screen.getAllByText("Ask clinic staff if you want to change this.")).toHaveLength(1);
    expect(screen.queryByText(/outside mBHR/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/when you ask for it|for research \(for research\)/);
    expect(screen.queryByRole("button", { name: /^Withdraw/ })).not.toBeInTheDocument();
  });

  it("never shows a record with no rules as a permission", async () => {
    const { client } = makeClient({
      interop_my_consents: () => ({ data: [{ ...activeRecord, provisions: [] }], error: null }),
    });
    render(<PrivacyConsentSection patientId={PATIENT} client={client} />);
    expect(
      await screen.findByText("A choice about sharing your records outside mBHR"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("It does not say what is allowed. Ask clinic staff about it."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Withdraw/ })).not.toBeInTheDocument();
  });

  it("does not list treatment consents or advance care wishes", async () => {
    const { client } = makeClient({
      interop_my_consents: () => ({ data: [adrRecord, treatmentRecord], error: null }),
    });
    render(<PrivacyConsentSection patientId={PATIENT} client={client} />);
    expect(await screen.findByText("No choices are recorded here.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Withdraw/ })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/future care|for your care/i);
  });

  it("does not call the server while offline", async () => {
    net.online = false;
    const { client, rpc } = makeClient({
      interop_my_consents: () => ({ data: [], error: null }),
    });
    render(<PrivacyConsentSection patientId={PATIENT} client={client} />);
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
    render(<PrivacyConsentSection patientId={PATIENT} client={client} />);

    expect(await screen.findByText(/Sharing your records outside mBHR/)).toBeInTheDocument();
    expect(screen.getByText("In place")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("01HXINTERNALID");

    fireEvent.click(screen.getByRole("button", { name: /^Withdraw:/ }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(
      screen.getByText(
        "mBHR will record that you withdrew this permission. It will no longer count as your permission.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("You cannot undo this here. To give permission again, ask clinic staff."),
    ).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText(/Why are you withdrawing it/), {
      target: { value: "No longer needed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Withdraw permission" }));

    expect(await screen.findByText("Your permission was withdrawn.")).toBeInTheDocument();
    // The page's patient is named, so a sign-in linked to two people
    // withdraws only for the person on this page.
    expect(rpc).toHaveBeenCalledWith("interop_withdraw_consent", {
      p_consent_id: ID,
      p_reason: "No longer needed",
      p_patient_id: PATIENT,
    });
    await waitFor(() => expect(screen.getByText("Withdrawn")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^Withdraw:/ })).not.toBeInTheDocument();
  });

  it("keeps the dialog open with a plain message when withdrawing is not possible yet", async () => {
    const { client } = makeClient({
      interop_my_consents: () => ({ data: [activeRecord], error: null }),
      interop_withdraw_consent: () => ({ data: null, error: { code: "PGRST202" } }),
    });
    render(<PrivacyConsentSection patientId={PATIENT} client={client} />);
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
    render(<PrivacyConsentSection patientId={PATIENT} client={client} />);
    await screen.findByText(/Sharing your records outside mBHR/);
    const text = document.body.textContent ?? "";
    for (const w of BANNED_WORDS) {
      expect(new RegExp(`\\b${w}\\b`, "i").test(text)).toBe(false);
    }
  });
});
