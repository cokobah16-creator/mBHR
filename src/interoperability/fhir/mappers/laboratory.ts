// public.lab_orders + public.lab_results -> ServiceRequest, DiagnosticReport
// and laboratory Observations.
//
// One lab order is one ServiceRequest (id = lab_orders.id) and one
// DiagnosticReport (the same id). Each current result row (one not replaced
// by a newer result through superseded_by) is one Observation with id
// "lab-<lab_results.id>". The value, unit, range and interpretation live only
// in the Observation; the report lists its Observations and carries a
// status, never a copy of a value.
//
// Clinical safety rules (each is listed in CLINICAL_LOGIC_CHANGES.md):
//   - Nothing is final before a clinician reviewed it. A result is
//     "preliminary" until reviewed_at is set (with an interpretation and a
//     value recorded), then "final". A report is "partial" while any current
//     result is not reviewed, "final" only when all are. The order status
//     never decides either: the app marks an order "completed" as soon as a
//     result is typed in, before review.
//   - A cancelled order is "revoked" (ServiceRequest) or "cancelled"
//     (DiagnosticReport, when it has no result), never completed or final.
//   - Values are published as recorded. valueQuantity only when the value
//     is a plain decimal number that JSON can carry without changing it AND
//     a unit is recorded; the unit gets a UCUM code only from the short,
//     exact-match table below. Anything else ("<0.5", "1:80", "12,5",
//     "Positive", a number without a unit) is valueString: the recorded
//     value, followed by the recorded unit after one space when there is
//     one, as the patient portal shows it. Nothing is parsed.
//   - Interpretation: normal -> N, abnormal -> A, critical -> AA (critical
//     abnormal). mBHR stores no direction, so never H, L, HH or LL; a
//     critical result is never shown as merely abnormal. A missing value is
//     left out, never "normal". An unreviewed "normal" is left out too: old
//     rows may carry the form's former default instead of a choice.
//   - The reference range is published as text only, never parsed.
//   - The test is published as recorded (code.text). A local code under
//     https://mbhr.app/codes/lab-test is added only when the order carries
//     an unchanged quick pick (the code AND the name both match the order
//     form's catalogue), because editing the name after a quick pick keeps
//     the old code. No LOINC is published: no lab code is verified.
//   - Never published: the ordering, entering, reviewing, releasing or
//     withholding accounts (auth uids), clinical notes, staff notes,
//     withheld reasons, patient notes, specimen type (never written by the
//     app), internal patient ids. The requester is a Practitioner reference
//     only when the staff directory resolves the ordering account.
//
// Mappers are pure: rows in, FHIR out. The resource modules fetch the rows.

import type { CodeableConcept, Coding, Observation, Quantity, Reference, Resource } from "../types/fhir";
import { MBHR_CODES, OBSERVATION_CATEGORY, UCUM } from "../terminology/codeSystems";
import { applyStatusMap } from "../terminology/statusMaps";
import {
  DIAGNOSTIC_REPORT_STATUS,
  LAB_INTERPRETATION,
  LAB_OBSERVATION_STATUS,
  SERVICE_REQUEST_PRIORITY,
  SERVICE_REQUEST_STATUS,
  type DiagnosticReportStatus,
  type LabInterpretationCode,
  type ServiceRequestPriority,
  type ServiceRequestStatus,
} from "../terminology/status/laboratory";
import { FHIR_ID } from "../search/params";
import { DATA_ABSENT_REASON } from "./observation";
import { instant, patientReference, str, versionMeta, type MapContext, type Row } from "./common";

// ---------------------------------------------------------------------------
// Resource shapes (only the elements these mappers fill)
// ---------------------------------------------------------------------------

export interface ServiceRequest extends Resource {
  resourceType: "ServiceRequest";
  status: ServiceRequestStatus;
  intent: "order";
  priority?: ServiceRequestPriority;
  code?: CodeableConcept;
  subject: Reference;
  encounter?: Reference;
  authoredOn?: string;
  requester?: Reference;
}

export interface DiagnosticReport extends Resource {
  resourceType: "DiagnosticReport";
  basedOn?: Reference[];
  status: DiagnosticReportStatus;
  category?: CodeableConcept[];
  code: CodeableConcept;
  subject: Reference;
  encounter?: Reference;
  effectiveDateTime?: string;
  issued?: string;
  result?: Reference[];
}

