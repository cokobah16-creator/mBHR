/**
 * Patient Portal Data Service
 *
 * Handles fetching and managing patient medical data for the portal including:
 * - Dashboard summary data (optimized with batched queries)
 * - Medical history and visit details (with pagination)
 * - Medications and prescriptions
 * - Lab results
 * - Vitals history
 * - Appointments
 */

import { supabase } from '@/lib/supabase'
import * as logger from '@/lib/logger'
import { logAccess } from './patientPortalAuth'
import type {
  PatientDashboardData,
  PatientMedicalRecord,
  PatientNotification,
  PatientMessage
} from '@/types/patientPortal'

interface DashboardCounts {
  unread_messages: number
  unread_notifications: number
  upcoming_appointments: number
  pending_submissions: number
}

/**
 * Get patient dashboard summary data with optimized batched queries
 */
export async function getPatientDashboard(
  portalUserId: string,
  patientId: string
): Promise<PatientDashboardData | null> {
  if (!supabase) {
    logger.warn('Supabase not initialized')
    return null
  }

  try {
    await logAccess(portalUserId, patientId, 'view', 'dashboard')

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const nowIso = new Date().toISOString()

    const [
      patientResult,
      appointmentsResult,
      vitalsResult,
      medicationsResult,
      countsResult
    ] = await Promise.all([
      supabase
        .from('patients')
        .select('id, given_name, family_name, dob, sex, phone, email')
        .eq('id', patientId)
        .single(),

      supabase
        .from('appointments')
        .select('id, appointment_type, scheduled_at, status')
        .eq('patient_id', patientId)
        .in('status', ['scheduled', 'confirmed'])
        .gte('scheduled_at', nowIso)
        .order('scheduled_at', { ascending: true })
        .limit(3),

      supabase
        .from('vitals')
        .select('taken_at, height_cm, weight_kg, bmi, temp_c, pulse_bpm, systolic, diastolic, spo2')
        .eq('patient_id', patientId)
        .eq('portal_visible', true)
        .order('taken_at', { ascending: false })
        .limit(1)
        .maybeSingle(),

      supabase
        .from('dispenses')
        .select('item_name, dosage, directions, dispensed_at')
        .eq('patient_id', patientId)
        .eq('portal_visible', true)
        .gte('dispensed_at', thirtyDaysAgo)
        .order('dispensed_at', { ascending: false })
        .limit(10),

      supabase.rpc('get_patient_dashboard_counts', { p_patient_id: patientId })
    ])

    const patient = patientResult.data
    if (patientResult.error || !patient) {
      logger.error('Error fetching patient:', patientResult.error)
      return null
    }

    const counts: DashboardCounts = countsResult.data || {
      unread_messages: 0,
      unread_notifications: 0,
      upcoming_appointments: 0,
      pending_submissions: 0
    }

    const upcomingAppointments = appointmentsResult.data || []
    const recentVitalsData = vitalsResult.data
    const activeMedicationsData = medicationsResult.data || []

    return {
      patient: {
        id: patient.id,
        givenName: patient.given_name,
        familyName: patient.family_name,
        dob: patient.dob,
        sex: patient.sex,
        phone: patient.phone,
        email: patient.email
      },
      upcomingAppointments: upcomingAppointments.map(appt => ({
        id: appt.id,
        appointmentType: appt.appointment_type,
        scheduledAt: new Date(appt.scheduled_at),
        providerName: undefined,
        status: appt.status
      })),
      recentVitals: recentVitalsData ? {
        takenAt: new Date(recentVitalsData.taken_at),
        heightCm: recentVitalsData.height_cm,
        weightKg: recentVitalsData.weight_kg,
        bmi: recentVitalsData.bmi,
        tempC: recentVitalsData.temp_c,
        pulseBpm: recentVitalsData.pulse_bpm,
        systolic: recentVitalsData.systolic,
        diastolic: recentVitalsData.diastolic,
        spo2: recentVitalsData.spo2
      } : undefined,
      activeMedications: activeMedicationsData.map(med => ({
        medicationName: med.item_name,
        dosage: med.dosage,
        directions: med.directions,
        dispensedAt: new Date(med.dispensed_at)
      })),
      unreadMessages: counts.unread_messages,
      unreadNotifications: counts.unread_notifications,
      recentLabResults: []
    }
  } catch (error) {
    logger.error('Error in getPatientDashboard:', error)
    await logAccess(portalUserId, patientId, 'view', 'dashboard', undefined, false, String(error))
    return null
  }
}

