/**
 * What the portal home lists under "What's new": pure rules, so they are
 * tested without a server. Everything here comes from the patient's own
 * records; nothing is inferred or invented.
 */
import { toPatientRequestStatus, type PatientRequestStatus } from "../requestStatus";

/** Lab results released within this many days count as new on the home screen. */
export const NEW_RESULT_DAYS = 30;
/** At most this many results and requests are listed on the home screen. */
export const HOME_LIST_LIMIT = 3;

export interface HomeLabResult {
  resultId: string;
  testName: string;
  /** When the care team released it to the portal (or, failing that, the result date). */
  availableAt?: Date;
}

export interface HomeRequest {
  id: string;
  kind: "appointment" | "televisit";
  status: PatientRequestStatus;
  /** The stored status, for the badge vocabulary. */
  storedStatus: string;
  sentAt: Date;
}

export interface HomeOutreach {
  id: string;
  /** Empty when the event has no name; the screen then uses a generic label. */
  name: string;
  /** "YYYY-MM-DD", a calendar day. */
  date: string;
  place?: string;
}

/**
 * Results made available in the last NEW_RESULT_DAYS days, newest first.
 * A result without any date is not listed as new.
 */
export function recentResults(
  results: readonly { resultId: string; testName: string; releasedAt?: Date; resultDate?: Date }[],
  now: number = Date.now(),
): HomeLabResult[] {
  const since = now - NEW_RESULT_DAYS * 24 * 60 * 60 * 1000;
  return results
    .map((r) => ({
      resultId: r.resultId,
      testName: r.testName,
      availableAt: r.releasedAt ?? r.resultDate,
    }))
    .filter((r) => r.availableAt && r.availableAt.getTime() >= since)
    .sort((a, b) => b.availableAt!.getTime() - a.availableAt!.getTime())
    .slice(0, HOME_LIST_LIMIT);
}

/** Requests still waiting on the care team (sent or under review), newest first. */
export function openRequests(
  rows: readonly {
    id: string;
    status: string | null;
    created_at: string;
    visit_mode?: string | null;
  }[],
): HomeRequest[] {
  return rows
    .map((row) => ({
      id: row.id,
      kind: (row.visit_mode === "televisit" ? "televisit" : "appointment") as HomeRequest["kind"],
      status: toPatientRequestStatus(row.status),
      storedStatus: row.status ?? "",
      sentAt: new Date(row.created_at),
    }))
    .filter(
      (r) =>
        (r.status === "submitted" || r.status === "underReview") &&
        !isNaN(r.sentAt.getTime()),
    )
    .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())
    .slice(0, HOME_LIST_LIMIT);
}

/** The soonest planned or running outreach from today on, or null. */
export function nextOutreach(
  events: readonly {
    id: string;
    event_name?: string | null;
    event_date?: string | null;
    status?: string | null;
    sites?: { name?: string | null; lga?: string | null; state?: string | null } | null;
  }[],
  today: string,
): HomeOutreach | null {
  const next = events
    .filter(
      (e) =>
        !!e.event_date &&
        e.event_date >= today &&
        (e.status === "planned" || e.status === "active"),
    )
    .sort((a, b) => (a.event_date! < b.event_date! ? -1 : a.event_date! > b.event_date! ? 1 : 0))[0];
  if (!next) return null;
  const site = next.sites;
  const place = [site?.name, site?.lga, site?.state]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean)
    .join(", ");
  return {
    id: next.id,
    name: next.event_name?.trim() || "",
    date: next.event_date!,
    place: place || undefined,
  };
}