// ---------------------------------------------------------------------------
// Code systems and codes
// ---------------------------------------------------------------------------

/** mBHR's local laboratory test codes (the order form's quick picks). */
export const LAB_TEST_SYSTEM = `${MBHR_CODES}/lab-test`;
/** mBHR's own interpretation values, published next to the v3 code. */
export const LAB_INTERPRETATION_SYSTEM = `${MBHR_CODES}/lab-interpretation`;
/** R4 Observation.interpretation (extensible binding). */
export const V3_OBSERVATION_INTERPRETATION = "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation";
/** R4 DiagnosticReport.category example binding: HL7 v2 table 0074, diagnostic service section. */
export const V2_DIAGNOSTIC_SERVICE_SECTION = "http://terminology.hl7.org/CodeSystem/v2-0074";

/** Observation ids of laboratory results: "lab-<lab_results.id>". */
export const LAB_OBSERVATION_PREFIX = "lab-";

/** A uuid as Postgres prints it (lower case). An upper-case id is a different FHIR id and matches nothing. */
export const LOWER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The order form's quick-pick tests (src/features/labs/LabOrderForm.tsx,
 * commonTests), exactly as the form stores them. "MRDTrunc" is kept as
 * stored (it is probably meant to read "MRDT"): renaming it here would
 * publish a code no order carries. Changing this list changes published
 * codings; a clinician and a terminology reviewer should approve it.
 */
export const LAB_TEST_CATALOGUE: readonly { code: string; name: string }[] = [
  { code: "CBC", name: "Complete Blood Count (CBC)" },
  { code: "BMP", name: "Basic Metabolic Panel" },
  { code: "CMP", name: "Comprehensive Metabolic Panel" },
  { code: "LIPID", name: "Lipid Panel" },
  { code: "HBA1C", name: "Hemoglobin A1C" },
  { code: "TSH", name: "Thyroid Stimulating Hormone" },
  { code: "UA", name: "Urinalysis" },
  { code: "GLUCOSE", name: "Blood Glucose" },
  { code: "LFT", name: "Liver Function Tests" },
  { code: "RFT", name: "Kidney Function Tests" },
  { code: "HIV", name: "HIV Test" },
  { code: "HBSAG", name: "Hepatitis B Surface Antigen" },
  { code: "MRDTrunc", name: "Malaria Rapid Test" },
  { code: "PREG", name: "Pregnancy Test" },
  { code: "STOOL", name: "Stool Analysis" },
];

/**
 * Units that get a UCUM code: only these exact, case-sensitive strings,
 * each of which is itself a valid UCUM code with the same meaning as typed
 * (https://ucum.org/ucum). Anything else ("g/dl ", "x10^9/L", "mEq/L",
 * "mIU/mL", "IU/L") is published as the unit text only, with no system:
 * a UCUM code is never guessed from a free-text unit.
 */
export const UCUM_UNITS: ReadonlyMap<string, string> = new Map(
  ["%", "g/dL", "g/L", "mg/dL", "mg/L", "mmol/L", "umol/L", "U/L", "fL", "pg", "mm/h", "10*9/L", "10*12/L"].map((u) => [u, u]),
);

const V3_DISPLAY: Record<LabInterpretationCode, string> = { N: "Normal", A: "Abnormal", AA: "Critical abnormal" };
const LOCAL_INTERPRETATION_DISPLAY: Record<string, string> = { normal: "Normal", abnormal: "Abnormal", critical: "Critical" };

const LABORATORY_CATEGORY: CodeableConcept[] = [
  { coding: [{ system: OBSERVATION_CATEGORY, code: "laboratory", display: "Laboratory" }], text: "Laboratory" },
];
const LAB_REPORT_CATEGORY: CodeableConcept[] = [
  { coding: [{ system: V2_DIAGNOSTIC_SERVICE_SECTION, code: "LAB", display: "Laboratory" }], text: "Laboratory" },
];
const VALUE_NOT_RECORDED: CodeableConcept = { coding: [{ system: DATA_ABSENT_REASON, code: "unknown", display: "Unknown" }] };

// ---------------------------------------------------------------------------
// Columns read
// ---------------------------------------------------------------------------

