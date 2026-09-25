// Vital signs calculations and flagging

import { patientAge } from './patient'

export interface VitalFlags {
  hypertension?: boolean
  fever?: boolean
  tachycardia?: boolean
  underweight?: boolean
  obese?: boolean
}

// ---------------------------------------------------------------------------
// Age. Every threshold in this file (flagVitals, classify*) is an adult one.
// A child's normal ranges depend on age and none have been agreed with the
// clinical team yet, so a reading taken before 18, or when the age is not
// known, is marked for a check against a paediatric chart instead.
// ---------------------------------------------------------------------------

/** Age from which the adult thresholds in this file apply. */
export const ADULT_VITALS_MIN_AGE = 18

/** Flag stored instead of adult flags when adult thresholds do not apply. */
export const PAEDIATRIC_CHECK_FLAG = 'check_paediatric_chart'

/**
 * Whether adult thresholds apply to a reading: the patient was 18 or over
 * when it was taken. False when the date of birth is missing or unreadable,
 * so an unknown age is never treated as adult.
 */
export function adultVitalRangesApply(
  dob: string | null | undefined,
  takenAt: Date | string | number = new Date(),
): boolean {
  const at = new Date(takenAt)
  const age = patientAge(dob, Number.isNaN(at.getTime()) ? new Date() : at)
  return age !== null && age >= ADULT_VITALS_MIN_AGE
}

export function calculateBMI(weightKg: number, heightCm: number): number {
  if (heightCm <= 0 || weightKg <= 0) return 0
  const heightM = heightCm / 100
  return Math.round((weightKg / (heightM * heightM)) * 10) / 10
}

export function flagVitals(vitals: {
  systolic?: number
  diastolic?: number
  temperature?: number
  pulse?: number
  spo2?: number
  bmi?: number
}): string[] {
  const flags: string[] = []

  // High blood pressure: systolic ≥ 140 or diastolic ≥ 90
  if ((vitals.systolic && vitals.systolic >= 140) ||
      (vitals.diastolic && vitals.diastolic >= 90)) {
    flags.push('high_bp')
  }

  // Low blood pressure: systolic < 90 or diastolic < 60
  if ((vitals.systolic && vitals.systolic < 90) ||
      (vitals.diastolic && vitals.diastolic < 60)) {
    flags.push('low_bp')
  }

  // High temperature: temp ≥ 38.0°C
  if (vitals.temperature && vitals.temperature >= 38.0) {
    flags.push('high_temp')
  }

  // Low temperature: temp < 35.0°C
  if (vitals.temperature && vitals.temperature < 35.0) {
    flags.push('low_temp')
  }

  // High pulse: pulse ≥ 100 bpm
  if (vitals.pulse && vitals.pulse >= 100) {
    flags.push('high_pulse')
  }

  // Low pulse: pulse < 60 bpm
  if (vitals.pulse && vitals.pulse < 60) {
    flags.push('low_pulse')
  }

  // Low oxygen saturation: SpO2 < 95%
  if (vitals.spo2 && vitals.spo2 < 95) {
    flags.push('low_spo2')
  }

  // BMI flags
  if (vitals.bmi) {
    if (vitals.bmi < 18.5) {
      flags.push('low_bmi')
    } else if (vitals.bmi >= 30) {
      flags.push('high_bmi')
    }
  }

  return flags
}

export function getFlagColor(flag: string): string {
  switch (flag) {
    case 'high_bp':
    case 'low_bp':
    case 'high_temp':
    case 'low_temp':
    case 'high_pulse':
    case 'low_pulse':
    case 'low_spo2':
      return 'text-red-600 bg-red-50'
    case 'low_bmi':
    case 'high_bmi':
    case PAEDIATRIC_CHECK_FLAG:
      return 'text-yellow-600 bg-yellow-50'
    default:
      return 'text-gray-600 bg-gray-50'
  }
}

