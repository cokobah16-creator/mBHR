/**
 * Patient Service – abstraction layer over Supabase for patient-facing data.
 *
 * All UI components should call these functions rather than querying Supabase
 * directly.  This keeps the Supabase dependency in one place and makes it
 * straightforward to add local caching or offline queuing later.
 */
import { supabase } from "@/lib/supabaseClient";
import * as logger from "@/lib/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PatientProfile {
  id: string;
  authUserId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  createdAt: string;
}

export interface Visit {
  id: string;
  patientId: string;
  visitDate: string;
  notes: string | null;
  diagnosis: string | null;
}

export interface Medication {
  id: string;
  patientId: string;
  name: string;
  dosage: string | null;
  instructions: string | null;
  createdAt: string;
}

export interface Vital {
  id: string;
  patientId: string;
  bloodPressure: string | null;
  weight: number | null;
  temperature: number | null;
  recordedAt: string;
}

export interface ServiceResult<T> {
  data: T | null;
  error: string | null;
}

// ─── Profile ─────────────────────────────────────────────────────────────────

export async function getPatientProfile(authUserId: string): Promise<ServiceResult<PatientProfile>> {
  if (!supabase) return { data: null, error: "Supabase not configured" };

  const { data, error } = await supabase
    .from("patients")
    .select("*")
    .eq("auth_user_id", authUserId)
    .single();

  if (error) {
    logger.error("[patientService] getPatientProfile:", error.message);
    return { data: null, error: error.message };
  }

  return {
    data: {
      id:           data.id,
      authUserId:   data.auth_user_id,
      fullName:     data.full_name,
      email:        data.email,
      phone:        data.phone,
      dateOfBirth:  data.date_of_birth,
      createdAt:    data.created_at,
    },
    error: null,
  };
}

export async function updatePatientProfile(
  patientId: string,
  updates: Partial<Pick<PatientProfile, "fullName" | "phone" | "dateOfBirth">>,
): Promise<ServiceResult<PatientProfile>> {
  if (!supabase) return { data: null, error: "Supabase not configured" };

  const payload: Record<string, unknown> = {};
  if (updates.fullName   !== undefined) payload.full_name      = updates.fullName;
  if (updates.phone      !== undefined) payload.phone          = updates.phone;
  if (updates.dateOfBirth !== undefined) payload.date_of_birth = updates.dateOfBirth;

  const { data, error } = await supabase
    .from("patients")
    .update(payload)
    .eq("id", patientId)
    .select()
    .single();

  if (error) {
    logger.error("[patientService] updatePatientProfile:", error.message);
    return { data: null, error: error.message };
  }

  return {
    data: {
      id:           data.id,
      authUserId:   data.auth_user_id,
      fullName:     data.full_name,
      email:        data.email,
      phone:        data.phone,
      dateOfBirth:  data.date_of_birth,
      createdAt:    data.created_at,
    },
    error: null,
  };
}

// ─── Vitals ───────────────────────────────────────────────────────────────────

export async function getVitals(patientId: string): Promise<ServiceResult<Vital[]>> {
  if (!supabase) return { data: null, error: "Supabase not configured" };

  const { data, error } = await supabase
    .from("vitals")
    .select("*")
    .eq("patient_id", patientId)
    .order("recorded_at", { ascending: false });

  if (error) {
    logger.error("[patientService] getVitals:", error.message);
    return { data: null, error: error.message };
  }

  return {
    data: (data || []).map((v) => ({
      id:            v.id,
      patientId:     v.patient_id,
      bloodPressure: v.blood_pressure,
      weight:        v.weight,
      temperature:   v.temperature,
      recordedAt:    v.recorded_at,
    })),
    error: null,
  };
}

