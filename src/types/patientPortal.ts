/**
 * Patient Portal Type Definitions
 *
 * Types for the patient-facing portal including authentication,
 * medical records access, appointments, and messaging.
 */

export interface PatientPortalUser {
  id: string
  patientId: string
  phoneNumber?: string
  email?: string
  phoneVerified: boolean
  emailVerified: boolean
  accountStatus: 'active' | 'suspended' | 'locked'
  failedLoginAttempts: number
  lockedUntil?: Date
  lastLoginAt?: Date
  preferredLanguage: string
  notificationPreferences: {
    sms: boolean
    email: boolean
    push: boolean
  }
  consentGiven: boolean
  consentGivenAt?: Date
  termsAcceptedVersion?: string
  termsAcceptedAt?: Date
  createdAt: Date
  updatedAt: Date
}

export interface PatientPortalSession {
  id: string
  portalUserId: string
  sessionToken: string
  deviceFingerprint?: string
  deviceName?: string
  ipAddress?: string
  userAgent?: string
  createdAt: Date
  expiresAt: Date
  lastActivityAt: Date
  isActive: boolean
}

export interface PatientPortalAccessLog {
  id: string
  portalUserId?: string
  patientId: string
  actionType: string
  resourceType: string
  resourceId?: string
  ipAddress?: string
  userAgent?: string
  success: boolean
  errorMessage?: string
  metadata?: Record<string, any>
  createdAt: Date
}

export interface PatientNotification {
  id: string
  patientId: string
  notificationType: string
  title: string
  message: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  read: boolean
  readAt?: Date
  actionUrl?: string
  actionLabel?: string
  metadata?: Record<string, any>
  expiresAt?: Date
  createdAt: Date
}

export interface PatientMessage {
  id: string
  patientId: string
  senderType: 'patient' | 'staff'
  senderId: string
  subject?: string
  messageBody: string
  parentMessageId?: string
  read: boolean
  readAt?: Date
  attachments?: Array<{
    fileName: string
    filePath: string
    fileSize: number
    mimeType: string
  }>
  priority: 'normal' | 'high'
  createdAt: Date
  updatedAt: Date
}

export interface PatientAppointmentRequest {
  id: string
  patientId: string
  appointmentType: string
  preferredDate1: string
  preferredTime1?: string
  preferredDate2?: string
  preferredTime2?: string
  preferredDate3?: string
  preferredTime3?: string
  reason?: string
  notes?: string
  status: 'pending' | 'approved' | 'scheduled' | 'declined' | 'cancelled'
  reviewedBy?: string
  reviewedAt?: Date
  reviewNotes?: string
  scheduledAppointmentId?: string
  createdAt: Date
  updatedAt: Date
}

export interface PatientDocument {
  id: string
  patientId: string
  documentType: string
  documentName: string
  filePath: string
  fileSize?: number
  mimeType?: string
  uploadedByPatient: boolean
  uploadedByUserId?: string
  description?: string
  metadata?: Record<string, any>
  createdAt: Date
  updatedAt: Date
}

export interface PatientConsentRecord {
  id: string
  patientId: string
  consentType: string
  consentGiven: boolean
  consentText: string
  consentVersion: string
  ipAddress?: string
  userAgent?: string
  createdAt: Date
  revokedAt?: Date
}

export interface PatientMedicalRecord {
  visitId: string
  visitDate: Date
  chiefComplaint?: string
  vitals?: {
    heightCm?: number
    weightKg?: number
    bmi?: number
    tempC?: number
    pulseBpm?: number
    systolic?: number
    diastolic?: number
    spo2?: number
  }
  consultation?: {
    subjective: string
    objective: string
    assessment: string
    plan: string
    diagnoses: string[]
    providerName: string
  }
  prescriptions?: Array<{
    medicationName: string
    dosage: string
    directions: string
    dispensedAt: Date
  }>
}

export interface OTPRequest {
  phone?: string
  email?: string
  purpose: 'registration' | 'login' | 'verification'
}

export interface OTPVerification {
  phone?: string
  email?: string
  otp: string
  dob?: string
}

export interface PatientPortalAuthResponse {
  success: boolean
  sessionToken?: string
  portalUser?: PatientPortalUser
  patient?: {
    id: string
    givenName: string
    familyName: string
    dob: string
    sex: string
  }
  error?: string
}

export interface PatientDashboardData {
  patient: {
    id: string
    givenName: string
    familyName: string
    dob: string
    sex: string
    phone: string
    email?: string
  }
  upcomingAppointments: Array<{
    id: string
    appointmentType: string
    scheduledAt: Date
    providerName?: string
    status: string
  }>
  recentVitals?: {
    takenAt: Date
    heightCm?: number
    weightKg?: number
    bmi?: number
    tempC?: number
    pulseBpm?: number
    systolic?: number
    diastolic?: number
    spo2?: number
  }
  activeMedications: Array<{
    medicationName: string
    dosage: string
    directions: string
    dispensedAt: Date
  }>
  unreadMessages: number
  unreadNotifications: number
  recentLabResults: Array<{
    testName: string
    resultDate: Date
    interpretation: 'normal' | 'abnormal' | 'critical'
  }>
}
