import { describe, it, expect } from "vitest";
import {
  isSupabaseAuthKey,
  parseActiveProfile,
  parsePortalUser,
  resolveActivePatientId,
} from "./portalSession";

describe("parsePortalUser", () => {
  it("returns null for missing or corrupt data", () => {
    expect(parsePortalUser(null)).toBeNull();
    expect(parsePortalUser("")).toBeNull();
    expect(parsePortalUser("{not json")).toBeNull();
    expect(parsePortalUser("42")).toBeNull();
  });

  it("reads the fields the portal uses", () => {
    const user = parsePortalUser(
      JSON.stringify({
        id: "u1",
        patientId: "p1",
        givenName: "Ada",
        familyName: "Obi",
        managedPatients: [
          {
            patientId: "p2",
            givenName: "Chi",
            familyName: "Obi",
            relationship: "child",
          },
        ],
      }),
    );
    expect(user).toEqual({
      id: "u1",
      patientId: "p1",
      givenName: "Ada",
      familyName: "Obi",
      managedPatients: [
        {
          patientId: "p2",
          givenName: "Chi",
          familyName: "Obi",
          relationship: "child",
        },
      ],
    });
  });

  it("fills missing fields with empty values", () => {
    expect(parsePortalUser("{}")).toEqual({
      id: "",
      patientId: "",
      givenName: "",
      familyName: "",
      managedPatients: [],
    });
  });
});

describe("parseActiveProfile", () => {
  it("needs a patient id", () => {
    expect(parseActiveProfile(JSON.stringify({ givenName: "Chi" }))).toBeNull();
    expect(parseActiveProfile("oops")).toBeNull();
    expect(
      parseActiveProfile(JSON.stringify({ patientId: "p2", givenName: "Chi" })),
    ).toEqual({ patientId: "p2", givenName: "Chi", familyName: "" });
  });
});

describe("resolveActivePatientId", () => {
  const user = {
    patientId: "p1",
    managedPatients: [
      { patientId: "p2", givenName: "", familyName: "", relationship: "" },
    ],
  };

  it("uses the account's own patient when no profile is selected", () => {
    expect(resolveActivePatientId(user, null)).toBe("p1");
  });

  it("allows switching to a managed patient", () => {
    expect(resolveActivePatientId(user, { patientId: "p2" })).toBe("p2");
  });

  it("ignores a profile the account does not manage", () => {
    expect(resolveActivePatientId(user, { patientId: "someone-else" })).toBe(
      "p1",
    );
  });
});

describe("isSupabaseAuthKey", () => {
  it("matches the keys supabase-js stores a sign-in under", () => {
    expect(isSupabaseAuthKey("sb-abcd1234-auth-token")).toBe(true);
    expect(isSupabaseAuthKey("sb-abcd1234-auth-token-code-verifier")).toBe(
      true,
    );
  });

  it("leaves other keys alone", () => {
    expect(isSupabaseAuthKey("patient_portal_user")).toBe(false);
    expect(isSupabaseAuthKey("patient_message_queue")).toBe(false);
    expect(isSupabaseAuthKey("sb-auth-token")).toBe(false);
    expect(isSupabaseAuthKey("my-sb-x-auth-token")).toBe(false);
  });
});
