// Observation <- public.vitals (vital signs) and public.lab_results
// (laboratory, see labObservation.ts).
//
// A search runs over the two sources in turn: first vital signs, then
// laboratory results, each in its own keyset order. The cursor records which
// source the page stopped in (p = "v" or "l"). A search whose category,
// code, status, _id or based-on can only match one source reads only that
// one. Laboratory rows are read only by staff with consult or lab_review
// (restriction "no_lab_rows" otherwise) and, for a patient, only results
// that were reviewed and released to them.

import type { Observation } from "../types/fhir";
import { READ_PERMISSIONS } from "../authorization/permissions";
import { VITALS_COLUMNS, mapVitalSign, parseObservationId } from "../mappers/observation";
import { LOCAL, LOINC, OBSERVATION_CATEGORY, VITAL_SIGNS, type VitalSignDef } from "../terminology/codeSystems";
import { referenceContext } from "../patients/canonical";
import { errors } from "../errors/operationOutcome";
import { parseId, parseReferenceId, parseToken, type Cursor, type ParsedSearch } from "../search/params";
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
import { LAB_OBSERVATION_PREFIX, labObservationSource, validateLabObservation } from "./labObservation";

export const observationDefinition: ResourceDefinition = {
  type: "Observation",
  source: "public.vitals (one row -> up to 7 vital-sign Observations); public.lab_results (one laboratory Observation per current result)",
  idStrategy: "<vitals.id>-<kind> (bp, heart-rate, temperature, weight, height, bmi, spo2); lab-<lab_results.id>",
  fields: [
    "status (vitals: final; laboratory: preliminary until reviewed, then final)",
    "category (vital-signs or laboratory)",
    "code (vitals: LOINC + local; laboratory: the test as named, local code only when verified)",
    "subject",
    "encounter",
    "effectiveDateTime",
    "valueQuantity (UCUM, vitals) / valueQuantity or valueString (laboratory, as recorded)",
    "component (blood pressure; a missing half carries dataAbsentReason)",
    "interpretation (laboratory, as recorded)",
    "referenceRange.text (laboratory, as recorded)",
  ],
  profiles: [],
  interactions: ["read", "search-type"],
  searchParams: [
    { name: "_id", type: "token", documentation: "Logical id of the resource." },
    { name: "patient", type: "reference", documentation: "Patient/[id]. Required unless _id, encounter or based-on is given." },
    { name: "subject", type: "reference", documentation: "Same as patient (Patient/[id] only)." },
    { name: "encounter", type: "reference", documentation: "Encounter/[id]." },
    {
      name: "date",
      type: "date",
      documentation:
        "When measured (vital signs) or collected (laboratory). A date without a time is a clinic day in Africa/Lagos. Up to two bounds.",
      maxRepeats: 2,
    },
    { name: "category", type: "token", documentation: "vital-signs or laboratory." },
    {
      name: "code",
      type: "token",
      documentation: "A LOINC code from the vital signs profile, an mBHR vitals column code, or an mBHR laboratory test code.",
    },
    { name: "status", type: "token", documentation: "final or preliminary." },
    { name: "based-on", type: "reference", documentation: "ServiceRequest/[id]: the laboratory order (laboratory results only)." },
  ],
  requiredSearch: [["_id"], ["patient"], ["subject"], ["encounter"], ["based-on"]],
  writeSupport: false,
  consentClass: "clinical",
  readPermissions: READ_PERMISSIONS.Observation,
  patientAccess: true,
  sensitiveSearch: true,
  notes: [
    "Laboratory results need consult or lab_review; other staff see vital signs only.",
    "Patients see portal-visible vital signs and laboratory results released to them.",
  ],
};

const START = "start";

/** Vital-sign kinds a code= token selects (LOINC from the profile, or a local column code). */
function kindsForCode(raw: string): Set<string> {
  const t = parseToken(raw, "code");
  const kinds = new Set<string>();
  for (const def of VITAL_SIGNS) {
    const loinc = def.loinc.some((c) => c.code === t.code) && (t.system === null || t.system === LOINC);
    const local = def.columns.includes(t.code) && (t.system === null || t.system === LOCAL.vitals);
    if (loinc || local) kinds.add(def.kind);
  }
  return kinds;
}

