export interface AudioPrompt {
  key: string;
  en: string;
  ha: string;
  yo: string;
  category:
    | "action"
    | "auth"
    | "patient"
    | "vitals"
    | "pharmacy"
    | "queue"
    | "status"
    | "navigation";
  priority: number;
}

export const TOP_20_AUDIO_PROMPTS: AudioPrompt[] = [
  {
    key: "action.register",
    en: "Register Patient",
    ha: "Rubuta Majiyyaci",
    yo: "Forukosile Alaisan",
    category: "action",
    priority: 1,
  },
  {
    key: "action.vitals",
    en: "Record Vitals",
    ha: "Rubuta Alamun Lafiya",
    yo: "Gba Ayewo Ara",
    category: "action",
    priority: 2,
  },
  {
    key: "action.consult",
    en: "Consultation",
    ha: "Shawarwari",
    yo: "Ijiroro",
    category: "action",
    priority: 3,
  },
  {
    key: "action.pharmacy",
    en: "Pharmacy",
    ha: "Kantin Magani",
    yo: "Ile Ogun",
    category: "action",
    priority: 4,
  },
  {
    key: "action.queue",
    en: "View Queue",
    ha: "Duba Layi",
    yo: "Wo Ila",
    category: "action",
    priority: 5,
  },
  {
    key: "auth.welcome",
    en: "Welcome",
    ha: "Maraba",
    yo: "Kaabo",
    category: "auth",
    priority: 6,
  },
  {
    key: "auth.enterPin",
    en: "Enter your PIN",
    ha: "Shigar da lambar sirri",
    yo: "Te nomba ipamo re",
    category: "auth",
    priority: 7,
  },
  {
    key: "auth.login",
    en: "Login",
    ha: "Shiga",
    yo: "Wole",
    category: "auth",
    priority: 8,
  },
  {
    key: "patient.givenName",
    en: "First Name",
    ha: "Suna na Farko",
    yo: "Oruko Akoko",
    category: "patient",
    priority: 9,
  },
  {
    key: "patient.familyName",
    en: "Family Name",
    ha: "Sunan Iyali",
    yo: "Oruko Idile",
    category: "patient",
    priority: 10,
  },
  {
    key: "patient.phone",
    en: "Phone Number",
    ha: "Lambar Waya",
    yo: "Nomba Foonu",
    category: "patient",
    priority: 11,
  },
  {
    key: "patient.dob",
    en: "Date of Birth",
    ha: "Ranar Haihuwa",
    yo: "Ojo Ibi",
    category: "patient",
    priority: 12,
  },
  {
    key: "patient.address",
    en: "Address",
    ha: "Adireshi",
    yo: "Adiresi",
    category: "patient",
    priority: 13,
  },
  {
    key: "vitals.height",
    en: "Height",
    ha: "Tsawo",
    yo: "Giga",
    category: "vitals",
    priority: 14,
  },
  {
    key: "vitals.weight",
    en: "Weight",
    ha: "Nauyi",
    yo: "Iwuwo",
    category: "vitals",
    priority: 15,
  },
  {
    key: "vitals.temperature",
    en: "Temperature",
    ha: "Zafin Jiki",
    yo: "Igbona Ara",
    category: "vitals",
    priority: 16,
  },
  {
    key: "vitals.bloodPressure",
    en: "Blood Pressure",
    ha: "Matsin Jini",
    yo: "Tite Eje",
    category: "vitals",
    priority: 17,
  },
  {
    key: "pharmacy.dispense",
    en: "Dispense Medication",
    ha: "Raba Magani",
    yo: "Pin Ogun",
    category: "pharmacy",
    priority: 18,
  },
  {
    key: "pharmacy.medication",
    en: "Medication",
    ha: "Magani",
    yo: "Ogun",
    category: "pharmacy",
    priority: 19,
  },
  {
    key: "status.success",
    en: "Success",
    ha: "Nasara",
    yo: "Aseyori",
    category: "status",
    priority: 20,
  },
];

export function getAudioPromptText(
  key: string,
  locale: string,
): string | undefined {
  const prompt = TOP_20_AUDIO_PROMPTS.find((p) => p.key === key);
  if (!prompt) return undefined;

  switch (locale) {
    case "ha":
      return prompt.ha;
    case "yo":
      return prompt.yo;
    default:
      return prompt.en;
  }
}

export function getAudioFileName(key: string): string {
  return key.replace(/\./g, "_") + ".mp3";
}

export function getAudioFilePath(key: string, locale: string): string {
  return `/audio/${locale}/${getAudioFileName(key)}`;
}
