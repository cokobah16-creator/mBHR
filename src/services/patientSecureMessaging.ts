import { supabase } from "@/lib/supabase";

// Messages between patients (patient portal) and clinic staff, stored only
// in Supabase (patient_secure_messages). Shared by the clinician inbox
// (features/doctor/PatientMessagesPanel) and the patient portal; keep the
// exported functions backward-compatible.
//
// `read` on a patient's message means a staff member has opened it; on a
// staff message it means the patient has opened it in the portal.

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
  is_archived?: boolean;
}

export interface PatientSearchResult {
  id: string;
  fullName: string;
}

const NOT_CONFIGURED =
  "Secure messaging is not available: the online service is not set up on this device.";

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

export async function getDoctorMessageInbox(_staffId: string): Promise<{
  messages: PatientSecureMessage[];
  patientNames: Map<string, string>;
}> {
  if (!supabase) return { messages: [], patientNames: new Map() };

  const { data, error } = await supabase
    .from("patient_secure_messages")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;

  const messages = (data || []) as PatientSecureMessage[];
  const patientNames = await loadPatientNameMap(
    messages.map((m) => m.patient_id),
  );

  return { messages, patientNames };
}

/**
 * Messages in the staff inbox (not archived), newest first. Throws when the
 * online service is not configured or returns an error, so the caller can
 * say so instead of showing an empty inbox.
 */
export async function listActivePatientMessages(): Promise<
  PatientSecureMessage[]
> {
  if (!supabase) throw new Error(NOT_CONFIGURED);

  const { data, error } = await supabase
    .from("patient_secure_messages")
    .select("*")
    .eq("is_archived", false)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data || []) as PatientSecureMessage[];
}

export async function getDoctorUnreadCount(_staffId: string): Promise<number> {
  if (!supabase) return 0;

  const { count, error } = await supabase
    .from("patient_secure_messages")
    .select("id", { count: "exact", head: true })
    .eq("from_patient", true)
    .eq("read", false);

  if (error) throw error;
  return count || 0;
}

// Characters that would break a PostgREST `or(...)` filter or act as
// wildcards are removed from search text.
function cleanSearch(query: string): string {
  return query
    .replace(/[,()"%*\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function searchPatientsByName(
  query: string,
): Promise<PatientSearchResult[]> {
  const cleaned = cleanSearch(query ?? "");
  if (!supabase || cleaned.length < 2) return [];

  // "Amina Bello": search on the longest (most selective) word, then keep
  // people whose full name contains every word.
  const words = cleaned.toLowerCase().split(" ");
  const multiWord = words.length > 1;
  const serverWord = words.reduce((a, b) => (b.length > a.length ? b : a));
  const term = `%${multiWord ? serverWord : cleaned}%`;
  const limit = multiWord ? 25 : 8;
  const matchesAll = (r: PatientSearchResult) =>
    !multiWord || words.every((w) => r.fullName.toLowerCase().includes(w));

  const snake = await supabase
    .from("patients")
    .select("id,given_name,family_name")
    .or(`given_name.ilike.${term},family_name.ilike.${term}`)
    .limit(limit);

  if (!snake.error && snake.data) {
    return snake.data
      .map((p) => ({
        id: p.id as string,
        fullName:
          `${(p.given_name as string) || ""} ${(p.family_name as string) || ""}`.trim(),
      }))
      .filter(matchesAll)
      .slice(0, 8);
  }

  const camel = await supabase
    .from("patients")
    .select("id,givenName,familyName")
    .or(`givenName.ilike.${term},familyName.ilike.${term}`)
    .limit(limit);

  if (camel.error) throw camel.error;

  return (camel.data || [])
    .map((p) => ({
      id: p.id as string,
      fullName:
        `${(p.givenName as string) || ""} ${(p.familyName as string) || ""}`.trim(),
    }))
    .filter(matchesAll)
    .slice(0, 8);
}

/**
 * Stores a staff message for the patient. It is saved unread so the patient
 * portal shows it as new. Resolves only once the online service has stored
 * it; throws otherwise.
 */
export async function sendDoctorMessage(params: {
  staffId: string;
  staffName: string;
  patientId: string;
  subject: string;
  body: string;
  /**
   * Optional client-generated UUID for the stored row. Sending again with
   * the same id after a lost response does not store the message twice.
   */
  clientId?: string;
}) {
  if (!supabase) {
    throw new Error(NOT_CONFIGURED);
  }

  const { error } = await supabase.from("patient_secure_messages").insert({
    ...(params.clientId ? { id: params.clientId } : {}),
    patient_id: params.patientId,
    staff_id: params.staffId,
    subject: params.subject.trim(),
    body: params.body.trim(),
    from_patient: false,
    from_name: params.staffName,
    read: false,
  });

  // 23505 on a retry with the same client id: an earlier attempt was
  // stored but its response never arrived, so the message is already sent.
  if (error && params.clientId && (error as { code?: string }).code === "23505") {
    return;
  }
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

/** Marks several patient messages as read by staff. */
export async function markPatientMessagesRead(messageIds: string[]) {
  if (!supabase || messageIds.length === 0) return;
  const { error } = await supabase
    .from("patient_secure_messages")
    .update({ read: true })
    .in("id", messageIds);

  if (error) throw error;
}

/**
 * Hides every message with this patient from the staff inbox (kept in the
 * record). Returns how many messages the server changed; 0 means nothing
 * was archived.
 */
export async function archivePatientThread(patientId: string): Promise<number> {
  if (!supabase) {
    throw new Error(NOT_CONFIGURED);
  }
  const { data, error } = await supabase
    .from("patient_secure_messages")
    .update({ is_archived: true })
    .eq("patient_id", patientId)
    .select("id");

  if (error) throw error;
  return data?.length ?? 0;
}

/**
 * Permanently deletes every message with this patient. Returns how many
 * messages the server deleted; 0 means nothing was deleted.
 */
export async function deletePatientThread(patientId: string): Promise<number> {
  if (!supabase) {
    throw new Error(NOT_CONFIGURED);
  }
  const { data, error } = await supabase
    .from("patient_secure_messages")
    .delete()
    .eq("patient_id", patientId)
    .select("id");

  if (error) throw error;
  return data?.length ?? 0;
}

export async function archiveSecureMessage(messageId: string) {
  if (!supabase) {
    throw new Error(NOT_CONFIGURED);
  }
  const { error } = await supabase
    .from("patient_secure_messages")
    .update({ is_archived: true })
    .eq("id", messageId);

  if (error) throw error;
}

export async function deleteSecureMessage(messageId: string) {
  if (!supabase) {
    throw new Error(NOT_CONFIGURED);
  }
  const { error } = await supabase
    .from("patient_secure_messages")
    .delete()
    .eq("id", messageId);

  if (error) throw error;
}
