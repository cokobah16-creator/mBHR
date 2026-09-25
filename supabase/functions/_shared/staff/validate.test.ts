import { describe, it, expect } from "vitest";
import {
  ACTION_FIELDS,
  isUuid,
  isUuidV4,
  normaliseEmail,
  normaliseFullName,
  parseProvisionableRole,
  routeStaffAdminRequest,
  type StaffRoute,
} from "./validate";
import { BODY_MAX_BYTES, STAFF_ADMIN_ACTIONS } from "./constants";

const ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const ID_UPPER = ID.toUpperCase();
// A version 1 uuid: an existing account id that was not made by the app.
const ID_V1 = "c232ab00-9414-11ec-b3c8-9f6bdeced846";
const SMALL = 200;

function route(body: unknown, bytes = SMALL): StaffRoute {
  return routeStaffAdminRequest(body, bytes);
}

function refusedWith(body: unknown, bytes = SMALL) {
  const result = route(body, bytes);
  if (result.kind !== "refused") throw new Error(`expected a refusal, got ${result.kind}`);
  return result;
}

const CREATE = {
  action: "create",
  userId: ID,
  fullName: "  Test   Person ",
  email: " Test.Person@Example.ORG ",
  role: "nurse",
};

describe("normaliseEmail", () => {
  it("trims and lower-cases an address", () => {
    expect(normaliseEmail("  Ada.Obi@Example.ORG ")).toBe("ada.obi@example.org");
  });

  it("refuses a space inside, a missing domain and values that are not text", () => {
    for (const raw of ["ada obi@example.org", "ada@exa mple.org", "ada@example", "ada", "", 42, null, {}]) {
      expect(normaliseEmail(raw)).toBeNull();
    }
  });

  it("accepts 254 characters and refuses 255", () => {
    const domain = "@example.org";
    const ok = `${"a".repeat(254 - domain.length)}${domain}`;
    expect(ok).toHaveLength(254);
    expect(normaliseEmail(ok)).toBe(ok);
    expect(normaliseEmail(`a${ok}`)).toBeNull();
  });

  it("refuses characters that could add a second address", () => {
    for (const raw of ["ada@example.org,bob@example.org", "Ada <ada@example.org>", "ada;@example.org"]) {
      expect(normaliseEmail(raw)).toBeNull();
    }
  });
});

describe("normaliseFullName", () => {
  it("trims and collapses runs of spaces, tabs and line breaks", () => {
    expect(normaliseFullName("  Amaka   Obi ")).toBe("Amaka Obi");
    expect(normaliseFullName("Amaka\t Obi\n")).toBe("Amaka Obi");
  });

  it("keeps accents and apostrophes", () => {
    expect(normaliseFullName("Adébáyọ̀ O'Neil-Okafor")).toBe("Adébáyọ̀ O'Neil-Okafor".normalize("NFC"));
  });

  it("refuses control characters and bidirectional overrides", () => {
    for (const raw of ["Amaka\u0000Obi", "Amaka\u0007Obi", "Amaka\u009bObi", "Amaka‮Obi", "⁦Amaka Obi"]) {
      expect(normaliseFullName(raw)).toBeNull();
    }
  });

  it("refuses < and >", () => {
    expect(normaliseFullName("<b>Amaka</b>")).toBeNull();
    expect(normaliseFullName("Amaka > Obi")).toBeNull();
  });

  it("accepts 2 to 120 characters", () => {
    expect(normaliseFullName("A")).toBeNull();
    expect(normaliseFullName("   A   ")).toBeNull();
    expect(normaliseFullName("Al")).toBe("Al");
    expect(normaliseFullName("a".repeat(120))).toBe("a".repeat(120));
    expect(normaliseFullName("a".repeat(121))).toBeNull();
    expect(normaliseFullName(`  ${"a".repeat(120)}  `)).toBe("a".repeat(120));
  });

  it("refuses values that are not text", () => {
    for (const raw of [undefined, null, 42, ["Amaka"], {}]) expect(normaliseFullName(raw)).toBeNull();
  });
});

describe("parseProvisionableRole", () => {
  it("accepts the roles the Users screen offers", () => {
    for (const role of ["volunteer", "nurse", "doctor", "pharmacist", "admin"]) {
      expect(parseProvisionableRole(role)).toBe(role);
    }
  });

  it("refuses guest, unconfirmed roles and anything else", () => {
    for (const raw of ["guest", "registration_lead", "auditor", "lead_clinician", "superuser", "Nurse", " nurse", "", null, 1]) {
      expect(parseProvisionableRole(raw)).toBeNull();
    }
  });
});

