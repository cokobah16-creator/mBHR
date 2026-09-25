import { describe, it, expect } from "vitest";
import {
  isPhoneQuery,
  patientMatchesQuery,
  phoneMatchesQuery,
} from "./patientSearch";

const ngozi = {
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  givenName: "Ngozi",
  familyName: "Eze",
  phone: "+2348031234567",
};

describe("patientMatchesQuery", () => {
  it("finds a stored international number from the local format", () => {
    expect(patientMatchesQuery(ngozi, "08031234567")).toBe(true);
    expect(patientMatchesQuery(ngozi, "0803 123 4567")).toBe(true);
    expect(patientMatchesQuery(ngozi, "0803")).toBe(true);
  });

  it("finds a stored local number from the international format", () => {
    const local = { ...ngozi, phone: "08031234567" };
    expect(patientMatchesQuery(local, "+2348031234567")).toBe(true);
    expect(patientMatchesQuery(local, "2348031234567")).toBe(true);
  });

  it("matches part of a number", () => {
    expect(patientMatchesQuery(ngozi, "4567")).toBe(true);
    expect(patientMatchesQuery(ngozi, "08099999999")).toBe(false);
  });

  it("matches the full name in either order, ignoring extra spaces", () => {
    expect(patientMatchesQuery(ngozi, "Ngozi Eze")).toBe(true);
    expect(patientMatchesQuery(ngozi, " Ngozi")).toBe(true);
    expect(patientMatchesQuery(ngozi, "Eze Ngozi")).toBe(true);
    expect(patientMatchesQuery(ngozi, "  ngozi   eze ")).toBe(true);
    expect(patientMatchesQuery(ngozi, "Ngozi Okafor")).toBe(false);
  });

  it("matches the MBHR ID", () => {
    expect(patientMatchesQuery(ngozi, "MBHR-28950E")).toBe(true);
    expect(patientMatchesQuery(ngozi, "mbhr-28950e")).toBe(true);
  });

  it("does not treat text with a few digits as a phone number", () => {
    expect(patientMatchesQuery(ngozi, "xyz123")).toBe(false);
  });

  it("matches everyone for an empty query", () => {
    expect(patientMatchesQuery(ngozi, "   ")).toBe(true);
  });
});

describe("phone query helpers", () => {
  it("recognises phone-like queries", () => {
    expect(isPhoneQuery("0803")).toBe(true);
    expect(isPhoneQuery("+234 (803) 123-4567")).toBe(true);
    expect(isPhoneQuery("08")).toBe(false);
    expect(isPhoneQuery("Eze 0803")).toBe(false);
  });

  it("does not match a patient with no phone", () => {
    expect(phoneMatchesQuery(null, "0803")).toBe(false);
    expect(phoneMatchesQuery("", "0803")).toBe(false);
  });
});
