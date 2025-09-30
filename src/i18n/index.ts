import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

// Translation resources
const resources = {
  en: {
    translation: {
      // Common
      'common.save': 'Save',
      'common.cancel': 'Cancel',
      'common.delete': 'Delete',
      'common.edit': 'Edit',
      'common.search': 'Search',
      'common.loading': 'Loading...',
      'common.error': 'Error',
      'common.success': 'Success',
      
      // Auth
      'auth.login': 'Login',
      'auth.logout': 'Logout',
      'auth.pin': 'PIN',
      'auth.enterPin': 'Enter your PIN',
      'auth.invalidPin': 'Invalid PIN',
      'auth.lockedOut': 'Too many failed attempts. Try again later.',
      
      // Navigation
      'nav.dashboard': 'Dashboard',
      'nav.patients': 'Patients',
      'nav.queue': 'Queue',
      'nav.inventory': 'Inventory',
      
      // Patient
      'patient.register': 'Register Patient',
      'patient.givenName': 'Given Name',
      'patient.familyName': 'Family Name',
      'patient.phone': 'Phone Number',
      'patient.address': 'Address',
      'patient.state': 'State',
      'patient.lga': 'LGA',
      
      // Vitals
      'vitals.height': 'Height (cm)',
      'vitals.weight': 'Weight (kg)',
      'vitals.temperature': 'Temperature (°C)',
      'vitals.pulse': 'Pulse (bpm)',
      'vitals.bloodPressure': 'Blood Pressure',
      'vitals.systolic': 'Systolic',
      'vitals.diastolic': 'Diastolic',
      
      // App
      'app.title': 'Med Bridge Health Reach',
      'app.subtitle': 'Powered by Dr. Isioma Okobah Foundation',
      'app.offline': 'Offline',
      'app.online': 'Online'
    }
  },
  ha: {
    translation: {
      // Hausa translations (stubs)
      'common.save': 'Ajiye',
      'common.cancel': 'Soke',
      'auth.login': 'Shiga',
      'patient.register': 'Rubuta Majiyyaci'
    }
  },
  yo: {
    translation: {
      // Yoruba translations (stubs)
      'common.save': 'Fi pamọ',
      'common.cancel': 'Fagilee',
      'auth.login': 'Wọle',
      'patient.register': 'Forukọsilẹ Alaisan'
    }
  },
  ig: {
    translation: {
      // Igbo translations (stubs)
      'common.save': 'Chekwaa',
      'common.cancel': 'Kagbuo',
      'auth.login': 'Banye',
      'patient.register': 'Debanye Onye Ọrịa'
    }
  }
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    debug: false,
    
    interpolation: {
      escapeValue: false
    },
    
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage']
    }
  })

export default i18n