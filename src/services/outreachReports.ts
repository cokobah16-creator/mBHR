// Aggregations for the Outreach Summary report.
// Pure functions over Dexie — no React dependencies.
import { db, Patient, Visit } from "@/db";
import { mbhrDb } from "@/db/mbhr";

export interface OutreachFilters {
  start: Date;
  end: Date;
  siteName?: string;
}

export interface GenderBreakdown {
  male: number;
  female: number;
  other: number;
  unknown: number;
}

const AGE_BAND_DEFS: Array<{ label: string; min: number; max: number }> = [
  { label: "0-4", min: 0, max: 4 },
  { label: "5-17", min: 5, max: 17 },
  { label: "18-34", min: 18, max: 34 },
  { label: "35-59", min: 35, max: 59 },
  { label: "60+", min: 60, max: Infinity },
];

export type AgeBands = Record<string, number>;

export interface ConditionTally {
  diagnosis: string;
  count: number;
}

export interface MedicineTally {
  name: string;
  unitsDispensed: number;
  events: number;
}

export interface VolunteerTally {
  actorId: string;
  fullName: string;
  role: string;
  events: number;
}

export interface OutreachSummary {
  filters: OutreachFilters;
  patientsSeen: number;
  visits: number;
  gender: GenderBreakdown;
  ageBands: AgeBands;
  conditions: ConditionTally[];
  medicines: MedicineTally[];
  referrals: number;
  highRiskCases: number;
  volunteers: VolunteerTally[];
}

function inRangeIso(iso: string | undefined, start: Date, end: Date): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return t >= start.getTime() && t < end.getTime();
}

function ageYearsAt(dobIso: string, asOf: Date): number | null {
  if (!dobIso) return null;
  const dob = new Date(dobIso);
  if (Number.isNaN(dob.getTime())) return null;
  let years = asOf.getFullYear() - dob.getFullYear();
  const monthDelta = asOf.getMonth() - dob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && asOf.getDate() < dob.getDate())) {
    years -= 1;
  }
  return years;
}

function ageBandFor(years: number): string {
  for (const band of AGE_BAND_DEFS) {
    if (years >= band.min && years <= band.max) return band.label;
  }
  return "unknown";
}

function emptyAgeBands(): AgeBands {
  const out: AgeBands = {};
  for (const band of AGE_BAND_DEFS) out[band.label] = 0;
  out.unknown = 0;
  return out;
}

async function loadVisitsInRange(filters: OutreachFilters): Promise<Visit[]> {
  const visits = await db.visits
    .where("startedAt")
    .between(filters.start, filters.end, true, false)
    .toArray();
  if (!filters.siteName) return visits;
  return visits.filter((v) => v.siteName === filters.siteName);
}

async function loadPatients(patientIds: Set<string>): Promise<Patient[]> {
  if (patientIds.size === 0) return [];
  return db.patients
    .where("id")
    .anyOf([...patientIds])
    .toArray();
}

export function getGenderBreakdown(patients: Patient[]): GenderBreakdown {
  const out: GenderBreakdown = { male: 0, female: 0, other: 0, unknown: 0 };
  for (const p of patients) {
    if (p.sex === "male") out.male += 1;
    else if (p.sex === "female") out.female += 1;
    else if (p.sex === "other") out.other += 1;
    else out.unknown += 1;
  }
  return out;
}

export function getAgeBands(patients: Patient[], asOf: Date): AgeBands {
  const out = emptyAgeBands();
  for (const p of patients) {
    const years = p.dob ? ageYearsAt(p.dob, asOf) : null;
    if (years === null || years < 0) {
      out.unknown += 1;
      continue;
    }
    const band = ageBandFor(years);
    out[band] = (out[band] ?? 0) + 1;
  }
  return out;
}

const REFERRAL_PATTERN = /\brefer(?:r(?:ed|al|ing))?\b/i;

function isLikelyReferral(soapPlan: string | undefined): boolean {
  if (!soapPlan) return false;
  return REFERRAL_PATTERN.test(soapPlan);
}

