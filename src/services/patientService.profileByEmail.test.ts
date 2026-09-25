import { beforeEach, describe, expect, it, vi } from "vitest";

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));

vi.mock("@/lib/supabaseClient", () => ({
  supabase: {
    from: fromMock,
  },
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
}));

import { getPatientProfileByEmail } from "./patientService";
import { MINOR_RECORD_LINK_MESSAGE } from "@/pages/legal/policyMeta";

/** 1 January, ten years ago: someone under 18 whatever today's date is. */
function childDob(): string {
  return `${new Date().getFullYear() - 10}-01-01`;
}

function row(dob: string, authUid: string | null = null) {
  return {
    id: "patient-1",
    auth_uid: authUid,
    given_name: "Kemi",
    family_name: "Obi",
    email: "obi.family@test.com",
    phone: null,
    dob,
    sex: "female",
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("patientService.getPatientProfileByEmail", () => {
  const updateEqMock = vi.fn();
  const updateMock = vi.fn((_values: unknown) => ({ eq: updateEqMock }));

  function lookupFinds(data: unknown) {
    const maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
    fromMock.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
      update: updateMock,
    }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    updateEqMock.mockReturnValue({
      then: (resolve: (v: { error: null }) => unknown) =>
        resolve({ error: null }),
    });
  });

  it("does not link or return a child's record that is not linked yet", async () => {
    lookupFinds(row(childDob()));

    const result = await getPatientProfileByEmail(
      "auth-1",
      "obi.family@test.com",
    );

    expect(result.data).toBeNull();
    expect(result.error).toBe(MINOR_RECORD_LINK_MESSAGE);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("links and returns an adult's record", async () => {
    lookupFinds(row("1985-03-03"));

    const result = await getPatientProfileByEmail(
      "auth-1",
      "obi.family@test.com",
    );

    expect(result.data?.id).toBe("patient-1");
    expect(updateMock).toHaveBeenCalledWith({ auth_uid: "auth-1" });
    expect(updateEqMock).toHaveBeenCalledWith("id", "patient-1");
  });

  it("leaves a record that is already linked as it is", async () => {
    lookupFinds(row(childDob(), "auth-1"));

    const result = await getPatientProfileByEmail(
      "auth-1",
      "obi.family@test.com",
    );

    expect(result.data?.id).toBe("patient-1");
    expect(updateMock).not.toHaveBeenCalled();
  });
});
