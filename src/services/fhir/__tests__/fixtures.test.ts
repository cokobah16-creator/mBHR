// Fixture validation: walks every entry in e2e/fixtures/fhir/golden-bundle.json
// through the in-house US Core 7.0 validator and asserts each resource passes
// without errors. This is the CI-mandatory gate that catches mapper
// regressions and shape drift. The Java HL7 FHIR Validator is the
// out-of-band conformance check (scripts/fhir-validate.sh) and runs
// manually / nightly.

import { describe, expect, it } from "vitest";

import goldenBundle from "../../../../e2e/fixtures/fhir/golden-bundle.json";
import { validateBundle, validateResource } from "../validation/core";
import type { FHIRResource } from "../types";

interface BundleEntry {
  resource: FHIRResource;
}

const bundle = goldenBundle as {
  resourceType: "Bundle";
  entry: BundleEntry[];
};

describe("US Core 7.0 fixture bundle", () => {
  it("loads as a Bundle with at least one entry per supported resource type", () => {
    expect(bundle.resourceType).toBe("Bundle");
    const types = new Set(bundle.entry.map((e) => e.resource.resourceType));
    // Every resource type tefca-ias advertises in /metadata should have at
    // least one fixture.
    expect(types).toEqual(
      new Set([
        "Patient",
        "Observation",
        "Encounter",
        "Condition",
        "AllergyIntolerance",
        "MedicationRequest",
        "MedicationDispense",
        "Immunization",
        "Procedure",
        "DiagnosticReport",
        "DocumentReference",
        "CarePlan",
        "Goal",
        "ServiceRequest",
      ]),
    );
  });

  it.each(bundle.entry)(
    "$resource.resourceType/$resource.id passes the in-house US Core 7.0 validator",
    ({ resource }) => {
      const result = validateResource(resource);
      if (!result.valid) {
        const issues = result.errors
          .map((e) => `[${e.path}] ${e.message}`)
          .join("; ");
        throw new Error(
          `${resource.resourceType}/${resource.id} failed validation: ${issues}`,
        );
      }
      expect(result.valid).toBe(true);
    },
  );

  it("validateBundle produces a clean summary across all fixtures", () => {
    const resources = bundle.entry.map((e) => e.resource);
    const summary = validateBundle(resources);
    expect(summary.invalidResources).toBe(0);
    expect(summary.validResources).toBe(resources.length);
    expect(summary.summary.errors).toBe(0);
  });
});
