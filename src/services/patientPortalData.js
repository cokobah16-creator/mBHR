/**
 * Patient Portal Data Service
 *
 * Handles fetching and managing patient medical data for the portal including:
 * - Dashboard summary data
 * - Medical history and visit details
 * - Medications and prescriptions
 * - Lab results
 * - Vitals history
 * - Appointments
 */
import { supabase } from '@/lib/supabase';
import * as logger from '@/lib/logger';
import { logAccess } from './patientPortalAuth';
/**
 * Get patient dashboard summary data
 */
export async function getPatientDashboard(portalUserId, patientId) {
    try {
        await logAccess(portalUserId, patientId, 'view', 'dashboard');
        const { data: patient, error: patientError } = await supabase
            .from('patients')
            .select('*')
            .eq('id', patientId)
            .single();
        if (patientError || !patient) {
            logger.error('Error fetching patient:', patientError);
            return null;
        }
        const { data: upcomingAppointments } = await supabase
            .from('appointments')
            .select('*')
            .eq('patient_id', patientId)
            .in('status', ['scheduled', 'confirmed'])
            .gte('scheduled_at', new Date().toISOString())
            .order('scheduled_at', { ascending: true })
            .limit(3);
        const { data: recentVitalsData } = await supabase
            .from('vitals')
            .select('*')
            .eq('patient_id', patientId)
            .order('taken_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const { data: activeMedicationsData } = await supabase
            .from('dispenses')
            .select('*')
            .eq('patient_id', patientId)
            .gte('dispensed_at', thirtyDaysAgo)
            .order('dispensed_at', { ascending: false })
            .limit(10);
        const { count: unreadMessagesCount } = await supabase
            .from('patient_messages')
            .select('*', { count: 'exact', head: true })
            .eq('patient_id', patientId)
            .eq('read', false)
            .eq('sender_type', 'staff');
        const { count: unreadNotificationsCount } = await supabase
            .from('patient_notifications')
            .select('*', { count: 'exact', head: true })
            .eq('patient_id', patientId)
            .eq('read', false);
        const { data: recentLabResultsData } = await supabase
            .from('lab_results')
            .select(`
        *,
        lab_orders!inner (
          patient_id,
          test_name,
          status
        )
      `)
            .eq('lab_orders.patient_id', patientId)
            .eq('lab_orders.status', 'completed')
            .order('result_date', { ascending: false })
            .limit(5);
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
            upcomingAppointments: (upcomingAppointments || []).map(appt => ({
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
            activeMedications: (activeMedicationsData || []).map(med => ({
                medicationName: med.item_name,
                dosage: med.dosage,
                directions: med.directions,
                dispensedAt: new Date(med.dispensed_at)
            })),
            unreadMessages: unreadMessagesCount || 0,
            unreadNotifications: unreadNotificationsCount || 0,
            recentLabResults: (recentLabResultsData || []).map(result => ({
                testName: result.lab_orders.test_name,
                resultDate: new Date(result.result_date),
                interpretation: result.interpretation
            }))
        };
    }
    catch (error) {
        logger.error('Error in getPatientDashboard:', error);
        await logAccess(portalUserId, patientId, 'view', 'dashboard', undefined, false, String(error));
        return null;
    }
}
/**
 * Get patient medical history with visits, vitals, consultations
 */
export async function getPatientMedicalHistory(portalUserId, patientId, limit = 20, offset = 0) {
    try {
        await logAccess(portalUserId, patientId, 'view', 'medical_history');
        const { data: visits, error: visitsError, count } = await supabase
            .from('visits')
            .select('*', { count: 'exact' })
            .eq('patient_id', patientId)
            .eq('status', 'closed')
            .order('started_at', { ascending: false })
            .range(offset, offset + limit - 1);
        if (visitsError) {
            logger.error('Error fetching visits:', visitsError);
            return { records: [], total: 0 };
        }
        const visitIds = visits.map(v => v.id);
        const { data: vitals } = await supabase
            .from('vitals')
            .select('*')
            .in('visit_id', visitIds);
        const { data: consultations } = await supabase
            .from('consultations')
            .select('*')
            .in('visit_id', visitIds);
        const { data: dispenses } = await supabase
            .from('dispenses')
            .select('*')
            .in('visit_id', visitIds);
        const records = visits.map(visit => {
            const visitVitals = vitals?.find(v => v.visit_id === visit.id);
            const visitConsultation = consultations?.find(c => c.visit_id === visit.id);
            const visitDispenses = dispenses?.filter(d => d.visit_id === visit.id) || [];
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
            };
        });
        return {
            records,
            total: count || 0
        };
    }
    catch (error) {
        logger.error('Error in getPatientMedicalHistory:', error);
        await logAccess(portalUserId, patientId, 'view', 'medical_history', undefined, false, String(error));
        return { records: [], total: 0 };
    }
}
/**
 * Get detailed visit information
 */
export async function getVisitDetails(portalUserId, patientId, visitId) {
    try {
        await logAccess(portalUserId, patientId, 'view', 'visit', visitId);
        const { data: visit, error: visitError } = await supabase
            .from('visits')
            .select('*')
            .eq('id', visitId)
            .eq('patient_id', patientId)
            .single();
        if (visitError || !visit) {
            logger.error('Error fetching visit:', visitError);
            return null;
        }
        const { data: vitals } = await supabase
            .from('vitals')
            .select('*')
            .eq('visit_id', visitId)
            .maybeSingle();
        const { data: consultation } = await supabase
            .from('consultations')
            .select('*')
            .eq('visit_id', visitId)
            .maybeSingle();
        const { data: dispenses } = await supabase
            .from('dispenses')
            .select('*')
            .eq('visit_id', visitId);
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
            prescriptions: (dispenses || []).map(d => ({
                medicationName: d.item_name,
                dosage: d.dosage,
                directions: d.directions,
                dispensedAt: new Date(d.dispensed_at)
            }))
        };
    }
    catch (error) {
        logger.error('Error in getVisitDetails:', error);
        await logAccess(portalUserId, patientId, 'view', 'visit', visitId, false, String(error));
        return null;
    }
}
/**
 * Get patient notifications
 */
export async function getPatientNotifications(portalUserId, patientId, unreadOnly = false) {
    try {
        await logAccess(portalUserId, patientId, 'view', 'notifications');
        let query = supabase
            .from('patient_notifications')
            .select('*')
            .eq('patient_id', patientId)
            .order('created_at', { ascending: false })
            .limit(50);
        if (unreadOnly) {
            query = query.eq('read', false);
        }
        const { data, error } = await query;
        if (error) {
            logger.error('Error fetching notifications:', error);
            return [];
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
        }));
    }
    catch (error) {
        logger.error('Error in getPatientNotifications:', error);
        return [];
    }
}
/**
 * Mark notification as read
 */
