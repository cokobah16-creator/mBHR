export interface Organization {
  id: string;
  name: string;
  slug: string;
  logo_url?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settings: Record<string, any>;
  subscription_tier: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Site {
  id: string;
  org_id: string;
  name: string;
  site_code: string;
  address: string;
  state: string;
  lga: string;
  typical_patient_volume: number;
  capacity: number;
  coordinates?: { lat: number; lng: number };
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface OutreachEvent {
  id: string;
  org_id: string;
  site_id: string;
  event_name: string;
  event_date: string;
  start_time: string;
  end_time: string;
  status: "planned" | "active" | "completed" | "cancelled";
  expected_volume: number;
  actual_volume?: number;
  staff_roster: Array<{
    user_id: string;
    role: string;
    station?: string;
  }>;
  notes?: string;
  outcome_summary?: {
    total_patients: number;
    diagnoses: Record<string, number>;
    prescriptions_dispensed: number;
    referrals_made: number;
  };
  created_at: string;
  updated_at: string;
}

export interface EventStaffAssignment {
  id: string;
  event_id: string;
  user_id: string;
  role: "doctor" | "nurse" | "pharmacist" | "volunteer" | "lab_tech" | "admin";
  station?:
    | "registration"
    | "vitals"
    | "consult"
    | "pharmacy"
    | "lab"
    | "education";
  is_supervising: boolean;
  check_in_time?: string;
  check_out_time?: string;
  created_at: string;
}

export interface UserOrgSite {
  id: string;
  user_id: string;
  org_id: string;
  site_id?: string;
  is_default: boolean;
  created_at: string;
}

export interface PatientFlag {
  id: string;
  org_id: string;
  site_id: string;
  event_id?: string;
  patient_id: string;
  visit_id?: string;
  flag_type:
    | "escalate_to_doctor"
    | "recheck_vitals"
    | "pharmacy_query"
    | "lab_pending"
    | "urgent"
    | "follow_up_needed";
  from_station: "registration" | "vitals" | "consult" | "pharmacy" | "lab";
  to_station: "registration" | "vitals" | "consult" | "pharmacy" | "lab";
  from_user_id: string;
  to_user_id?: string;
  priority: "urgent" | "high" | "normal" | "low";
  message: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: Record<string, any>;
  status: "open" | "acknowledged" | "resolved" | "cancelled";
  resolved_at?: string;
  resolved_by?: string;
  resolution_note?: string;
  created_at: string;
}

export interface Referral {
  id: string;
  org_id: string;
  site_id: string;
  event_id?: string;
  patient_id: string;
  visit_id?: string;
  referring_doctor_id: string;
  referral_type: "specialist" | "hospital" | "lab" | "imaging" | "follow_up";
  specialty?: string;
  facility_name?: string;
  urgency: "emergency" | "urgent" | "routine";
  reason: string;
  clinical_summary?: string;
  diagnosis?: string;
  status: "pending" | "scheduled" | "completed" | "cancelled";
  appointment_date?: string;
  outcome?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface FollowUpSchedule {
  id: string;
  org_id: string;
  site_id: string;
  patient_id: string;
  original_visit_id?: string;
  scheduled_event_id?: string;
  follow_up_type:
    | "chronic_disease"
    | "medication_refill"
    | "test_results"
    | "post_treatment"
    | "general_checkup";
  reason: string;
  priority: "urgent" | "high" | "routine";
  scheduled_date?: string;
  reminder_sent: boolean;
  reminder_sent_at?: string;
  status: "scheduled" | "reminded" | "completed" | "missed" | "cancelled";
  completed_visit_id?: string;
  notes?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface PrescriptionTemplate {
  id: string;
  org_id: string;
  name: string;
  condition: string;
  description?: string;
  medications: Array<{
    medication_name: string;
    dosage: string;
    frequency: string;
    duration_days: number;
    quantity: number;
    instructions?: string;
  }>;
  is_protocol: boolean;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface SiteFormulary {
  id: string;
  org_id: string;
  site_id: string;
  medication_name: string;
  generic_name?: string;
  form: string;
  strength: string;
  unit: string;
  typical_stock_level?: number;
  current_stock: number;
  reorder_threshold?: number;
  is_controlled: boolean;
  alternatives: string[];
  notes?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DoctorAnalytics {
  id: string;
  org_id: string;
  site_id: string;
  event_id: string;
  doctor_id: string;
  patients_seen: number;
  consultations_completed: number;
  avg_consultation_time_minutes?: number;
  prescriptions_written: number;
  referrals_made: number;
  pharmacy_queries: number;
  vitals_rechecks: number;
  diagnoses: Record<string, number>;
  shift_start?: string;
  shift_end?: string;
  total_hours?: number;
  created_at: string;
  updated_at: string;
}

export interface ConsultationReview {
  id: string;
  org_id: string;
  site_id: string;
  event_id?: string;
  consultation_id: string;
  patient_id: string;
  visit_id?: string;
  reviewed_doctor_id: string;
  reviewing_doctor_id: string;
  review_type: "routine" | "requested" | "teaching" | "quality_assurance";
  review_status: "pending" | "approved" | "modified" | "flagged";
  feedback?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  modifications?: Record<string, any>;
  teaching_points?: string;
  reviewed_at?: string;
  created_at: string;
}

export interface ProtocolLibrary {
  id: string;
  org_id: string;
  site_id?: string;
  title: string;
  condition: string;
  category:
    | "infectious"
    | "chronic"
    | "acute"
    | "emergency"
    | "pediatric"
    | "maternal"
    | "general";
  protocol_content: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  algorithm?: Record<string, any>;
  medications?: Array<{
    name: string;
    dosage: string;
    alternatives?: string[];
  }>;
  contraindications?: string[];
  special_considerations?: string;
  clinical_references?: string;
  version: string;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}
