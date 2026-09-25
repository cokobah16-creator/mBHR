// GET /fhir/R4/metadata: generated from the resource registry, so it lists
// exactly the resource types, interactions and search parameters the
// gateway serves, and nothing it does not. It claims no profile conformance
// (supportedProfile) the mappers do not guarantee for every instance, no
// SMART or OAuth endpoints, and no write interactions.

import { RESOURCE_DEFINITIONS, PUBLISHED_TYPES } from "../resources/registry";
import { FHIR_VERSION } from "../types/fhir";

export const SOFTWARE = { name: "mBHR FHIR gateway", version: "0.2.0" } as const;

export interface CapabilityOptions {
  /** FHIR_PATIENT_ACCESS_ENABLED: say so in the security description. */
  patientAccessEnabled?: boolean;
  /** FHIR_READ_ENABLED: when off, no resource type is listed (only /metadata answers). */
  readEnabled?: boolean;
}

export function capabilityStatement(baseUrl: string, releaseDate = "2026-09-26", opts: CapabilityOptions = {}) {
  const who = opts.patientAccessEnabled
    ? "signed-in mBHR staff, and patients reading their own records"
    : "signed-in mBHR staff";
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
          description:
            "Bearer token from an mBHR sign-in (Supabase session); no SMART or OAuth tokens are accepted. Access is the intersection of the account's mBHR permissions, row-level security, the patient's own records for a patient account, and the purpose-of-use and consent policy (staff: treatment only). Organisation scoping is not applied: mBHR clinical records carry no organisation yet. Every request is audited before any data is returned.",
        },
        ...(opts.readEnabled === false ? {} : { resource: resources() }),
      },
    ],
  };
}

function resources() {
  return PUBLISHED_TYPES.map((type) => {
    const def = RESOURCE_DEFINITIONS[type];
    const notes = def.notes?.length ? ` ${def.notes.join(" ")}` : "";
    return {
      type,
      documentation: `Source: ${def.source}.${notes}`,
      interaction: def.interactions.map((code) => ({ code })),
      // meta.versionId is a digest of the resource as served (it changes
      // whenever the served content changes); no history is kept or offered.
      versioning: "versioned",
      readHistory: false,
      updateCreate: false,
      conditionalRead: "not-match",
      ...(def.searchParams.length
        ? {
            searchParam: def.searchParams.map((p) => ({
              name: p.name,
              type: p.type,
              documentation: p.documentation,
            })),
          }
        : {}),
    };
  });
}
