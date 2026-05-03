// Registry-driven CapabilityStatement generator.
//
// Walks RESOURCE_REGISTRY so that adding a resource to the registry
// automatically reflects in the /metadata response — no second source of
// truth.

import { RESOURCE_REGISTRY } from "./registry.ts";

const BULK_EXPORT_OPERATIONS = [
  {
    name: "export",
    definition: "http://hl7.org/fhir/uv/bulkdata/OperationDefinition/export",
  },
  {
    name: "patient-export",
    definition:
      "http://hl7.org/fhir/uv/bulkdata/OperationDefinition/patient-export",
  },
  {
    name: "group-export",
    definition:
      "http://hl7.org/fhir/uv/bulkdata/OperationDefinition/group-export",
  },
];

const PATIENT_INSTANCE_OPERATIONS = [
  {
    name: "everything",
    definition: "http://hl7.org/fhir/OperationDefinition/Patient-everything",
  },
  {
    name: "match",
    definition: "http://hl7.org/fhir/OperationDefinition/Patient-match",
  },
];

export function createCapabilityStatement(baseUrl: string) {
  return {
    resourceType: "CapabilityStatement",
    id: "mbhr-tefca-capability",
    meta: { lastUpdated: new Date().toISOString() },
    status: "active",
    date: new Date().toISOString(),
    kind: "instance",
    software: { name: "mBHR TEFCA Gateway", version: "2.2.0" },
    implementation: {
      description:
        "Med Bridge Health Reach TEFCA/IAS Endpoint - Nigeria Medical Outreach",
      url: baseUrl,
    },
    fhirVersion: "4.0.1",
    format: ["json"],
    rest: [
      {
        mode: "server",
        security: {
          cors: true,
          service: [
            {
              coding: [
                {
                  system:
                    "http://terminology.hl7.org/CodeSystem/restful-security-service",
                  code: "SMART-on-FHIR",
                },
              ],
            },
          ],
          description: "TEFCA IAS compliant authentication required",
        },
        resource: RESOURCE_REGISTRY.map((r) => {
          const operations =
            r.resourceType === "Patient" ? PATIENT_INSTANCE_OPERATIONS : [];
          return {
            type: r.resourceType,
            profile: r.profile,
            interaction: r.interactions.map((code) => ({ code })),
            searchParam: r.searchParams.map(({ name, type }) => ({
              name,
              type,
            })),
            operation: operations,
          };
        }),
        operation: BULK_EXPORT_OPERATIONS,
      },
    ],
  };
}