/** The vital-sign kinds this search can match (empty: vital signs are not searched). */
function vitalKinds(search: ParsedSearch): Set<string> {
  let kinds = new Set(VITAL_SIGNS.map((d) => d.kind));
  const category = one(search, "category");
  if (category) {
    const t = parseToken(category, "category");
    if (t.code !== "vital-signs" || (t.system !== null && t.system !== OBSERVATION_CATEGORY)) return new Set();
  }
  const status = one(search, "status");
  if (status && parseToken(status, "status").code !== "final") return new Set();
  if (one(search, "based-on")) return new Set();
  const code = one(search, "code");
  if (code) {
    const selected = kindsForCode(code);
    kinds = new Set([...kinds].filter((k) => selected.has(k)));
  }
  const idParam = one(search, "_id");
  if (idParam) {
    const id = parseId(idParam);
    const parsed = id.startsWith(LAB_OBSERVATION_PREFIX) ? null : parseObservationId(id);
    if (!parsed || !SOURCE_ID.test(parsed.vitalsId)) return new Set();
    kinds = new Set([...kinds].filter((k) => k === parsed.kind));
  }
  return kinds;
}

function labAllowed(ctx: QueryCtx): boolean {
  return !ctx.restrictions.has("no_lab_rows");
}

/** Only rows that can yield at least one of the kinds (keeps pages full; phase1-audit D2). */
function measuredFilter(defs: VitalSignDef[]): Filters {
  const cols = [...new Set(defs.flatMap((d) => d.columns))];
  return cols.length ? [["or", `(${cols.map((c) => `${c}.gt.0`).join(",")})`]] : [];
}

/** The portal shows vital signs unless a clinician marked them hidden. */
function patientView(ctx: QueryCtx): Filters {
  return ctx.scope.kind === "patient" ? [["or", "(portal_visible.is.null,portal_visible.is.true)"]] : [];
}

interface VitalItem {
  obs: Observation;
  rowId: string;
  index: number;
  owner: string | null;
}

async function vitalsPhase(
  ctx: QueryCtx,
  filters: Filters,
  kinds: Set<string>,
  count: number,
  cursor: { k: string; s?: number } | null,
): Promise<{ items: VitalItem[]; next: { k: string; s?: number } | null }> {
  const defs = VITAL_SIGNS.map((def, index) => ({ def, index })).filter((d) => kinds.has(d.def.kind));
  const batch = Math.min(Math.max(count + 1, 25), 101);
  const out: VitalItem[] = [];
  let afterRow = cursor?.k ?? null;
  let afterIndex = cursor?.s;
  for (let round = 0; round < MAX_KEYSET_ROUNDS; round++) {
    const f: Filters = [...filters, ...measuredFilter(defs.map((d) => d.def))];
    // A partly emitted row is fetched again (gte) and resumes after its index.
    if (afterRow !== null) f.push(["id", `${afterIndex !== undefined ? "gte" : "gt"}.${afterRow}`]);
    const rows = await ctx.db.select("vitals", VITALS_COLUMNS, f, { order: "id.asc", limit: batch });
    const refs = await referenceContext(ctx.db, ownersOf(rows).filter((v): v is string => v !== null));
    for (const row of rows) {
      const rowId = String(row.id);
      for (const { def, index } of defs) {
        if (afterIndex !== undefined && rowId === afterRow && index <= afterIndex) continue;
        const obs = mapVitalSign(row, def, refs);
        if (!obs) continue;
        if (out.length === count) {
          const last = out[out.length - 1];
          return { items: out, next: { k: last.rowId, s: last.index } };
        }
        out.push({ obs, rowId, index, owner: ownersOf([row])[0] });
      }
      afterRow = rowId;
      afterIndex = undefined;
    }
    if (rows.length < batch) return { items: out, next: null };
  }
  return { items: out, next: afterRow !== null ? { k: afterRow } : null };
}

