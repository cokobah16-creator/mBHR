// Comprehensive message key types for multilingual support
export type MsgKey =
  // Navigation
  | 'nav.dashboard' | 'nav.patients' | 'nav.queue' | 'nav.inventory' | 'nav.pharmacy'
  | 'nav.users' | 'nav.analytics' | 'nav.games' | 'nav.vitals'

  // Common actions
  | 'action.save' | 'action.cancel' | 'action.delete' | 'action.edit' | 'action.search'
  | 'action.start' | 'action.complete' | 'action.next' | 'action.back' | 'action.submit'
  | 'action.register' | 'action.vitals' | 'action.consult' | 'action.pharmacy' | 'action.queue'
  
  // Authentication
  | 'auth.login' | 'auth.logout' | 'auth.pin' | 'auth.enterPin' | 'auth.invalidPin'
  | 'auth.lockedOut' | 'auth.welcome'
  
  // Patient management
  | 'patient.register' | 'patient.givenName' | 'patient.familyName' | 'patient.sex'
  | 'patient.dob' | 'patient.phone' | 'patient.address' | 'patient.state' | 'patient.lga'
  | 'patient.male' | 'patient.female' | 'patient.other' | 'patient.photo'
  | 'patient.names' | 'patient.demographics' | 'patient.contact' | 'patient.location'
  | 'patient.age' | 'patient.registrationSuccess'
  
  // Vitals
  | 'vitals.height' | 'vitals.weight' | 'vitals.temperature' | 'vitals.pulse'
  | 'vitals.bloodPressure' | 'vitals.systolic' | 'vitals.diastolic' | 'vitals.spo2'
  | 'vitals.bmi' | 'vitals.normal' | 'vitals.abnormal' | 'vitals.high' | 'vitals.low'
  
  // Triage priorities
  | 'triage.priority.urgent' | 'triage.priority.normal' | 'triage.priority.low'
  | 'triage.category.adult' | 'triage.category.child' | 'triage.category.antenatal'
  
  // Pharmacy
  | 'pharmacy.dispense' | 'pharmacy.medication' | 'pharmacy.dosage' | 'pharmacy.directions'
  | 'pharmacy.quantity' | 'pharmacy.morning' | 'pharmacy.evening' | 'pharmacy.withFood'
  | 'pharmacy.beforeFood' | 'pharmacy.asNeeded' | 'pharmacy.dispensing'

  // Queue stages
  | 'queue.registration' | 'queue.vitals' | 'queue.consultation' | 'queue.pharmacy'
  | 'queue.waiting' | 'queue.inProgress' | 'queue.completed'
  | 'queue.status.open' | 'queue.status.closed'
  
  // Status messages
  | 'status.loading' | 'status.saving' | 'status.success' | 'status.error'
  | 'status.offline' | 'status.online' | 'status.syncing'
  
  // Numbers and quantities (for visual representation)
  | 'number.one' | 'number.two' | 'number.three' | 'number.four' | 'number.five'
  | 'number.morning' | 'number.afternoon' | 'number.evening' | 'number.night'
  
  // Medical terms (simplified)
  | 'medical.fever' | 'medical.pain' | 'medical.cough' | 'medical.headache'
  | 'medical.nausea' | 'medical.dizziness' | 'medical.fatigue'

  // Timeline
  | 'timeline.visitStarted' | 'timeline.vitalsRecorded' | 'timeline.consultationCompleted'
  | 'timeline.medicationDispensed' | 'timeline.medicalHistory' | 'timeline.consultations'
  | 'timeline.medications' | 'timeline.noEvents' | 'timeline.viewDetails'

  // Simple mode
  | 'simple.chooseAction' | 'simple.tapToHear' | 'simple.tapCameraToAddPhoto'
  | 'simple.enterFirstName' | 'simple.enterLastName' | 'simple.phoneExample'
  | 'simple.enterAddress' | 'simple.selectState' | 'simple.selectLGA'
  | 'simple.registerDescription' | 'simple.selectMedication' | 'simple.dosageExample'
  | 'simple.directionsExample'

  // Common
  | 'common.all' | 'common.years' | 'common.of' | 'common.available'

  // Stepper
  | 'stepper.step'

  // Consultation
  | 'consultation.assessment' | 'consultation.plan'

  // App
  | 'app.title'

  // Messaging
  | 'messaging.outbox' | 'messaging.sendQueued' | 'messaging.sending' | 'messaging.queued'
  | 'messaging.sent' | 'messaging.delivered' | 'messaging.failed' | 'messaging.lastSync'
  | 'messaging.neverSynced' | 'messaging.offlineQueue' | 'messaging.processComplete'
  | 'messaging.noMessages' | 'messaging.processError'

  // Accessibility
  | 'accessibility.playAudio'

  // Errors
  | 'error.registrationFailed' | 'error.dispenseFailed'

export type LocalePack = Record<MsgKey, string>

export type SupportedLocale = 'en' | 'ha' | 'yo' | 'ig' | 'pcm' // pcm = Nigerian Pidgin

export interface AudioClip {
  key: MsgKey
  url: string
  duration: number
}

export interface LocaleManifest {
  code: SupportedLocale
  name: string
  nativeName: string
  textPack: LocalePack
  audioPack: AudioClip[]
  rtl: boolean
  fallback: SupportedLocale
}