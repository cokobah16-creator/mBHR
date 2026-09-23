/**
 * The saved copy of upcoming outreach events, so the list can be shown
 * without a connection. The time it was saved is kept alongside so the page
 * can say how old the list is.
 */

export const OUTREACH_CACHE_KEY = "patient_cached_outreach";
export const OUTREACH_CACHE_AT_KEY = "patient_cached_outreach_at";

export function parseCachedList<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function parseSavedAt(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function readOutreachCache<T>(): { events: T[]; savedAt: Date | null } {
  try {
    return {
      events: parseCachedList<T>(localStorage.getItem(OUTREACH_CACHE_KEY)),
      savedAt: parseSavedAt(localStorage.getItem(OUTREACH_CACHE_AT_KEY)),
    };
  } catch {
    return { events: [], savedAt: null };
  }
}

export function writeOutreachCache<T>(events: T[], now: Date = new Date()): void {
  try {
    localStorage.setItem(OUTREACH_CACHE_KEY, JSON.stringify(events));
    localStorage.setItem(OUTREACH_CACHE_AT_KEY, now.toISOString());
  } catch {
    // Storage full or blocked: the list still shows for this visit.
  }
}

/** Today's date on this device (local time), as YYYY-MM-DD. */
export function localIsoDate(now: Date = new Date()): string {
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
}

/**
 * Drop saved events whose date has passed, so an old saved list never shows
 * past outreaches as upcoming. Events without a readable date are kept.
 */
export function upcomingOnly<T extends { event_date?: string }>(
  events: T[],
  today: string = localIsoDate(),
): T[] {
  return events.filter((e) => {
    const day = typeof e?.event_date === "string" ? e.event_date.slice(0, 10) : "";
    return !/^\d{4}-\d{2}-\d{2}$/.test(day) || day >= today;
  });
}

/** "HH:MM" from a Postgres time value such as "09:00:00". */
export function shortTime(value: string | undefined): string {
  return value ? value.slice(0, 5) : "";
}
