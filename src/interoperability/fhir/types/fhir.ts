// The slice of FHIR R4 (4.0.1) JSON this module produces. Deliberately
// narrow: only elements a mapper in this module actually fills are typed.

export const FHIR_VERSION = "4.0.1";
export const FHIR_JSON = "application/fhir+json";

export interface Coding {
  system?: string;
  version?: string;
  code?: string;
  display?: string;
}

export interface CodeableConcept {
  coding?: Coding[];
  text?: string;
}

export interface Reference {
  reference?: string;
  type?: string;
  identifier?: Identifier;
  display?: string;
}

export interface Identifier {
  use?: "usual" | "official" | "temp" | "secondary" | "old";
  system?: string;
  value?: string;
}

export interface Meta {
  versionId?: string;
  lastUpdated?: string;
  source?: string;
  profile?: string[];
}

export interface Period {
  start?: string;
  end?: string;
}

export interface Quantity {
  value?: number;
  unit?: string;
  system?: string;
  code?: string;
}

export interface Resource {
  resourceType: string;
  id?: string;
  meta?: Meta;
}

export interface HumanName {
  use?: "usual" | "official" | "temp" | "nickname" | "anonymous" | "old" | "maiden";
  text?: string;
  family?: string;
  given?: string[];
}

export interface ContactPoint {
  system?: "phone" | "fax" | "email" | "pager" | "url" | "sms" | "other";
  value?: string;
  use?: "home" | "work" | "temp" | "old" | "mobile";
}

export interface Address {
  use?: "home" | "work" | "temp" | "old" | "billing";
  type?: "postal" | "physical" | "both";
  text?: string;
  line?: string[];
  city?: string;
  district?: string;
  state?: string;
  country?: string;
}

export interface Patient extends Resource {
  resourceType: "Patient";
  identifier?: Identifier[];
  active?: boolean;
  name?: HumanName[];
  telecom?: ContactPoint[];
  gender?: "male" | "female" | "other" | "unknown";
  birthDate?: string;
  address?: Address[];
  link?: { other: Reference; type: "replaced-by" | "replaces" | "refer" | "seealso" }[];
}

export interface Encounter extends Resource {
  resourceType: "Encounter";
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
  class: Coding;
  subject?: Reference;
  period?: Period;
  location?: { location: Reference }[];
}

export interface ObservationComponent {
  code: CodeableConcept;
  valueQuantity?: Quantity;
  dataAbsentReason?: CodeableConcept;
}

export interface Annotation {
  text: string;
  time?: string;
}

export interface Observation extends Resource {
  resourceType: "Observation";
  status:
    | "registered"
    | "preliminary"
    | "final"
    | "amended"
    | "corrected"
    | "cancelled"
    | "entered-in-error"
    | "unknown";
  basedOn?: Reference[];
  category?: CodeableConcept[];
  code: CodeableConcept;
  subject?: Reference;
  encounter?: Reference;
  effectiveDateTime?: string;
  issued?: string;
  valueQuantity?: Quantity;
  valueString?: string;
  dataAbsentReason?: CodeableConcept;
  interpretation?: CodeableConcept[];
  note?: Annotation[];
  referenceRange?: { text?: string }[];
  derivedFrom?: Reference[];
  component?: ObservationComponent[];
}

export interface Condition extends Resource {
  resourceType: "Condition";
  clinicalStatus?: CodeableConcept;
  verificationStatus?: CodeableConcept;
  category?: CodeableConcept[];
  severity?: CodeableConcept;
  code?: CodeableConcept;
  subject: Reference;
  onsetDateTime?: string;
  abatementDateTime?: string;
  recordedDate?: string;
}

export interface OperationOutcomeIssue {
  severity: "fatal" | "error" | "warning" | "information";
  code: string;
  details?: CodeableConcept;
  diagnostics?: string;
}

export interface OperationOutcome extends Resource {
  resourceType: "OperationOutcome";
  issue: OperationOutcomeIssue[];
}

export interface BundleLink {
  relation: "self" | "next" | "previous" | "first" | "last";
  url: string;
}

export interface BundleEntry {
  fullUrl?: string;
  resource: Resource;
  search?: { mode: "match" | "include" | "outcome" };
}

export interface Bundle extends Resource {
  resourceType: "Bundle";
  type: "searchset";
  timestamp?: string;
  total?: number;
  link: BundleLink[];
  entry: BundleEntry[];
}
