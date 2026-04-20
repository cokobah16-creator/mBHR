/**
 * Patient Service – abstracts all Supabase data access.
 *
 * Maps to the EXISTING Supabase schema (patients, vitals, consultations,
 * dispenses, visits tables created by the initial migrations).
 * Column names match the snake_case columns already in the database.
 */
import { supabase } from "@/lib/supabaseClient";
import * as logger from "@/lib/logger";

// ─── Domain types (camelCase for the app) ─────────────────────────────────────

export interface PatientProfile {
  id: string; // text pk
  id: string;           // text pk
  authUid: string | null;
  givenName: string;
  familyName: string;
  email: string | null;
  phone: string | null;
  dob: string | null;
  sex: string | null;
  createdAt: string;
}

/** Vitals row from the existing `vitals` table */
export interface Vital {
  id: string;
  patientId: string;
  visitId: string | null;
  heightCm: number | null;
  weightKg: number | null;
  tempC: number | null;
  pulseBpm: number | null;
  systolic: number | null;
  diastolic: number | null;
  spo2: number | null;
  bmi: number | null;
  takenAt: string;
}

/** Maps to the `dispenses` table (medications dispensed to a patient) */
export interface Medication {
  id: string;
  patientId: string;
  visitId: string | null;
  itemName: string;
  dosage: string | null;
  directions: string | null;
  dispensedAt: string;
}

/** Maps to `visits` joined with the latest `consultations` row for that visit */
export interface Visit {
  id: string;
  patientId: string;
  startedAt: string;
  siteName: string | null;
  status: string;
  diagnosis: string | null; // from consultations.soap_assessment
  notes: string | null; // from consultations.soap_subjective
  diagnosis: string | null;    // from consultations.soap_assessment
  notes: string | null;        // from consultations.soap_subjective
}

