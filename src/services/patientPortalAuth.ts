/**
 * Patient Portal Authentication Service
 *
 * Handles OTP-based authentication for patient portal access including:
 * - OTP generation and delivery via SMS/Email
 * - OTP verification and session creation
 * - Account registration and linking to patient records
 * - Session management and validation
 * - Security measures (rate limiting, lockout, audit logging)
 */

import { supabase } from '@/lib/supabase'
import * as logger from '@/lib/logger'
import type {
  PatientPortalUser,
  PatientPortalSession,
  OTPRequest,
  OTPVerification,
  PatientPortalAuthResponse
} from '@/types/patientPortal'

const OTP_LENGTH = 6
const OTP_EXPIRY_MINUTES = 10
const MAX_OTP_ATTEMPTS = 5
const MAX_FAILED_LOGIN_ATTEMPTS = 5
const LOCKOUT_DURATION_MINUTES = 60
const SESSION_DURATION_HOURS = 24
const MAX_OTP_REQUESTS_PER_HOUR = 200

/**
 * Generate a random 6-digit OTP code
 */
function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

/**
 * Hash OTP for secure storage
 */
async function hashOTP(otp: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(otp)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Check rate limiting for OTP requests using the database function
 * Returns an object with allowed status and retry information
 */
async function checkOTPRateLimit(
  phone?: string,
  email?: string
): Promise<{ allowed: boolean; retryAfter?: number; message?: string }> {
  try {
    if (!phone && !email) {
      return { allowed: true }
    }

    const contactMethod = phone ? 'phone' : 'email'
    const contactValue = phone || email || ''

    // Use the database function to check and increment rate limit
    const { data, error } = await supabase.rpc('check_and_increment_otp_rate_limit', {
      p_contact_method: contactMethod,
      p_contact_value: contactValue,
      p_max_requests: MAX_OTP_REQUESTS_PER_HOUR
    })

    if (error) {
      logger.error('Error checking OTP rate limit:', error)
      // Allow request on error to maintain functionality
      return { allowed: true }
    }

    const result = data as { allowed: boolean; current_count: number; max_requests: number; retry_after_seconds: number }

    if (!result.allowed) {
      const minutes = Math.ceil(result.retry_after_seconds / 60)
      return {
        allowed: false,
        retryAfter: result.retry_after_seconds,
        message: `Too many OTP requests. Please try again in ${minutes} minute${minutes !== 1 ? 's' : ''}.`
      }
    }

    return { allowed: true }
  } catch (error) {
    logger.error('Error in checkOTPRateLimit:', error)
    // Allow request on error to maintain functionality
    return { allowed: true }
  }
}

/**
 * Send OTP via SMS using Supabase Edge Function
 */
async function sendOTPSMS(phone: string, otp: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.functions.invoke('send-otp-sms', {
      body: { phone, otp }
    })

    if (error) {
      logger.error('Error sending OTP SMS:', error)
      return false
    }

    return data?.success === true
  } catch (error) {
    logger.error('Error in sendOTPSMS:', error)
    return false
  }
}

/**
 * Send OTP via Email using Supabase Edge Function
 */
async function sendOTPEmail(email: string, otp: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.functions.invoke('send-otp-email', {
      body: { email, otp }
    })

    if (error) {
      logger.error('Error sending OTP email:', error)
      return false
    }

    return data?.success === true
  } catch (error) {
    logger.error('Error in sendOTPEmail:', error)
    return false
  }
}

/**
 * Request OTP for patient portal login
 */
