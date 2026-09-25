// Medicines -> Medication, MedicationRequest and MedicationDispense.
//
//   Medication          <- public.pharmacy_items (the pharmacy catalogue)
//   MedicationRequest   <- public.prescriptions, one resource per line
//   MedicationDispense  <- public.dispenses (what mBHR recorded as given)
//
// The rules this file keeps (Phase 2 medicines research, owner rules):
//
//   - No medicine code is invented. mBHR's catalogue has no code column and
//     no verified RxNorm, SNOMED CT or ATC mapping, so a medicine is its name
//     and strength as text (CodeableConcept.text). The RxNorm system that
//     dispenses.medication_code_system carries by column default (with no
//     code) is never read.
//   - Dosing stays free text exactly as recorded: dose, frequency, duration
//     and directions go into Dosage.text. Nothing is parsed into a dose
//     quantity, a timing, a route or a strength ratio.
//   - A quantity is published only with its unit: the catalogue's dispensing
//     unit (tablets, bottles, ...), as text, with no UCUM code (those units
//     are not UCUM). A quantity with no unit on record is left out.
//   - Statuses go through the explicit maps in terminology/status/
//     medication.ts. A dispense row is never taken as proof of a handover.
//   - References: the patient always as the canonical record (a row whose
//     patient does not resolve is withheld); an encounter only when the
//     visit exists, the caller can read it and it belongs to the same
//     patient; staff only when the account resolves through the staff
//     directory (the account id itself is never published). The catalogue
//     row id (pharmacy_items.id) is never published: a Medication has a
//     random id kept by the server (fhir_link_ids).
//   - Never published: account ids, device ids used as staff ids, staff
//     names typed into dispensed_by, void reasons, visibility notes, stock
//     and lot data, internal patient ids.
//
// Mappers are pure: rows and pre-resolved lookups in, FHIR JSON out.

import type { CodeableConcept, Identifier, Quantity, Reference, Resource } from "../types/fhir";
import { MBHR_IDENTIFIERS } from "../terminology/codeSystems";
import { applyStatusMap } from "../terminology/statusMaps";
import {
  MEDICATION_DISPENSE_STATUS,
  MEDICATION_REQUEST_STATUS,
  MEDICATION_STATUS,
  type MedicationDispenseStatus,
  type MedicationRequestStatus,
  type MedicationStatus,
} from "../terminology/status/medication";
import { FHIR_ID } from "../search/params";
import { instant, str, versionMeta, type MapContext, type Row } from "./common";

// ---------------------------------------------------------------------------
// FHIR shapes (only the elements these mappers fill)
// ---------------------------------------------------------------------------

/** Dosage: free text only (never structured from free text). */
export interface Dosage {
  text?: string;
  patientInstruction?: string;
}

export interface Medication extends Resource {
  resourceType: "Medication";
  code: CodeableConcept;
  status?: MedicationStatus;
  form?: CodeableConcept;
}

export interface MedicationRequest extends Resource {
  resourceType: "MedicationRequest";
  status: MedicationRequestStatus;
  intent: "order";
  medicationReference?: Reference;
  medicationCodeableConcept?: CodeableConcept;
  subject: Reference;
  encounter?: Reference;
  authoredOn?: string;
  requester?: Reference;
  groupIdentifier: Identifier;
  dosageInstruction?: Dosage[];
  dispenseRequest?: { quantity: Quantity };
}

export interface MedicationDispense extends Resource {
  resourceType: "MedicationDispense";
  status: MedicationDispenseStatus;
  medicationCodeableConcept: CodeableConcept;
  subject: Reference;
  context?: Reference;
  performer?: { actor: Reference }[];
  authorizingPrescription?: Reference[];
  quantity?: Quantity;
  whenHandedOver?: string;
  dosageInstruction?: Dosage[];
}

/** Identifier system for a prescription (it groups the lines of one prescription). */
export const PRESCRIPTION_IDENTIFIER = `${MBHR_IDENTIFIERS}/prescription`;
export const MEDICATION_REQUEST_STATUS_SYSTEM = "http://hl7.org/fhir/CodeSystem/medicationrequest-status";
export const MEDICATION_DISPENSE_STATUS_SYSTEM = "http://terminology.hl7.org/CodeSystem/medicationdispense-status";

