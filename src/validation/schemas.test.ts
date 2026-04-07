import { describe, it, expect } from "vitest";
import { patientSchema, vitalsSchema, soapSchema } from "./schemas";

describe("Patient Schema Validation", () => {
  it("should validate a valid patient with phone", () => {
    const validPatient = {
      givenName: "John",
      familyName: "Doe",
      sex: "male" as const,
      dob: "1990-01-01",
      phone: "08012345678",
      address: "123 Main Street",
      state: "Lagos",
      lga: "Ikeja",
    };

    expect(() => patientSchema.parse(validPatient)).not.toThrow();
  });

  it("should validate a valid patient with email", () => {
    const validPatient = {
      givenName: "John",
      familyName: "Doe",
      sex: "male" as const,
      dob: "1990-01-01",
      email: "john.doe@example.com",
      address: "123 Main Street",
      state: "Lagos",
      lga: "Ikeja",
    };

    // Don't include phone field at all when testing email-only
    expect(() => patientSchema.parse(validPatient)).not.toThrow();
  });

  it("should validate a valid patient with both phone and email", () => {
    const validPatient = {
      givenName: "John",
      familyName: "Doe",
      sex: "male" as const,
      dob: "1990-01-01",
      phone: "08012345678",
      email: "john.doe@example.com",
      address: "123 Main Street",
      state: "Lagos",
      lga: "Ikeja",
    };

    expect(() => patientSchema.parse(validPatient)).not.toThrow();
  });

  it("should reject patient without phone or email", () => {
    const invalidPatient = {
      givenName: "John",
      familyName: "Doe",
      sex: "male" as const,
      dob: "1990-01-01",
      address: "123 Main Street",
      state: "Lagos",
      lga: "Ikeja",
    };

    expect(() => patientSchema.parse(invalidPatient)).toThrow();
  });

  it("should reject patient with empty phone and no email", () => {
    const invalidPatient = {
      givenName: "John",
      familyName: "Doe",
      sex: "male" as const,
      dob: "1990-01-01",
      phone: "",
      address: "123 Main Street",
      state: "Lagos",
      lga: "Ikeja",
    };

    expect(() => patientSchema.parse(invalidPatient)).toThrow();
  });

  it("should reject invalid phone number", () => {
    const invalidPatient = {
      givenName: "John",
      familyName: "Doe",
      sex: "male" as const,
      dob: "1990-01-01",
      phone: "123",
      address: "123 Main Street",
      state: "Lagos",
      lga: "Ikeja",
    };

    expect(() => patientSchema.parse(invalidPatient)).toThrow();
  });

  it("should reject invalid email", () => {
    const invalidPatient = {
      givenName: "John",
      familyName: "Doe",
      sex: "male" as const,
      dob: "1990-01-01",
      email: "invalid-email",
      address: "123 Main Street",
      state: "Lagos",
      lga: "Ikeja",
    };

    expect(() => patientSchema.parse(invalidPatient)).toThrow();
  });

  it("should reject future date of birth", () => {
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);

    const invalidPatient = {
      givenName: "John",
      familyName: "Doe",
      sex: "male" as const,
      dob: futureDate.toISOString().split("T")[0],
      phone: "08012345678",
      address: "123 Main Street",
      state: "Lagos",
      lga: "Ikeja",
    };

    expect(() => patientSchema.parse(invalidPatient)).toThrow();
  });
});

describe("Vitals Schema Validation", () => {
  it("should validate valid vitals", () => {
    const validVitals = {
      heightCm: 170,
      weightKg: 70,
      tempC: 37,
      pulseBpm: 72,
      systolic: 120,
      diastolic: 80,
      spo2: 98,
    };

    expect(() => vitalsSchema.parse(validVitals)).not.toThrow();
  });

  it("should reject systolic lower than diastolic", () => {
    const invalidVitals = {
      systolic: 80,
      diastolic: 120,
    };

    expect(() => vitalsSchema.parse(invalidVitals)).toThrow();
  });

  it("should reject out of range values", () => {
    const invalidVitals = {
      tempC: 50,
    };

    expect(() => vitalsSchema.parse(invalidVitals)).toThrow();
  });
});

describe("SOAP Schema Validation", () => {
  it("should validate complete SOAP note", () => {
    const validSOAP = {
      soapSubjective: "Patient complains of headache",
      soapObjective: "BP 120/80, Temp 37°C",
      soapAssessment: "Tension headache",
      soapPlan: "Prescribe paracetamol 500mg",
    };

    expect(() => soapSchema.parse(validSOAP)).not.toThrow();
  });

  it("should reject incomplete SOAP note", () => {
    const invalidSOAP = {
      soapSubjective: "Patient complains of headache",
      soapObjective: "",
      soapAssessment: "Tension headache",
      soapPlan: "Prescribe paracetamol 500mg",
    };

    expect(() => soapSchema.parse(invalidSOAP)).toThrow();
  });
});
