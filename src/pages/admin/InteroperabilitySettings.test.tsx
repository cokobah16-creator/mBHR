import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { InteropRpcClient } from "@/services/interopRpc";
import type { FetchLike } from "@/services/interopStatus";

const { state } = vi.hoisted(() => ({
  state: {
    online: true,
    cloud: "signed_in" as "unknown" | "signed_in" | "signed_out",
    role: "admin" as string | null,
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

import { InteroperabilitySettings } from "./InteroperabilitySettings";

const CAPABILITY = {
  resourceType: "CapabilityStatement",
  fhirVersion: "4.0.1",
  software: { version: "0.2.0" },
  implementation: { url: "https://app.example/fhir/R4" },
  rest: [{ resource: [{ type: "Patient" }, { type: "Observation" }] }],
};

function fakeFetch(status: number, body: unknown, flags: string | null): FetchLike {
  return () =>
    Promise.resolve({
      status,
      headers: { get: (n: string) => (n === "X-MBHR-FHIR-Flags" ? flags : null) },
      json: () => Promise.resolve(body),
    });
}

function makeClient(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { client: { rpc } as unknown as InteropRpcClient, rpc };
}

describe("InteroperabilitySettings", () => {
  beforeEach(() => {
    state.online = true;
    state.cloud = "signed_in";
    state.role = "admin";
  });

  it("shows Off for a 404 and a quiet note when request history is not deployed", async () => {
    const { client } = makeClient({ data: null, error: { code: "PGRST202" } });
    const fetchImpl = fakeFetch(404, null, null);
    render(
      <InteroperabilitySettings
        client={client}
        fetchImpl={fetchImpl}
        origin="https://app.example"
      />,
    );
    expect(await screen.findByText("Off")).toBeInTheDocument();
    expect(
      await screen.findByText("Request history is not available on this server yet."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows version, resources, flags and recent activity without ids", async () => {
    const { client } = makeClient({
      data: {
        requests_24h: 5,
        denials_24h: 1,
        requests_7d: 12,
        denials_7d: 2,
        recent: [
          {
            occurred_at: "2026-09-25T10:00:00Z",
            action: "search",
            resource_type: "Observation",
            decision: "permit",
            denial_reason: null,
            actor_role: "doctor",
            http_status: 200,
            patient_ids: ["01HXSECRETPATIENT"],
          },
        ],
        recent_denials: [
          {
            occurred_at: "2026-09-25T09:00:00Z",
            action: "read",
            resource_type: "Patient",
            decision: "deny",
            denial_reason: "insufficient_permission",
            actor_role: "pharmacist",
            http_status: 403,
          },
        ],
        consent: { records: 2, active: 1, withdrawn: 1 },
      },
      error: null,
    });
    const fetchImpl = fakeFetch(
      200,
      CAPABILITY,
      "read=on; patient=off; consent=on; audit=on; external=off; write=off; smart=off",
    );
    render(
      <InteroperabilitySettings
        client={client}
        fetchImpl={fetchImpl}
        origin="https://app.example"
      />,
    );
    expect(await screen.findByText("On")).toBeInTheDocument();
    expect(screen.getByText("4.0.1")).toBeInTheDocument();
    expect(screen.getByText("0.2.0")).toBeInTheDocument();
    expect(screen.getByText("https://app.example/fhir/R4")).toBeInTheDocument();
    expect(screen.getByText("External apps: No")).toBeInTheDocument();
    expect(screen.getByText("SMART: No")).toBeInTheDocument();
    expect(screen.getByText("Writes: No")).toBeInTheDocument();
    expect(screen.getByText("Patient access: Off")).toBeInTheDocument();
    expect(screen.getByText("Consent enforcement: On")).toBeInTheDocument();
    expect(await screen.findByText("Insufficient permission")).toBeInTheDocument();
    expect(screen.getByText("Recent refusals")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("01HXSECRETPATIENT");
  });

  it("treats a missing flags header as unknown", async () => {
    const { client } = makeClient({ data: {}, error: null });
    const fetchImpl = fakeFetch(200, CAPABILITY, null);
    render(
      <InteroperabilitySettings
        client={client}
        fetchImpl={fetchImpl}
        origin="https://app.example"
      />,
    );
    expect(await screen.findByText("External apps: Unknown")).toBeInTheDocument();
    expect(screen.getByText("The server did not report its settings.")).toBeInTheDocument();
  });

  it("does not ask the server for history when not signed in online", async () => {
    state.cloud = "signed_out";
    const { client, rpc } = makeClient({ data: {}, error: null });
    const fetchImpl = fakeFetch(404, null, null);
    render(
      <InteroperabilitySettings
        client={client}
        fetchImpl={fetchImpl}
        origin="https://app.example"
      />,
    );
    expect(await screen.findByText("Sign in online to see request history.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Off")).toBeInTheDocument());
    expect(rpc).not.toHaveBeenCalled();
  });
});
