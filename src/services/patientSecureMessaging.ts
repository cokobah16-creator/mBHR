import { supabase } from "@/lib/supabase";

export interface PatientSecureMessage {
  id: string;
  patient_id: string;
  staff_id: string | null;
  subject: string;
  body: string;
  from_patient: boolean;
  from_name: string;
  read: boolean;
  created_at: string;
}

export interface PatientSearchResult {
  id: string;
  fullName: string;
}

async function loadPatientNameMap(patientIds: string[]) {
  if (!supabase || patientIds.length === 0) return new Map<string, string>();

  const uniqueIds = Array.from(new Set(patientIds));

  const map = new Map<string, string>();

  const snake = await supabase
    .from("patients")
    .select("id,given_name,family_name")
    .in("id", uniqueIds);

  if (!snake.error && snake.data) {
    snake.data.forEach((p) => {
      map.set(
        p.id as string,
        `${(p.given_name as string) || ""} ${(p.family_name as string) || ""}`.trim(),
      );
    });
    return map;
  }

  const camel = await supabase
    .from("patients")
    .select("id,givenName,familyName")
    .in("id", uniqueIds);

  if (!camel.error && camel.data) {
    camel.data.forEach((p) => {
      map.set(
        p.id as string,
        `${(p.givenName as string) || ""} ${(p.familyName as string) || ""}`.trim(),
      );
    });
  }

  return map;
}

export async function getDoctorMessageInbox(staffId: string): Promise<{
  messages: PatientSecureMessage[];
  patientNames: Map<string, string>;
}> {
  if (!supabase) return { messages: [], patientNames: new Map() };

  const { data, error } = await supabase
    .from("patient_secure_messages")
    .select("*")
    .or(`staff_id.eq.${staffId},and(staff_id.is.null,from_patient.eq.true)`)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const messages = (data || []) as PatientSecureMessage[];
  const patientNames = await loadPatientNameMap(
    messages.map((m) => m.patient_id),
  );

  return { messages, patientNames };
}

export async function getDoctorUnreadCount(staffId: string): Promise<number> {
  if (!supabase) return 0;

  const { count, error } = await supabase
    .from("patient_secure_messages")
    .select("id", { count: "exact", head: true })
    .eq("from_patient", true)
    .eq("read", false)
    .or(`staff_id.eq.${staffId},staff_id.is.null`);

  if (error) throw error;
  return count || 0;
}

export async function searchPatientsByName(
  query: string,
): Promise<PatientSearchResult[]> {
  if (!supabase || query.trim().length < 2) return [];

  const term = `%${query.trim()}%`;

  const snake = await supabase
    .from("patients")
    .select("id,given_name,family_name")
    .or(`given_name.ilike.${term},family_name.ilike.${term}`)
    .limit(8);

  if (!snake.error && snake.data) {
    return snake.data.map((p) => ({
      id: p.id as string,
      fullName:
        `${(p.given_name as string) || ""} ${(p.family_name as string) || ""}`.trim(),
    }));
  }

  const camel = await supabase
    .from("patients")
    .select("id,givenName,familyName")
    .or(`givenName.ilike.${term},familyName.ilike.${term}`)
    .limit(8);

  if (camel.error) throw camel.error;

  return (camel.data || []).map((p) => ({
    id: p.id as string,
    fullName:
      `${(p.givenName as string) || ""} ${(p.familyName as string) || ""}`.trim(),
  }));
}

export async function sendDoctorMessage(params: {
  staffId: string;
  staffName: string;
  patientId: string;
  subject: string;
  body: string;
}) {
  if (!supabase) {
    throw new Error("Secure messaging is unavailable while offline.");
  }

  const { error } = await supabase.from("patient_secure_messages").insert({
    patient_id: params.patientId,
    staff_id: params.staffId,
    subject: params.subject.trim(),
    body: params.body.trim(),
    from_patient: false,
    from_name: params.staffName,
    read: false,
  });

  if (error) throw error;
}

export async function markMessageRead(messageId: string) {
  if (!supabase) return;
  const { error } = await supabase
    .from("patient_secure_messages")
    .update({ read: true })
    .eq("id", messageId);

  if (error) throw error;
}
