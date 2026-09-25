// MedicationRequest <- public.prescriptions, one resource per prescription
// line (see mappers/medication.ts for the mapping rules).
//
// One prescription row yields one MedicationRequest per line, so a search
// pages with its own keyset (as the vital-signs part of Observation does):
// the cursor holds the prescription id (k) and the position of the last
// line returned (s). The lines of a prescription never change after upload
// (rx_guard_prescription), so a line's id is stable.
//
// Staff only: portal patients are refused before this module runs (the
// portal does not show prescriptions), and row-level security refuses them
// too.

import type { OperationOutcomeIssue } from "../types/fhir";
import { errors } from "../errors/operationOutcome";
import type { MedicationMapContext, MedicationRequest } from "../mappers/medication";
import {
  MAX_PRESCRIPTION_LINES,
  MEDICATION_REQUEST_STATUS_SYSTEM,
  PRESCRIPTION_COLUMNS,
  lineItemId,
  mapMedicationRequest,
  parseMedicationRequestId,
  prescriptionLines,
} from "../mappers/medication";
import type { Row } from "../mappers/common";
import { MEDICATION_REQUEST_STATUS } from "../terminology/status/medication";
import { READ_PERMISSIONS } from "../authorization/permissions";
import { referenceContext } from "../patients/canonical";
import { parseId, parseReferenceId, type Cursor, type ParsedSearch } from "../search/params";
import { emptyResult, type QueryCtx, type QueryResult, type ResourceDefinition, type ResourceModule } from "./module";
import {
  MAX_KEYSET_ROUNDS,
  SOURCE_ID,
  checkCursorKey,
  dateFilters,
  namedPatientFilter,
  one,
  ownersOf,
  patientNotes,
  scopeFilter,
  type Filters,
} from "./shared";
import {
  catalogueEntries,
  practitionerIds,
  readableVisits,
  statusCode,
  statusSearchFilter,
  visitPatientIds,
} from "./medication";

export const definition: ResourceDefinition = {
  type: "MedicationRequest",
  source: "public.prescriptions (one resource per entry of prescriptions.lines)",
  idStrategy: "<prescriptions.id>-<n>, n the 1-based position of the line in the prescription",
  fields: [
    "status (open: active; dispensed: completed; void: cancelled; partial or anything else: unknown)",
    "intent (order)",
    "medicationReference (the catalogue entry, with its name and strength as display)",
    "subject",
    "encounter (only when the visit exists and belongs to the same patient)",
    "authoredOn",
    "requester (only when the prescriber's account resolves in the staff directory)",
    "groupIdentifier (the prescription, grouping its lines)",
    "dosageInstruction.text (dose, frequency and duration as written) and patientInstruction",
    "dispenseRequest.quantity (total quantity with the medicine's dispensing unit, when both are recorded)",
  ],
  profiles: [],
  interactions: ["read", "search-type"],
  searchParams: [
    { name: "_id", type: "token", documentation: "Logical id of the resource (<prescription id>-<line>)." },
    { name: "patient", type: "reference", documentation: "Patient/[id]. Required unless _id or encounter is given." },
    { name: "subject", type: "reference", documentation: "Same as patient (Patient/[id] only)." },
    {
      name: "encounter",
      type: "reference",
      documentation: "Encounter/[id]: prescriptions written in that visit (only those whose encounter is published).",
    },
    {
      name: "status",
      type: "token",
      documentation: "A medicationrequest-status code: active, completed, cancelled or unknown match; other codes match nothing.",
    },
    {
      name: "authoredon",
      type: "date",
      documentation:
        "When the prescription was written, by the prescribing tablet's clock. A date without a time is a clinic day in Africa/Lagos. Up to two bounds.",
      maxRepeats: 2,
    },
  ],
  requiredSearch: [["_id"], ["patient"], ["subject"], ["encounter"]],
  writeSupport: false,
  consentClass: "medication",
  readPermissions: READ_PERMISSIONS.MedicationRequest,
  patientAccess: false,
  sensitiveSearch: false,
  notes: [
    "Dosing is free text exactly as the prescriber wrote it; no structured dose, frequency, route or timing is published.",
    "An open prescription is active until it is dispensed or cancelled: mBHR sets no expiry, so check authoredOn.",
    "completed means the pharmacy recorded every line as dispensed, not that the course of treatment has ended.",
    "The medicine's name and dispensing unit are read from the current catalogue entry (a line records only the entry).",
    "A prescription reaches the server only when a prescriber's tablet uploads it; a handover the server refused is kept on the tablet only.",
    "No medicine code (RxNorm, SNOMED CT, ATC) and no reason for prescribing are published; the prescriber's account id and void notes are never published.",
    "Not available to patient accounts.",
  ],
};