export function getFlagLabel(flag: string): string {
  switch (flag) {
    case 'high_bp':
      return 'High BP'
    case 'low_bp':
      return 'Low BP'
    case 'high_temp':
      return 'Fever'
    case 'low_temp':
      return 'Hypothermia'
    case 'high_pulse':
      return 'High HR'
    case 'low_pulse':
      return 'Low HR'
    case 'low_spo2':
      return 'Low O2'
    case 'low_bmi':
      return 'Underweight'
    case 'high_bmi':
      return 'Obese'
    case PAEDIATRIC_CHECK_FLAG:
      return 'Check paediatric chart'
    default:
      return flag
  }
}
// ---------------------------------------------------------------------------
// Clinical classification — gives staff a word, not just a number.
// Tones map to the design system's semantic colours (see StatusBadge).
// ---------------------------------------------------------------------------

export type ClinicalTone = 'neutral' | 'success' | 'warning' | 'danger' | 'critical'

export interface Classification {
  label: string
  tone: ClinicalTone
}

/** WHO adult BMI categories. */
export function classifyBMI(bmi?: number | null): Classification | null {
  if (!bmi || bmi <= 0 || !Number.isFinite(bmi)) return null
  if (bmi < 16) return { label: 'Severely underweight', tone: 'danger' }
  if (bmi < 18.5) return { label: 'Underweight', tone: 'warning' }
  if (bmi < 25) return { label: 'Normal', tone: 'success' }
  if (bmi < 30) return { label: 'Overweight', tone: 'warning' }
  return { label: 'Obese', tone: 'danger' }
}

/**
 * Blood pressure category. Thresholds align with flagVitals (≥140/90 high,
 * <90/60 low) and add a "severely elevated" band at ≥180/120, where staff
 * should escalate to a clinician immediately.
 */
export function classifyBloodPressure(
  systolic?: number | null,
  diastolic?: number | null,
): Classification | null {
  if (!systolic && !diastolic) return null
  const s = systolic ?? 0
  const d = diastolic ?? 0
  if (s >= 180 || d >= 120) return { label: 'Severely elevated', tone: 'critical' }
  if (s >= 140 || d >= 90) return { label: 'High', tone: 'danger' }
  if ((s && s < 90) || (d && d < 60)) return { label: 'Low', tone: 'danger' }
  if (s >= 130 || d >= 80) return { label: 'Elevated', tone: 'warning' }
  return { label: 'Normal', tone: 'success' }
}

export function classifyTemperature(tempC?: number | null): Classification | null {
  if (!tempC) return null
  if (tempC >= 39.5) return { label: 'High fever', tone: 'critical' }
  if (tempC >= 38) return { label: 'Fever', tone: 'danger' }
  if (tempC < 35) return { label: 'Hypothermia', tone: 'danger' }
  return { label: 'Normal', tone: 'success' }
}

export function classifyPulse(pulse?: number | null): Classification | null {
  if (!pulse) return null
  if (pulse >= 130 || pulse < 40) return { label: pulse < 40 ? 'Very low' : 'Very high', tone: 'critical' }
  if (pulse >= 100) return { label: 'High', tone: 'danger' }
  if (pulse < 60) return { label: 'Low', tone: 'warning' }
  return { label: 'Normal', tone: 'success' }
}

export function classifySpO2(spo2?: number | null): Classification | null {
  if (!spo2) return null
  if (spo2 < 90) return { label: 'Critically low', tone: 'critical' }
  if (spo2 < 95) return { label: 'Low', tone: 'danger' }
  return { label: 'Normal', tone: 'success' }
}

/** Semantic tone for a stored flag code (from flagVitals). */
export function getFlagTone(flag: string): ClinicalTone {
  switch (flag) {
    case 'low_bmi':
    case 'high_bmi':
    case PAEDIATRIC_CHECK_FLAG:
      return 'warning'
    case 'high_bp':
    case 'low_bp':
    case 'high_temp':
    case 'low_temp':
    case 'high_pulse':
    case 'low_pulse':
    case 'low_spo2':
      return 'danger'
    default:
      return 'neutral'
  }
}