/**
 * Get patient medical history with visits, vitals, consultations
 * Optimized with batched queries and filters by portal_visible
 */
export async function getPatientMedicalHistory(
  portalUserId: string,
  patientId: string,
  limit: number = 20,
  offset: number = 0
): Promise<{ records: PatientMedicalRecord[], total: number }> {
  if (!supabase) {
    return { records: [], total: 0 }
  }

  try {
    await logAccess(portalUserId, patientId, 'view', 'medical_history')

    const { data: visits, error: visitsError, count } = await supabase
      .from('visits')
      .select('id, started_at, site_name, status', { count: 'exact' })
      .eq('patient_id', patientId)
      .eq('status', 'closed')
      .order('started_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (visitsError || !visits?.length) {
      if (visitsError) logger.error('Error fetching visits:', visitsError)
      return { records: [], total: count || 0 }
    }

    const visitIds = visits.map(v => v.id)

    const [vitalsResult, consultationsResult, dispensesResult] = await Promise.all([
      supabase
        .from('vitals')
        .select('visit_id, height_cm, weight_kg, bmi, temp_c, pulse_bpm, systolic, diastolic, spo2')
        .in('visit_id', visitIds)
        .eq('portal_visible', true),

      supabase
        .from('consultations')
        .select('visit_id, soap_subjective, soap_objective, soap_assessment, soap_plan, provisional_dx, provider_name')
        .in('visit_id', visitIds)
        .eq('portal_visible', true),

      supabase
        .from('dispenses')
        .select('visit_id, item_name, dosage, directions, dispensed_at')
        .in('visit_id', visitIds)
        .eq('portal_visible', true)
    ])

    const vitals = vitalsResult.data || []
    const consultations = consultationsResult.data || []
    const dispenses = dispensesResult.data || []

    const records: PatientMedicalRecord[] = visits.map(visit => {
      const visitVitals = vitals.find(v => v.visit_id === visit.id)
      const visitConsultation = consultations.find(c => c.visit_id === visit.id)
      const visitDispenses = dispenses.filter(d => d.visit_id === visit.id)

      return {
        visitId: visit.id,
        visitDate: new Date(visit.started_at),
        vitals: visitVitals ? {
          heightCm: visitVitals.height_cm,
          weightKg: visitVitals.weight_kg,
          bmi: visitVitals.bmi,
          tempC: visitVitals.temp_c,
          pulseBpm: visitVitals.pulse_bpm,
          systolic: visitVitals.systolic,
          diastolic: visitVitals.diastolic,
          spo2: visitVitals.spo2
        } : undefined,
        consultation: visitConsultation ? {
          subjective: visitConsultation.soap_subjective,
          objective: visitConsultation.soap_objective,
          assessment: visitConsultation.soap_assessment,
          plan: visitConsultation.soap_plan,
          diagnoses: visitConsultation.provisional_dx,
          providerName: visitConsultation.provider_name
        } : undefined,
        prescriptions: visitDispenses.map(d => ({
          medicationName: d.item_name,
          dosage: d.dosage,
          directions: d.directions,
          dispensedAt: new Date(d.dispensed_at)
        }))
      }
    })

    return {
      records,
      total: count || 0
    }
  } catch (error) {
    logger.error('Error in getPatientMedicalHistory:', error)
    await logAccess(portalUserId, patientId, 'view', 'medical_history', undefined, false, String(error))
    return { records: [], total: 0 }
  }
}