export interface ServiceResult<T> {
  data: T | null;
  error: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rowToProfile(r: Record<string, unknown>): PatientProfile {
  return {
    id: r.id as string,
    authUid: r.auth_uid as string | null,
    givenName: r.given_name as string,
    familyName: r.family_name as string,
    email: r.email as string | null,
    phone: r.phone as string | null,
    dob: r.dob as string | null,
    sex: r.sex as string | null,
    createdAt: r.created_at as string,
  };
}

// ─── Patient profile ──────────────────────────────────────────────────────────

/** Fetch a patient by their Supabase auth UID (stored as text in auth_uid). */
export async function getPatientProfile(
  authUid: string,
): Promise<ServiceResult<PatientProfile>> {

function rowToProfile(r: Record<string, unknown>): PatientProfile {
  return {
    id:         r.id           as string,
    authUid:    r.auth_uid     as string | null,
    givenName:  r.given_name   as string,
    familyName: r.family_name  as string,
    email:      r.email        as string | null,
    phone:      r.phone        as string | null,
    dob:        r.dob          as string | null,
    sex:        r.sex          as string | null,
    createdAt:  r.created_at   as string,
  };
}

// ─── Patient profile ──────────────────────────────────────────────────────────

/** Fetch a patient by their Supabase auth UID (stored as text in auth_uid). */
export async function getPatientProfile(authUid: string): Promise<ServiceResult<PatientProfile>> {
  if (!supabase) return { data: null, error: "Supabase not configured" };

  const { data, error } = await supabase
    .from("patients")
    .select(
      "id, auth_uid, given_name, family_name, email, phone, dob, sex, created_at",
    )
    .select("id, auth_uid, given_name, family_name, email, phone, dob, sex, created_at")
    .eq("auth_uid", authUid)
    .maybeSingle();

  if (error) {
    logger.error("[patientService] getPatientProfile:", error.message);
    return { data: null, error: error.message };
  }
  if (!data)
    return { data: null, error: "No patient profile found for this account." };
  if (!data) return { data: null, error: "No patient profile found for this account." };

  return { data: rowToProfile(data), error: null };
}

export async function updatePatientProfile(
  patientId: string,
  updates: Partial<
    Pick<PatientProfile, "givenName" | "familyName" | "phone" | "dob">
  >,
): Promise<ServiceResult<PatientProfile>> {
  if (!supabase) return { data: null, error: "Supabase not configured" };

  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (updates.givenName !== undefined) payload.given_name = updates.givenName;
  if (updates.familyName !== undefined)
    payload.family_name = updates.familyName;
  if (updates.phone !== undefined) payload.phone = updates.phone;
  if (updates.dob !== undefined) payload.dob = updates.dob;
  updates: Partial<Pick<PatientProfile, "givenName" | "familyName" | "phone" | "dob">>,
): Promise<ServiceResult<PatientProfile>> {
  if (!supabase) return { data: null, error: "Supabase not configured" };

  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.givenName  !== undefined) payload.given_name  = updates.givenName;
  if (updates.familyName !== undefined) payload.family_name = updates.familyName;
  if (updates.phone      !== undefined) payload.phone       = updates.phone;
  if (updates.dob        !== undefined) payload.dob         = updates.dob;

  const { data, error } = await supabase
    .from("patients")
    .update(payload)
    .eq("id", patientId)
    .select(
      "id, auth_uid, given_name, family_name, email, phone, dob, sex, created_at",
    )
    .select("id, auth_uid, given_name, family_name, email, phone, dob, sex, created_at")
    .single();

  if (error) {
    logger.error("[patientService] updatePatientProfile:", error.message);
    return { data: null, error: error.message };
  }
  return { data: rowToProfile(data), error: null };
}

// ─── Vitals ───────────────────────────────────────────────────────────────────

export async function getVitals(
  patientId: string,
): Promise<ServiceResult<Vital[]>> {
  if (!supabase) return { data: null, error: "Supabase not configured" };

  const { data, error } = await supabase
    .from("vitals")
    .select(
      "id, patient_id, visit_id, height_cm, weight_kg, temp_c, pulse_bpm, systolic, diastolic, spo2, bmi, taken_at",
    )
    .select("id, patient_id, visit_id, height_cm, weight_kg, temp_c, pulse_bpm, systolic, diastolic, spo2, bmi, taken_at")
    .eq("patient_id", patientId)
    .order("taken_at", { ascending: false });

  if (error) {
    logger.error("[patientService] getVitals:", error.message);
    return { data: null, error: error.message };
  }

  return {
    data: (data || []).map((v) => ({
      id: v.id,
      patientId: v.patient_id,
      visitId: v.visit_id,
      heightCm: v.height_cm,
      weightKg: v.weight_kg,
      tempC: v.temp_c,
      pulseBpm: v.pulse_bpm,
      systolic: v.systolic,
      diastolic: v.diastolic,
      spo2: v.spo2,
      bmi: v.bmi,
      takenAt: v.taken_at,
      id:        v.id,
      patientId: v.patient_id,
      visitId:   v.visit_id,
      heightCm:  v.height_cm,
      weightKg:  v.weight_kg,
      tempC:     v.temp_c,
      pulseBpm:  v.pulse_bpm,
      systolic:  v.systolic,
      diastolic: v.diastolic,
      spo2:      v.spo2,
      bmi:       v.bmi,
      takenAt:   v.taken_at,
    })),
    error: null,
  };
}

export async function addVital(
  patientId: string,
  vital: {
    bloodPressureSystolic?: number | null;
    bloodPressureDiastolic?: number | null;
    weightKg?: number | null;
    tempC?: number | null;
    pulseBpm?: number | null;
    spo2?: number | null;
    heightCm?: number | null;
  },
): Promise<ServiceResult<Vital>> {
  if (!supabase) return { data: null, error: "Supabase not configured" };

  const id = crypto.randomUUID();

  const { data, error } = await supabase
    .from("vitals")
    .insert({
      id,
      patient_id: patientId,
      systolic: vital.bloodPressureSystolic ?? null,
      diastolic: vital.bloodPressureDiastolic ?? null,
      weight_kg: vital.weightKg ?? null,
      temp_c: vital.tempC ?? null,
      pulse_bpm: vital.pulseBpm ?? null,
      spo2: vital.spo2 ?? null,
      height_cm: vital.heightCm ?? null,
      taken_at: new Date().toISOString(),
      flags: [],
      systolic:   vital.bloodPressureSystolic  ?? null,
      diastolic:  vital.bloodPressureDiastolic ?? null,
      weight_kg:  vital.weightKg  ?? null,
      temp_c:     vital.tempC     ?? null,
      pulse_bpm:  vital.pulseBpm  ?? null,
      spo2:       vital.spo2      ?? null,
      height_cm:  vital.heightCm  ?? null,
      taken_at:   new Date().toISOString(),
      flags:      [],
    })
    .select()
    .single();

  if (error) {
    logger.error("[patientService] addVital:", error.message);
    return { data: null, error: error.message };
  }

  return {
    data: {
      id: data.id,
      patientId: data.patient_id,
      visitId: data.visit_id,
      heightCm: data.height_cm,
      weightKg: data.weight_kg,
      tempC: data.temp_c,
      pulseBpm: data.pulse_bpm,
      systolic: data.systolic,
      diastolic: data.diastolic,
      spo2: data.spo2,
      bmi: data.bmi,
      takenAt: data.taken_at,
      id:        data.id,
      patientId: data.patient_id,
      visitId:   data.visit_id,
      heightCm:  data.height_cm,
      weightKg:  data.weight_kg,
      tempC:     data.temp_c,
      pulseBpm:  data.pulse_bpm,
      systolic:  data.systolic,
      diastolic: data.diastolic,
      spo2:      data.spo2,
      bmi:       data.bmi,
      takenAt:   data.taken_at,
    },
    error: null,
  };
}

// ─── Medications (dispenses) ──────────────────────────────────────────────────

export async function getMedications(
  patientId: string,
): Promise<ServiceResult<Medication[]>> {
  if (!supabase) return { data: null, error: "Supabase not configured" };

  const { data, error } = await supabase
    .from("dispenses")
    .select(
      "id, patient_id, visit_id, item_name, dosage, directions, dispensed_at",
    )
    .select("id, patient_id, visit_id, item_name, dosage, directions, dispensed_at")
    .eq("patient_id", patientId)
    .order("dispensed_at", { ascending: false });

  if (error) {
    logger.error("[patientService] getMedications:", error.message);
    return { data: null, error: error.message };
  }

  return {
    data: (data || []).map((m) => ({
      id: m.id,
      patientId: m.patient_id,
      visitId: m.visit_id,
      itemName: m.item_name,
      dosage: m.dosage,
      directions: m.directions,
      id:          m.id,
      patientId:   m.patient_id,
      visitId:     m.visit_id,
      itemName:    m.item_name,
      dosage:      m.dosage,
      directions:  m.directions,
      dispensedAt: m.dispensed_at,
    })),
    error: null,
  };
}

export async function addMedication(
  patientId: string,
  med: { name: string; dosage?: string | null; instructions?: string | null },
): Promise<ServiceResult<Medication>> {
  if (!supabase) return { data: null, error: "Supabase not configured" };

  const id = crypto.randomUUID();

  const { data, error } = await supabase
    .from("dispenses")
    .insert({
      id,
      patient_id: patientId,
      item_name: med.name,
      dosage: med.dosage ?? null,
      directions: med.instructions ?? null,
      qty: 1,
      patient_id:   patientId,
      item_name:    med.name,
      dosage:       med.dosage       ?? null,
      directions:   med.instructions ?? null,
      qty:          1,
      dispensed_by: "staff",
      dispensed_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    logger.error("[patientService] addMedication:", error.message);
    return { data: null, error: error.message };
  }

  return {
    data: {
      id: data.id,
      patientId: data.patient_id,
      visitId: data.visit_id,
      itemName: data.item_name,
      dosage: data.dosage,
      directions: data.directions,
      id:          data.id,
      patientId:   data.patient_id,
      visitId:     data.visit_id,
      itemName:    data.item_name,
      dosage:      data.dosage,
      directions:  data.directions,
      dispensedAt: data.dispensed_at,
    },
    error: null,
  };
}

// ─── Visits ───────────────────────────────────────────────────────────────────

export async function getVisits(
  patientId: string,
): Promise<ServiceResult<Visit[]>> {
  if (!supabase) return { data: null, error: "Supabase not configured" };

  const { data, error } = await supabase
    .from("visits")
    .select(
      `
      id, patient_id, started_at, site_name, status,
      consultations ( soap_assessment, soap_subjective, created_at )
    `,
    )
    .eq("patient_id", patientId)
    .order("started_at", { ascending: false })
    .order("created_at", {
      referencedTable: "consultations",
      ascending: false,
    });
    .select(`
      id, patient_id, started_at, site_name, status,
      consultations ( soap_assessment, soap_subjective, created_at )
    `)
    .eq("patient_id", patientId)
    .order("started_at", { ascending: false })
    .order("created_at", { referencedTable: "consultations", ascending: false });

  if (error) {
    logger.error("[patientService] getVisits:", error.message);
    return { data: null, error: error.message };
  }

  return {
    data: (data || []).map((v) => {
      const consult = Array.isArray(v.consultations)
        ? v.consultations[0]
        : v.consultations;
      return {
        id: v.id,
        patientId: v.patient_id,
        startedAt: v.started_at,
        siteName: v.site_name,
        status: v.status,
        diagnosis: consult?.soap_assessment ?? null,
        notes: consult?.soap_subjective ?? null,
      const consult = Array.isArray(v.consultations) ? v.consultations[0] : v.consultations;
      return {
        id:         v.id,
        patientId:  v.patient_id,
        startedAt:  v.started_at,
        siteName:   v.site_name,
        status:     v.status,
        diagnosis:  consult?.soap_assessment ?? null,
        notes:      consult?.soap_subjective ?? null,
      };
    }),
    error: null,
  };
}

export async function addVisit(
  patientId: string,
  visit: { notes?: string | null; diagnosis?: string | null; siteName?: string },
): Promise<ServiceResult<Visit>> {
  if (!supabase) return { data: null, error: "Supabase not configured" };

  const visitId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const hasConsultationContent = Boolean(
    visit.notes?.trim() || visit.diagnosis?.trim(),
  );

  const { error: visitError } = await supabase.from("visits").insert({
    id: visitId,
    patient_id: patientId,
    started_at: startedAt,
    site_name: visit.siteName ?? "Portal entry",
    status: "closed",
  });

  if (visitError) {
    logger.error("[patientService] addVisit (visit):", visitError.message);
    return { data: null, error: visitError.message };
  }

  if (hasConsultationContent) {
    const { error: consultationError } = await supabase
      .from("consultations")
      .insert({
        id: crypto.randomUUID(),
        patient_id: patientId,
        visit_id: visitId,
        provider_name: "Staff (portal)",
        soap_subjective: visit.notes?.trim() ?? "",
        soap_objective: "",
        soap_assessment: visit.diagnosis?.trim() ?? "",
        soap_plan: "",
        provisional_dx: [],
      });

    if (consultationError) {
      const consultationFailureMessage = consultationError.message;
      logger.error(
        "[patientService] addVisit (consultation):",
        consultationFailureMessage,
      );

      // Best-effort rollback to avoid reporting a successful visit when clinical
      // notes failed to persist.
      const { error: rollbackError } = await supabase
        .from("visits")
        .delete()
        .eq("id", visitId)
        .eq("patient_id", patientId);

      if (rollbackError) {
        logger.error(
          "[patientService] addVisit (rollback visit):",
          rollbackError.message,
        );

        return {
          data: null,
          error: `Consultation save failed and visit cleanup failed: ${consultationFailureMessage}. Cleanup error: ${rollbackError.message}`,
        };
      }

      return {
        data: null,
        error: `Consultation save failed; visit was rolled back: ${consultationFailureMessage}`,
      };
    }
  }

  return {
    data: {
      id: visitId,
      patientId,
      startedAt,
      siteName: visit.siteName ?? "Portal entry",
      status: "closed",
      diagnosis: visit.diagnosis ?? null,
      notes: visit.notes ?? null,
    },
    error: null,
  };
}

// ─── Staff helpers ────────────────────────────────────────────────────────────

export async function getAllPatients(): Promise<
  ServiceResult<PatientProfile[]>
> {
  if (!supabase) return { data: null, error: "Supabase not configured" };

  const { data, error } = await supabase
    .from("patients")
    .select(
      "id, auth_uid, given_name, family_name, email, phone, dob, sex, created_at",
    )
    .select("id, auth_uid, given_name, family_name, email, phone, dob, sex, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("[patientService] getAllPatients:", error.message);
    return { data: null, error: error.message };
  }

  return { data: (data || []).map(rowToProfile), error: null };
}
