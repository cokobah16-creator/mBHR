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

  it.each([
    ["not_allowed", "External sharing: Not allowed"],
    ["allowed", "External sharing: Allowed"],
    ["withdrawn", "External sharing: Withdrawn"],
  ])("shows %s with a note that care is not affected", async (value, label) => {
    const { client, rpc } = makeClient({ data: { external_sharing: value }, error: null });
    render(<ExternalSharingChip patientId="01HXP" client={client} />);
    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(screen.getByTestId("external-sharing-chip")).toHaveAttribute(
      "title",
      "This is about sharing records outside mBHR. It does not affect care.",
    );
    expect(rpc).toHaveBeenCalledWith("interop_consent_summary", { p_patient_id: "01HXP" });
  });

  it("renders nothing when the function is not deployed", async () => {
    const { client, rpc } = makeClient({ data: null, error: { code: "PGRST202" } });
    const { container } = render(<ExternalSharingChip patientId="01HXP" client={client} />);
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("does not call while offline, signed in offline, or for a role without access", () => {
    const { client, rpc } = makeClient({ data: { external_sharing: "allowed" }, error: null });

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