/** lab_orders columns the report and the result Observations need (no account ids, no notes). */
export const LAB_ORDER_COLUMNS = [
  "id",
  "patient_id",
  "visit_id",
  "test_name",
  "test_code",
  "priority",
  "status",
  "ordered_at",
  "collected_at",
  "created_at",
  "updated_at",
] as const;

/** ServiceRequest also reads ordered_by, only to look it up in the staff directory. */
export const SERVICE_REQUEST_COLUMNS = [...LAB_ORDER_COLUMNS, "ordered_by"] as const;

/** lab_results columns (no staff ids, notes, withheld reasons or patient notes). */
export const LAB_RESULT_COLUMNS = [
  "id",
  "order_id",
  "result_value",
  "result_unit",
  "reference_range",
  "interpretation",
  "result_date",
  "reviewed_at",
  "created_at",
  "updated_at",
] as const;

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/** The catalogue entry an order carries unchanged (code AND name match exactly), or null. */
export function catalogueEntry(order: Row): { code: string; name: string } | null {
  const code = order.test_code;
  const name = order.test_name;
  if (typeof code !== "string" || typeof name !== "string") return null;
  return LAB_TEST_CATALOGUE.find((e) => e.code === code && e.name === name) ?? null;
}

/** The test as ordered: its name as text, plus the local code for an unchanged quick pick. */
export function labTestConcept(order: Row): CodeableConcept | null {
  const name = str(order, "test_name");
  if (!name) return null;
  const entry = catalogueEntry(order);
  return entry ? { coding: [{ system: LAB_TEST_SYSTEM, code: entry.code, display: entry.name }], text: name } : { text: name };
}

function encounterReference(order: Row): Reference | undefined {
  // The foreign key guarantees the visit exists; an id FHIR cannot carry is left out.
  const visitId = str(order, "visit_id");
  return visitId && FHIR_ID.test(visitId) ? { reference: `Encounter/${visitId}` } : undefined;
}

function orderId(order: Row): string | null {
  const id = order.id;
  return typeof id === "string" && LOWER_UUID.test(id) ? id : null;
}

/** A synthetic row whose updated_at is the latest change among the rows (for meta.lastUpdated). */
function latest(rows: Row[]): Row {
  let best: string | undefined;
  for (const r of rows) {
    const t = instant(r, "updated_at") ?? instant(r, "created_at");
    if (t && (!best || Date.parse(t) > Date.parse(best))) best = t;
  }
  return best ? { updated_at: best } : {};
}