/**
 * Columns each module reads. Every one is checked against the migrations:
 *   pharmacy_items  20250930065243 (+ is_active 20260925100400)
 *   prescriptions   20250930065243 (+ updated_at 20260925100000)
 *   dispenses       20250930025202 (+ portal_visible 20260115072241,
 *                   prescription_id/item_id 20260420000000,
 *                   dispense_status/when_handed_over 20260503010200)
 */
export const MEDICATION_COLUMNS = ["id", "med_name", "strength", "form", "is_active", "updated_at"] as const;
/** What a prescription or dispense needs from its catalogue entry. */
export const CATALOGUE_LOOKUP_COLUMNS = ["id", "med_name", "strength", "unit"] as const;
export const PRESCRIPTION_COLUMNS = [
  "id",
  "patient_id",
  "visit_id",
  "prescriber_id",
  "lines",
  "created_at",
  "status",
  "updated_at",
] as const;
export const DISPENSE_COLUMNS = [
  "id",
  "patient_id",
  "visit_id",
  "item_name",
  "qty",
  "dosage",
  "directions",
  "dispensed_by",
  "dispensed_at",
  "updated_at",
  "prescription_id",
  "item_id",
  "dispense_status",
  "when_handed_over",
] as const;

/**
 * Lines of one prescription that get a resource each: positions 1 to 64
 * (the app writes one line per prescription; the paging cursor holds a line
 * position of at most 64).
 */
export const MAX_PRESCRIPTION_LINES = 64;

// ---------------------------------------------------------------------------
// Lookups the resource modules resolve before mapping
// ---------------------------------------------------------------------------

/** A catalogue entry as the caller could read it. */
export interface CatalogueEntry {
  /** The published Medication id, or null when none could be obtained. */
  fhirId: string | null;
  /** "<med_name> <strength>", as mBHR's own dispense records name it. */
  description: string;
  /** Dispensing unit text (tablets, bottles, ...); undefined when not recorded. */
  unit?: string;
}

/** A prescription as a dispense's authorizingPrescription needs it. */
export interface PrescriptionLines {
  /** Canonical Patient id of the prescription (null: did not resolve). */
  patientFhirId: string | null;
  /** lines[n].itemId by position (null for a line without one). */
  itemIds: (string | null)[];
}

export interface MedicationMapContext extends MapContext {
  /** pharmacy_items.id -> entry (missing: not found, or not readable by the caller). */
  items: ReadonlyMap<string, CatalogueEntry>;
  /** visits.id -> canonical Patient id of the visit (only visits the caller can read). */
  visitPatients: ReadonlyMap<string, string>;
  /** Staff account id -> Practitioner id (fhir_staff_directory; empty for patients). */
  practitioners: ReadonlyMap<string, string>;
  /** prescriptions.id -> its lines (MedicationDispense only; empty for patients). */
  prescriptions: ReadonlyMap<string, PrescriptionLines>;
  /**
   * The patient-portal view (MedicationDispense for a patient): what the
   * portal shows them. No quantity (its unit comes from the catalogue, which
   * patients cannot read), no prescription link, no staff.
   */
  patientView: boolean;
}

