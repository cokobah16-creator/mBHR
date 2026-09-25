// Synthetic fixtures (no real patient data) shaped like PostgREST rows from
// the tables the mappers read.

export const PATIENT_A = {
  id: "01HZZPATIENTA0000000000000",
  fhir_id: "0b3c1d2e-1111-4aaa-8bbb-000000000001",
  given_name: "Ada Chioma",
  family_name: "Okafor",
  sex: "female",
  dob: "1984-03-02",
  phone: "08000000001",
  email: "ada@example.org",
  address: "12 Example Street",
  lga: "Oshimili South",
  state: "Delta",
  merged_into: null,
  created_at: "2026-01-02T09:00:00+00:00",
  updated_at: "2026-05-01T10:30:00+00:00",
  // Columns the mapper must never publish, present to prove it:
  auth_uid: "secret-auth-uid",
  photo_url: "https://storage.example/patient-photos/a.jpg",
  portal_enabled: true,
};

export const PATIENT_B = {
  ...PATIENT_A,
  id: "01HZZPATIENTB0000000000000",
  fhir_id: "0b3c1d2e-1111-4aaa-8bbb-000000000002",
  given_name: "Bola",
  family_name: "Adeyemi",
  sex: "M",
  dob: "1990-07-15",
  email: null,
};

export const VISIT_A = {
  id: "01HZZVISITA000000000000000",
  patient_id: PATIENT_A.id,
  started_at: "2026-05-01T08:15:00+00:00",
  site_name: "Asaba outreach",
  status: "closed",
  updated_at: "2026-05-01T12:00:00+00:00",
};

export const VITALS_A = {
  id: "01HZZVITALSA0000000000000",
  patient_id: PATIENT_A.id,
  visit_id: VISIT_A.id,
  height_cm: 162,
  weight_kg: "61.5",
  temp_c: 36.8,
  pulse_bpm: 0, // implausible: must not be published
  systolic: 128,
  diastolic: 84,
  spo2: 97,
  bmi: null, // missing: must not become 0
  taken_at: "2026-05-01T08:40:00+00:00",
  updated_at: "2026-05-01T08:41:00+00:00",
};

export const CONDITION_A = {
  id: "c0000000-0000-4000-8000-00000000000a",
  patient_id: PATIENT_A.id,
  condition_code: "MAL",
  condition_name: "Malaria",
  clinical_status: "active",
  verification_status: "provisional",
  category: "encounter-diagnosis",
  severity: "moderate",
  onset_date: "2026-04-28",
  abatement_date: null,
  recorded_by: "Dr Example",
  notes: "private clinician note",
  created_at: "2026-05-01T09:00:00+00:00",
  updated_at: "2026-05-01T09:00:00+00:00",
};