export async function requestOTP(request: OTPRequest): Promise<PatientPortalAuthResponse> {
  try {
    const { phone, email, purpose } = request

    if (!phone && !email) {
      return {
        success: false,
        error: 'Phone number or email required'
      }
    }

    const rateLimitCheck = await checkOTPRateLimit(phone, email)
    if (!rateLimitCheck.allowed) {
      return {
        success: false,
        error: rateLimitCheck.message || 'Too many OTP requests. Please try again later.'
      }
    }

    if (purpose === 'registration') {
      let query = supabase
        .from('patient_portal_users')
        .select('id')

      if (phone) {
        query = query.eq('phone_number', phone)
      } else if (email) {
        query = query.eq('email', email)
      }

      const { data: existingUser } = await query.maybeSingle()

      if (existingUser) {
        return {
          success: false,
          error: 'Account already exists. Please login instead.'
        }
      }
    }

    if (purpose === 'login') {
      let query = supabase
        .from('patient_portal_users')
        .select('*')

      if (phone) {
        query = query.eq('phone_number', phone)
      } else if (email) {
        query = query.ilike('email', email)
      }

      const { data: portalUser, error } = await query.maybeSingle()

      if (error || !portalUser) {
        const contactMethod = phone ? 'phone number' : 'email address'
        return {
          success: false,
          error: `No account found with this ${contactMethod}.`
        }
      }

      if (portalUser.account_status === 'locked' && portalUser.locked_until) {
        const lockedUntil = new Date(portalUser.locked_until)
        if (lockedUntil > new Date()) {
          return {
            success: false,
            error: `Account is locked until ${lockedUntil.toLocaleString()}`
          }
        }
      }

      if (portalUser.account_status === 'suspended') {
        return {
          success: false,
          error: 'Account is suspended. Please contact support.'
        }
      }
    }

    const otp = generateOTP()
    const otpHash = await hashOTP(otp)
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000)

    if (purpose === 'login') {
      let updateQuery = supabase
        .from('patient_portal_users')
        .update({
          otp_secret: otpHash,
          otp_expires_at: expiresAt.toISOString(),
          otp_attempts: 0,
          last_otp_sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })

      if (phone) {
        updateQuery = updateQuery.eq('phone_number', phone)
      } else if (email) {
        updateQuery = updateQuery.ilike('email', email)
      }

      const { error } = await updateQuery

      if (error) {
        logger.error('Error updating OTP:', error)
        return {
          success: false,
          error: 'Failed to send OTP. Please try again.'
        }
      }
    }

    let otpSent = false
    let isDemo = false
    if (phone) {
      otpSent = await sendOTPSMS(phone, otp)
    } else if (email) {
      otpSent = await sendOTPEmail(email, otp)
    }

    if (!otpSent) {
      logger.warn('OTP delivery failed, but continuing for demo purposes')
      logger.info('OTP for development:', otp)
      isDemo = true
    }

    return {
      success: true,
      error: undefined,
      demoMode: isDemo,
      demoOTP: isDemo ? otp : undefined
    }
  } catch (error) {
    logger.error('Error in requestOTP:', error)
    return {
      success: false,
      error: 'An error occurred. Please try again.'
    }
  }
}

/**
 * Verify OTP and create session for patient portal access
 */