export function emptyMedicationContext(base: MapContext, patientView = false): MedicationMapContext {
  return {
    ...base,
    items: new Map(),
    visitPatients: new Map(),
    practitioners: new Map(),
    prescriptions: new Map(),
    patientView,
  };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** A whole number above zero (a number, or a string of digits); anything else is absent. */
export function positiveInt(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isInteger(v) && v > 0 ? v : undefined;
  if (typeof v === "string" && /^\d{1,9}$/.test(v.trim())) {
    const n = Number(v.trim());
    return n > 0 ? n : undefined;
  }
  return undefined;
}

function isObject(v: unknown): v is Row {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The catalogue entry's description: name and strength as typed (strength is never parsed). */
export function itemDescription(row: Row): string | undefined {
  const name = str(row, "med_name");
  if (!name) return undefined;
  const strength = str(row, "strength");
  return strength ? `${name} ${strength}` : name;
}

function patientFhirId(ctx: MapContext, internalId: unknown): string | null {
  return typeof internalId === "string" ? ctx.patientFhirIds.get(internalId) ?? null : null;
}

/** Encounter reference: only a readable visit of the same (canonical) patient. */
function encounterFor(ctx: MedicationMapContext, visitId: string | undefined, subjectFhirId: string): Reference | undefined {
  if (!visitId || !FHIR_ID.test(visitId)) return undefined;
  return ctx.visitPatients.get(visitId) === subjectFhirId ? { reference: `Encounter/${visitId}` } : undefined;
}

function practitionerFor(ctx: MedicationMapContext, accountId: string | undefined): Reference | undefined {
  if (ctx.patientView || !accountId) return undefined;
  const id = ctx.practitioners.get(accountId);
  return id && FHIR_ID.test(id) ? { reference: `Practitioner/${id}` } : undefined;
}

/** Free-text parts joined as mBHR joins its own directions ("a · b · c"); nothing is parsed. */
function joinText(parts: (string | undefined)[]): string | undefined {
  const kept = parts.filter((p): p is string => p !== undefined && p !== "");
  return kept.length ? kept.join(" · ") : undefined;
}

// ---------------------------------------------------------------------------
// Medication <- public.pharmacy_items
// ---------------------------------------------------------------------------

/** Maps is_active (a boolean) through MEDICATION_STATUS. */
export function mapMedicationStatus(isActive: unknown): MedicationStatus | null {
  return applyStatusMap(MEDICATION_STATUS, typeof isActive === "boolean" ? String(isActive) : isActive);
}

/**
 * A catalogue entry. `fhirId` is the random id the server keeps for it
 * (fhir_link_ids); without one, or without a name, nothing is published.
 * Stock, reorder level, controlled-drug flag, site and the row id are
 * never published.
 */
export function mapMedication(row: Row, fhirId: string | null | undefined): Medication | null {
  const description = itemDescription(row);
  if (!fhirId || !FHIR_ID.test(fhirId) || !description) return null;
  const medication: Medication = {
    resourceType: "Medication",
    id: fhirId,
    meta: versionMeta(row),
    // No coding: the catalogue has no code column and no verified mapping.
    code: { text: description },
  };
  const status = mapMedicationStatus(row.is_active);
  if (status) medication.status = status;
  // The dose form as typed or picked (tablet, syrup, ...): text only.
  const form = str(row, "form");
  if (form) medication.form = { text: form };
  return medication;
}

// ---------------------------------------------------------------------------
// MedicationRequest <- public.prescriptions x lines
// ---------------------------------------------------------------------------

/** The lines array by position (a line that is not an object stays in place as null, so numbering never shifts). */
export function prescriptionLines(row: Row): (Row | null)[] {
  const lines = row.lines;
  if (!Array.isArray(lines)) return [];
  return lines.slice(0, MAX_PRESCRIPTION_LINES).map((l) => (isObject(l) ? l : null));
}

/** "<prescriptions.id>-<n>", n the 1-based line position; null when that is not a FHIR id. */
export function medicationRequestId(prescriptionId: string, lineIndex: number): string | null {
  if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= MAX_PRESCRIPTION_LINES) return null;
  const id = `${prescriptionId}-${lineIndex + 1}`;
  return FHIR_ID.test(id) ? id : null;
}

/** The reverse of medicationRequestId: split at the last "-" (a line number has none). */
export function parseMedicationRequestId(id: string): { prescriptionId: string; lineIndex: number } | null {
  if (!FHIR_ID.test(id)) return null;
  const dash = id.lastIndexOf("-");
  if (dash <= 0) return null;
  const n = id.slice(dash + 1);
  if (!/^[1-9]\d?$/.test(n) || Number(n) > MAX_PRESCRIPTION_LINES) return null;
  return { prescriptionId: id.slice(0, dash), lineIndex: Number(n) - 1 };
}

/** The item a line names (null when it names none). */
export function lineItemId(line: Row | null): string | null {
  if (!line) return null;
  const v = line.itemId;
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/**
 * Dosage text as the prescriber wrote it: dose, frequency and duration
 * joined into one line ("1 tablet · three times daily · 5 days"), the same
 * composition mBHR uses on the dispense record. The patient instructions
 * ("Instructions for the patient" on the prescription form) are published
 * as patientInstruction. Nothing is parsed into a structured dose or timing.
 */
export function prescriptionDosage(line: Row): Dosage | undefined {
  const days = positiveInt(line.durationDays);
  const text = joinText([str(line, "dosage"), str(line, "frequency"), days ? `${days} day${days === 1 ? "" : "s"}` : undefined]);
  const patientInstruction = str(line, "notes");
  if (!text && !patientInstruction) return undefined;
  const dosage: Dosage = {};
  if (text) dosage.text = text;
  if (patientInstruction) dosage.patientInstruction = patientInstruction;
  return dosage;
}

export function mapMedicationRequestStatus(status: unknown): MedicationRequestStatus {
  return applyStatusMap(MEDICATION_REQUEST_STATUS, status) ?? "unknown";
}

/**
 * One prescription line. Withheld (null) when the id is not a FHIR id, the
 * line is not a line, the patient does not resolve to a kept record, or
 * the medicine the line names is not in the catalogue the caller can read
 * (medication[x] is required and the line records no name of its own).
 */
export function mapMedicationRequest(row: Row, lineIndex: number, ctx: MedicationMapContext): MedicationRequest | null {
  const prescriptionId = str(row, "id");
  const line = prescriptionLines(row)[lineIndex] ?? null;
  if (!prescriptionId || !line) return null;
  const id = medicationRequestId(prescriptionId, lineIndex);
  const subjectId = patientFhirId(ctx, row.patient_id);
  const itemId = lineItemId(line);
  const item = itemId ? ctx.items.get(itemId) : undefined;
  if (!id || !subjectId || !item) return null;

  const request: MedicationRequest = {
    resourceType: "MedicationRequest",
    id,
    meta: versionMeta(row),
    status: mapMedicationRequestStatus(row.status),
    intent: "order",
    subject: { reference: `Patient/${subjectId}` },
    groupIdentifier: { system: PRESCRIPTION_IDENTIFIER, value: prescriptionId },
  };
  if (item.fhirId && FHIR_ID.test(item.fhirId)) {
    request.medicationReference = { reference: `Medication/${item.fhirId}`, display: item.description };
  } else {
    // The catalogue entry was read but its published id could not be
    // obtained: the medicine is still named, as text.
    request.medicationCodeableConcept = { text: item.description };
  }
  const encounter = encounterFor(ctx, str(row, "visit_id"), subjectId);
  if (encounter) request.encounter = encounter;
  const authoredOn = instant(row, "created_at");
  if (authoredOn) request.authoredOn = authoredOn;
  const requester = practitionerFor(ctx, str(row, "prescriber_id"));
  if (requester) request.requester = requester;
  const dosage = prescriptionDosage(line);
  if (dosage) request.dosageInstruction = [dosage];
  // qty is the total in the medicine's dispensing unit, read now from the
  // catalogue (lines record no unit). No unit on record: no quantity.
  const qty = positiveInt(line.qty);
  if (qty && item.unit) request.dispenseRequest = { quantity: { value: qty, unit: item.unit } };
  return request;
}

// ---------------------------------------------------------------------------
// MedicationDispense <- public.dispenses
// ---------------------------------------------------------------------------

/** Dispense row ids that can be published: ':' becomes '.', so no '.' may occur in the row id itself. */
const PUBLISHABLE_DISPENSE_ID = /^[A-Za-z0-9:-]{1,64}$/;

/**
 * dispenses.id as a FHIR id. Ids written by the rx_dispense fallback have
 * the form <command uuid>:<line>:<k>; ':' is not allowed in a FHIR id, so it
 * is published as '.'. No writer puts '.' in a dispense id (ULIDs, uuids),
 * so the mapping reverses exactly; a row whose id holds a '.' or any other
 * character is not published (null) rather than risk two rows sharing an id.
 */
export function dispenseFhirId(sourceId: string): string | null {
  return PUBLISHABLE_DISPENSE_ID.test(sourceId) ? sourceId.replace(/:/g, ".") : null;
}

/** The reverse of dispenseFhirId. */
export function dispenseSourceId(fhirId: string): string | null {
  if (!FHIR_ID.test(fhirId)) return null;
  const id = fhirId.replace(/\./g, ":");
  return PUBLISHABLE_DISPENSE_ID.test(id) ? id : null;
}

/**
 * Rows from the staff dashboard's "Add medicine" form: no prescription, no
 * visit, dispensed_by the literal 'staff' and a quantity of 1 the form
 * invents. They do not record a dispensing event and are never published.
 * (The same rule is applied in every query; see DISPENSE_NOT_ADD_MEDICINE.)
 */
export function isAddMedicineRow(row: Row): boolean {
  return row.prescription_id == null && row.visit_id == null && row.dispensed_by === "staff";
}

export function mapMedicationDispenseStatus(status: unknown): MedicationDispenseStatus {
  return applyStatusMap(MEDICATION_DISPENSE_STATUS, status) ?? "unknown";
}

/**
 * authorizingPrescription: MedicationRequest/<prescription>-<n> only when
 * exactly one line of the prescription names the medicine this row gave.
 * No prescription, no matching line, or several lines naming the same
 * medicine: left out, never guessed. The column authorizing_prescription_id
 * is never written by the app and is not read.
 */
function authorizingPrescription(row: Row, ctx: MedicationMapContext, subjectId: string): Reference[] | undefined {
  if (ctx.patientView) return undefined;
  const prescriptionId = str(row, "prescription_id");
  const itemId = str(row, "item_id");
  if (!prescriptionId || !itemId) return undefined;
  const rx = ctx.prescriptions.get(prescriptionId);
  if (!rx || rx.patientFhirId !== subjectId) return undefined;
  const matches = rx.itemIds.flatMap((v, i) => (v === itemId ? [i] : []));
  if (matches.length !== 1) return undefined;
  const id = medicationRequestId(prescriptionId, matches[0]);
  return id ? [{ reference: `MedicationRequest/${id}` }] : undefined;
}

/**
 * One dispense row. Withheld (null) for "Add medicine" rows, ids that
 * cannot be published, rows whose patient does not resolve, and rows with
 * no medicine name (medication[x] is required).
 */
export function mapMedicationDispense(row: Row, ctx: MedicationMapContext): MedicationDispense | null {
  const sourceId = str(row, "id");
  const id = sourceId ? dispenseFhirId(sourceId) : null;
  const subjectId = patientFhirId(ctx, row.patient_id);
  // item_name is the name as it was when the medicine was given (a
  // snapshot, unlike the catalogue entry, which can change).
  const medicine = str(row, "item_name");
  if (!id || !subjectId || !medicine || isAddMedicineRow(row)) return null;

  const dispense: MedicationDispense = {
    resourceType: "MedicationDispense",
    id,
    meta: versionMeta(row),
    status: mapMedicationDispenseStatus(row.dispense_status),
    medicationCodeableConcept: { text: medicine },
    subject: { reference: `Patient/${subjectId}` },
  };
  const context = encounterFor(ctx, str(row, "visit_id"), subjectId);
  if (context) dispense.context = context;
  const performer = practitionerFor(ctx, str(row, "dispensed_by"));
  if (performer) dispense.performer = [{ actor: performer }];
  const prescription = authorizingPrescription(row, ctx, subjectId);
  if (prescription) dispense.authorizingPrescription = prescription;
  if (!ctx.patientView) {
    // Units given in this row, in the medicine's dispensing unit from the
    // catalogue. No catalogue link (visit dispensing), no unit on record, or
    // no positive quantity (history imports may record 0): left out.
    const qty = positiveInt(row.qty);
    const itemId = str(row, "item_id");
    const unit = itemId ? ctx.items.get(itemId)?.unit : undefined;
    if (qty && unit) dispense.quantity = { value: qty, unit };
  }
  // A time only when one was recorded: when_handed_over where set, else the
  // time mBHR recorded the medicine as given (dispensed_at, the tablet's
  // clock). Never the row's update time.
  const handedOver = instant(row, "when_handed_over") ?? instant(row, "dispensed_at");
  if (handedOver) dispense.whenHandedOver = handedOver;
  const text = joinText([str(row, "dosage"), str(row, "directions")]);
  if (text) dispense.dosageInstruction = [{ text }];
  return dispense;
}
