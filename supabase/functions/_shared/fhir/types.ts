export interface FHIRResource {
  resourceType: string;
  id?: string;
  meta?: FHIRMeta;
}

export interface FHIRMeta {
  versionId?: string;
  lastUpdated?: string;
  source?: string;
  profile?: string[];
}

export interface FHIRIdentifier {
  use?: "usual" | "official" | "temp" | "secondary" | "old";
  type?: FHIRCodeableConcept;
  system?: string;
  value?: string;
}

export interface FHIRCodeableConcept {
  coding?: FHIRCoding[];
  text?: string;
}

export interface FHIRCoding {
  system?: string;
  version?: string;
  code?: string;
  display?: string;
}

export interface FHIRHumanName {
  use?:
    | "usual"
    | "official"
    | "temp"
    | "nickname"
    | "anonymous"
    | "old"
    | "maiden";
  text?: string;
  family?: string;
  given?: string[];
}

export interface FHIRContactPoint {
  system?: "phone" | "fax" | "email" | "pager" | "url" | "sms" | "other";
  value?: string;
  use?: "home" | "work" | "temp" | "old" | "mobile";
}

export interface FHIRAddress {
  use?: "home" | "work" | "temp" | "old" | "billing";
  type?: "postal" | "physical" | "both";
  text?: string;
  line?: string[];
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface FHIRReference {
  reference?: string;
  type?: string;
  display?: string;
}

export interface FHIRQuantity {
  value?: number;
  unit?: string;
  system?: string;
  code?: string;
}

export interface FHIRPeriod {
  start?: string;
  end?: string;
}

export interface FHIRPatient extends FHIRResource {
  resourceType: "Patient";
  identifier?: FHIRIdentifier[];
  active?: boolean;
  name?: FHIRHumanName[];
  telecom?: FHIRContactPoint[];
  gender?: "male" | "female" | "other" | "unknown";
  birthDate?: string;
  address?: FHIRAddress[];
}

export interface FHIRObservation extends FHIRResource {
  resourceType: "Observation";
  identifier?: FHIRIdentifier[];
  status:
    | "registered"
    | "preliminary"
    | "final"
    | "amended"
    | "corrected"
    | "cancelled"
    | "entered-in-error"
    | "unknown";
  category?: FHIRCodeableConcept[];
  code: FHIRCodeableConcept;
  subject?: FHIRReference;
  effectiveDateTime?: string;
  valueQuantity?: FHIRQuantity;
  component?: FHIRObservationComponent[];
}

export interface FHIRObservationComponent {
  code: FHIRCodeableConcept;
  valueQuantity?: FHIRQuantity;
}

export interface FHIRMedicationRequest extends FHIRResource {
  resourceType: "MedicationRequest";
  identifier?: FHIRIdentifier[];
  status:
    | "active"
    | "on-hold"
    | "cancelled"
    | "completed"
    | "entered-in-error"
    | "stopped"
    | "draft"
    | "unknown";
  intent:
    | "proposal"
    | "plan"
    | "order"
    | "original-order"
    | "reflex-order"
    | "filler-order"
    | "instance-order"
    | "option";
  medicationCodeableConcept?: FHIRCodeableConcept;
  subject: FHIRReference;
  authoredOn?: string;
  dosageInstruction?: FHIRDosage[];
  dispenseRequest?: FHIRDispenseRequest;
}

export interface FHIRDosage {
  text?: string;
  timing?: {
    repeat?: {
      frequency?: number;
      period?: number;
      periodUnit?: string;
    };
  };
  doseAndRate?: {
    doseQuantity?: FHIRQuantity;
  }[];
}

export interface FHIRDispenseRequest {
  numberOfRepeatsAllowed?: number;
  quantity?: FHIRQuantity;
  expectedSupplyDuration?: {
    value?: number;
    unit?: string;
  };
}

export interface FHIREncounter extends FHIRResource {
  resourceType: "Encounter";
  identifier?: FHIRIdentifier[];
  status:
    | "planned"
    | "arrived"
    | "triaged"
    | "in-progress"
    | "onleave"
    | "finished"
    | "cancelled"
    | "entered-in-error"
    | "unknown";
  class: FHIRCoding;
  type?: FHIRCodeableConcept[];
  subject?: FHIRReference;
  period?: FHIRPeriod;
  reasonCode?: FHIRCodeableConcept[];
}

export interface FHIRAnnotation {
  text: string;
  authorString?: string;
  time?: string;
}

export interface FHIRAttachment {
  contentType?: string;
  url?: string;
  data?: string;
  size?: number;
  hash?: string;
  title?: string;
  creation?: string;
}

export interface FHIRAllergyIntolerance extends FHIRResource {
  resourceType: "AllergyIntolerance";
  identifier?: FHIRIdentifier[];
  clinicalStatus?: FHIRCodeableConcept;
  verificationStatus?: FHIRCodeableConcept;
  type?: "allergy" | "intolerance";
  category?: ("food" | "medication" | "environment" | "biologic")[];
  criticality?: "low" | "high" | "unable-to-assess";
  code?: FHIRCodeableConcept;
  patient: FHIRReference;
  onsetDateTime?: string;
  recordedDate?: string;
  reaction?: Array<{
    manifestation: FHIRCodeableConcept[];
    description?: string;
    severity?: "mild" | "moderate" | "severe";
  }>;
  note?: FHIRAnnotation[];
}

export interface FHIRCondition extends FHIRResource {
  resourceType: "Condition";
  identifier?: FHIRIdentifier[];
  clinicalStatus: FHIRCodeableConcept;
  verificationStatus?: FHIRCodeableConcept;
  category?: FHIRCodeableConcept[];
  severity?: FHIRCodeableConcept;
  code: FHIRCodeableConcept;
  subject: FHIRReference;
  encounter?: FHIRReference;
  onsetDateTime?: string;
  abatementDateTime?: string;
  recordedDate?: string;
  note?: FHIRAnnotation[];
}

export interface FHIRImmunization extends FHIRResource {
  resourceType: "Immunization";
  identifier?: FHIRIdentifier[];
  status: "completed" | "entered-in-error" | "not-done";
  vaccineCode: FHIRCodeableConcept;
  patient: FHIRReference;
  encounter?: FHIRReference;
  occurrenceDateTime?: string;
  primarySource?: boolean;
  lotNumber?: string;
  site?: FHIRCodeableConcept;
  route?: FHIRCodeableConcept;
  doseQuantity?: FHIRQuantity;
  protocolApplied?: Array<{
    doseNumberPositiveInt?: number;
    seriesDosesPositiveInt?: number;
  }>;
  note?: FHIRAnnotation[];
}

export interface FHIRDiagnosticReport extends FHIRResource {
  resourceType: "DiagnosticReport";
  identifier?: FHIRIdentifier[];
  status:
    | "registered"
    | "partial"
    | "preliminary"
    | "final"
    | "amended"
    | "corrected"
    | "appended"
    | "cancelled"
    | "entered-in-error"
    | "unknown";
  category?: FHIRCodeableConcept[];
  code: FHIRCodeableConcept;
  subject: FHIRReference;
  encounter?: FHIRReference;
  effectiveDateTime?: string;
  issued?: string;
  result?: FHIRReference[];
  conclusion?: string;
  presentedForm?: FHIRAttachment[];
}

export interface FHIRMedicationDispense extends FHIRResource {
  resourceType: "MedicationDispense";
  identifier?: FHIRIdentifier[];
  status:
    | "preparation"
    | "in-progress"
    | "cancelled"
    | "on-hold"
    | "completed"
    | "entered-in-error"
    | "stopped"
    | "declined"
    | "unknown";
  medicationCodeableConcept?: FHIRCodeableConcept;
  subject: FHIRReference;
  context?: FHIRReference;
  authorizingPrescription?: FHIRReference[];
  quantity?: FHIRQuantity;
  daysSupply?: FHIRQuantity;
  whenHandedOver?: string;
  performer?: Array<{ actor: FHIRReference }>;
  dosageInstruction?: FHIRDosage[];
  note?: FHIRAnnotation[];
}

export interface FHIRProcedure extends FHIRResource {
  resourceType: "Procedure";
  identifier?: FHIRIdentifier[];
  status:
    | "preparation"
    | "in-progress"
    | "not-done"
    | "on-hold"
    | "stopped"
    | "completed"
    | "entered-in-error"
    | "unknown";
  code?: FHIRCodeableConcept;
  subject: FHIRReference;
  encounter?: FHIRReference;
  performedDateTime?: string;
  performedPeriod?: FHIRPeriod;
  performer?: Array<{ actor: FHIRReference }>;
  note?: FHIRAnnotation[];
}

export interface FHIRDocumentReference extends FHIRResource {
  resourceType: "DocumentReference";
  identifier?: FHIRIdentifier[];
  status: "current" | "superseded" | "entered-in-error";
  docStatus?: "preliminary" | "final" | "amended" | "entered-in-error";
  type?: FHIRCodeableConcept;
  category?: FHIRCodeableConcept[];
  subject: FHIRReference;
  date?: string;
  author?: FHIRReference[];
  content: Array<{
    attachment: FHIRAttachment;
    format?: FHIRCoding;
  }>;
  context?: {
    encounter?: FHIRReference[];
    period?: FHIRPeriod;
  };
}

export interface FHIRCarePlan extends FHIRResource {
  resourceType: "CarePlan";
  identifier?: FHIRIdentifier[];
  status:
    | "draft"
    | "active"
    | "on-hold"
    | "revoked"
    | "completed"
    | "entered-in-error"
    | "unknown";
  intent: "proposal" | "plan" | "order" | "option" | "directive";
  category?: FHIRCodeableConcept[];
  title?: string;
  description?: string;
  subject: FHIRReference;
  period?: FHIRPeriod;
  author?: FHIRReference;
  addresses?: FHIRReference[];
  goal?: FHIRReference[];
  note?: FHIRAnnotation[];
}

export interface FHIRGoal extends FHIRResource {
  resourceType: "Goal";
  identifier?: FHIRIdentifier[];
  lifecycleStatus:
    | "proposed"
    | "planned"
    | "accepted"
    | "active"
    | "on-hold"
    | "completed"
    | "cancelled"
    | "entered-in-error"
    | "rejected";
  achievementStatus?: FHIRCodeableConcept;
  category?: FHIRCodeableConcept[];
  description: FHIRCodeableConcept;
  subject: FHIRReference;
  startDate?: string;
  target?: Array<{
    measure?: FHIRCodeableConcept;
    detailQuantity?: FHIRQuantity;
    dueDate?: string;
  }>;
  note?: FHIRAnnotation[];
}

export interface FHIRServiceRequest extends FHIRResource {
  resourceType: "ServiceRequest";
  identifier?: FHIRIdentifier[];
  status:
    | "draft"
    | "active"
    | "on-hold"
    | "revoked"
    | "completed"
    | "entered-in-error"
    | "unknown";
  intent:
    | "proposal"
    | "plan"
    | "directive"
    | "order"
    | "original-order"
    | "reflex-order"
    | "filler-order"
    | "instance-order"
    | "option";
  category?: FHIRCodeableConcept[];
  code?: FHIRCodeableConcept;
  subject: FHIRReference;
  encounter?: FHIRReference;
  occurrenceDateTime?: string;
  occurrencePeriod?: FHIRPeriod;
  requester?: FHIRReference;
  note?: FHIRAnnotation[];
}

export interface FHIRBundle extends FHIRResource {
  resourceType: "Bundle";
  type:
    | "document"
    | "message"
    | "transaction"
    | "transaction-response"
    | "batch"
    | "batch-response"
    | "history"
    | "searchset"
    | "collection";
  total?: number;
  link?: FHIRBundleLink[];
  entry?: FHIRBundleEntry[];
}

export interface FHIRBundleLink {
  relation: string;
  url: string;
}

export interface FHIRBundleEntry {
  fullUrl?: string;
  resource?: FHIRResource;
  search?: {
    mode?: "match" | "include" | "outcome";
    score?: number;
  };
}

export interface FHIRCapabilityStatement extends FHIRResource {
  resourceType: "CapabilityStatement";
  status: "draft" | "active" | "retired" | "unknown";
  date: string;
  kind: "instance" | "capability" | "requirements";
  fhirVersion: string;
  format: string[];
  rest?: FHIRCapabilityStatementRest[];
}

export interface FHIRCapabilityStatementRest {
  mode: "client" | "server";
  resource?: FHIRCapabilityStatementResource[];
}

export interface FHIRCapabilityStatementResource {
  type: string;
  interaction?: { code: string }[];
  searchParam?: { name: string; type: string }[];
}

export interface FHIROperationOutcome extends FHIRResource {
  resourceType: "OperationOutcome";
  issue: FHIROperationOutcomeIssue[];
}

export interface FHIROperationOutcomeIssue {
  severity: "fatal" | "error" | "warning" | "information";
  code: string;
  diagnostics?: string;
  details?: FHIRCodeableConcept;
}

export type ExchangePurpose =
  | "individual-access"
  | "treatment"
  | "payment"
  | "operations";

export interface TEFCARequest {
  requestingOrganization: string;
  qhinId: string;
  exchangePurpose: ExchangePurpose;
  patientIdentifier?: string;
  resourceTypes?: string[];
  dateRange?: {
    start?: string;
    end?: string;
  };
}

export interface TEFCAAuditLog {
  id?: string;
  timestamp: string;
  requestingOrganization: string;
  qhinId: string;
  exchangePurpose: ExchangePurpose;
  patientId?: string;
  resourcesRequested: string[];
  resourcesReturned: number;
  success: boolean;
  errorMessage?: string;
  ipAddress?: string;
  responseTimeMs?: number;
}