export async function verifyOTP(verification: OTPVerification): Promise<PatientPortalAuthResponse> {
  try {
    const { phone, email, otp, dob } = verification

    let query = supabase
      .from('patient_portal_users')
      .select('*, patients(*)')

    if (phone) {
      query = query.eq('phone_number', phone)
    } else if (email) {
      query = query.ilike('email', email)
    } else {
      return {
        success: false,
        error: 'Phone number or email required'
      }
    }

    const { data: portalUser, error: fetchError } = await query.maybeSingle()

    if (fetchError || !portalUser) {
      const contactMethod = phone ? 'phone number' : 'email address'
      return {
        success: false,
        error: `Invalid ${contactMethod} or OTP`
      }
    }

    if (!portalUser.otp_secret || !portalUser.otp_expires_at) {
      return {
        success: false,
        error: 'No OTP request found. Please request a new OTP.'
      }
    }

    const expiresAt = new Date(portalUser.otp_expires_at)
    if (expiresAt < new Date()) {
      return {
        success: false,
        error: 'OTP has expired. Please request a new one.'
      }
    }

    if (portalUser.otp_attempts >= MAX_OTP_ATTEMPTS) {
      const lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000)
      await supabase
        .from('patient_portal_users')
        .update({
          account_status: 'locked',
          locked_until: lockedUntil.toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', portalUser.id)

      return {
        success: false,
        error: 'Too many failed attempts. Account locked for 1 hour.'
      }
    }

    const otpHash = await hashOTP(otp)
    if (otpHash !== portalUser.otp_secret) {
      await supabase
        .from('patient_portal_users')
        .update({
          otp_attempts: portalUser.otp_attempts + 1,
          updated_at: new Date().toISOString()
        })
        .eq('id', portalUser.id)

      return {
        success: false,
        error: `Invalid OTP. ${MAX_OTP_ATTEMPTS - portalUser.otp_attempts - 1} attempts remaining.`
      }
    }

    const sessionToken = crypto.randomUUID()
    const sessionExpiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000)

    const { error: sessionError } = await supabase
      .from('patient_portal_sessions')
      .insert({
        portal_user_id: portalUser.id,
        session_token: sessionToken,
        expires_at: sessionExpiresAt.toISOString(),
        is_active: true
      })

    if (sessionError) {
      logger.error('Error creating session:', sessionError)
      return {
        success: false,
        error: 'Failed to create session. Please try again.'
      }
    }

    await supabase
      .from('patient_portal_users')
      .update({
        otp_secret: null,
        otp_expires_at: null,
        otp_attempts: 0,
        failed_login_attempts: 0,
        last_login_at: new Date().toISOString(),
        phone_verified: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', portalUser.id)

    await supabase
      .from('patient_portal_access_logs')
      .insert({
        portal_user_id: portalUser.id,
        patient_id: portalUser.patient_id,
        action_type: 'login',
        resource_type: 'session',
        success: true
      })

    return {
      success: true,
      sessionToken,
      portalUser: {
        id: portalUser.id,
        patientId: portalUser.patient_id,
        phoneNumber: portalUser.phone_number,
        email: portalUser.email,
        phoneVerified: portalUser.phone_verified,
        emailVerified: portalUser.email_verified,
        accountStatus: portalUser.account_status,
        failedLoginAttempts: portalUser.failed_login_attempts,
        lastLoginAt: portalUser.last_login_at ? new Date(portalUser.last_login_at) : undefined,
        preferredLanguage: portalUser.preferred_language,
        notificationPreferences: portalUser.notification_preferences,
        consentGiven: portalUser.consent_given,
        consentGivenAt: portalUser.consent_given_at ? new Date(portalUser.consent_given_at) : undefined,
        termsAcceptedVersion: portalUser.terms_accepted_version,
        termsAcceptedAt: portalUser.terms_accepted_at ? new Date(portalUser.terms_accepted_at) : undefined,
        createdAt: new Date(portalUser.created_at),
        updatedAt: new Date(portalUser.updated_at)
      },
      patient: portalUser.patients ? {
        id: portalUser.patients.id,
        givenName: portalUser.patients.given_name,
        familyName: portalUser.patients.family_name,
        dob: portalUser.patients.dob,
        sex: portalUser.patients.sex
      } : undefined
    }
  } catch (error) {
    logger.error('Error in verifyOTP:', error)
    return {
      success: false,
      error: 'An error occurred. Please try again.'
    }
  }
}

/**
 * Register new patient portal account and link to existing patient
 */
export async function registerPatientPortalAccount(
  phone: string | undefined,
  email: string | undefined,
  otp: string,
  dob: string
): Promise<PatientPortalAuthResponse> {
  try {
    let patientQuery = supabase
      .from('patients')
      .select('*')
      .eq('dob', dob)

    if (phone) {
      patientQuery = patientQuery.eq('phone', phone)
    } else if (email) {
      patientQuery = patientQuery.eq('email', email)
    } else {
      return {
        success: false,
        error: 'Phone number or email required'
      }
    }

    const { data: patient, error: patientError } = await patientQuery.maybeSingle()

    if (patientError || !patient) {
      const contactMethod = phone ? 'phone and date of birth' : 'email and date of birth'
      return {
        success: false,
        error: `No patient record found matching ${contactMethod}.`
      }
    }

    const { data: existingPortalUser } = await supabase
      .from('patient_portal_users')
      .select('id')
      .eq('patient_id', patient.id)
      .maybeSingle()

    if (existingPortalUser) {
      return {
        success: false,
        error: 'Portal account already exists for this patient.'
      }
    }

    const otpHash = await hashOTP(otp)
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000)

    const { data: newPortalUser, error: createError} = await supabase
      .from('patient_portal_users')
      .insert({
        patient_id: patient.id,
        phone_number: phone || null,
        email: email || null,
        otp_secret: otpHash,
        otp_expires_at: expiresAt.toISOString(),
        account_status: 'active',
        phone_verified: false,
        email_verified: false
      })
      .select()
      .single()

    if (createError || !newPortalUser) {
      logger.error('Error creating portal user:', createError)
      return {
        success: false,
        error: 'Failed to create account. Please try again.'
      }
    }

    return await verifyOTP({ phone, email, otp, dob })
  } catch (error) {
    logger.error('Error in registerPatientPortalAccount:', error)
    return {
      success: false,
      error: 'An error occurred. Please try again.'
    }
  }
}

/**
 * Validate session token and return portal user
 */
export async function validateSession(sessionToken: string): Promise<PatientPortalUser | null> {
  try {
    const { data: session, error: sessionError } = await supabase
      .from('patient_portal_sessions')
      .select('*, patient_portal_users(*)')
      .eq('session_token', sessionToken)
      .eq('is_active', true)
      .maybeSingle()

    if (sessionError || !session) {
      return null
    }

    const expiresAt = new Date(session.expires_at)
    if (expiresAt < new Date()) {
      await supabase
        .from('patient_portal_sessions')
        .update({ is_active: false })
        .eq('id', session.id)
      return null
    }

    await supabase
      .from('patient_portal_sessions')
      .update({ last_activity_at: new Date().toISOString() })
      .eq('id', session.id)

    const portalUser = session.patient_portal_users
    return {
      id: portalUser.id,
      patientId: portalUser.patient_id,
      phoneNumber: portalUser.phone_number,
      email: portalUser.email,
      phoneVerified: portalUser.phone_verified,
      emailVerified: portalUser.email_verified,
      accountStatus: portalUser.account_status,
      failedLoginAttempts: portalUser.failed_login_attempts,
      lastLoginAt: portalUser.last_login_at ? new Date(portalUser.last_login_at) : undefined,
      preferredLanguage: portalUser.preferred_language,
      notificationPreferences: portalUser.notification_preferences,
      consentGiven: portalUser.consent_given,
      consentGivenAt: portalUser.consent_given_at ? new Date(portalUser.consent_given_at) : undefined,
      termsAcceptedVersion: portalUser.terms_accepted_version,
      termsAcceptedAt: portalUser.terms_accepted_at ? new Date(portalUser.terms_accepted_at) : undefined,
      createdAt: new Date(portalUser.created_at),
      updatedAt: new Date(portalUser.updated_at)
    }
  } catch (error) {
    logger.error('Error in validateSession:', error)
    return null
  }
}

/**
 * Logout and invalidate session
 */
export async function logout(sessionToken: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('patient_portal_sessions')
      .update({ is_active: false })
      .eq('session_token', sessionToken)

    if (error) {
      logger.error('Error logging out:', error)
      return false
    }

    return true
  } catch (error) {
    logger.error('Error in logout:', error)
    return false
  }
}

/**
 * Log patient portal access for audit trail
 */
export async function logAccess(
  portalUserId: string,
  patientId: string,
  actionType: string,
  resourceType: string,
  resourceId?: string,
  success: boolean = true,
  errorMessage?: string
): Promise<void> {
  try {
    await supabase
      .from('patient_portal_access_logs')
      .insert({
        portal_user_id: portalUserId,
        patient_id: patientId,
        action_type: actionType,
        resource_type: resourceType,
        resource_id: resourceId,
        success,
        error_message: errorMessage
      })
  } catch (error) {
    logger.error('Error logging access:', error)
  }
}
