import { supabase } from "@/lib/supabase";
import type {
  Organization,
  Site,
  OutreachEvent,
  EventStaffAssignment,
  UserOrgSite,
} from "@/types/multiTenant";

export const outreachService = {
  async getOrganization(org_id: string): Promise<Organization | null> {
    if (!supabase) throw new Error("Supabase not initialized");

    const { data, error } = await supabase
      .from("organizations")
      .select("*")
      .eq("id", org_id)
      .maybeSingle();

    if (error) {
      console.error("Error fetching organization:", error);
      return null;
    }

    return data;
  },

  async getUserOrganizations(user_id: string): Promise<Organization[]> {
    if (!supabase) throw new Error("Supabase not initialized");

    const { data, error } = await supabase
      .from("user_org_sites")
      .select("org_id, organizations(*)")
      .eq("user_id", user_id);

    if (error) {
      console.error("Error fetching user organizations:", error);
      return [];
    }

    return data?.map((item: any) => item.organizations).filter(Boolean) || [];
  },

  async getSites(org_id: string): Promise<Site[]> {
    if (!supabase) throw new Error("Supabase not initialized");

    const { data, error } = await supabase
      .from("sites")
      .select("*")
      .eq("org_id", org_id)
      .eq("is_active", true)
      .order("name");

    if (error) {
      console.error("Error fetching sites:", error);
      return [];
    }

    return data || [];
  },

  async getSite(site_id: string): Promise<Site | null> {
    if (!supabase) throw new Error("Supabase not initialized");

    const { data, error } = await supabase
      .from("sites")
      .select("*")
      .eq("id", site_id)
      .maybeSingle();

    if (error) {
      console.error("Error fetching site:", error);
      return null;
    }

    return data;
  },

  async getOutreachEvents(params: {
    org_id: string;
    site_id?: string;
    status?: string;
    from_date?: string;
    to_date?: string;
  }): Promise<OutreachEvent[]> {
    if (!supabase) throw new Error("Supabase not initialized");

    let query = supabase
      .from("outreach_events")
      .select("*")
      .eq("org_id", params.org_id)
      .order("event_date", { ascending: false });

    if (params.site_id) {
      query = query.eq("site_id", params.site_id);
    }

    if (params.status) {
      query = query.eq("status", params.status);
    }

    if (params.from_date) {
      query = query.gte("event_date", params.from_date);
    }

    if (params.to_date) {
      query = query.lte("event_date", params.to_date);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching outreach events:", error);
      return [];
    }

    return data || [];
  },

  async getOutreachEvent(event_id: string): Promise<OutreachEvent | null> {
    if (!supabase) throw new Error("Supabase not initialized");

    const { data, error } = await supabase
      .from("outreach_events")
      .select("*")
      .eq("id", event_id)
      .maybeSingle();

    if (error) {
      console.error("Error fetching outreach event:", error);
      return null;
    }

    return data;
  },

  async createOutreachEvent(
    event: Omit<OutreachEvent, "id" | "created_at" | "updated_at">,
  ): Promise<OutreachEvent | null> {
    if (!supabase) throw new Error("Supabase not initialized");

    const { data, error } = await supabase
      .from("outreach_events")
      .insert(event)
      .select()
      .single();

    if (error) {
      console.error("Error creating outreach event:", error);
      return null;
    }

    return data;
  },

  async updateOutreachEvent(
    event_id: string,
    updates: Partial<OutreachEvent>,
  ): Promise<boolean> {
    if (!supabase) throw new Error("Supabase not initialized");

    const { error } = await supabase
      .from("outreach_events")
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq("id", event_id);

    if (error) {
      console.error("Error updating outreach event:", error);
      return false;
    }

    return true;
  },

  async getEventStaffAssignments(
    event_id: string,
  ): Promise<EventStaffAssignment[]> {
    if (!supabase) throw new Error("Supabase not initialized");

    const { data, error } = await supabase
      .from("event_staff_assignments")
      .select("*")
      .eq("event_id", event_id)
      .order("created_at");

    if (error) {
      console.error("Error fetching event staff assignments:", error);
      return [];
    }

    return data || [];
  },

  async assignStaffToEvent(
    assignment: Omit<EventStaffAssignment, "id" | "created_at">,
  ): Promise<EventStaffAssignment | null> {
    if (!supabase) throw new Error("Supabase not initialized");

    const { data, error } = await supabase
      .from("event_staff_assignments")
      .insert(assignment)
      .select()
      .single();

    if (error) {
      console.error("Error assigning staff to event:", error);
      return null;
    }

    return data;
  },

  async checkInStaff(assignment_id: string): Promise<boolean> {
    if (!supabase) throw new Error("Supabase not initialized");

    const { error } = await supabase
      .from("event_staff_assignments")
      .update({
        check_in_time: new Date().toISOString(),
      })
      .eq("id", assignment_id);

    if (error) {
      console.error("Error checking in staff:", error);
      return false;
    }

    return true;
  },

  async checkOutStaff(assignment_id: string): Promise<boolean> {
    if (!supabase) throw new Error("Supabase not initialized");

    const { error } = await supabase
      .from("event_staff_assignments")
      .update({
        check_out_time: new Date().toISOString(),
      })
      .eq("id", assignment_id);

    if (error) {
      console.error("Error checking out staff:", error);
      return false;
    }

    return true;
  },

  async getUserEventAssignments(
    user_id: string,
  ): Promise<EventStaffAssignment[]> {
    if (!supabase) throw new Error("Supabase not initialized");

    const { data, error } = await supabase
      .from("event_staff_assignments")
      .select("*")
      .eq("user_id", user_id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching user event assignments:", error);
      return [];
    }

    return data || [];
  },

  async getActiveEventForUser(user_id: string): Promise<OutreachEvent | null> {
    if (!supabase) throw new Error("Supabase not initialized");

    const today = new Date().toISOString().split("T")[0];

    const { data: assignments, error: assignmentError } = await supabase
      .from("event_staff_assignments")
      .select("event_id")
      .eq("user_id", user_id);

    if (assignmentError || !assignments || assignments.length === 0) {
      return null;
    }

    const eventIds = assignments.map((a) => a.event_id);

    const { data, error } = await supabase
      .from("outreach_events")
      .select("*")
      .in("id", eventIds)
      .eq("event_date", today)
      .eq("status", "active")
      .maybeSingle();

    if (error) {
      console.error("Error fetching active event for user:", error);
      return null;
    }

    return data;
  },

  async getUserDefaultOrgSite(user_id: string): Promise<UserOrgSite | null> {
    if (!supabase) throw new Error("Supabase not initialized");

    const { data, error } = await supabase
      .from("user_org_sites")
      .select("*")
      .eq("user_id", user_id)
      .eq("is_default", true)
      .maybeSingle();

    if (error) {
      console.error("Error fetching default org/site:", error);
      return null;
    }

    return data;
  },

  async setDefaultOrgSite(
    user_id: string,
    org_id: string,
    site_id?: string,
  ): Promise<boolean> {
    if (!supabase) throw new Error("Supabase not initialized");

    await supabase
      .from("user_org_sites")
      .update({ is_default: false })
      .eq("user_id", user_id);

    const { error } = await supabase
      .from("user_org_sites")
      .update({ is_default: true })
      .eq("user_id", user_id)
      .eq("org_id", org_id)
      .eq("site_id", site_id || null);

    if (error) {
      console.error("Error setting default org/site:", error);
      return false;
    }

    return true;
  },
};
