// Patient identity matching used by FHIR Patient/$match (TEFCA Patient
// Discovery). Ported from src/services/fhir/tefcaAuth.ts:matchPatientIdentity
// so the same logic runs in browser (offline IAS) and edge (TEFCA) contexts.

import { createClient } from "npm:@supabase/supabase-js@2";

type SupabaseLike = ReturnType<typeof createClient>;

export interface MatchIdentifiers {
  mrn?: string;
  phone?: string;
  email?: string;
  name?: string;
  dob?: string;
}

export interface PatientIdentityMatch {
  patientId: string;
  confidence: number;
  matchMethod: "exact" | "identifier" | "demographic";
}

/** Normalize a phone number to Nigerian E.164 (without the +). */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("234") && digits.length === 13) return digits;
  if (digits.startsWith("0") && digits.length === 11)
    return "234" + digits.slice(1);
  if (digits.length === 10) return "234" + digits;
  return digits;
}

export async function matchPatientIdentity(
  supabase: SupabaseLike,
  identifiers: MatchIdentifiers,
): Promise<PatientIdentityMatch | null> {
  if (identifiers.mrn) {
    const { data: patient } = await supabase
      .from("patients")
      .select("id")
      .eq("id", identifiers.mrn)
      .maybeSingle();
    if (patient) {
      return {
        patientId: (patient as { id: string }).id,
        confidence: 1.0,
        matchMethod: "exact",
      };
    }
  }

  if (identifiers.phone) {
    const normalized = normalizePhone(identifiers.phone);
    const { data: patient } = await supabase
      .from("patients")
      .select("id")
      .eq("phone", normalized)
      .maybeSingle();
    if (patient) {
      return {
        patientId: (patient as { id: string }).id,
        confidence: 0.95,
        matchMethod: "identifier",
      };
    }
  }

  if (identifiers.email) {
    const { data: patient } = await supabase
      .from("patients")
      .select("id")
      .eq("email", identifiers.email.toLowerCase())
      .maybeSingle();
    if (patient) {
      return {
        patientId: (patient as { id: string }).id,
        confidence: 0.95,
        matchMethod: "identifier",
      };
    }
  }

  if (identifiers.name && identifiers.dob) {
    const { data: patients } = await supabase
      .from("patients")
      .select("id, name, dob")
      .eq("dob", identifiers.dob)
      .ilike("name", `%${identifiers.name}%`);

    const rows = (patients || []) as Array<{ id: string; name: string }>;
    if (rows.length === 1) {
      return {
        patientId: rows[0].id,
        confidence: 0.85,
        matchMethod: "demographic",
      };
    }
    if (rows.length > 1) {
      const exact = rows.find(
        (p) => p.name.toLowerCase() === identifiers.name!.toLowerCase(),
      );
      if (exact) {
        return {
          patientId: exact.id,
          confidence: 0.9,
          matchMethod: "demographic",
        };
      }
    }
  }

  return null;
}

/**
 * Extract MatchIdentifiers from a FHIR Parameters resource as per
 * http://hl7.org/fhir/R4/patient-operation-match.html
 *
 * The resource parameter contains a draft Patient with identifiers, name,
 * telecom, and birthDate that we match against.
 */
export function parseMatchParameters(body: unknown): MatchIdentifiers {
  // FHIR `Parameters` resource shape:
  // { resourceType: "Parameters", parameter: [{ name: "resource", resource: <Patient> }, ...] }
  const params = (body as { parameter?: unknown[] })?.parameter || [];
  const resourceParam = (
    params as Array<{ name?: string; resource?: unknown }>
  ).find((p) => p.name === "resource")?.resource;

  if (!resourceParam) return {};

  const patient = resourceParam as {
    identifier?: Array<{ system?: string; value?: string }>;
    name?: Array<{ text?: string; family?: string; given?: string[] }>;
    telecom?: Array<{ system?: string; value?: string }>;
    birthDate?: string;
  };

  const out: MatchIdentifiers = {};

  // MRN: any identifier value (caller supplies the system they registered with)
  const mrn = patient.identifier?.[0]?.value;
  if (mrn) out.mrn = mrn;

  // Name: prefer joined family + given, fall back to text
  const name0 = patient.name?.[0];
  if (name0) {
    const given = (name0.given || []).join(" ");
    const family = name0.family || "";
    const composed = [given, family].filter(Boolean).join(" ").trim();
    out.name = composed || name0.text;
  }

  // DOB
  if (patient.birthDate) out.dob = patient.birthDate;

  // Telecom: phone + email
  for (const t of patient.telecom || []) {
    if (t.system === "phone" && t.value) out.phone = t.value;
    if (t.system === "email" && t.value) out.email = t.value;
  }

  return out;
}