export async function markNotificationAsRead(portalUserId, patientId, notificationId) {
    try {
        await logAccess(portalUserId, patientId, 'update', 'notification', notificationId);
        const { error } = await supabase
            .from('patient_notifications')
            .update({
            read: true,
            read_at: new Date().toISOString()
        })
            .eq('id', notificationId)
            .eq('patient_id', patientId);
        if (error) {
            logger.error('Error marking notification as read:', error);
            return false;
        }
        return true;
    }
    catch (error) {
        logger.error('Error in markNotificationAsRead:', error);
        return false;
    }
}
/**
 * Get patient messages (inbox)
 */
export async function getPatientMessages(portalUserId, patientId, unreadOnly = false) {
    try {
        await logAccess(portalUserId, patientId, 'view', 'messages');
        let query = supabase
            .from('patient_messages')
            .select('*')
            .eq('patient_id', patientId)
            .is('parent_message_id', null)
            .order('created_at', { ascending: false })
            .limit(50);
        if (unreadOnly) {
            query = query.eq('read', false);
        }
        const { data, error } = await query;
        if (error) {
            logger.error('Error fetching messages:', error);
            return [];
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
        }));
    }
    catch (error) {
        logger.error('Error in getPatientMessages:', error);
        return [];
    }
}
/**
 * Send message from patient to care team
 */
export async function sendMessage(portalUserId, patientId, subject, messageBody, priority = 'normal', parentMessageId) {
    try {
        await logAccess(portalUserId, patientId, 'create', 'message');
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
            .single();
        if (error || !data) {
            logger.error('Error sending message:', error);
            return null;
        }
        await supabase
            .from('patient_notifications')
            .insert({
            patient_id: patientId,
            notification_type: 'message_sent',
            title: 'Message Sent',
            message: 'Your message has been sent to the care team.',
            priority: 'normal'
        });
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
        };
    }
    catch (error) {
        logger.error('Error in sendMessage:', error);
        return null;
    }
}
/**
 * Mark message as read
 */
export async function markMessageAsRead(portalUserId, patientId, messageId) {
    try {
        await logAccess(portalUserId, patientId, 'update', 'message', messageId);
        const { error } = await supabase
            .from('patient_messages')
            .update({
            read: true,
            read_at: new Date().toISOString()
        })
            .eq('id', messageId)
            .eq('patient_id', patientId);
        if (error) {
            logger.error('Error marking message as read:', error);
            return false;
        }
        return true;
    }
    catch (error) {
        logger.error('Error in markMessageAsRead:', error);
        return false;
    }
}
