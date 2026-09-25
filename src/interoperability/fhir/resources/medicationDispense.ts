// MedicationDispense <- public.dispenses (see mappers/medication.ts for the
// mapping rules).
//
// Rows come from three writers: prescription dispensing (rx_dispense, one
// row per lot used), imported tablet history (rx_import_history) and visit
// dispensing (the /pharmacy form, free text, no prescription). A fourth,
// the staff dashboard's "Add medicine" form, writes rows with an invented
// quantity of 1 and no visit or prescription; those are excluded in every
// query (DISPENSE_NOT_ADD_MEDICINE) and again by the mapper.
//
// Portal patients (when patient access is on) see their own rows that are
// visible in the portal (restriction portal_visible_only), with what the
// portal shows them: the medicine, status, visit and directions.
//
// No handover time is published and there is no whenhandedover search: mBHR
// records when a medicine was recorded as given, not a handover (see
// mappers/medication.ts).

import type { MedicationDispense, MedicationMapContext, PrescriptionLines } from "../mappers/medication";
import {
  DISPENSE_COLUMNS,
  MEDICATION_DISPENSE_STATUS_SYSTEM,
  dispenseSourceId,
  lineItemId,
  mapMedicationDispense,
  parseMedicationRequestId,
  prescriptionLines,
} from "../mappers/medication";
import type { Row } from "../mappers/common";
import { MEDICATION_DISPENSE_STATUS } from "../terminology/status/medication";
import { READ_PERMISSIONS } from "../authorization/permissions";
import { errors } from "../errors/operationOutcome";
import { inList } from "../gateway/postgrest";
import { referenceContext } from "../patients/canonical";
import { parseId, parseReferenceId, type ParsedSearch } from "../search/params";
import { emptyResult, type QueryCtx, type QueryResult, type ResourceDefinition, type ResourceModule } from "./module";
import {
  SOURCE_ID,
  keysetPage,
  namedPatientFilter,
  one,
  ownersOf,
  patientNotes,
  scopeFilter,
  type Filters,
} from "./shared";
import {
  catalogueEntries,
  distinctStrings,
  practitionerIds,
  readableVisits,
  statusCode,
  statusSearchFilter,
  visitPatientIds,
} from "./medication";

export const definition: ResourceDefinition = {
  type: "MedicationDispense",
  source: "public.dispenses (prescription dispensing, imported tablet history and visit dispensing)",
  idStrategy: "dispenses.id, with ':' written as '.' (ids from the rx_dispense fallback contain ':')",
  fields: [
    "status (dispense_status where it was set on purpose; not recorded, or the 'completed' a migration stamped on old rows: unknown, never assumed completed)",
    "medicationCodeableConcept.text (the medicine's name as recorded when it was given)",
    "subject",
    "context (only when the visit exists and belongs to the same patient)",
    "authorizingPrescription (only when exactly one line of the prescription names this medicine)",
    "quantity (units given with the medicine's dispensing unit, when both are recorded; staff only)",
    "performer (only when the dispenser's account resolves in the staff directory; staff only)",
    "dosageInstruction.text (dose and directions as written)",
  ],
  profiles: [],
  interactions: ["read", "search-type"],
  searchParams: [
    { name: "_id", type: "token", documentation: "Logical id of the resource." },
    { name: "patient", type: "reference", documentation: "Patient/[id]. Required unless _id or prescription is given." },
    { name: "subject", type: "reference", documentation: "Same as patient (Patient/[id] only)." },
    {
      name: "status",
      type: "token",
      documentation:
        "A medicationdispense-status code, matched against the status as published. Almost every record is unknown (mBHR does not record a dispense status), so completed matches nothing.",
    },
    {
      name: "prescription",
      type: "reference",
      documentation:
        "MedicationRequest/[id]: dispenses whose authorizingPrescription is that prescription line (only those where the line is exactly identified). Staff only: a patient's view carries no authorizingPrescription.",
    },
  ],
  requiredSearch: [["_id"], ["patient"], ["subject"], ["prescription"]],
  writeSupport: false,
  consentClass: "medication",
  readPermissions: READ_PERMISSIONS.MedicationDispense,
  patientAccess: true,
  sensitiveSearch: false,
  notes: [
    "status is unknown unless a dispense status was set on purpose: mBHR records that a medicine was given, not a separate handover status. A 'completed' is published as unknown too: the only thing that writes it is a database migration that fills it in for every row without a status. unknown does not mean the medicine was not given.",
    "No handover time (whenHandedOver) is published and whenhandedover cannot be searched: mBHR records when a medicine was recorded as given, on the tablet's clock, not when it was handed over. meta.lastUpdated is when the record last changed, not when the medicine was given.",
    "One prescription line can have several dispenses (one per stock lot, plus any units given offline beyond server stock): add them up per authorizingPrescription.",
    "A quantity is shown only with its unit: visit dispensing records no unit, so it has none.",
    "The medicine is the name as recorded, as text: no medicine code is published (none is recorded).",
    "Records from the staff dashboard's 'Add medicine' form are not published (their quantity is invented).",
    "The dispenser's account id or typed name, lots, allergy-override flags and visibility notes are not published.",
    "Patients see their own records that are visible in the portal: medicine, status, visit and directions only.",
  ],
};

