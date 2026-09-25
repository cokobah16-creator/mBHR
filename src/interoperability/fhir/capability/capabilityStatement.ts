// GET /fhir/R4/metadata: generated from the resource registry, so it lists
// exactly the resource types, interactions and search parameters the
// gateway serves, and nothing it does not. It claims no profile conformance
// (supportedProfile) the mappers do not guarantee for every instance, no
// SMART or OAuth endpoints, and no write interactions.

import { RESOURCE_DEFINITIONS, PUBLISHED_TYPES } from "../resources/registry";
import { FHIR_VERSION } from "../types/fhir";

export const SOFTWARE = { name: "mBHR FHIR gateway", version: "0.2.0" } as const;

export interface CapabilityOptions {
  /**
   * FHIR_PATIENT_ACCESS_ENABLED: say so in the descriptions, and publish
   * what patients get (each type's patientAccessNotes and each search
   * parameter's patientDocumentation) only when it is on.
   */
  patientAccessEnabled?: boolean;
  /** FHIR_READ_ENABLED: when off, no resource type is listed (only /metadata answers). */
  readEnabled?: boolean;
}

export function capabilityStatement(baseUrl: string, releaseDate = "2026-09-26", opts: CapabilityOptions = {}) {
  const patients = opts.patientAccessEnabled === true;
  const who = patients ? "signed-in mBHR staff, and patients reading their own records" : "signed-in mBHR staff";
  return {
    resourceType: "CapabilityStatement",
    status: "draft",
    date: releaseDate,
    publisher: "Med Bridge Health Reach (mBHR)",
    kind: "instance",
    software: SOFTWARE,
    implementation: {
      description: `mBHR FHIR R4 read-only gateway for ${who}. External clients, SMART on FHIR and writes are not available.`,
      url: baseUrl,
    },
    fhirVersion: FHIR_VERSION,
    format: ["application/fhir+json"],
    rest: [
      {
        mode: "server",
        security: {
          cors: false,
          description: `Bearer token from an mBHR sign-in (Supabase session); no SMART or OAuth tokens are accepted. Access is the intersection of the account's mBHR permissions, row-level security, ${patients ? "the patient's own records for a patient account, " : ""}and the purpose-of-use and consent policy (staff: treatment only). Organisation scoping is not applied: mBHR clinical records carry no organisation yet. Every request is audited before any data is returned.`,
        },
        ...(opts.readEnabled === false ? {} : { resource: resources(patients) }),
      },
    ],
  };
}

function resources(patientAccessEnabled: boolean) {
  return PUBLISHED_TYPES.map((type) => {
    const def = RESOURCE_DEFINITIONS[type];
    // def.source names tables and functions: it stays in the code and the
    // docs, and is not published to unauthenticated callers. What patients
    // get is said only while patient access is on.
    const notes = [...(def.notes ?? []), ...(patientAccessEnabled ? (def.patientAccessNotes ?? []) : [])].join(" ");
    // A Binary read answers with the file itself: no meta.versionId, no
    // ETag, and If-None-Match is not honoured.
    const file = type === "Binary";
    return {
      type,
      ...(notes ? { documentation: notes } : {}),
      interaction: def.interactions.map((code) => ({ code })),
      // meta.versionId is a digest of the resource as served (it changes
      // whenever the served content changes); no history is kept or offered.
      versioning: file ? "no-version" : "versioned",
      readHistory: false,
      updateCreate: false,
      conditionalRead: file ? "not-supported" : "not-match",
      ...(def.searchParams.length
        ? {
            searchParam: def.searchParams.map((p) => ({
              name: p.name,
              type: p.type,
              documentation:
                patientAccessEnabled && p.patientDocumentation
                  ? `${p.documentation} ${p.patientDocumentation}`
                  : p.documentation,
            })),
          }
        : {}),
    };
  });
}
