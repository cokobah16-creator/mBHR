import { describe, it, expect } from "vitest";
import {
  ASSIGNABLE_ROLES,
  staffNameError,
  validateStaffForm,
  describeRoleAccess,
  lostAccess,
  gainedAccess,
  type StaffFormValues,
} from "./staffForm";

const base: StaffFormValues = {
  fullName: "Amina Bello",
  role: "nurse",
  email: "",
  phone: "",
  pin: "482913",
  confirmPin: "482913",
};

describe("validateStaffForm", () => {
  it("accepts a complete new account", () => {
    expect(validateStaffForm(base, "create")).toEqual({});
  });

  it("requires a name", () => {
    expect(validateStaffForm({ ...base, fullName: "  " }, "create").fullName).toBeTruthy();
    expect(validateStaffForm({ ...base, fullName: "A" }, "create").fullName).toBeTruthy();
  });

  it("requires a 6-digit PIN when creating", () => {
    const e = validateStaffForm({ ...base, pin: "", confirmPin: "" }, "create");
    expect(e.pin).toBeTruthy();
    expect(validateStaffForm({ ...base, pin: "12345", confirmPin: "12345" }, "create").pin).toBeTruthy();
    expect(validateStaffForm({ ...base, pin: "12a456", confirmPin: "12a456" }, "create").pin).toBeTruthy();
  });

  it("requires the confirmation to match", () => {
    const e = validateStaffForm({ ...base, confirmPin: "482914" }, "create");
    expect(e.pin).toBeUndefined();
    expect(e.confirmPin).toBeTruthy();
  });

  it("lets an edit keep the current PIN by leaving it blank", () => {
    expect(validateStaffForm({ ...base, pin: "", confirmPin: "" }, "edit")).toEqual({});
  });

  it("checks a new PIN when one is typed during an edit", () => {
    expect(validateStaffForm({ ...base, pin: "123", confirmPin: "" }, "edit").pin).toBeTruthy();
    expect(validateStaffForm({ ...base, pin: "", confirmPin: "123456" }, "edit").pin).toBeTruthy();
  });

  it("checks optional email and phone only when given", () => {
    expect(validateStaffForm({ ...base, email: "not-an-email" }, "create").email).toBeTruthy();
    expect(validateStaffForm({ ...base, email: "amina@example.org" }, "create").email).toBeUndefined();
    expect(validateStaffForm({ ...base, phone: "0803 123 4567" }, "create").phone).toBeUndefined();
    expect(validateStaffForm({ ...base, phone: "+234 803 123 4567" }, "create").phone).toBeUndefined();
    expect(validateStaffForm({ ...base, phone: "12" }, "create").phone).toBeTruthy();
    expect(validateStaffForm({ ...base, phone: "call me" }, "create").phone).toBeTruthy();
  });

  it("lets an administrator give the registration lead role", () => {
    expect(ASSIGNABLE_ROLES).toContain("registration_lead");
    expect(validateStaffForm({ ...base, role: "registration_lead" }, "create").role).toBeUndefined();
  });

  it("allows an existing non-assignable role to be kept on edit", () => {
    expect(validateStaffForm({ ...base, role: "guest" }, "edit").role).toBeUndefined();
    expect(validateStaffForm({ ...base, role: "guest" }, "create").role).toBeTruthy();
  });
});

describe("role access descriptions", () => {
  it("describes what a role can do from the RBAC matrix", () => {
    expect(describeRoleAccess("volunteer")).toBe(
      "Volunteer: can register patients, record vital signs, move patients through the queue and manage patient portal access.",
    );
    expect(describeRoleAccess("guest")).toBe("Guest: no clinical or admin actions.");
    expect(describeRoleAccess("admin")).toContain("manage staff accounts");
  });

  it("describes a registration lead: registration and invitations, no vital signs", () => {
    expect(describeRoleAccess("registration_lead")).toBe(
      "Registration lead: can register patients, move patients through the queue, manage patient portal access and send patient portal invitations.",
    );
    expect(gainedAccess("volunteer", "registration_lead")).toEqual([
      "send patient portal invitations",
    ]);
    expect(lostAccess("volunteer", "registration_lead")).toEqual([
      "record vital signs",
    ]);
    expect(lostAccess("registration_lead", "nurse")).toEqual([
      "send patient portal invitations",
    ]);
  });

  it("lists what a demotion takes away", () => {
    const lost = lostAccess("admin", "nurse");
    expect(lost).toContain("manage staff accounts");
    expect(lost).toContain("dispense medicines");
    expect(lost).not.toContain("record vital signs");
    expect(gainedAccess("admin", "nurse")).toEqual([]);
  });

  it("lists what a promotion adds", () => {
    expect(gainedAccess("nurse", "doctor")).toEqual([
      "document consultations",
      "mark lab results reviewed",
      "release lab results to patients",
    ]);
    expect(lostAccess("nurse", "doctor")).toEqual([]);
  });
});

describe("validateStaffForm in invite mode (Add Staff online)", () => {
  const invite: StaffFormValues = {
    fullName: "Amina Bello",
    role: "nurse",
    email: "amina@example.org",
    phone: "",
    pin: "",
    confirmPin: "",
  };
  const serverRoles = ["volunteer", "nurse", "doctor", "pharmacist"];

  it("accepts a name, an email and a listed role with no PIN", () => {
    expect(validateStaffForm(invite, "invite", serverRoles)).toEqual({});
  });

  it("requires an email address", () => {
    expect(validateStaffForm({ ...invite, email: "  " }, "invite", serverRoles).email).toBeTruthy();
    expect(
      validateStaffForm({ ...invite, email: "not-an-email" }, "invite", serverRoles).email,
    ).toBeTruthy();
  });

  it("ignores the PIN and phone fields", () => {
    const e = validateStaffForm(
      { ...invite, pin: "12", confirmPin: "99", phone: "call me" },
      "invite",
      serverRoles,
    );
    expect(e).toEqual({});
  });

  it("only accepts a role the server listed", () => {
    expect(validateStaffForm({ ...invite, role: "admin" }, "invite", serverRoles).role).toBe(
      "Choose one of the listed roles.",
    );
    expect(
      validateStaffForm({ ...invite, role: "registration_lead" }, "invite", serverRoles).role,
    ).toBeTruthy();
    expect(validateStaffForm({ ...invite, role: "doctor" }, "invite", serverRoles).role).toBeUndefined();
    expect(validateStaffForm({ ...invite, role: "nurse" }, "invite", []).role).toBeTruthy();
  });

  it("checks the name the way the server does", () => {
    expect(validateStaffForm({ ...invite, fullName: "A" }, "invite", serverRoles).fullName).toBeTruthy();
    expect(
      validateStaffForm({ ...invite, fullName: "<b>Amina</b>" }, "invite", serverRoles).fullName,
    ).toBeTruthy();
    expect(
      validateStaffForm({ ...invite, fullName: "x".repeat(121) }, "invite", serverRoles).fullName,
    ).toBeTruthy();
    expect(staffNameError("  Amina   Bello  ")).toBeUndefined();
    expect(staffNameError("")).toBeTruthy();
  });
});