/** Excludes the "Add medicine" rows: no prescription, no visit and dispensed_by 'staff'. */
export const DISPENSE_NOT_ADD_MEDICINE: [string, string] = [
  "or",
  "(prescription_id.not.is.null,visit_id.not.is.null,dispensed_by.is.null,dispensed_by.neq.staff)",
];

/** Patients see only rows shown in their portal (restriction portal_visible_only). */
function patientView(ctx: QueryCtx): Filters {
  return ctx.scope.kind === "patient" || ctx.restrictions.has("portal_visible_only") ? [["portal_visible", "is.true"]] : [];
}

/**
 * The prescriptions behind a batch of dispense rows (staff only): their
 * patient and the item each line names, for authorizingPrescription.
 */
async function prescriptionsFor(ctx: QueryCtx, rows: Row[]): Promise<Row[]> {
  if (ctx.scope.kind !== "staff") return [];
  const ids = distinctStrings(
    rows.map((r) => r.prescription_id),
    SOURCE_ID,
  );
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const part = ids.slice(i, i + 100);
    out.push(...(await ctx.db.select("prescriptions", ["id", "patient_id", "lines"], [["id", inList(part)]], { limit: part.length })));
  }
  return out;
}

async function mapContext(ctx: QueryCtx, rows: Row[]): Promise<MedicationMapContext> {
  const staff = ctx.scope.kind === "staff";
  const [items, visits, practitioners, rxRows] = await Promise.all([
    // The unit for quantity (staff only: patients cannot read the catalogue).
    staff ? catalogueEntries(ctx, rows.map((r) => r.item_id), false) : Promise.resolve(new Map()),
    readableVisits(ctx, rows.map((r) => r.visit_id)),
    practitionerIds(ctx, rows.map((r) => r.dispensed_by)),
    prescriptionsFor(ctx, rows),
  ]);
  const refs = await referenceContext(ctx.db, [
    ...ownersOf(rows).filter((v): v is string => v !== null),
    ...visits.values(),
    ...ownersOf(rxRows).filter((v): v is string => v !== null),
  ]);
  const prescriptions = new Map<string, PrescriptionLines>();
  for (const r of rxRows) {
    if (typeof r.id !== "string") continue;
    prescriptions.set(r.id, {
      patientFhirId: typeof r.patient_id === "string" ? refs.patientFhirIds.get(r.patient_id) ?? null : null,
      itemIds: prescriptionLines(r).map(lineItemId),
    });
  }
  return {
    ...refs,
    items,
    visitPatients: visitPatientIds(visits, refs.patientFhirIds),
    practitioners,
    prescriptions,
    patientView: !staff,
  };
}

async function read(ctx: QueryCtx, id: string): Promise<QueryResult> {
  const sourceId = dispenseSourceId(id);
  if (!sourceId) return emptyResult();
  const rows = await ctx.db.select(
    "dispenses",
    DISPENSE_COLUMNS,
    [["id", `eq.${sourceId}`], ...scopeFilter(ctx), ...patientView(ctx), DISPENSE_NOT_ADD_MEDICINE],
    { limit: 1 },
  );
  if (!rows.length) return emptyResult();
  const dispense = mapMedicationDispense(rows[0], await mapContext(ctx, rows));
  return dispense ? { page: { resources: [dispense], next: null }, owners: ownersOf(rows) } : emptyResult();
}

