// GET /fhir/R4/metadata: generated from the mapping registry, so it lists
// exactly the resource types, interactions and search parameters the
// gateway serves, and nothing it does not.

import { RESOURCE_DEFINITIONS, PUBLISHED_TYPES } from "../mappers/registry";
import { FHIR_VERSION } from "../types/fhir";

export const SOFTWARE = { name: "mBHR FHIR gateway", version: "0.1.0" } as const;

export function capabilityStatement(baseUrl: string, releaseDate = "2026-09-25") {
  return {
    resourceType: "CapabilityStatement",
    status: "draft",
    date: releaseDate,
    publisher: "Med Bridge Health Reach (mBHR)",
    kind: "instance",
    software: SOFTWARE,
    implementation: {
      description:
        "mBHR FHIR R4 read-only gateway for signed-in mBHR staff. External clients, SMART on FHIR and writes are not available.",
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
            "Bearer token from an mBHR staff sign-in (Supabase session). Access is the intersection of the account's mBHR permissions, row-level security and the purpose-of-use policy (treatment only). Every request is audited.",
        },
        resource: PUBLISHED_TYPES.map((type) => {
          const def = RESOURCE_DEFINITIONS[type];
          return {
            type,
            ...(def.profiles.length ? { supportedProfile: def.profiles } : {}),
            interaction: def.interactions.map((code) => ({ code })),
            versioning: "versioned",
            readHistory: false,
            updateCreate: false,
            conditionalRead: "not-match",
            searchParam: def.searchParams.map((p) => ({
              name: p.name,
              type: p.type,
              documentation: p.documentation,
            })),
          };
        }),
      },
    ],
  };
}