/** A line that matched the search but could not be shown because its medicine is not in the catalogue. */
const UNRESOLVED_MEDICINE: OperationOutcomeIssue = {
  severity: "information",
  code: "informational",
  diagnostics:
    "Some prescription lines were left out because the medicine they name could not be found in the pharmacy catalogue (or the line names none). An empty or short result does not mean nothing else was prescribed for the patient.",
};

/** Everything the mapper needs for a batch of prescription rows, resolved in a few queries. */
async function mapContext(ctx: QueryCtx, rows: Row[]): Promise<MedicationMapContext> {
  const lines = rows.flatMap((r) => prescriptionLines(r));
  const [items, visits, practitioners] = await Promise.all([
    catalogueEntries(ctx, lines.map(lineItemId), true),
    readableVisits(ctx, rows.map((r) => r.visit_id)),
    practitionerIds(ctx, rows.map((r) => r.prescriber_id)),
  ]);
  const refs = await referenceContext(ctx.db, [
    ...ownersOf(rows).filter((v): v is string => v !== null),
    ...visits.values(),
  ]);
  return {
    ...refs,
    items,
    visitPatients: visitPatientIds(visits, refs.patientFhirIds),
    practitioners,
    prescriptions: new Map(),
    patientView: false,
  };
}

async function read(ctx: QueryCtx, id: string): Promise<QueryResult> {
  const parsed = parseMedicationRequestId(id);
  if (!parsed || !SOURCE_ID.test(parsed.prescriptionId)) return emptyResult();
  const rows = await ctx.db.select(
    "prescriptions",
    PRESCRIPTION_COLUMNS,
    [["id", `eq.${parsed.prescriptionId}`], ...scopeFilter(ctx)],
    { limit: 1 },
  );
  if (!rows.length) return emptyResult();
  const request = mapMedicationRequest(rows[0], parsed.lineIndex, await mapContext(ctx, rows));
  return request ? { page: { resources: [request], next: null }, owners: ownersOf(rows) } : emptyResult();
}

interface LineItem {
  request: MedicationRequest;
  rowId: string;
  index: number;
  owner: string | null;
}

/**
 * Keyset paging over prescription rows, several resources per row. A row
 * cut part-way is fetched again (gte) and resumes after the last line
 * returned; after MAX_KEYSET_ROUNDS batches the page is returned short with
 * a next link, as keysetPage() does.
 */
async function linesPhase(
  ctx: QueryCtx,
  filters: Filters,
  count: number,
  cursor: Cursor | null,
  onlyLine: number | null,
  keep: (request: MedicationRequest) => boolean,
): Promise<{ items: LineItem[]; next: Cursor | null; unresolved: boolean }> {
  checkCursorKey(cursor, SOURCE_ID);
  if (cursor && cursor.s !== undefined && cursor.s >= MAX_PRESCRIPTION_LINES) {
    throw errors.badRequest("_cursor is not valid. Start the search again.");
  }
  const batch = Math.min(Math.max(count + 1, 25), 101);
  const out: LineItem[] = [];
  let unresolved = false;
  let afterRow = cursor?.k ?? null;
  let afterIndex = cursor?.s;
  for (let round = 0; round < MAX_KEYSET_ROUNDS; round++) {
    const f: Filters = [...filters];
    if (afterRow !== null) f.push(["id", `${afterIndex !== undefined ? "gte" : "gt"}.${afterRow}`]);
    const rows = await ctx.db.select("prescriptions", PRESCRIPTION_COLUMNS, f, { order: "id.asc", limit: batch });
    const mctx = await mapContext(ctx, rows);
    for (const row of rows) {
      const rowId = String(row.id);
      const owner = ownersOf([row])[0];
      const lines = prescriptionLines(row);
      for (let index = 0; index < lines.length; index++) {
        if (afterIndex !== undefined && rowId === afterRow && index <= afterIndex) continue;
        if (onlyLine !== null && index !== onlyLine) continue;
        const request = mapMedicationRequest(row, index, mctx);
        if (!request) {
          // Say so when a line of a patient the caller can see was left out
          // only because its medicine is missing from the catalogue.
          const item = lineItemId(lines[index]);
          if (owner !== null && mctx.patientFhirIds.has(owner) && (item === null || !mctx.items.has(item))) unresolved = true;
          continue;
        }
        if (!keep(request)) continue;
        if (out.length === count) {
          const last = out[out.length - 1];
          return { items: out, next: { k: last.rowId, s: last.index }, unresolved };
        }
        out.push({ request, rowId, index, owner });
      }
      afterRow = rowId;
      afterIndex = undefined;
    }
    if (rows.length < batch) return { items: out, next: null, unresolved };
  }
  return { items: out, next: afterRow !== null ? { k: afterRow } : null, unresolved };
}

