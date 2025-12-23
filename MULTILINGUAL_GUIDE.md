# Multilingual Functionality Guide

## Overview

The mBHR application now supports 5 languages:
- **English (en)** - Default
- **Hausa (ha)** - Hausa
- **Yoruba (yo)** - Yorùbá
- **Igbo (ig)** - Igbo
- **Nigerian Pidgin (pcm)** - Naija

## How to Change Languages

### Via Language Selector

1. Look for the language selector in the header (desktop) or mobile menu
2. Click the language dropdown showing the current language
3. Select your preferred language from the list
4. The interface will immediately update to show content in that language

### Language Persistence

- Your language preference is saved in browser localStorage
- The app will remember your choice on future visits
- Key: `mbhr-locale` in localStorage

## Translation Keys

All translations are organized by domain:

### Navigation (`nav.*`)
- `nav.dashboard` - Dashboard
- `nav.patients` - Patients
- `nav.queue` - Queue
- `nav.inventory` - Inventory
- `nav.pharmacy` - Pharmacy
- `nav.users` - Users
- `nav.analytics` - Analytics
- `nav.games` - Games

### Actions (`action.*`)
- `action.save` - Save
- `action.cancel` - Cancel
- `action.delete` - Delete
- `action.edit` - Edit
- `action.search` - Search
- `action.start` - Start
- `action.complete` - Complete
- `action.next` - Next
- `action.back` - Back
- `action.submit` - Submit

### Authentication (`auth.*`)
- `auth.login` - Login
- `auth.logout` - Logout
- `auth.pin` - PIN
- `auth.enterPin` - Enter your PIN
- `auth.invalidPin` - Invalid PIN
- `auth.lockedOut` - Too many failed attempts
- `auth.welcome` - Welcome

### Patient Information (`patient.*`)
- `patient.register` - Register Patient
- `patient.givenName` - First Name
- `patient.familyName` - Last Name
- `patient.sex` - Sex
- `patient.dob` - Date of Birth
- `patient.phone` - Phone Number
- `patient.address` - Address
- `patient.state` - State
- `patient.lga` - Local Government Area

### Vital Signs (`vitals.*`)
- `vitals.height` - Height (cm)
- `vitals.weight` - Weight (kg)
- `vitals.temperature` - Temperature (°C)
- `vitals.pulse` - Pulse (bpm)
- `vitals.bloodPressure` - Blood Pressure
- `vitals.systolic` - Systolic
- `vitals.diastolic` - Diastolic
- `vitals.spo2` - SpO2 (%)
- `vitals.bmi` - BMI

### Application (`app.*`)
- `app.title` - Med Bridge Health Reach
- `app.subtitle` - Powered by Dr. Isioma Okobah Foundation
- `app.offline` - Offline
- `app.online` - Online

## Using Translations in Code

### With the useT Hook (Enhanced with Audio)

```typescript
import { useT } from '@/hooks/useT'

function MyComponent() {
  const { t, speak, changeLocale, locale } = useT()

  return (
    <div>
      <h1>{t('nav.dashboard')}</h1>
      <button onClick={() => speak('auth.welcome')}>
        Play Audio
      </button>
      <button onClick={() => changeLocale('ha')}>
        Switch to Hausa
      </button>
    </div>
  )
}
```

### With Standard React i18next Hook

```typescript
import { useTranslation } from 'react-i18next'

function MyComponent() {
  const { t, i18n } = useTranslation()

  return (
    <div>
      <h1>{t('nav.patients')}</h1>
      <button onClick={() => i18n.changeLanguage('yo')}>
        Switch to Yoruba
      </button>
    </div>
  )
}
```

## Audio Support

The app includes audio prompts for key phrases in multiple languages:

- Audio files are stored in `/public/audio/{locale}/{key}.mp3`
- Falls back to text-to-speech if audio file is not available
- Use the `speak()` function from `useT` hook to play audio

Example structure:
```
/public/audio/
  en/
    action_register.mp3
    action_save.mp3
  ha/
    action_register.mp3
  yo/
    ...
```

## Testing Languages

### Manual Testing

1. Start the development server
2. Login with PIN `1111`
3. Click the language selector in the header
4. Switch between languages and verify:
   - Navigation labels update
   - Form labels update
   - Button text updates
   - Error messages appear in correct language

### Browser Testing

Test with different browser language settings:
- Set browser to Hausa (ha) - App should auto-detect
- Set browser to Yoruba (yo) - App should auto-detect
- Set browser to Igbo (ig) - App should auto-detect
- Any other language defaults to English

## Adding New Translations

1. Open the appropriate JSON file in `src/i18n/locales/`
2. Add new key-value pairs following the existing structure
3. Translations automatically sync across all languages
4. Missing translations fall back to English

Example:
```json
{
  "queue.waiting": "Waiting",
  "queue.inProgress": "In Progress",
  "queue.completed": "Completed"
}
```

## Translation Files

All translation files are in `src/i18n/locales/`:
- `en.json` - English (complete)
- `ha.json` - Hausa (complete)
- `yo.json` - Yoruba (complete)
- `ig.json` - Igbo (complete)
- `pcm.json` - Nigerian Pidgin (complete)

## Technical Details

### Architecture

- **i18next** - Core internationalization framework
- **react-i18next** - React bindings for i18next
- **i18next-browser-languagedetector** - Auto-detect user language
- Custom `useT` hook - Enhanced with audio support

### Configuration

Configuration is in `src/i18n/index.ts`:
- Fallback language: English
- Detection order: localStorage → browser language
- Persistence: localStorage key `mbhr-locale`
- Supported languages: en, ha, yo, ig, pcm

### JSON Import

TypeScript is configured to import JSON files:
```json
{
  "compilerOptions": {
    "resolveJsonModule": true
  }
}
```

## Troubleshooting

### Language not changing
- Check browser console for errors
- Verify localStorage has `mbhr-locale` key
- Clear browser cache and try again

### Missing translations
- Check if key exists in JSON file
- Verify key spelling matches exactly
- Falls back to English if key not found

### Audio not playing
- Check if audio file exists in `/public/audio/{locale}/`
- Verify file naming: use underscores instead of dots
- Falls back to text-to-speech if file missing
