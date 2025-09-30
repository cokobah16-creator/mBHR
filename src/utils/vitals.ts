// Vital signs calculations and flagging

export interface VitalFlags {
  hypertension?: boolean
  fever?: boolean
  tachycardia?: boolean
  underweight?: boolean
  obese?: boolean
}

export function calculateBMI(heightCm: number, weightKg: number): number {
  if (heightCm <= 0 || weightKg <= 0) return 0
  const heightM = heightCm / 100
  return Math.round((weightKg / (heightM * heightM)) * 10) / 10
}

export function flagVitals(vitals: {
  systolic?: number
  diastolic?: number
  tempC?: number
  pulseBpm?: number
  bmi?: number
}): string[] {
  const flags: string[] = []
  
  // Hypertension: systolic ≥ 140 or diastolic ≥ 90
  if ((vitals.systolic && vitals.systolic >= 140) || 
      (vitals.diastolic && vitals.diastolic >= 90)) {
    flags.push('hypertension')
  }
  
  // Fever: temp ≥ 38.0°C
  if (vitals.tempC && vitals.tempC >= 38.0) {
    flags.push('fever')
  }
  
  // Tachycardia: pulse ≥ 100 bpm
  if (vitals.pulseBpm && vitals.pulseBpm >= 100) {
    flags.push('tachycardia')
  }
  
  // BMI flags
  if (vitals.bmi) {
    if (vitals.bmi < 18.5) {
      flags.push('underweight')
    } else if (vitals.bmi >= 30) {
      flags.push('obese')
    }
  }
  
  return flags
}

export function getFlagColor(flag: string): string {
  switch (flag) {
    case 'hypertension':
    case 'fever':
    case 'tachycardia':
      return 'text-red-600 bg-red-50'
    case 'underweight':
    case 'obese':
      return 'text-yellow-600 bg-yellow-50'
    default:
      return 'text-gray-600 bg-gray-50'
  }
}

export function getFlagLabel(flag: string): string {
  switch (flag) {
    case 'hypertension':
      return 'High BP'
    case 'fever':
      return 'Fever'
    case 'tachycardia':
      return 'High HR'
    case 'underweight':
      return 'Underweight'
    case 'obese':
      return 'Obese'
    default:
      return flag
  }
}