async function read(ctx: QueryCtx, id: string): Promise<QueryResult> {
  if (id.startsWith(LAB_OBSERVATION_PREFIX)) {
    if (!labAllowed(ctx)) return emptyResult();
    return labObservationSource.read(ctx, id);
  }
  const parsed = parseObservationId(id);
  const def = parsed && VITAL_SIGNS.find((d) => d.kind === parsed.kind);
  if (!parsed || !def || !SOURCE_ID.test(parsed.vitalsId)) return emptyResult();
  const rows = await ctx.db.select(
    "vitals",
    VITALS_COLUMNS,
    [["id", `eq.${parsed.vitalsId}`], ...scopeFilter(ctx), ...patientView(ctx)],
    { limit: 1 },
  );
  const refs = await referenceContext(ctx.db, ownersOf(rows).filter((v): v is string => v !== null));
  const obs = rows.length ? mapVitalSign(rows[0], def, refs) : null;
  return { page: { resources: obs ? [obs] : [], next: null }, owners: obs ? ownersOf(rows) : [] };
}

async function search(ctx: QueryCtx, search: ParsedSearch): Promise<QueryResult> {
  const notes = patientNotes(ctx);
  const named = namedPatientFilter(ctx);
  if (named === null) return emptyResult(notes);

  const kinds = vitalKinds(search);
  const wantLabs = labAllowed(ctx) && labObservationSource.selects(search);
  const cursor: Cursor | null = search.cursor;
  const phase = cursor?.p ?? (kinds.size ? "v" : "l");
  if (phase !== "v" && phase !== "l") throw errors.badRequest("_cursor is not valid. Start the search again.");

  const resources: Observation[] = [];
  const owners: (string | null)[] = [];
  let next: Cursor | null = null;
  let remaining = search.count;

  if (phase === "v" && kinds.size) {
    if (cursor) checkCursorKey(cursor, SOURCE_ID);
    const filters: Filters = [...scopeFilter(ctx), ...patientView(ctx), ...named];
    const encounter = one(search, "encounter");
    if (encounter) filters.push(["visit_id", `eq.${parseReferenceId(encounter, "Encounter", "encounter")}`]);
    filters.push(...dateFilters("taken_at", search.values.get("date"), "date"));
    const idParam = one(search, "_id");
    if (idParam) {
      const parsed = parseObservationId(parseId(idParam));
      if (parsed && SOURCE_ID.test(parsed.vitalsId)) filters.push(["id", `eq.${parsed.vitalsId}`]);
    }
    const r = await vitalsPhase(ctx, filters, kinds, remaining, cursor ? { k: cursor.k, s: cursor.s } : null);
    for (const item of r.items) {
      resources.push(item.obs);
      owners.push(item.owner);
    }
    remaining -= r.items.length;
    if (r.next) next = { ...r.next, p: "v" };
    else if (wantLabs) {
      if (remaining > 0) {
        const lab = await labObservationSource.search({ ctx, search, patientIds: ctx.patients?.ids ?? undefined, after: null, count: remaining });
        resources.push(...lab.resources);
        owners.push(...lab.owners);
        if (lab.next) next = { k: lab.next, p: "l" };
      } else {
        next = { k: START, p: "l" };
      }
    }
  } else if (wantLabs) {
    const after = cursor && cursor.p === "l" && cursor.k !== START ? cursor.k : null;
    const lab = await labObservationSource.search({ ctx, search, patientIds: ctx.patients?.ids ?? undefined, after, count: remaining });
    resources.push(...lab.resources);
    owners.push(...lab.owners);
    if (lab.next) next = { k: lab.next, p: "l" };
  }
  return { page: { resources, next }, owners, ...notes };
}

export const observationModule: ResourceModule = { definition: observationDefinition, read, search, validate: validateLabObservation };