/**
 * BMI and flags for a vitals record, taking the record's own field names.
 * Use this instead of calling calculateBMI/flagVitals directly: both have
 * positional/renamed parameters that were previously passed incorrectly
 * (height and weight swapped; tempC/pulseBpm/spo2 never reaching the flags).
 *
 * Pass adultRanges: false for a patient under 18 or of unknown age (see
 * adultVitalRangesApply). The adult flags are then left out and a reading
 * is marked PAEDIATRIC_CHECK_FLAG, so it never reads as normal.
 */
export function assessVitals(
  v: {
    heightCm?: number | null
    weightKg?: number | null
    tempC?: number | null
    pulseBpm?: number | null
    systolic?: number | null
    diastolic?: number | null
    spo2?: number | null
  },
  opts: { adultRanges?: boolean } = {},
): { bmi: number | null; flags: string[] } {
  const bmi =
    v.heightCm && v.weightKg && v.heightCm > 0 && v.weightKg > 0
      ? calculateBMI(v.weightKg, v.heightCm)
      : null
  if (opts.adultRanges === false) {
    const hasReading = !!(v.systolic || v.diastolic || v.tempC || v.pulseBpm || v.spo2 || bmi)
    return { bmi, flags: hasReading ? [PAEDIATRIC_CHECK_FLAG] : [] }
  }
  const flags = flagVitals({
    systolic: v.systolic ?? undefined,
    diastolic: v.diastolic ?? undefined,
    temperature: v.tempC ?? undefined,
    pulse: v.pulseBpm ?? undefined,
    spo2: v.spo2 ?? undefined,
    bmi: bmi ?? undefined,
  })
  return { bmi, flags }
}

/**
 * BMI to display for a stored vitals record. Recomputes from height and
 * weight when both exist (records saved before the argument-order fix hold
 * a wrong stored BMI); otherwise uses the stored value only if plausible.
 */
export function resolveBmi(v: {
  heightCm?: number | null
  weightKg?: number | null
  bmi?: number | null
}): number | undefined {
  if (v.heightCm && v.weightKg && v.heightCm > 0 && v.weightKg > 0) {
    return calculateBMI(v.weightKg, v.heightCm)
  }
  if (v.bmi && v.bmi >= 8 && v.bmi <= 90) return v.bmi
  return undefined
}

// ---------------------------------------------------------------------------
// Vitals form values. Every measurement is optional: a field left empty is
// stored as absent, never as NaN or 0.
// ---------------------------------------------------------------------------

export const VITAL_MEASUREMENTS = [
  'heightCm',
  'weightKg',
  'tempC',
  'pulseBpm',
  'systolic',
  'diastolic',
  'spo2',
] as const

export type VitalMeasurement = (typeof VITAL_MEASUREMENTS)[number]

/**
 * A number input's value as a measurement. An empty field is undefined; any
 * other text becomes a number (NaN when unreadable, so validation rejects
 * it instead of the entry being dropped).
 */
export function parseMeasurement(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === 'number') return raw
  const text = String(raw).trim()
  return text === '' ? undefined : Number(text)
}

/** The measurements that hold a usable number; empty fields are left out. */
export function enteredMeasurements(
  values: Partial<Record<VitalMeasurement, unknown>>,
): Partial<Record<VitalMeasurement, number>> {
  const out: Partial<Record<VitalMeasurement, number>> = {}
  for (const key of VITAL_MEASUREMENTS) {
    const value = values?.[key]
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
  }
  return out
}

/** Whether anything has been typed into the vitals form, readable or not. */
export function hasVitalsEntries(
  values: Partial<Record<VitalMeasurement, unknown>>,
): boolean {
  return VITAL_MEASUREMENTS.some((key) => {
    const value = values?.[key]
    return value !== undefined && value !== null && value !== ''
  })
}
