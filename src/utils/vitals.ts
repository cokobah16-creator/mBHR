// Vital signs calculations and flagging

export interface VitalFlags {
  hypertension?: boolean
  fever?: boolean
  tachycardia?: boolean
  underweight?: boolean
  obese?: boolean
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
    default:
      return flag
  }
}