export async function getOutreachSummary(
  filters: OutreachFilters,
): Promise<OutreachSummary> {
  const visits = await loadVisitsInRange(filters);
  const visitIds = new Set(visits.map((v) => v.id));
  const patientIds = new Set(visits.map((v) => v.patientId));

  const patients = await loadPatients(patientIds);

  // Conditions + referrals: read consultations whose visitId is in scope.
  const consultations = await db.consultations
    .where("visitId")
    .anyOf([...visitIds])
    .toArray();

  const conditionCounts = new Map<string, number>();
  let referrals = 0;
  for (const c of consultations) {
    for (const dx of c.provisionalDx ?? []) {
      const key = dx.trim();
      if (!key) continue;
      conditionCounts.set(key, (conditionCounts.get(key) ?? 0) + 1);
    }
    if (isLikelyReferral(c.soapPlan)) referrals += 1;
  }
  const conditions: ConditionTally[] = [...conditionCounts.entries()]
    .map(([diagnosis, count]) => ({ diagnosis, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  // Vitals → high-risk count: distinct patients with any flagged vitals row in range.
  const vitals = await db.vitals
    .where("takenAt")
    .between(filters.start, filters.end, true, false)
    .toArray();
  const flaggedPatients = new Set<string>();
  for (const v of vitals) {
    if (!visitIds.has(v.visitId)) continue;
    if (Array.isArray(v.flags) && v.flags.length > 0) {
      flaggedPatients.add(v.patientId);
    }
  }
  const highRiskCases = flaggedPatients.size;

  // Medicines dispensed: prefer the rich db.dispenses (has itemName + Date).
  const dispenses = await db.dispenses
    .where("dispensedAt")
    .between(filters.start, filters.end, true, false)
    .toArray();
  const scopedDispenses = filters.siteName
    ? dispenses.filter((d) => visitIds.has(d.visitId))
    : dispenses;
  const medMap = new Map<string, { units: number; events: number }>();
  for (const d of scopedDispenses) {
    const name = (d.itemName ?? "").trim() || "Unknown";
    const cur = medMap.get(name) ?? { units: 0, events: 0 };
    cur.units += d.qty ?? 0;
    cur.events += 1;
    medMap.set(name, cur);
  }
  const medicines: MedicineTally[] = [...medMap.entries()]
    .map(([name, v]) => ({
      name,
      unitsDispensed: v.units,
      events: v.events,
    }))
    .sort((a, b) => b.unitsDispensed - a.unitsDispensed)
    .slice(0, 20);

  // Volunteer attendance: distinct stage_event actors with activity in range.
  const stageEvents = await mbhrDb.stage_events.toArray();
  const actorEventCounts = new Map<string, number>();
  for (const e of stageEvents) {
    const overlapsRange =
      inRangeIso(e.startedAt, filters.start, filters.end) ||
      inRangeIso(e.finishedAt, filters.start, filters.end);
    if (!overlapsRange) continue;
    if (!e.actorId) continue;
    actorEventCounts.set(e.actorId, (actorEventCounts.get(e.actorId) ?? 0) + 1);
  }
  const actorIds = [...actorEventCounts.keys()];
  const actors = actorIds.length
    ? await db.users.where("id").anyOf(actorIds).toArray()
    : [];
  const actorMap = new Map(actors.map((u) => [u.id, u]));
  const volunteers: VolunteerTally[] = actorIds
    .map((actorId) => {
      const u = actorMap.get(actorId);
      return {
        actorId,
        fullName: u?.fullName ?? "Unknown",
        role: u?.role ?? "unknown",
        events: actorEventCounts.get(actorId) ?? 0,
      };
    })
    .sort((a, b) => b.events - a.events);

  return {
    filters,
    patientsSeen: patientIds.size,
    visits: visits.length,
    gender: getGenderBreakdown(patients),
    ageBands: getAgeBands(patients, filters.end),
    conditions,
    medicines,
    referrals,
    highRiskCases,
    volunteers,
  };
}

export async function listOutreachSites(): Promise<string[]> {
  const visits = await db.visits.toArray();
  const set = new Set<string>();
  for (const v of visits) {
    if (v.siteName) set.add(v.siteName);
  }
  return [...set].sort();
}

// Inclusive start-of-day (local) → exclusive next-midnight, in local time.
export function dayBounds(d: Date): { start: Date; end: Date } {
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export function rangeBounds(
  startDate: Date,
  endDate: Date,
): {
  start: Date;
  end: Date;
} {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export function summaryToCsvRows(
  summary: OutreachSummary,
): Record<string, string | number>[] {
  const rows: Record<string, string | number>[] = [];
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const meta = [
    { metric: "Date range start", value: fmt(summary.filters.start) },
    { metric: "Date range end (exclusive)", value: fmt(summary.filters.end) },
    { metric: "Site", value: summary.filters.siteName ?? "All sites" },
    { metric: "Patients seen", value: summary.patientsSeen },
    { metric: "Visits", value: summary.visits },
    { metric: "Referrals", value: summary.referrals },
    { metric: "High-risk cases", value: summary.highRiskCases },
    { metric: "Female", value: summary.gender.female },
    { metric: "Male", value: summary.gender.male },
    {
      metric: "Other / Unknown",
      value: summary.gender.other + summary.gender.unknown,
    },
  ];
  rows.push(...meta);
  for (const [band, count] of Object.entries(summary.ageBands)) {
    rows.push({ metric: `Age ${band}`, value: count });
  }
  for (const c of summary.conditions) {
    rows.push({ metric: `Dx: ${c.diagnosis}`, value: c.count });
  }
  for (const m of summary.medicines) {
    rows.push({
      metric: `Rx: ${m.name}`,
      value: `${m.unitsDispensed} units / ${m.events} events`,
    });
  }
  for (const v of summary.volunteers) {
    rows.push({
      metric: `Volunteer: ${v.fullName} (${v.role})`,
      value: `${v.events} events`,
    });
  }
  return rows;
}
