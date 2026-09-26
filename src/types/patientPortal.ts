/**
 * Patient Portal Type Definitions
 *
 * Types for the patient-facing portal including authentication,
 * medical records access, appointments, and messaging.
 */

export interface PatientPortalUser {
  id: string;
  patientId: string;
  phoneNumber: string;
  email?: string;
  phoneVerified: boolean;
  emailVerified: boolean;
  accountStatus: "active" | "suspended" | "locked";
  failedLoginAttempts: number;
  lockedUntil?: Date;
  lastLoginAt?: Date;
  preferredLanguage?: string;
  notificationPreferences?: {
    sms: boolean;
    email: boolean;
    push: boolean;
  };
  consentGiven: boolean;
  consentGivenAt?: Date;
  termsAcceptedVersion?: string;
  termsAcceptedAt?: Date;
  privacyAcceptedVersion?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PatientPortalSession {
  id: string;
  portalUserId: string;
  sessionToken: string;
  deviceFingerprint?: string;
  deviceName?: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
  expiresAt: Date;
  lastActivityAt: Date;
  isActive: boolean;
}

export interface PatientPortalAccessLog {
  id: string;
  portalUserId?: string;
  patientId: string;
  actionType: string;
  resourceType: string;
  resourceId?: string;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  errorMessage?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>;
  createdAt: Date;
}

export interface PatientNotification {
  id: string;
  patientId: string;
  notificationType: string;
  title: string;
  message: string;
  priority: "low" | "normal" | "high" | "urgent";
  read: boolean;
  readAt?: Date;
  actionUrl?: string;
  actionLabel?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>;
  expiresAt?: Date;
  createdAt: Date;
}

export interface PatientMessage {
  id: string;
  patientId: string;
  senderType: "patient" | "staff";
  senderId: string;
  subject?: string;
  messageBody: string;
  parentMessageId?: string;
  read: boolean;
  readAt?: Date;
  attachments?: Array<{
    fileName: string;
    filePath: string;
    fileSize: number;
    mimeType: string;
  }>;
  priority: "normal" | "high";
  createdAt: Date;
  updatedAt: Date;
}

export interface PatientAppointmentRequest {
  id: string;
  patientId: string;
  appointmentType: string;
  preferredDate1: string;
  preferredTime1?: string;
  preferredDate2?: string;
  preferredTime2?: string;
  preferredDate3?: string;
  preferredTime3?: string;
  reason?: string;
  notes?: string;
  status: "pending" | "approved" | "scheduled" | "declined" | "cancelled";
  reviewedBy?: string;
  reviewedAt?: Date;
  reviewNotes?: string;
  scheduledAppointmentId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PatientDocument {
  id: string;
  patientId: string;
  documentType: string;
  documentName: string;
  filePath: string;
  fileSize?: number;
  mimeType?: string;
  uploadedByPatient: boolean;
  uploadedByUserId?: string;
  description?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface PatientConsentRecord {
  id: string;
  patientId: string;
  consentType: string;
  consentGiven: boolean;
  consentText: string;
  consentVersion: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
  revokedAt?: Date;
}

export interface PatientMedicalRecord {
  visitId: string;
  visitDate: Date;
  chiefComplaint?: string;
  vitals?: {
    heightCm?: number;
    weightKg?: number;
    bmi?: number;
    tempC?: number;
    pulseBpm?: number;
    systolic?: number;
    diastolic?: number;
    spo2?: number;
  };
  consultation?: {
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
    diagnoses: string[];
    providerName: string;
  };
  prescriptions?: Array<{
    medicationName: string;
    dosage: string;
    directions: string;
    dispensedAt?: Date;
  }>;
}

export interface OTPRequest {
  phone: string;
  email?: string;
  purpose: "registration" | "login" | "verification";
}

export interface OTPVerification {
  phone: string;
  otp: string;
  dob?: string;
}

export interface PatientPortalAuthResponse {
  success: boolean;
  sessionToken?: string;
  portalUser?: PatientPortalUser;
  patient?: {
    id: string;
    givenName: string;
    familyName: string;
    dob: string;
    sex: string;
  };
  error?: string;
}

export interface PatientDashboardData {
  patient: {
    id: string;
    givenName: string;
    familyName: string;
    dob: string;
    sex: string;
    phone: string;
    email?: string;
  };
  upcomingAppointments: Array<{
    id: string;
    appointmentType: string;
    scheduledAt: Date;
    providerName?: string;
    status: string;
  }>;
  recentVitals?: {
    takenAt: Date;
    heightCm?: number;
    weightKg?: number;
    bmi?: number;
    tempC?: number;
    pulseBpm?: number;
    systolic?: number;
    diastolic?: number;
    spo2?: number;
  };
  activeMedications: Array<{
    medicationName: string;
    dosage: string;
    directions: string;
    dispensedAt: Date;
  }>;
  unreadMessages: number;
  unreadNotifications: number;
  /**
   * Up to five lab results the clinic has reviewed AND released to the
   * portal (server RPC portal_my_lab_results), newest first. Empty unless
   * recentLabResultsStatus is "ok": check that before saying "no results".
   */
  recentLabResults: Array<{
    testName: string;
    resultDate: Date;
    /** "unknown" when the stored value is missing or unexpected. */
    interpretation: PortalLabInterpretation;
  }>;
  /** Whether recentLabResults could be loaded (see PortalLabResultsStatus). */
  recentLabResultsStatus?: PortalLabResultsStatus;
  /**
   * Dashboard sections whose query failed. Their lists above are empty
   * because they could not be loaded, not because there is nothing to show.
   */
  failedSections?: PatientDashboardSection[];
}

export type PatientDashboardSection =
  | "appointments"
  | "vitals"
  | "medications"
  | "messages"
  | "labResults";

/**
 * Why a portal read returned no data:
 * - "unavailable": this portal is not connected to the clinic's online
 *   records (no Supabase configured).
 * - "offline": the device is offline, nothing was requested.
 * - "not_signed_in": no online sign-in (for example the local PIN portal),
 *   so the server cannot tell whose records these are.
 * - "not_found": the record does not exist or is not this patient's.
 * - "failed": the request was made and failed.
 */
export type PortalDataError =
  | "unavailable"
  | "offline"
  | "not_signed_in"
  | "not_found"
  | "failed";

// ─── Lab results released to the portal ──────────────────────────────────────

/** Stored interpretation; "unknown" for a missing or unexpected value. */
export type PortalLabInterpretation = "normal" | "abnormal" | "critical" | "unknown";

/**
 * One lab result as the patient sees it: reviewed by the clinic and
 * released to the portal. Staff notes, clinical notes and staff ids are
 * never included.
 */
export interface PortalLabResult {
  resultId: string;
  orderId: string;
  patientId: string;
  testName: string;
  testCode?: string;
  specimenType?: string;
  orderedAt?: Date;
  resultValue: string;
  resultUnit?: string;
  referenceRange?: string;
  interpretation: PortalLabInterpretation;
  resultDate?: Date;
  /** When the clinic released the result to the portal. */
  releasedAt?: Date;
  /** Plain-language note the clinic wrote for the patient. */
  patientNote?: string;
}

/**
 * Outcome of loading released lab results:
 * - "ok": results loaded (possibly none released yet);
 * - "not_updated": the server does not have the lab release update yet;
 * - the PortalDataError values otherwise.
 */
export type PortalLabResultsStatus =
  | "ok"
  | "not_updated"
  | Exclude<PortalDataError, "not_found">;

export interface PortalLabResultsLoad {
  status: PortalLabResultsStatus;
  /** Empty unless status is "ok". Held in memory only, never cached. */
  results: PortalLabResult[];
}