describe("isUuidV4 and isUuid", () => {
  it("accepts a uuid v4 in either case", () => {
    expect(isUuidV4(ID)).toBe(true);
    expect(isUuidV4(ID_UPPER)).toBe(true);
  });

  it("refuses other versions, device ids and junk for a new id", () => {
    expect(isUuidV4(ID_V1)).toBe(false);
    expect(isUuidV4("01HZX3K9V5T6Q8W2E4R7Y1U0IO")).toBe(false); // a device-only ULID
    expect(isUuidV4(`${ID} `)).toBe(false);
    expect(isUuidV4("")).toBe(false);
    expect(isUuidV4(null)).toBe(false);
    expect(isUuidV4("7c9e6679-7425-40de-c44b-e07fc1f90ae7")).toBe(false); // bad variant
  });

  it("accepts any uuid version for an existing account", () => {
    expect(isUuid(ID)).toBe(true);
    expect(isUuid(ID_V1)).toBe(true);
    expect(isUuid("01HZX3K9V5T6Q8W2E4R7Y1U0IO")).toBe(false);
    expect(isUuid("00000000-0000-0000-0000-000000000000")).toBe(false);
  });
});

describe("routeStaffAdminRequest: order of checks", () => {
  it("refuses a body that is too large before anything else", () => {
    const big = refusedWith({ action: "ping", pin: "1234" }, BODY_MAX_BYTES + 1);
    expect(big).toMatchObject({ status: 413, error: "too_large" });
    expect(route({ action: "ping" }, BODY_MAX_BYTES)).toEqual({ kind: "ping" });
    expect(refusedWith({ action: "ping" }, Number.NaN).error).toBe("too_large");
  });

  it("refuses a body that is not an object", () => {
    for (const body of [null, undefined, "ping", 42, true, ["ping"]]) {
      expect(refusedWith(body)).toMatchObject({ status: 400, error: "invalid_request" });
    }
  });

  it("refuses any PIN key before the action is looked at", () => {
    for (const body of [
      { action: "create", pin: "1234" },
      { action: "create", newPin: "1234" },
      { action: "create", PIN: "1234" },
      { action: "made_up", pinHash: "x" },
      { pin: "1234" },
      { action: "ping", extra: { devicePin: "1234" } },
      { action: "ping", extra: [{ Pin: "1234" }] },
    ]) {
      const refused = refusedWith(body);
      expect(refused).toEqual({
        kind: "refused",
        status: 400,
        error: "pin_not_accepted",
        message: "PINs are set on each device, never on the server.",
      });
    }
  });

  it("refuses an unknown or missing action", () => {
    for (const body of [{}, { action: "delete" }, { action: "reset_pin" }, { action: "CREATE" }, { action: 1 }]) {
      expect(refusedWith(body)).toMatchObject({ status: 400, error: "invalid_action" });
    }
    expect(refusedWith({ action: "toString" }).error).toBe("invalid_action");
  });

  it("refuses a field the action does not accept, naming it", () => {
    for (const field of ["adminPermanent", "adminAccess", "phone", "facility"]) {
      expect(refusedWith({ ...CREATE, [field]: true })).toMatchObject({
        status: 400,
        error: "unexpected_field",
        field,
      });
    }
  });

  it("checks field values last", () => {
    expect(refusedWith({ ...CREATE, email: "not an email", adminAccess: true }).error).toBe("unexpected_field");
    expect(refusedWith({ ...CREATE, email: "not an email" })).toMatchObject({
      status: 422,
      error: "invalid_email",
      field: "email",
    });
  });
});

