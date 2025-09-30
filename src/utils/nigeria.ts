// Nigerian states and LGAs data
export const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue',
  'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu',
  'FCT', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi',
  'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun',
  'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'
]

// Sample LGAs for major states (can be expanded)
export const LGAS_BY_STATE: Record<string, string[]> = {
  'Lagos': ['Agege', 'Ajeromi-Ifelodun', 'Alimosho', 'Amuwo-Odofin', 'Apapa', 'Badagry', 'Epe', 'Eti-Osa', 'Ibeju-Lekki', 'Ifako-Ijaiye', 'Ikeja', 'Ikorodu', 'Kosofe', 'Lagos Island', 'Lagos Mainland', 'Mushin', 'Ojo', 'Oshodi-Isolo', 'Shomolu', 'Surulere'],
  'Kano': ['Ajingi', 'Albasu', 'Bagwai', 'Bebeji', 'Bichi', 'Bunkure', 'Dala', 'Dambatta', 'Dawakin Kudu', 'Dawakin Tofa', 'Doguwa', 'Fagge', 'Gabasawa', 'Garko', 'Garun Mallam', 'Gaya', 'Gezawa', 'Gwale', 'Gwarzo', 'Kabo', 'Kano Municipal', 'Karaye', 'Kibiya', 'Kiru', 'Kumbotso', 'Kunchi', 'Kura', 'Madobi', 'Makoda', 'Minjibir', 'Nasarawa', 'Rano', 'Rimin Gado', 'Rogo', 'Shanono', 'Sumaila', 'Takai', 'Tarauni', 'Tofa', 'Tsanyawa', 'Tudun Wada', 'Ungogo', 'Warawa', 'Wudil'],
  'FCT': ['Abaji', 'Bwari', 'Gwagwalada', 'Kuje', 'Municipal Area Council', 'Kwali']
}

export function formatPhoneNG(phone: string): string {
  // Remove all non-digits
  const digits = phone.replace(/\D/g, '')
  
  // Handle different formats
  if (digits.startsWith('234')) {
    // International format: +234XXXXXXXXXX
    return `+${digits}`
  } else if (digits.startsWith('0') && digits.length === 11) {
    // Local format: 0XXXXXXXXXX -> +234XXXXXXXXX
    return `+234${digits.slice(1)}`
  } else if (digits.length === 10) {
    // Without leading 0: XXXXXXXXXX -> +234XXXXXXXXXX
    return `+234${digits}`
  }
  
  return phone // Return as-is if format not recognized
}

export function validatePhoneNG(phone: string): boolean {
  const formatted = formatPhoneNG(phone)
  // Nigerian mobile numbers: +234[7-9]XXXXXXXXX (11 digits after +234)
  return /^\+234[789]\d{9}$/.test(formatted)
}

export function getLGAsForState(state: string): string[] {
  return LGAS_BY_STATE[state] || []
}