// The mapping registry: one module per published FHIR resource type,
// stating where it comes from, how its id is formed, what it fills, how it
// can be searched and who may read it (ResourceDefinition), and how it is
// read (ResourceModule). The CapabilityStatement, the gateway's parameter
// allowlists and docs/interoperability/resource-mapping.md are all derived
// from (or checked against) this table, so they cannot drift apart.

import type { FhirResourceType } from "../authorization/permissions";
import type { ResourceDefinition, ResourceModule } from "./module";
import { patientModule } from "./patient";
import { encounterModule } from "./encounter";
import { observationModule } from "./observation";
import { conditionModule } from "./condition";
import { allergyIntoleranceModule } from "./allergyIntolerance";
import { medicationModule } from "./medication";
import { medicationRequestModule } from "./medicationRequest";
import { medicationDispenseModule } from "./medicationDispense";
import { serviceRequestModule } from "./serviceRequest";
import { diagnosticReportModule } from "./diagnosticReport";
import { documentReferenceModule } from "./documentReference";
import { binaryModule } from "./binary";
import { consentModule } from "./consent";
import { practitionerModule } from "./practitioner";
import { practitionerRoleModule } from "./practitionerRole";
import { organizationModule } from "./organization";
import { locationModule } from "./location";
import { provenanceModule } from "./provenance";
import { auditEventModule } from "./auditEvent";

export const MODULES: Record<FhirResourceType, ResourceModule> = {
  Patient: patientModule,
  Encounter: encounterModule,
  Observation: observationModule,
  Condition: conditionModule,
  AllergyIntolerance: allergyIntoleranceModule,
  Medication: medicationModule,
  MedicationRequest: medicationRequestModule,
  MedicationDispense: medicationDispenseModule,
  ServiceRequest: serviceRequestModule,
  DiagnosticReport: diagnosticReportModule,
  DocumentReference: documentReferenceModule,
  Binary: binaryModule,
  Consent: consentModule,
  Practitioner: practitionerModule,
  PractitionerRole: practitionerRoleModule,
  Organization: organizationModule,
  Location: locationModule,
  Provenance: provenanceModule,
  AuditEvent: auditEventModule,
};

export const RESOURCE_DEFINITIONS = Object.fromEntries(
  Object.entries(MODULES).map(([type, m]) => [type, m.definition]),
) as Record<FhirResourceType, ResourceDefinition>;

export const PUBLISHED_TYPES = Object.keys(MODULES) as FhirResourceType[];

export function isPublishedType(t: string): t is FhirResourceType {
  return Object.prototype.hasOwnProperty.call(MODULES, t);
}
