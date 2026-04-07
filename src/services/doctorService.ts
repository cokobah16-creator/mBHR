import { supabase } from "@/lib/supabase";
import type {
  PatientFlag,
  Referral,
  FollowUpSchedule,
  PrescriptionTemplate,
  SiteFormulary,
  DoctorAnalytics,
  ConsultationReview,
  ProtocolLibrary,
} from "@/types/multiTenant";

export const doctorService = {
  async createPatientFlag(
    flag: Omit<PatientFlag, "id" | "created_at" | "status">,
  ): Promise<PatientFlag | null> {
    if (!supabase) throw new Error("Supabase not initialized");

    const { data, error } = await supabase
      .from("patient_flags")
      .insert({
        ...flag,
        status: "open",
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating patient flag:", error);
      return null;
    }

    return data;
  },

  async getPatientFlags(params: {
    org_id: string;
    site_id?: string;
    event_id?: string;
    to_station?: string;
    status?: string;
  }): Promise<PatientFlag[]> {
    if (!supabase) throw new Error("Supabase not initialized");

    let query = supabase
      .from("patient_flags")
      .select("*")
      .eq("org_id", params.org_id)
      .order("created_at", { ascending: false });

    if (params.site_id) {
      query = query.eq("site_id", params.site_id);
    }

    if (params.event_id) {
      query = query.eq("event_id", params.event_id);
    }

    if (params.to_station) {
      query = query.eq("to_station", params.to_station);
    }

    if (params.status) {
      query = query.eq("status", params.status);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching patient flags:", error);
      return [];
    }

    return data || [];
  },

  async resolvePatientFlag(
    flagId: string,
    resolvedBy: string,
    resolutionNote?: string,
  ): Promise<boolean> {
    if (!supabase) throw new Error("Supabase not initialized");

    const { error } = await supabase
      .from("patient_flags")
      .update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        resolved_by: resolvedBy,
        resolution_note: resolutionNote,
      })
      .eq("id", flagId);

    if (error) {
      console.error("Error resolving patient flag:", error);
      return false;
    }

    return true;
  },

  async createReferral(
    referral: Omit<Referral, "id" | "created_at" | "updated_at">,
  ): Promise<Referral | null> {
    if (!supabase) throw new Error("Supabase not initialized");

    const { data, error } = await supabase
      .from("referrals")
      .insert(referral)
      .select()
      .single();

    if (error) {
      console.error("Error creating referral:", error);
      return null;
    }

    return data;
  },

  async getReferrals(params: {
    org_id: string;
    site_id?: string;
    patient_id?: string;
    status?: string;
  }): Promise<Referral[]> {
    if (!supabase) throw new Error("Supabase not initialized");

    let query = supabase
      .from("referrals")
      .select("*")
      .eq("org_id", params.org_id)
      .order("created_at", { ascending: false });

    if (params.site_id) {
      query = query.eq("site_id", params.site_id);
    }

    if (params.patient_id) {
      query = query.eq("patient_id", params.patient_id);
    }

    if (params.status) {
      query = query.eq("status", params.status);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching referrals:", error);
      return [];
    }

    return data || [];
  },

  async scheduleFollowUp(
    followUp: Omit<FollowUpSchedule, "id" | "created_at" | "updated_at">,
  ): Promise<FollowUpSchedule | null> {
    if (!supabase) throw new Error("Supabase not initialized");

    const { data, error } = await supabase
      .from("follow_up_schedules")
      .insert(followUp)
      .select()
      .single();

    if (error) {
      console.error("Error scheduling follow-up:", error);
      return null;
    }

    return data;
  },

  async getFollowUpSchedules(params: {
    org_id: string;
    site_id?: string;
    patient_id?: string;
    status?: string;
  }): Promise<FollowUpSchedule[]> {
    if (!supabase) throw new Error("Supabase not initialized");

    let query = supabase
      .from("follow_up_schedules")
      .select("*")
      .eq("org_id", params.org_id)
      .order("scheduled_date", { ascending: true });

    if (params.site_id) {
      query = query.eq("site_id", params.site_id);
    }

    if (params.patient_id) {
      query = query.eq("patient_id", params.patient_id);
    }

    if (params.status) {
      query = query.eq("status", params.status);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching follow-up schedules:", error);
      return [];
    }

    return data || [];
  },

  async getPrescriptionTemplates(
    org_id: string,
    condition?: string,
  ): Promise<PrescriptionTemplate[]> {
    if (!supabase) throw new Error("Supabase not initialized");

    let query = supabase
      .from("prescription_templates")
      .select("*")
      .eq("org_id", org_id)
      .eq("is_active", true)
      .order("name");

    if (condition) {
      query = query.eq("condition", condition);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching prescription templates:", error);
      return [];
    }

    return data || [];
  },

  async getSiteFormulary(
    site_id: string,
    searchTerm?: string,
  ): Promise<SiteFormulary[]> {
    if (!supabase) throw new Error("Supabase not initialized");

    let query = supabase
      .from("site_formulary")
      .select("*")
      .eq("site_id", site_id)
      .eq("is_active", true)
      .order("medication_name");

    if (searchTerm) {
      query = query.ilike("medication_name", `%${searchTerm}%`);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching site formulary:", error);
      return [];
    }

    return data || [];
  },

  async getDoctorAnalytics(
    event_id: string,
    doctor_id: string,
  ): Promise<DoctorAnalytics | null> {
    if (!supabase) throw new Error("Supabase not initialized");

    const { data, error } = await supabase
      .from("doctor_analytics")
      .select("*")
      .eq("event_id", event_id)
      .eq("doctor_id", doctor_id)
      .maybeSingle();

    if (error) {
      console.error("Error fetching doctor analytics:", error);
      return null;
    }

    return data;
  },

  async updateDoctorAnalytics(
    event_id: string,
    doctor_id: string,
    updates: Partial<DoctorAnalytics>,
  ): Promise<boolean> {
    if (!supabase) throw new Error("Supabase not initialized");

    const { error } = await supabase.from("doctor_analytics").upsert({
      event_id,
      doctor_id,
      ...updates,
      updated_at: new Date().toISOString(),
    });

    if (error) {
      console.error("Error updating doctor analytics:", error);
      return false;
    }

    return true;
  },

  async getProtocols(params: {
    org_id: string;
    condition?: string;
    category?: string;
  }): Promise<ProtocolLibrary[]> {
    if (!supabase) throw new Error("Supabase not initialized");

    let query = supabase
      .from("protocol_library")
      .select("*")
      .eq("org_id", params.org_id)
      .eq("is_active", true)
      .order("title");

    if (params.condition) {
      query = query.eq("condition", params.condition);
    }

    if (params.category) {
      query = query.eq("category", params.category);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching protocols:", error);
      return [];
    }

    return data || [];
  },

  async createConsultationReview(
    review: Omit<ConsultationReview, "id" | "created_at">,
  ): Promise<ConsultationReview | null> {
    if (!supabase) throw new Error("Supabase not initialized");

    const { data, error } = await supabase
      .from("consultation_reviews")
      .insert(review)
      .select()
      .single();

    if (error) {
      console.error("Error creating consultation review:", error);
      return null;
    }

    return data;
  },

  async getConsultationReviews(params: {
    org_id: string;
    reviewed_doctor_id?: string;
    review_status?: string;
  }): Promise<ConsultationReview[]> {
    if (!supabase) throw new Error("Supabase not initialized");

    let query = supabase
      .from("consultation_reviews")
      .select("*")
      .eq("org_id", params.org_id)
      .order("created_at", { ascending: false });

    if (params.reviewed_doctor_id) {
      query = query.eq("reviewed_doctor_id", params.reviewed_doctor_id);
    }

    if (params.review_status) {
      query = query.eq("review_status", params.review_status);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching consultation reviews:", error);
      return [];
    }

    return data || [];
  },
};
