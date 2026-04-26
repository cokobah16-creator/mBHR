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

import { supabase } from "@/lib/supabase";
import * as logger from "@/lib/logger";
import { logAccess } from "./patientPortalAuth";
import type {
  PatientDashboardData,
  PatientMedicalRecord,
  PatientNotification,
  PatientMessage,
} from "@/types/patientPortal";

/**
 * Get patient dashboard summary data
 */
export async function getPatientDashboard(
  portalUserId: string,
  patientId: string,
): Promise<PatientDashboardData | null> {
  try {
    await logAccess(portalUserId, patientId, "view", "dashboard");

    if (!supabase) {
      const { db } = await import("@/db");
      const patient = await db.patients.get(patientId);
      if (!patient) return null;
      const vitalsArr = await db.vitals
        .where("patientId")
        .equals(patientId)
        .toArray();
      const latestVital = vitalsArr.sort(
        (a, b) => new Date(b.takenAt).getTime() - new Date(a.takenAt).getTime(),
      )[0];
      const medsArr = await db.dispenses
        .where("patientId")
        .equals(patientId)
        .toArray();
      const recentMeds = medsArr
        .sort(
          (a, b) =>
            new Date(b.dispensedAt).getTime() -
            new Date(a.dispensedAt).getTime(),
        )
        .slice(0, 10);
      return {
        patient: {
          id: patient.id,
          givenName: patient.givenName,
          familyName: patient.familyName,
          dob: patient.dob,
          sex: patient.sex,
          phone: patient.phone || "",
          email: patient.email,
        },
        upcomingAppointments: [],
        recentVitals: latestVital
          ? {
              takenAt: new Date(latestVital.takenAt),
              heightCm: latestVital.heightCm,
              weightKg: latestVital.weightKg,
              bmi: latestVital.bmi,
              tempC: latestVital.tempC,
              pulseBpm: latestVital.pulseBpm,
              systolic: latestVital.systolic,
              diastolic: latestVital.diastolic,
              spo2: latestVital.spo2,
            }
          : undefined,
        activeMedications: recentMeds.map((m) => ({
          medicationName: m.itemName,
          dosage: m.dosage,
          directions: m.directions,
          dispensedAt: new Date(m.dispensedAt),
        })),
        unreadMessages: 0,
        unreadNotifications: 0,
        recentLabResults: [],
      };
    }

    const { data: patient, error: patientError } = await supabase
      .from("patients")
      .select("*")
      .eq("id", patientId)
      .single();

    if (patientError || !patient) {
      logger.error("Error fetching patient:", patientError);
      return null;
    }

    const { data: upcomingAppointments } = await supabase
      .from("appointments")
      .select("*")
      .eq("patient_id", patientId)
      .in("status", ["scheduled", "confirmed"])
      .gte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(3);

    const { data: recentVitalsData } = await supabase
      .from("vitals")
      .select("*")
      .eq("patient_id", patientId)
      .order("taken_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const thirtyDaysAgo = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { data: activeMedicationsData } = await supabase
      .from("dispenses")
      .select("*")
      .eq("patient_id", patientId)
      .gte("dispensed_at", thirtyDaysAgo)
      .order("dispensed_at", { ascending: false })
      .limit(10);

    const { count: unreadMessagesCount } = await supabase
      .from("patient_secure_messages")
      .select("*", { count: "exact", head: true })
      .eq("patient_id", patientId)
      .eq("read", false)
      .eq("from_patient", false);

    const unreadNotificationsCount = 0;

    const { data: recentLabResultsData } = await supabase
      .from("lab_results")
      .select(
        `
        *,
        lab_orders!inner (
          patient_id,
          test_name,
          status
        )
      `,
      )
      .eq("lab_orders.patient_id", patientId)
      .eq("lab_orders.status", "completed")
      .order("result_date", { ascending: false })
      .limit(5);

    return {
      patient: {
        id: patient.id,
        givenName: patient.given_name,
        familyName: patient.family_name,
        dob: patient.dob,
        sex: patient.sex,
        phone: patient.phone,
        email: patient.email,
      },
      upcomingAppointments: (upcomingAppointments || []).map((appt) => ({
        id: appt.id,
        appointmentType: appt.appointment_type,
        scheduledAt: new Date(appt.scheduled_at),
        providerName: undefined,
        status: appt.status,
      })),
      recentVitals: recentVitalsData
        ? {
            takenAt: new Date(recentVitalsData.taken_at),
            heightCm: recentVitalsData.height_cm,
            weightKg: recentVitalsData.weight_kg,
            bmi: recentVitalsData.bmi,
            tempC: recentVitalsData.temp_c,
            pulseBpm: recentVitalsData.pulse_bpm,
            systolic: recentVitalsData.systolic,
            diastolic: recentVitalsData.diastolic,
            spo2: recentVitalsData.spo2,
          }
        : undefined,
      activeMedications: (activeMedicationsData || []).map((med) => ({
        medicationName: med.item_name,
        dosage: med.dosage,
        directions: med.directions,
        dispensedAt: new Date(med.dispensed_at),
      })),
      unreadMessages: unreadMessagesCount || 0,
      unreadNotifications: unreadNotificationsCount || 0,
      recentLabResults: (recentLabResultsData || []).map((result) => ({
        testName: result.lab_orders.test_name,
        resultDate: new Date(result.result_date),
        interpretation: result.interpretation,
      })),
    };
  } catch (error) {
    logger.error("Error in getPatientDashboard:", error);
    await logAccess(
      portalUserId,
      patientId,
      "view",
      "dashboard",
      undefined,
      false,
      String(error),
    );
    return null;
  }
}

/**
 * Get patient medical history with visits, vitals, consultations
 */
export async function getPatientMedicalHistory(
  portalUserId: string,
  patientId: string,
  limit: number = 20,
  offset: number = 0,
): Promise<{ records: PatientMedicalRecord[]; total: number }> {
  try {
    await logAccess(portalUserId, patientId, "view", "medical_history");

    const {
      data: visits,
      error: visitsError,
      count,
    } = await supabase
      .from("visits")
      .select("*", { count: "exact" })
      .eq("patient_id", patientId)
      .eq("status", "closed")
      .order("started_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (visitsError) {
      logger.error("Error fetching visits:", visitsError);
      return { records: [], total: 0 };
    }

    const visitIds = visits.map((v) => v.id);

    const { data: vitals } = await supabase
      .from("vitals")
      .select("*")
      .in("visit_id", visitIds);

    const { data: consultations } = await supabase
      .from("consultations")
      .select("*")
      .in("visit_id", visitIds);

    const { data: dispenses } = await supabase
      .from("dispenses")
      .select("*")
      .in("visit_id", visitIds);

    const records: PatientMedicalRecord[] = visits.map((visit) => {
      const visitVitals = vitals?.find((v) => v.visit_id === visit.id);
      const visitConsultation = consultations?.find(
        (c) => c.visit_id === visit.id,
      );
      const visitDispenses =
        dispenses?.filter((d) => d.visit_id === visit.id) || [];

      return {
        visitId: visit.id,
        visitDate: new Date(visit.started_at),
        vitals: visitVitals
          ? {
              heightCm: visitVitals.height_cm,
              weightKg: visitVitals.weight_kg,
              bmi: visitVitals.bmi,
              tempC: visitVitals.temp_c,
              pulseBpm: visitVitals.pulse_bpm,
              systolic: visitVitals.systolic,
              diastolic: visitVitals.diastolic,
              spo2: visitVitals.spo2,
            }
          : undefined,
        consultation: visitConsultation
          ? {
              subjective: visitConsultation.soap_subjective,
              objective: visitConsultation.soap_objective,
              assessment: visitConsultation.soap_assessment,
              plan: visitConsultation.soap_plan,
              diagnoses: visitConsultation.provisional_dx,
              providerName: visitConsultation.provider_name,
            }
          : undefined,
        prescriptions: visitDispenses.map((d) => ({
          medicationName: d.item_name,
          dosage: d.dosage,
          directions: d.directions,
          dispensedAt: new Date(d.dispensed_at),
        })),
      };
    });

    return {
      records,
      total: count || 0,
    };
  } catch (error) {
    logger.error("Error in getPatientMedicalHistory:", error);
    await logAccess(
      portalUserId,
      patientId,
      "view",
      "medical_history",
      undefined,
      false,
      String(error),
    );
    return { records: [], total: 0 };
  }
}

/**
 * Get detailed visit information
 */
export async function getVisitDetails(
  portalUserId: string,
  patientId: string,
  visitId: string,
): Promise<PatientMedicalRecord | null> {
  try {
    await logAccess(portalUserId, patientId, "view", "visit", visitId);

    const { data: visit, error: visitError } = await supabase
      .from("visits")
      .select("*")
      .eq("id", visitId)
      .eq("patient_id", patientId)
      .single();

    if (visitError || !visit) {
      logger.error("Error fetching visit:", visitError);
      return null;
    }

    const { data: vitals } = await supabase
      .from("vitals")
      .select("*")
      .eq("visit_id", visitId)
      .maybeSingle();

    const { data: consultation } = await supabase
      .from("consultations")
      .select("*")
      .eq("visit_id", visitId)
      .maybeSingle();

    const { data: dispenses } = await supabase
      .from("dispenses")
      .select("*")
      .eq("visit_id", visitId);

    return {
      visitId: visit.id,
      visitDate: new Date(visit.started_at),
      vitals: vitals
        ? {
            heightCm: vitals.height_cm,
            weightKg: vitals.weight_kg,
            bmi: vitals.bmi,
            tempC: vitals.temp_c,
            pulseBpm: vitals.pulse_bpm,
            systolic: vitals.systolic,
            diastolic: vitals.diastolic,
            spo2: vitals.spo2,
          }
        : undefined,
      consultation: consultation
        ? {
            subjective: consultation.soap_subjective,
            objective: consultation.soap_objective,
            assessment: consultation.soap_assessment,
            plan: consultation.soap_plan,
            diagnoses: consultation.provisional_dx,
            providerName: consultation.provider_name,
          }
        : undefined,
      prescriptions: (dispenses || []).map((d) => ({
        medicationName: d.item_name,
        dosage: d.dosage,
        directions: d.directions,
        dispensedAt: new Date(d.dispensed_at),
      })),
    };
  } catch (error) {
    logger.error("Error in getVisitDetails:", error);
    await logAccess(
      portalUserId,
      patientId,
      "view",
      "visit",
      visitId,
      false,
      String(error),
    );
    return null;
  }
}

/**
 * Get patient notifications
 */
export async function getPatientNotifications(
  _portalUserId: string,
  _patientId: string,
  _unreadOnly: boolean = false,
): Promise<PatientNotification[]> {
  // No patient_notifications table in this schema; return empty.
  return [];
}

/**
 * Mark notification as read
 */
export async function markNotificationAsRead(
  _portalUserId: string,
  _patientId: string,
  _notificationId: string,
): Promise<boolean> {
  // No patient_notifications table in this schema; treat as success.
  return true;
}

/**
 * Get patient messages (inbox)
 */
export async function getPatientMessages(
  portalUserId: string,
  patientId: string,
  unreadOnly: boolean = false,
): Promise<PatientMessage[]> {
  try {
    await logAccess(portalUserId, patientId, "view", "messages");

    if (!supabase) return [];

    let query = supabase
      .from("patient_secure_messages")
      .select("*")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (unreadOnly) {
      query = query.eq("read", false).eq("from_patient", false);
    }

    const { data, error } = await query;

    if (error) {
      logger.error("Error fetching messages:", error);
      return [];
    }

    return (data || []).map((message) => ({
      id: message.id,
      patientId: message.patient_id,
      senderType: message.from_patient
        ? "patient"
        : ("staff" as "patient" | "staff"),
      senderId: message.staff_id ?? message.patient_id,
      subject: message.subject,
      messageBody: message.body,
      parentMessageId: undefined,
      read: message.read,
      readAt: undefined,
      attachments: undefined,
      priority: "normal" as "normal" | "high",
      createdAt: new Date(message.created_at),
      updatedAt: new Date(message.created_at),
    }));
  } catch (error) {
    logger.error("Error in getPatientMessages:", error);
    return [];
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
  priority: "normal" | "high" = "normal",
  _parentMessageId?: string,
): Promise<PatientMessage | null> {
  try {
    await logAccess(portalUserId, patientId, "create", "message");

    if (!supabase) return null;

    const { data: patientRow } = await supabase
      .from("patients")
      .select("given_name, family_name")
      .eq("id", patientId)
      .maybeSingle();

    const fromName = patientRow
      ? `${patientRow.given_name ?? ""} ${patientRow.family_name ?? ""}`.trim()
      : "Patient";

    const { data, error } = await supabase
      .from("patient_secure_messages")
      .insert({
        patient_id: patientId,
        staff_id: null,
        subject,
        body: messageBody,
        from_patient: true,
        from_name: fromName,
        read: false,
      })
      .select()
      .single();

    if (error || !data) {
      logger.error("Error sending message:", error);
      return null;
    }

    return {
      id: data.id,
      patientId: data.patient_id,
      senderType: "patient",
      senderId: patientId,
      subject: data.subject,
      messageBody: data.body,
      parentMessageId: undefined,
      read: data.read,
      attachments: undefined,
      priority,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.created_at),
    };
  } catch (error) {
    logger.error("Error in sendMessage:", error);
    return null;
  }
}

/**
 * Mark message as read
 */
export async function markMessageAsRead(
  portalUserId: string,
  patientId: string,
  messageId: string,
): Promise<boolean> {
  try {
    await logAccess(portalUserId, patientId, "update", "message", messageId);

    if (!supabase) return false;

    const { error } = await supabase
      .from("patient_secure_messages")
      .update({ read: true })
      .eq("id", messageId)
      .eq("patient_id", patientId);

    if (error) {
      logger.error("Error marking message as read:", error);
      return false;
    }

    return true;
  } catch (error) {
    logger.error("Error in markMessageAsRead:", error);
    return false;
  }
}