describe("routeStaffAdminRequest: actions", () => {
  it("routes ping and overview, which take no fields", () => {
    expect(route({ action: "ping" })).toEqual({ kind: "ping" });
    expect(route({ action: "overview" })).toEqual({ kind: "overview" });
    expect(refusedWith({ action: "ping", userId: ID })).toMatchObject({ error: "unexpected_field", field: "userId" });
    expect(refusedWith({ action: "overview", version: "1" })).toMatchObject({ error: "unexpected_field" });
  });

  it("routes create with clean values", () => {
    expect(route(CREATE)).toEqual({
      kind: "create",
      userId: ID,
      fullName: "Test Person",
      email: "test.person@example.org",
      role: "nurse",
    });
    expect(route({ ...CREATE, userId: ID_UPPER })).toMatchObject({ kind: "create", userId: ID });
  });

  it("refuses create with a bad id, name, email or role", () => {
    expect(refusedWith({ ...CREATE, userId: ID_V1 })).toMatchObject({ status: 422, error: "invalid_id", field: "userId" });
    expect(refusedWith({ ...CREATE, userId: undefined })).toMatchObject({ error: "invalid_id" });
    expect(refusedWith({ ...CREATE, fullName: "A" })).toMatchObject({ status: 422, error: "invalid_name", field: "fullName" });
    expect(refusedWith({ ...CREATE, email: undefined })).toMatchObject({ error: "invalid_email", field: "email" });
    for (const role of ["guest", "registration_lead", "owner", undefined]) {
      expect(refusedWith({ ...CREATE, role })).toMatchObject({ status: 422, error: "role_not_allowed", field: "role" });
    }
  });

  it("routes the single-account actions", () => {
    for (const action of ["login_status", "resend_invitation", "reset_password", "disable"]) {
      expect(route({ action, userId: ID_V1 })).toEqual({ kind: action, userId: ID_V1 });
      expect(refusedWith({ action, userId: "u1" })).toMatchObject({ error: "invalid_id" });
      expect(refusedWith({ action })).toMatchObject({ error: "invalid_id" });
      expect(refusedWith({ action, userId: ID, role: "nurse" })).toMatchObject({ error: "unexpected_field", field: "role" });
    }
  });

  it("routes reactivate with or without a role", () => {
    expect(route({ action: "reactivate", userId: ID })).toEqual({ kind: "reactivate", userId: ID, role: null });
    expect(route({ action: "reactivate", userId: ID, role: null })).toEqual({ kind: "reactivate", userId: ID, role: null });
    expect(route({ action: "reactivate", userId: ID, role: "doctor" })).toEqual({
      kind: "reactivate",
      userId: ID,
      role: "doctor",
    });
    expect(refusedWith({ action: "reactivate", userId: ID, role: "guest" })).toMatchObject({ error: "role_not_allowed" });
    expect(refusedWith({ action: "reactivate", userId: ID, role: "" })).toMatchObject({ error: "role_not_allowed" });
  });

  it("routes update with a name, a role or both", () => {
    expect(route({ action: "update", userId: ID, fullName: " Test  Person " })).toEqual({
      kind: "update",
      userId: ID,
      fullName: "Test Person",
      role: null,
    });
    expect(route({ action: "update", userId: ID, role: "admin" })).toEqual({
      kind: "update",
      userId: ID,
      fullName: null,
      role: "admin",
    });
    expect(route({ action: "update", userId: ID, fullName: "Test Person", role: "doctor" })).toEqual({
      kind: "update",
      userId: ID,
      fullName: "Test Person",
      role: "doctor",
    });
  });

  it("refuses update with nothing to change", () => {
    for (const body of [
      { action: "update", userId: ID },
      { action: "update", userId: ID, fullName: null, role: null },
    ]) {
      expect(refusedWith(body)).toEqual({
        kind: "refused",
        status: 422,
        error: "nothing_to_update",
        message: "Change their name or role before saving.",
      });
    }
  });

  it("refuses update with a bad name or role, or the admin flags", () => {
    expect(refusedWith({ action: "update", userId: ID, fullName: "<x>" })).toMatchObject({ error: "invalid_name", field: "fullName" });
    expect(refusedWith({ action: "update", userId: ID, fullName: "" })).toMatchObject({ error: "invalid_name" });
    expect(refusedWith({ action: "update", userId: ID, role: "guest" })).toMatchObject({ error: "role_not_allowed", field: "role" });
    for (const field of ["adminAccess", "adminPermanent", "email"]) {
      expect(refusedWith({ action: "update", userId: ID, role: "nurse", [field]: true })).toMatchObject({
        error: "unexpected_field",
        field,
      });
    }
    expect(refusedWith({ action: "update", userId: "nope", role: "nurse" })).toMatchObject({ error: "invalid_id" });
  });

  it("routes create_login", () => {
    expect(
      route({ action: "create_login", userId: ID_V1, email: "Ada@Example.org", confirmFullName: " Ada  Obi " }),
    ).toEqual({ kind: "create_login", userId: ID_V1, email: "ada@example.org", confirmFullName: "Ada Obi" });
    expect(
      refusedWith({ action: "create_login", userId: ID, email: "x", confirmFullName: "Ada Obi" }),
    ).toMatchObject({ error: "invalid_email", field: "email" });
    expect(
      refusedWith({ action: "create_login", userId: ID, email: "ada@example.org", confirmFullName: "A" }),
    ).toMatchObject({ error: "invalid_name", field: "confirmFullName" });
    expect(
      refusedWith({ action: "create_login", userId: ID, email: "ada@example.org", confirmFullName: "Ada Obi", role: "admin" }),
    ).toMatchObject({ error: "unexpected_field", field: "role" });
  });

  it("routes create_staff_record only with the acknowledgement and never as admin", () => {
    const body = {
      action: "create_staff_record",
      userId: ID,
      fullName: "Ada Obi",
      role: "nurse",
      confirmEmail: " ADA@example.org",
      acknowledged: true,
    };
    expect(route(body)).toEqual({
      kind: "create_staff_record",
      userId: ID,
      fullName: "Ada Obi",
      role: "nurse",
      confirmEmail: "ada@example.org",
      acknowledged: true,
    });
    expect(refusedWith({ ...body, role: "admin" })).toMatchObject({ status: 422, error: "role_not_allowed", field: "role" });
    expect(refusedWith({ ...body, confirmEmail: "nope" })).toMatchObject({ error: "invalid_email", field: "confirmEmail" });
    for (const acknowledged of [false, "true", 1, undefined]) {
      expect(refusedWith({ ...body, acknowledged })).toMatchObject({
        status: 422,
        error: "acknowledgement_required",
        field: "acknowledged",
      });
    }
  });

  it("accepts no PIN field on any action", () => {
    expect(Object.keys(ACTION_FIELDS).sort()).toEqual([...STAFF_ADMIN_ACTIONS].sort());
    for (const fields of Object.values(ACTION_FIELDS)) {
      for (const field of fields) expect(field).not.toMatch(/pin/i);
    }
  });

  it("puts a plain-English message on every refusal", () => {
    const refused = refusedWith({ ...CREATE, role: "guest" });
    expect(refused.message).toBe("Choose one of the listed roles.");
  });
});
