// public.vitals -> Observation (vital signs)
//
// One vitals row holds several measurements, so it becomes up to seven
// Observations, one per measured value, each with a stable id
// "<vitals id>-<kind>" (see VITAL_SIGNS). Blood pressure is one Observation
// with systolic and diastolic components, as the R4 profile requires.
//
// Clinical safety rules:
//   - A missing value produces no Observation; it never becomes 0.
//   - A stored value of 0 or below is not published either. None of these
//     measurements can be 0 in a living patient (the vitals form refuses
//     such values), so a 0 can only be a data-entry or import artefact, and
//     publishing "pulse 0" would assert something clinically false. Listed
//     in docs/clinical/CLINICAL_LOGIC_CHANGES.md for clinician review.
//   - Values are published exactly as stored, in the unit of the column.
//   - The app's own vitals flags are not published as interpretation, and no
//     reference range is published: mBHR's ranges are local rules awaiting
//     clinical sign-off, not part of the recorded measurement.
//   - status is "final": a saved vitals row is a completed measurement. mBHR
//     has no preliminary or entered-in-error state for vitals.

import type { Observation, Quantity } from "../types/fhir";
import {
  BP_COMPONENTS,
  LOCAL,
  LOINC,
  OBSERVATION_CATEGORY,
  UCUM,
  VITAL_SIGNS,
  VITAL_SIGNS_PROFILE,
  type VitalSignDef,
} from "../terminology/codeSystems";
import { instant, num, patientReference, str, versionMeta, type MapContext, type Row } from "./common";

export const VITALS_COLUMNS = [
  "id",
  "patient_id",
  "visit_id",
  "height_cm",
  "weight_kg",
  "temp_c",
  "pulse_bpm",
  "systolic",
  "diastolic",
  "spo2",
  "bmi",
  "taken_at",
  "updated_at",
] as const;

const VITAL_SIGNS_CATEGORY = [
  {
    coding: [{ system: OBSERVATION_CATEGORY, code: "vital-signs", display: "Vital Signs" }],
    text: "Vital Signs",
  },
];

function measured(row: Row, column: string): number | undefined {
  const v = num(row, column);
  return v !== undefined && v > 0 ? v : undefined;
}

function quantity(value: number, unit: { code: string; display: string }): Quantity {
  return { value, unit: unit.display, system: UCUM, code: unit.code };
}

/** Kinds this row would produce, in VITAL_SIGNS order. */
export function vitalKindsPresent(row: Row): VitalSignDef[] {
  return VITAL_SIGNS.filter((def) =>
    def.kind === "bp"
      ? measured(row, "systolic") !== undefined && measured(row, "diastolic") !== undefined
      : measured(row, def.columns[0]) !== undefined,
  );
}

/** Split "<vitals id>-<kind>" into its parts, or null. */
export function parseObservationId(id: string): { vitalsId: string; kind: string } | null {
  for (const def of VITAL_SIGNS) {
    const suffix = `-${def.kind}`;
    if (id.endsWith(suffix) && id.length > suffix.length) {
      return { vitalsId: id.slice(0, -suffix.length), kind: def.kind };
    }
  }
  return null;
}

export function mapVitalSign(row: Row, def: VitalSignDef, ctx: MapContext): Observation | null {
  const id = str(row, "id");
  const subject = patientReference(ctx, row.patient_id);
  if (!id || !subject) return null;

  // The vital signs profiles require a measurement time. A row without one
  // is still published, but does not claim the profiles (the time is never
  // invented).
  const effective = instant(row, "taken_at");
  const obs: Observation = {
    resourceType: "Observation",
    id: `${id}-${def.kind}`,
    meta: versionMeta(row, effective ? [VITAL_SIGNS_PROFILE, def.profile] : undefined),
    status: "final",
    category: VITAL_SIGNS_CATEGORY,
    code: {
      coding: [
        ...def.loinc.map((c) => ({ system: LOINC, code: c.code, display: c.display })),
        // Codings in one CodeableConcept must mean the same thing, so the
        // local column code goes here only for single-column kinds; blood
        // pressure carries its column codes on its components.
        ...(def.columns.length === 1 ? [{ system: LOCAL.vitals, code: def.columns[0] }] : []),
      ],
      text: def.display,
    },
    subject,
  };
  const visitId = str(row, "visit_id");
  if (visitId) obs.encounter = { reference: `Encounter/${visitId}` };
  if (effective) obs.effectiveDateTime = effective;

  if (def.kind === "bp") {
    const systolic = measured(row, "systolic");
    const diastolic = measured(row, "diastolic");
    if (systolic === undefined || diastolic === undefined) return null;
    obs.component = [
      {
        code: {
          coding: [{ system: LOINC, ...BP_COMPONENTS.systolic }, { system: LOCAL.vitals, code: "systolic" }],
          text: BP_COMPONENTS.systolic.display,
        },
        valueQuantity: quantity(systolic, BP_COMPONENTS.unit),
      },
      {
        code: {
          coding: [{ system: LOINC, ...BP_COMPONENTS.diastolic }, { system: LOCAL.vitals, code: "diastolic" }],
          text: BP_COMPONENTS.diastolic.display,
        },
        valueQuantity: quantity(diastolic, BP_COMPONENTS.unit),
      },
    ];
    return obs;
  }

  const value = measured(row, def.columns[0]);
  if (value === undefined || !def.unit) return null;
  obs.valueQuantity = quantity(value, def.unit);
  return obs;
}

/** Every Observation one vitals row produces, in a stable order. */
export function mapVitalsRow(row: Row, ctx: MapContext): Observation[] {
  return vitalKindsPresent(row)
    .map((def) => mapVitalSign(row, def, ctx))
    .filter((o): o is Observation => o !== null);
}
