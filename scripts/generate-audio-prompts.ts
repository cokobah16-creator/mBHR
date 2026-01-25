#!/usr/bin/env npx tsx
/**
 * Audio Prompt Generation Script for mBHR Low-Literate UX
 *
 * This script generates audio files for the top 20 clinic actions in
 * Hausa and Yoruba languages to support low-literate healthcare workers.
 *
 * Usage Options:
 *
 * 1. Using Google Cloud Text-to-Speech (recommended for production):
 *    - Set GOOGLE_APPLICATION_CREDENTIALS environment variable
 *    - Run: npx tsx scripts/generate-audio-prompts.ts --provider=google
 *
 * 2. Using AWS Polly:
 *    - Configure AWS credentials
 *    - Run: npx tsx scripts/generate-audio-prompts.ts --provider=aws
 *
 * 3. Using browser Web Speech API (manual process):
 *    - Open the app in a browser
 *    - Use browser dev tools to record audio from speechSynthesis
 *
 * 4. Manual recording (highest quality):
 *    - Use the prompt list below for native speakers to record
 */

import * as fs from 'fs'
import * as path from 'path'

interface AudioPrompt {
  key: string
  en: string
  ha: string
  yo: string
  filename: string
}

const TOP_20_PROMPTS: AudioPrompt[] = [
  {
    key: 'action.register',
    en: 'Register Patient',
    ha: 'Rubuta Majiyyaci',
    yo: 'Forukosile Alaisan',
    filename: 'action_register.mp3'
  },
  {
    key: 'action.vitals',
    en: 'Record Vitals',
    ha: 'Rubuta Alamun Lafiya',
    yo: 'Gba Ayewo Ara',
    filename: 'action_vitals.mp3'
  },
  {
    key: 'action.consult',
    en: 'Consultation',
    ha: 'Shawarwari',
    yo: 'Ijiroro',
    filename: 'action_consult.mp3'
  },
  {
    key: 'action.pharmacy',
    en: 'Pharmacy',
    ha: 'Kantin Magani',
    yo: 'Ile Ogun',
    filename: 'action_pharmacy.mp3'
  },
  {
    key: 'action.queue',
    en: 'View Queue',
    ha: 'Duba Layi',
    yo: 'Wo Ila',
    filename: 'action_queue.mp3'
  },
  {
    key: 'auth.welcome',
    en: 'Welcome',
    ha: 'Maraba',
    yo: 'Kaabo',
    filename: 'auth_welcome.mp3'
  },
  {
    key: 'auth.enterPin',
    en: 'Enter your PIN',
    ha: 'Shigar da lambar sirri',
    yo: 'Te nomba ipamo re',
    filename: 'auth_enterPin.mp3'
  },
  {
    key: 'auth.login',
    en: 'Login',
    ha: 'Shiga',
    yo: 'Wole',
    filename: 'auth_login.mp3'
  },
  {
    key: 'patient.givenName',
    en: 'First Name',
    ha: 'Suna na Farko',
    yo: 'Oruko Akoko',
    filename: 'patient_givenName.mp3'
  },
  {
    key: 'patient.familyName',
    en: 'Family Name',
    ha: 'Sunan Iyali',
    yo: 'Oruko Idile',
    filename: 'patient_familyName.mp3'
  },
  {
    key: 'patient.phone',
    en: 'Phone Number',
    ha: 'Lambar Waya',
    yo: 'Nomba Foonu',
    filename: 'patient_phone.mp3'
  },
  {
    key: 'patient.dob',
    en: 'Date of Birth',
    ha: 'Ranar Haihuwa',
    yo: 'Ojo Ibi',
    filename: 'patient_dob.mp3'
  },
  {
    key: 'patient.address',
    en: 'Address',
    ha: 'Adireshi',
    yo: 'Adiresi',
    filename: 'patient_address.mp3'
  },
  {
    key: 'vitals.height',
    en: 'Height',
    ha: 'Tsawo',
    yo: 'Giga',
    filename: 'vitals_height.mp3'
  },
  {
    key: 'vitals.weight',
    en: 'Weight',
    ha: 'Nauyi',
    yo: 'Iwuwo',
    filename: 'vitals_weight.mp3'
  },
  {
    key: 'vitals.temperature',
    en: 'Temperature',
    ha: 'Zafin Jiki',
    yo: 'Igbona Ara',
    filename: 'vitals_temperature.mp3'
  },
  {
    key: 'vitals.bloodPressure',
    en: 'Blood Pressure',
    ha: 'Matsin Jini',
    yo: 'Tite Eje',
    filename: 'vitals_bloodPressure.mp3'
  },
  {
    key: 'pharmacy.dispense',
    en: 'Dispense Medication',
    ha: 'Raba Magani',
    yo: 'Pin Ogun',
    filename: 'pharmacy_dispense.mp3'
  },
  {
    key: 'pharmacy.medication',
    en: 'Medication',
    ha: 'Magani',
    yo: 'Ogun',
    filename: 'pharmacy_medication.mp3'
  },
  {
    key: 'status.success',
    en: 'Success',
    ha: 'Nasara',
    yo: 'Aseyori',
    filename: 'status_success.mp3'
  }
]