function latestInstant(rows: Row[], column: string): string | undefined {
  let best: string | undefined;
  for (const r of rows) {
    const t = instant(r, column);
    if (t && (!best || Date.parse(t) > Date.parse(best))) best = t;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Result review state, value and interpretation
// ---------------------------------------------------------------------------

export type LabReviewState = "reviewed" | "review_incomplete" | "unreviewed";

/** The recorded value exactly as stored, or undefined when nothing (or only spaces) is recorded. */
function recordedValue(result: Row): string | undefined {
  const v = result.result_value;
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

/** The interpretation the app writes (normal, abnormal, critical), lower case, or undefined. */
function recordedInterpretation(result: Row): string | undefined {
  return applyStatusMap(LAB_INTERPRETATION, result.interpretation) ? String(result.interpretation).toLowerCase() : undefined;
}

/** See terminology/status/laboratory.ts for what each state means. */
export function resultReviewState(result: Row): LabReviewState {
  if (!instant(result, "reviewed_at")) return "unreviewed";
  if (!recordedInterpretation(result) || recordedValue(result) === undefined) return "review_incomplete";
  return "reviewed";
}

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * The number a plain decimal text stands for, or undefined when the text is
 * not a plain decimal or JSON cannot carry it unchanged: only trailing
 * zeros after the decimal point may be lost ("12.50" -> 12.5). Leading
 * zeros ("007"), "-0" and more digits than a double holds keep their text.
 */
export function plainNumber(text: string): number | undefined {
  if (!PLAIN_NUMBER.test(text)) return undefined;
  const n = Number(text);
  if (!Number.isFinite(n)) return undefined;
  const canonical = text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
  return String(n) === canonical ? n : undefined;
}

/** value[x] for a result: see the rules at the top of this file. */
export function labValue(result: Row): Pick<Observation, "valueQuantity" | "valueString" | "dataAbsentReason"> {
  const value = recordedValue(result);
  if (value === undefined) return { dataAbsentReason: VALUE_NOT_RECORDED };
  const unit = str(result, "result_unit");
  const n = unit ? plainNumber(value) : undefined;
  if (unit && n !== undefined) {
    const q: Quantity = { value: n, unit };
    const ucum = UCUM_UNITS.get(unit);
    if (ucum) {
      q.system = UCUM;
      q.code = ucum;
    }
    return { valueQuantity: q };
  }
  return { valueString: unit ? `${value} ${unit}` : value };
}

/** Observation.interpretation for a result, or undefined (left out). */
export function labInterpretation(result: Row, state: LabReviewState): CodeableConcept[] | undefined {
  const code = applyStatusMap(LAB_INTERPRETATION, result.interpretation);
  if (!code) return undefined;
  // An unreviewed "normal" may be the form's old default rather than a choice.
  if (code === "N" && state !== "reviewed") return undefined;
  const local = String(result.interpretation).toLowerCase();
  const coding: Coding[] = [
    { system: V3_OBSERVATION_INTERPRETATION, code, display: V3_DISPLAY[code] },
    { system: LAB_INTERPRETATION_SYSTEM, code: local, display: LOCAL_INTERPRETATION_DISPLAY[local] },
  ];
  return [{ coding, text: LOCAL_INTERPRETATION_DISPLAY[local] }];
}

// ---------------------------------------------------------------------------
// Observation (laboratory)
// ---------------------------------------------------------------------------

/**
 * One current result of an order as a laboratory Observation, or null when
 * it cannot be published (malformed ids, a result of another order, a
 * patient whose record does not resolve, or an order without a test name).
 */
export function mapLabObservation(result: Row, order: Row, ctx: MapContext): Observation | null {
  const id = result.id;
  const oid = orderId(order);
  if (typeof id !== "string" || !LOWER_UUID.test(id) || !oid || result.order_id !== oid) return null;
  const subject = patientReference(ctx, order.patient_id);
  const code = labTestConcept(order);
  if (!subject || !code) return null;

  const state = resultReviewState(result);
  const status = applyStatusMap(LAB_OBSERVATION_STATUS, state) ?? "unknown";
  const obs: Observation = {
    resourceType: "Observation",
    id: `${LAB_OBSERVATION_PREFIX}${id}`,
    meta: versionMeta(latest([result, order])),
    status,
    basedOn: [{ reference: `ServiceRequest/${oid}` }],
    category: LABORATORY_CATEGORY,
    code,
    subject,
  };
  const encounter = encounterReference(order);
  if (encounter) obs.encounter = encounter;
  // Specimen collection time; never the order time or the entry time.
  const collected = instant(order, "collected_at");
  if (collected) obs.effectiveDateTime = collected;
  // When this version was made available: the review for a final result,
  // otherwise the time the result was entered.
  const issued = status === "final" ? instant(result, "reviewed_at") : instant(result, "result_date");
  if (issued) obs.issued = issued;
  Object.assign(obs, labValue(result));
  const interpretation = labInterpretation(result, state);
  if (interpretation) obs.interpretation = interpretation;
  const range = str(result, "reference_range");
  if (range) obs.referenceRange = [{ text: range }];
  return obs;
}

// ---------------------------------------------------------------------------
// DiagnosticReport
// ---------------------------------------------------------------------------

export type LabReportState =
  | "awaiting_result"
  | "cancelled"
  | "unreviewed"
  | "reviewed"
  | "results_on_cancelled_order"
  | "completed_without_result"
  | "unrecognised_order_status";

const OPEN_ORDER = ["ordered", "collected", "processing"];
const KNOWN_ORDER = [...OPEN_ORDER, "completed", "cancelled"];

/**
 * The report state of an order and its CURRENT results (superseded results
 * already removed), or null when the order has no status. See
 * terminology/status/laboratory.ts.
 */
export function reportState(order: Row, current: Row[]): LabReportState | null {
  const raw = order.status;
  if (typeof raw !== "string" || raw === "") return null;
  const status = raw.toLowerCase();
  if (!KNOWN_ORDER.includes(status)) return "unrecognised_order_status";
  if (!current.length) {
    if (status === "cancelled") return "cancelled";
    if (status === "completed") return "completed_without_result";
    return "awaiting_result";
  }
  if (status === "cancelled") return "results_on_cancelled_order";
  return current.every((r) => resultReviewState(r) === "reviewed") ? "reviewed" : "unreviewed";
}

/**
 * An order and its current results as a DiagnosticReport, or null when the
 * order cannot be published (malformed id, unresolved patient, no test
 * name). `current` must hold only this order's current results (for a
 * patient: the results released to them).
 */
export function mapDiagnosticReport(order: Row, current: Row[], ctx: MapContext): DiagnosticReport | null {
  const oid = orderId(order);
  if (!oid) return null;
  const subject = patientReference(ctx, order.patient_id);
  const code = labTestConcept(order);
  if (!subject || !code) return null;
  const results = current
    .filter((r) => r.order_id === oid && typeof r.id === "string" && LOWER_UUID.test(r.id))
    .sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));

  const status = applyStatusMap(DIAGNOSTIC_REPORT_STATUS, reportState(order, results)) ?? "unknown";
  const report: DiagnosticReport = {
    resourceType: "DiagnosticReport",
    id: oid,
    meta: versionMeta(latest([order, ...results])),
    basedOn: [{ reference: `ServiceRequest/${oid}` }],
    status,
    category: LAB_REPORT_CATEGORY,
    code,
    subject,
  };
  const encounter = encounterReference(order);
  if (encounter) report.encounter = encounter;
  const collected = instant(order, "collected_at");
  if (collected) report.effectiveDateTime = collected;
  // Issued only once every result was reviewed: the latest review.
  if (status === "final") {
    const issued = latestInstant(results, "reviewed_at");
    if (issued) report.issued = issued;
  }
  if (results.length) report.result = results.map((r) => ({ reference: `Observation/${LAB_OBSERVATION_PREFIX}${String(r.id)}` }));
  return report;
}

// ---------------------------------------------------------------------------
// ServiceRequest
// ---------------------------------------------------------------------------

/**
 * A lab order as a ServiceRequest, or null when it cannot be published
 * (malformed id, unresolved patient). `practitioners` maps an account id
 * (ordered_by) to its published Practitioner id from the staff directory;
 * an account missing from it gets no requester.
 */
export function mapServiceRequest(
  order: Row,
  ctx: MapContext,
  practitioners: ReadonlyMap<string, string> = new Map(),
): ServiceRequest | null {
  const oid = orderId(order);
  if (!oid) return null;
  const subject = patientReference(ctx, order.patient_id);
  if (!subject) return null;
  const sr: ServiceRequest = {
    resourceType: "ServiceRequest",
    id: oid,
    meta: versionMeta(order),
    status: applyStatusMap(SERVICE_REQUEST_STATUS, order.status) ?? "unknown",
    intent: "order",
    subject,
  };
  const priority = applyStatusMap(SERVICE_REQUEST_PRIORITY, order.priority);
  if (priority) sr.priority = priority;
  const code = labTestConcept(order);
  if (code) sr.code = code;
  const encounter = encounterReference(order);
  if (encounter) sr.encounter = encounter;
  const authored = instant(order, "ordered_at");
  if (authored) sr.authoredOn = authored;
  const requester = typeof order.ordered_by === "string" ? practitioners.get(order.ordered_by) : undefined;
  if (requester && FHIR_ID.test(requester)) sr.requester = { reference: `Practitioner/${requester}` };
  return sr;
}

// ---------------------------------------------------------------------------
// Patient path: rows of public.fhir_patient_lab_results
// ---------------------------------------------------------------------------

/**
 * Split one row of fhir_patient_lab_results (a released result with its
 * order's columns) into an order row and a result row shaped like the
 * table rows above, so the same mappers serve staff and patients.
 */
export function splitPatientLabRow(row: Row): { order: Row; result: Row } {
  return {
    order: {
      id: row.order_id,
      patient_id: row.patient_id,
      visit_id: row.visit_id,
      test_name: row.test_name,
      test_code: row.test_code,
      priority: row.priority,
      status: row.order_status,
      ordered_at: row.ordered_at,
      collected_at: row.collected_at,
      created_at: row.order_created_at,
      updated_at: row.order_updated_at,
    },
    result: {
      id: row.id,
      order_id: row.order_id,
      result_value: row.result_value,
      result_unit: row.result_unit,
      reference_range: row.reference_range,
      interpretation: row.interpretation,
      result_date: row.result_date,
      reviewed_at: row.reviewed_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
  };
}