async function search(ctx: QueryCtx, search: ParsedSearch): Promise<QueryResult> {
  const notes = patientNotes(ctx);
  const named = namedPatientFilter(ctx);
  if (named === null) return emptyResult(notes);
  const filters: Filters = [...scopeFilter(ctx), ...named];

  let onlyLine: number | null = null;
  const idParam = one(search, "_id");
  if (idParam) {
    const parsed = parseMedicationRequestId(parseId(idParam));
    if (!parsed || !SOURCE_ID.test(parsed.prescriptionId)) return emptyResult(notes);
    filters.push(["id", `eq.${parsed.prescriptionId}`]);
    onlyLine = parsed.lineIndex;
  }

  let encounterRef: string | null = null;
  const encounter = one(search, "encounter");
  if (encounter) {
    const visitId = parseReferenceId(encounter, "Encounter", "encounter");
    filters.push(["visit_id", `eq.${visitId}`]);
    // Only lines whose published encounter is this one (the visit must
    // exist and belong to the same patient), so search and resource agree.
    encounterRef = `Encounter/${visitId}`;
  }

  const status = one(search, "status");
  if (status) {
    const code = statusCode(status, "status", MEDICATION_REQUEST_STATUS_SYSTEM);
    const f = code === null ? null : statusSearchFilter(MEDICATION_REQUEST_STATUS, "status", code);
    if (!f) return emptyResult(notes);
    filters.push(...f);
  }

  filters.push(...dateFilters("created_at", search.values.get("authoredon"), "authoredon"));

  const r = await linesPhase(
    ctx,
    filters,
    search.count,
    search.cursor,
    onlyLine,
    (request) => encounterRef === null || request.encounter?.reference === encounterRef,
  );
  const outcomes = [...(notes.outcomes ?? [])];
  if (r.unresolved) outcomes.push(UNRESOLVED_MEDICINE);
  return {
    page: { resources: r.items.map((i) => i.request), next: r.next },
    owners: r.items.map((i) => i.owner),
    ...notes,
    ...(outcomes.length ? { outcomes } : {}),
  };
}

const STATUS_CODES = ["active", "on-hold", "cancelled", "completed", "entered-in-error", "stopped", "draft", "unknown"];
const INTENT_CODES = ["proposal", "plan", "order", "original-order", "reflex-order", "filler-order", "instance-order", "option"];

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const refTo = (v: unknown, type: string) => isObj(v) && typeof v.reference === "string" && v.reference.startsWith(`${type}/`);

function validate(resource: Json, add: (path: string, message: string) => void): void {
  if (!STATUS_CODES.includes(resource.status as string)) add("status", "not a medicationrequest-status code");
  if (!INTENT_CODES.includes(resource.intent as string)) add("intent", "not a medicationrequest-intent code");
  const byRef = resource.medicationReference !== undefined;
  const byText = resource.medicationCodeableConcept !== undefined;
  if (byRef === byText) add("medication[x]", "exactly one of medicationReference or medicationCodeableConcept is required");
  if (byRef && !refTo(resource.medicationReference, "Medication")) add("medicationReference", "must reference a Medication");
  if (byText) {
    const c = resource.medicationCodeableConcept;
    if (!isObj(c) || typeof c.text !== "string") add("medicationCodeableConcept", "the medicine must be named (text)");
    else if (c.coding !== undefined) add("medicationCodeableConcept.coding", "no verified medicine code exists; text only");
  }
  if (!refTo(resource.subject, "Patient")) add("subject", "required (a Patient)");
  if (resource.encounter !== undefined && !refTo(resource.encounter, "Encounter")) add("encounter", "must reference an Encounter");
  if (resource.requester !== undefined && !refTo(resource.requester, "Practitioner")) add("requester", "must reference a Practitioner");
  // Dosing is free text only: nothing structured may appear.
  for (const [i, d] of (Array.isArray(resource.dosageInstruction) ? resource.dosageInstruction : []).entries()) {
    if (!isObj(d)) continue;
    for (const k of Object.keys(d)) {
      if (k !== "text" && k !== "patientInstruction") add(`dosageInstruction[${i}].${k}`, "dosing is published as text only");
    }
  }
  const dr = resource.dispenseRequest;
  if (dr !== undefined) {
    const q = isObj(dr) ? dr.quantity : undefined;
    if (!isObj(q) || typeof q.value !== "number" || !(q.value > 0) || typeof q.unit !== "string" || q.unit === "") {
      add("dispenseRequest.quantity", "a quantity needs a positive value and its unit");
    } else if (q.system !== undefined || q.code !== undefined) {
      add("dispenseRequest.quantity", "dispensing units are not UCUM; no system or code");
    }
  }
}

export const medicationRequestModule: ResourceModule = { definition, read, search, validate };
