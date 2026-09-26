import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { InteropRpcClient } from "@/services/interopRpc";

const { state } = vi.hoisted(() => ({
  state: {
    online: true,
    cloud: "signed_in" as "unknown" | "signed_in" | "signed_out",
    role: "doctor" as string | null,
  },
}));

vi.mock("@/lib/supabaseClient", () => ({ supabase: null, isSupabaseEnabled: false }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => state.online }));
vi.mock("@/lib/cloudSession", () => ({ useCloudSession: () => state.cloud }));
vi.mock("@/stores/auth", () => {
  const useAuthStore = (selector: (s: { currentUser: { role: string } | null }) => unknown) =>
    selector({ currentUser: state.role ? { role: state.role } : null });
  return { useAuthStore };
});

import { ExternalSharingChip } from "./ExternalSharingChip";

function makeClient(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { client: { rpc } as unknown as InteropRpcClient, rpc };
}

describe("ExternalSharingChip", () => {
  beforeEach(() => {
    state.online = true;
    state.cloud = "signed_in";
    state.role = "doctor";
  });

  const NOTE =
    "External access is off in this release, so this is not used to share records yet. It does not affect care.";

  it.each([
    ["allowed", "permitted", "Allowed", "The patient allowed sharing outside mBHR, with no limits."],
    [
      "restricted",
      "refused",
      "Restricted",
      "The patient asked us not to share their records outside mBHR.",
    ],
    ["restricted", "refused_partly", "Restricted", "The patient refused some sharing outside mBHR."],
    [
      "restricted",
      "limited",
      "Restricted",
      "The patient's permission covers only some recipients, records or uses.",
    ],
    ["restricted", "no_permission", "Restricted", "No permission to share outside mBHR is in force."],
    ["withdrawn", "withdrawn", "Withdrawn", "A permission to share outside mBHR was withdrawn."],
  ])("shows %s (%s) with the reason and a note that care is not affected", async (value, reason, word, why) => {
    const { client, rpc } = makeClient({
      data: { sharing_state: value, sharing_reason: reason, external_sharing: "allowed" },
      error: null,
    });
    render(<ExternalSharingChip patientId="01HXP" client={client} />);
    expect(await screen.findByText(`External sharing: ${word}`)).toBeInTheDocument();
    expect(screen.getByTestId("external-sharing-chip")).toHaveAttribute("title", `${why} ${NOTE}`);
    expect(rpc).toHaveBeenCalledWith("interop_consent_summary", { p_patient_id: "01HXP" });
  });

  it("never shows Allowed from the older key alone", async () => {
    const { client, rpc } = makeClient({ data: { external_sharing: "allowed" }, error: null });
    const { container } = render(<ExternalSharingChip patientId="01HXP" client={client} />);
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the function is not deployed", async () => {
    const { client, rpc } = makeClient({ data: null, error: { code: "PGRST202" } });
    const { container } = render(<ExternalSharingChip patientId="01HXP" client={client} />);
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("does not call while offline, signed in offline, or for a role without access", () => {
    const { client, rpc } = makeClient({
      data: { sharing_state: "allowed", sharing_reason: "permitted" },
      error: null,
    });

    state.online = false;
    const a = render(<ExternalSharingChip patientId="01HXP" client={client} />);
    expect(a.container).toBeEmptyDOMElement();
    a.unmount();

    state.online = true;
    state.cloud = "signed_out";
    const b = render(<ExternalSharingChip patientId="01HXP" client={client} />);
    expect(b.container).toBeEmptyDOMElement();
    b.unmount();

    state.cloud = "signed_in";
    state.role = "pharmacist";
    const c = render(<ExternalSharingChip patientId="01HXP" client={client} />);
    expect(c.container).toBeEmptyDOMElement();

    expect(rpc).not.toHaveBeenCalled();
  });
});