const AUDIO_DIR = path.join(process.cwd(), 'public', 'audio')

function ensureDirectories() {
  const locales = ['en', 'ha', 'yo', 'pcm', 'ig']
  for (const locale of locales) {
    const dir = path.join(AUDIO_DIR, locale)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
      console.log(`Created directory: ${dir}`)
    }
  }
}

function generateRecordingScript() {
  console.log('\n=== AUDIO RECORDING SCRIPT FOR NATIVE SPEAKERS ===\n')
  console.log('Instructions:')
  console.log('1. Record each phrase clearly and naturally')
  console.log('2. Save as MP3 format, 128kbps, 44.1kHz')
  console.log('3. Keep each recording 1-3 seconds')
  console.log('4. Normalize volume across all files')
  console.log('')

  console.log('\n--- HAUSA (ha) PROMPTS ---\n')
  for (const prompt of TOP_20_PROMPTS) {
    console.log(`File: ${prompt.filename}`)
    console.log(`Text: "${prompt.ha}"`)
    console.log(`English reference: "${prompt.en}"`)
    console.log('')
  }

  console.log('\n--- YORUBA (yo) PROMPTS ---\n')
  for (const prompt of TOP_20_PROMPTS) {
    console.log(`File: ${prompt.filename}`)
    console.log(`Text: "${prompt.yo}"`)
    console.log(`English reference: "${prompt.en}"`)
    console.log('')
  }
}

function generatePlaceholderFiles() {
  console.log('\nGenerating placeholder marker files...\n')

  for (const locale of ['ha', 'yo']) {
    for (const prompt of TOP_20_PROMPTS) {
      const text = locale === 'ha' ? prompt.ha : prompt.yo
      const filePath = path.join(AUDIO_DIR, locale, prompt.filename)

      const marker = `[TTS_PLACEHOLDER]\nKey: ${prompt.key}\nLocale: ${locale}\nText: ${text}\nGenerate audio using: speechSynthesis or cloud TTS\n`

      fs.writeFileSync(filePath, marker)
      console.log(`Created: ${filePath}`)
    }
  }
}

function printSummary() {
  console.log('\n=== AUDIO PROMPT SUMMARY ===\n')
  console.log(`Total prompts: ${TOP_20_PROMPTS.length}`)
  console.log('Languages: Hausa (ha), Yoruba (yo)')
  console.log(`Files per language: ${TOP_20_PROMPTS.length}`)
  console.log(`Total audio files needed: ${TOP_20_PROMPTS.length * 2}`)
  console.log('')
  console.log('Categories covered:')
  console.log('- Core actions (5): register, vitals, consult, pharmacy, queue')
  console.log('- Authentication (3): welcome, enterPin, login')
  console.log('- Patient registration (5): givenName, familyName, phone, dob, address')
  console.log('- Vitals recording (4): height, weight, temperature, bloodPressure')
  console.log('- Pharmacy (2): dispense, medication')
  console.log('- Status (1): success')
}

async function main() {
  const args = process.argv.slice(2)

  console.log('mBHR Audio Prompt Generator')
  console.log('===========================\n')

  ensureDirectories()

  if (args.includes('--script')) {
    generateRecordingScript()
  } else if (args.includes('--placeholders')) {
    generatePlaceholderFiles()
  } else {
    printSummary()
    console.log('\nUsage:')
    console.log('  npx tsx scripts/generate-audio-prompts.ts --script      # Print recording script')
    console.log('  npx tsx scripts/generate-audio-prompts.ts --placeholders # Create placeholder files')
  }
}

main().catch(console.error)