/**
 * Get detailed visit information with portal visibility filtering
 */
export async function getVisitDetails(
  portalUserId: string,
  patientId: string,
  visitId: string
): Promise<PatientMedicalRecord | null> {
  if (!supabase) {
    return null
  }

  try {
    await logAccess(portalUserId, patientId, 'view', 'visit', visitId)

    const [visitResult, vitalsResult, consultationResult, dispensesResult] = await Promise.all([
      supabase
        .from('visits')
        .select('id, started_at, site_name, status')
        .eq('id', visitId)
        .eq('patient_id', patientId)
        .single(),

      supabase
        .from('vitals')
        .select('height_cm, weight_kg, bmi, temp_c, pulse_bpm, systolic, diastolic, spo2')
        .eq('visit_id', visitId)
        .eq('portal_visible', true)
        .maybeSingle(),

      supabase
        .from('consultations')
        .select('soap_subjective, soap_objective, soap_assessment, soap_plan, provisional_dx, provider_name')
        .eq('visit_id', visitId)
        .eq('portal_visible', true)
        .maybeSingle(),

      supabase
        .from('dispenses')
        .select('item_name, dosage, directions, dispensed_at')
        .eq('visit_id', visitId)
        .eq('portal_visible', true)
    ])

    const visit = visitResult.data
    if (visitResult.error || !visit) {
      logger.error('Error fetching visit:', visitResult.error)
      return null
    }

    const vitals = vitalsResult.data
    const consultation = consultationResult.data
    const dispenses = dispensesResult.data || []

    return {
      visitId: visit.id,
      visitDate: new Date(visit.started_at),
      vitals: vitals ? {
        heightCm: vitals.height_cm,
        weightKg: vitals.weight_kg,
        bmi: vitals.bmi,
        tempC: vitals.temp_c,
        pulseBpm: vitals.pulse_bpm,
        systolic: vitals.systolic,
        diastolic: vitals.diastolic,
        spo2: vitals.spo2
      } : undefined,
      consultation: consultation ? {
        subjective: consultation.soap_subjective,
        objective: consultation.soap_objective,
        assessment: consultation.soap_assessment,
        plan: consultation.soap_plan,
        diagnoses: consultation.provisional_dx,
        providerName: consultation.provider_name
      } : undefined,
      prescriptions: dispenses.map(d => ({
        medicationName: d.item_name,
        dosage: d.dosage,
        directions: d.directions,
        dispensedAt: new Date(d.dispensed_at)
      }))
    }
  } catch (error) {
    logger.error('Error in getVisitDetails:', error)
    await logAccess(portalUserId, patientId, 'view', 'visit', visitId, false, String(error))
    return null
  }
}

/**
 * Get patient notifications
 */
export async function getPatientNotifications(
  portalUserId: string,
  patientId: string,
  unreadOnly: boolean = false
): Promise<PatientNotification[]> {
  try {
    await logAccess(portalUserId, patientId, 'view', 'notifications')

    let query = supabase
      .from('patient_notifications')
      .select('*')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (unreadOnly) {
      query = query.eq('read', false)
    }

    const { data, error } = await query

    if (error) {
      logger.error('Error fetching notifications:', error)
      return []
    }

    return (data || []).map(notification => ({
      id: notification.id,
      patientId: notification.patient_id,
      notificationType: notification.notification_type,
      title: notification.title,
      message: notification.message,
      priority: notification.priority,
      read: notification.read,
      readAt: notification.read_at ? new Date(notification.read_at) : undefined,
      actionUrl: notification.action_url,
      actionLabel: notification.action_label,
      metadata: notification.metadata,
      expiresAt: notification.expires_at ? new Date(notification.expires_at) : undefined,
      createdAt: new Date(notification.created_at)
    }))
  } catch (error) {
    logger.error('Error in getPatientNotifications:', error)
    return []
  }
}

/**
 * Mark notification as read
 */