async function search(ctx: QueryCtx, search: ParsedSearch): Promise<QueryResult> {
  const notes = patientNotes(ctx);
  const named = namedPatientFilter(ctx);
  if (named === null) return emptyResult(notes);
  const filters: Filters = [...scopeFilter(ctx), ...patientView(ctx), ...named, DISPENSE_NOT_ADD_MEDICINE];

  const idParam = one(search, "_id");
  if (idParam) {
    const sourceId = dispenseSourceId(parseId(idParam));
    if (!sourceId) return emptyResult(notes);
    filters.push(["id", `eq.${sourceId}`]);
  }

  const status = one(search, "status");
  if (status) {
    const code = statusCode(status, "status", MEDICATION_DISPENSE_STATUS_SYSTEM);
    const f = code === null ? null : statusSearchFilter(MEDICATION_DISPENSE_STATUS, "dispense_status", code);
    if (!f) return emptyResult(notes);
    filters.push(...f);
  }

  // prescription=MedicationRequest/<prescription id>-<n>: rows of that
  // prescription, kept only when the published authorizingPrescription is
  // that exact line (so search and resource agree).
  let prescriptionRef: string | null = null;
  const prescription = one(search, "prescription");
  // A patient's view never carries authorizingPrescription, so the search
  // could only ever come back empty; refuse it rather than imply "none".
  if (prescription && ctx.scope.kind !== "staff") {
    throw errors.badRequest("The prescription parameter is not available to patient accounts.");
  }
  if (prescription) {
    const requestId = parseReferenceId(prescription, "MedicationRequest", "prescription");
    const parsed = parseMedicationRequestId(requestId);
    if (!parsed || !SOURCE_ID.test(parsed.prescriptionId)) return emptyResult(notes);
    filters.push(["prescription_id", `eq.${parsed.prescriptionId}`]);
    prescriptionRef = `MedicationRequest/${requestId}`;
  }

  const { page, rows } = await keysetPage<MedicationDispense>({
    db: ctx.db,
    table: "dispenses",
    columns: DISPENSE_COLUMNS,
    key: "id",
    keyPattern: SOURCE_ID,
    filters,
    count: search.count,
    cursor: search.cursor,
    map: async (batch) => {
      const mctx = await mapContext(ctx, batch);
      return batch.map((r) => {
        const d = mapMedicationDispense(r, mctx);
        if (!d) return null;
        if (prescriptionRef !== null && !d.authorizingPrescription?.some((p) => p.reference === prescriptionRef)) return null;
        return d;
      });
    },
  });
  return { page, owners: ownersOf(rows), ...notes };
}

const STATUS_CODES = ["preparation", "in-progress", "cancelled", "on-hold", "completed", "entered-in-error", "stopped", "declined", "unknown"];

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const refTo = (v: unknown, type: string) => isObj(v) && typeof v.reference === "string" && v.reference.startsWith(`${type}/`);

function validate(resource: Json, add: (path: string, message: string) => void): void {
  if (!STATUS_CODES.includes(resource.status as string)) add("status", "not a medicationdispense-status code");
  if ((resource.medicationReference !== undefined) === (resource.medicationCodeableConcept !== undefined)) {
    add("medication[x]", "exactly one of medicationReference or medicationCodeableConcept is required");
  }
  const c = resource.medicationCodeableConcept;
  if (c !== undefined) {
    if (!isObj(c) || typeof c.text !== "string") add("medicationCodeableConcept", "the medicine must be named (text)");
    else if (c.coding !== undefined) add("medicationCodeableConcept.coding", "no verified medicine code exists; text only");
  }
  if (!refTo(resource.subject, "Patient")) add("subject", "required (a Patient)");
  if (resource.context !== undefined && !refTo(resource.context, "Encounter")) add("context", "must reference an Encounter");
  for (const [i, p] of (Array.isArray(resource.authorizingPrescription) ? resource.authorizingPrescription : []).entries()) {
    if (!refTo(p, "MedicationRequest")) add(`authorizingPrescription[${i}]`, "must reference a MedicationRequest");
  }
  for (const [i, p] of (Array.isArray(resource.performer) ? resource.performer : []).entries()) {
    if (!isObj(p) || !refTo(p.actor, "Practitioner")) add(`performer[${i}].actor`, "must reference a Practitioner");
  }
  const q = resource.quantity;
  if (q !== undefined) {
    if (!isObj(q) || typeof q.value !== "number" || !(q.value > 0) || typeof q.unit !== "string" || q.unit === "") {
      add("quantity", "a quantity needs a positive value and its unit");
    } else if (q.system !== undefined || q.code !== undefined) {
      add("quantity", "dispensing units are not UCUM; no system or code");
    }
  }
  // mBHR records no preparation step and no handover time (the time it
  // records is when the medicine was recorded as given, not a handover).
  if (resource.whenPrepared !== undefined) add("whenPrepared", "not recorded by mBHR");
  if (resource.whenHandedOver !== undefined) add("whenHandedOver", "mBHR records no handover time");
  for (const [i, d] of (Array.isArray(resource.dosageInstruction) ? resource.dosageInstruction : []).entries()) {
    if (!isObj(d)) continue;
    for (const k of Object.keys(d)) if (k !== "text") add(`dosageInstruction[${i}].${k}`, "dosing is published as text only");
  }
}

export const medicationDispenseModule: ResourceModule = { definition, read, search, validate };
