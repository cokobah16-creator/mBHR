import { describe, it, expect } from "vitest";
import { scrubUrl, scrubUrlFields } from "./scrubUrl";

describe("scrubUrl", () => {
  it("drops the query string and the fragment", () => {
    expect(scrubUrl("https://mbhr.app/patient/register?email=a%40b.ng&phone=0803")).toBe(
      "https://mbhr.app/patient/register",
    );
    expect(scrubUrl("/reset-password#access_token=abc&refresh_token=def")).toBe(
      "/reset-password",
    );
    expect(
      scrubUrl("https://abc.supabase.co/rest/v1/patients?select=*&family_name=eq.Bello"),
    ).toBe("https://abc.supabase.co/rest/v1/patients");
  });

  it("replaces record ids in the path", () => {
    expect(scrubUrl("/patients/01J8ZQ3K4V5W6X7Y8Z9A0B1C2D")).toBe("/patients/:id");
    expect(scrubUrl("/vitals/01j8zq3k4v5w6x7y8z9a0b1c2d?tab=bp")).toBe("/vitals/:id");
    expect(
      scrubUrl("https://abc.supabase.co/storage/v1/object/photos/123e4567-e89b-12d3-a456-426614174000/01J8ZQ3K4V5W6X7Y8Z9A0B1C2D.jpg"),
    ).toBe("https://abc.supabase.co/storage/v1/object/photos/:id/:id");
    expect(scrubUrl("/lookup/08031234567")).toBe("/lookup/:id");
  });

  it("keeps ordinary paths as they are", () => {
    expect(scrubUrl("/admin/conflicts")).toBe("/admin/conflicts");
    expect(scrubUrl("https://abc.supabase.co/rest/v1/app_users")).toBe(
      "https://abc.supabase.co/rest/v1/app_users",
    );
    expect(scrubUrl("GET https://abc.supabase.co/auth/v1/user")).toBe(
      "GET https://abc.supabase.co/auth/v1/user",
    );
  });
});

describe("scrubUrlFields", () => {
  it("cleans only the named string fields", () => {
    const data: Record<string, unknown> = {
      from: "/patient/register?phone=0803",
      to: "/patients/01J8ZQ3K4V5W6X7Y8Z9A0B1C2D",
      url: "/x?y=1",
      status_code: 200,
    };
    scrubUrlFields(data, ["from", "to", "status_code"]);
    expect(data).toEqual({
      from: "/patient/register",
      to: "/patients/:id",
      url: "/x?y=1",
      status_code: 200,
    });
  });

  it("accepts missing data", () => {
    expect(() => scrubUrlFields(undefined, ["url"])).not.toThrow();
  });
});