export async function markNotificationAsRead(
  portalUserId: string,
  patientId: string,
  notificationId: string
): Promise<boolean> {
  try {
    await logAccess(portalUserId, patientId, 'update', 'notification', notificationId)

    const { error } = await supabase
      .from('patient_notifications')
      .update({
        read: true,
        read_at: new Date().toISOString()
      })
      .eq('id', notificationId)
      .eq('patient_id', patientId)

    if (error) {
      logger.error('Error marking notification as read:', error)
      return false
    }

    return true
  } catch (error) {
    logger.error('Error in markNotificationAsRead:', error)
    return false
  }
}

/**
 * Get patient messages (inbox)
 */
export async function getPatientMessages(
  portalUserId: string,
  patientId: string,
  unreadOnly: boolean = false
): Promise<PatientMessage[]> {
  try {
    await logAccess(portalUserId, patientId, 'view', 'messages')

    let query = supabase
      .from('patient_messages')
      .select('*')
      .eq('patient_id', patientId)
      .is('parent_message_id', null)
      .order('created_at', { ascending: false })
      .limit(50)

    if (unreadOnly) {
      query = query.eq('read', false)
    }

    const { data, error } = await query

    if (error) {
      logger.error('Error fetching messages:', error)
      return []
    }

    return (data || []).map(message => ({
      id: message.id,
      patientId: message.patient_id,
      senderType: message.sender_type,
      senderId: message.sender_id,
      subject: message.subject,
      messageBody: message.message_body,
      parentMessageId: message.parent_message_id,
      read: message.read,
      readAt: message.read_at ? new Date(message.read_at) : undefined,
      attachments: message.attachments,
      priority: message.priority,
      createdAt: new Date(message.created_at),
      updatedAt: new Date(message.updated_at)
    }))
  } catch (error) {
    logger.error('Error in getPatientMessages:', error)
    return []
  }
}

/**
 * Send message from patient to care team
 */
export async function sendMessage(
  portalUserId: string,
  patientId: string,
  subject: string,
  messageBody: string,
  priority: 'normal' | 'high' = 'normal',
  parentMessageId?: string
): Promise<PatientMessage | null> {
  try {
    await logAccess(portalUserId, patientId, 'create', 'message')

    const { data, error } = await supabase
      .from('patient_messages')
      .insert({
        patient_id: patientId,
        sender_type: 'patient',
        sender_id: portalUserId,
        subject: parentMessageId ? undefined : subject,
        message_body: messageBody,
        parent_message_id: parentMessageId,
        priority,
        read: false
      })
      .select()
      .single()

    if (error || !data) {
      logger.error('Error sending message:', error)
      return null
    }

    await supabase
      .from('patient_notifications')
      .insert({
        patient_id: patientId,
        notification_type: 'message_sent',
        title: 'Message Sent',
        message: 'Your message has been sent to the care team.',
        priority: 'normal'
      })

    return {
      id: data.id,
      patientId: data.patient_id,
      senderType: data.sender_type,
      senderId: data.sender_id,
      subject: data.subject,
      messageBody: data.message_body,
      parentMessageId: data.parent_message_id,
      read: data.read,
      attachments: data.attachments,
      priority: data.priority,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at)
    }
  } catch (error) {
    logger.error('Error in sendMessage:', error)
    return null
  }
}

/**
 * Mark message as read
 */
export async function markMessageAsRead(
  portalUserId: string,
  patientId: string,
  messageId: string
): Promise<boolean> {
  try {
    await logAccess(portalUserId, patientId, 'update', 'message', messageId)

    const { error } = await supabase
      .from('patient_messages')
      .update({
        read: true,
        read_at: new Date().toISOString()
      })
      .eq('id', messageId)
      .eq('patient_id', patientId)

    if (error) {
      logger.error('Error marking message as read:', error)
      return false
    }

    return true
  } catch (error) {
    logger.error('Error in markMessageAsRead:', error)
    return false
  }
}