export async function addVital(
  patientId: string,
  vital: Pick<Vital, "bloodPressure" | "weight" | "temperature">,
): Promise<ServiceResult<Vital>> {
  if (!supabase) return { data: null, error: "Supabase not configured" };

  const { data, error } = await supabase
    .from("vitals")
    .insert({
      patient_id:     patientId,
      blood_pressure: vital.bloodPressure,
      weight:         vital.weight,
      temperature:    vital.temperature,
    })
    .select()
    .single();

  if (error) {
    logger.error("[patientService] addVital:", error.message);
    return { data: null, error: error.message };
  }

  return {
    data: {
      id:            data.id,
      patientId:     data.patient_id,
      bloodPressure: data.blood_pressure,
      weight:        data.weight,
      temperature:   data.temperature,
      recordedAt:    data.recorded_at,
    },
    error: null,
  };
}

// ─── Medications ──────────────────────────────────────────────────────────────

export async function getMedications(patientId: string): Promise<ServiceResult<Medication[]>> {
  if (!supabase) return { data: null, error: "Supabase not configured" };

  const { data, error } = await supabase
    .from("medications")
    .select("*")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("[patientService] getMedications:", error.message);
    return { data: null, error: error.message };
  }

  return {
    data: (data || []).map((m) => ({
      id:           m.id,
      patientId:    m.patient_id,
      name:         m.name,
      dosage:       m.dosage,
      instructions: m.instructions,
      createdAt:    m.created_at,
    })),
    error: null,
  };
}

export async function addMedication(
  patientId: string,
  med: Pick<Medication, "name" | "dosage" | "instructions">,
): Promise<ServiceResult<Medication>> {
  if (!supabase) return { data: null, error: "Supabase not configured" };

  const { data, error } = await supabase
    .from("medications")
    .insert({
      patient_id:   patientId,
      name:         med.name,
      dosage:       med.dosage,
      instructions: med.instructions,
    })
    .select()
    .single();

  if (error) {
    logger.error("[patientService] addMedication:", error.message);
    return { data: null, error: error.message };
  }

  return {
    data: {
      id:           data.id,
      patientId:    data.patient_id,
      name:         data.name,
      dosage:       data.dosage,
      instructions: data.instructions,
      createdAt:    data.created_at,
    },
    error: null,
  };
}

// ─── Visits ───────────────────────────────────────────────────────────────────

export async function getVisits(patientId: string): Promise<ServiceResult<Visit[]>> {
  if (!supabase) return { data: null, error: "Supabase not configured" };

  const { data, error } = await supabase
    .from("visits")
    .select("*")
    .eq("patient_id", patientId)
    .order("visit_date", { ascending: false });

  if (error) {
    logger.error("[patientService] getVisits:", error.message);
    return { data: null, error: error.message };
  }

  return {
    data: (data || []).map((v) => ({
      id:        v.id,
      patientId: v.patient_id,
      visitDate: v.visit_date,
      notes:     v.notes,
      diagnosis: v.diagnosis,
    })),
    error: null,
  };
}

export async function addVisit(
  patientId: string,
  visit: Pick<Visit, "notes" | "diagnosis">,
): Promise<ServiceResult<Visit>> {
  if (!supabase) return { data: null, error: "Supabase not configured" };

  const { data, error } = await supabase
    .from("visits")
    .insert({
      patient_id: patientId,
      notes:      visit.notes,
      diagnosis:  visit.diagnosis,
    })
    .select()
    .single();

  if (error) {
    logger.error("[patientService] addVisit:", error.message);
    return { data: null, error: error.message };
  }

  return {
    data: {
      id:        data.id,
      patientId: data.patient_id,
      visitDate: data.visit_date,
      notes:     data.notes,
      diagnosis: data.diagnosis,
    },
    error: null,
  };
}

// ─── Staff helpers ────────────────────────────────────────────────────────────

export async function getAllPatients(): Promise<ServiceResult<PatientProfile[]>> {
  if (!supabase) return { data: null, error: "Supabase not configured" };

  const { data, error } = await supabase
    .from("patients")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("[patientService] getAllPatients:", error.message);
    return { data: null, error: error.message };
  }

  return {
    data: (data || []).map((p) => ({
      id:           p.id,
      authUserId:   p.auth_user_id,
      fullName:     p.full_name,
      email:        p.email,
      phone:        p.phone,
      dateOfBirth:  p.date_of_birth,
      createdAt:    p.created_at,
    })),
    error: null,
  };
}
