import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import {
  MapPinIcon,
  CalendarIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import * as logger from "@/lib/logger";
import { formatNigerianDate, formatNigerianDateTime } from "@/utils/dateFormat";
import {
  readOutreachCache,
  shortTime,
  upcomingOnly,
  writeOutreachCache,
} from "./account/outreachCache";
import { errorName } from "./account/portalSession";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

interface OutreachEvent {
  id: string;
  event_name: string;
  event_date: string;
  start_time?: string;
  end_time?: string;
  status?: string;
  notes?: string;
  sites?: {
    name: string;
    address: string;
    lga: string;
    state: string;
  } | null;
}

/** Where the list on screen came from. */
type ListSource = "live" | "saved" | "none";

export function OutreachFinder() {
  const isOnline = useOnlineStatus();
  const [events, setEvents] = useState<OutreachEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<ListSource>("none");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const isOffline = !supabase;

  const loadEvents = useCallback(async () => {
    const showSaved = () => {
      const cached = readOutreachCache<OutreachEvent>();
      // A saved list can be old: never show outreaches that have passed.
      const upcoming = upcomingOnly(cached.events);
      setEvents(upcoming);
      setSavedAt(cached.savedAt);
      setSource(upcoming.length > 0 ? "saved" : "none");
    };

    setLoading(true);
    setFetchFailed(false);
    try {
      if (!supabase) {
        showSaved();
        return;
      }

      const { data, error } = await supabase
        .from("outreach_events")
        .select(
          "id, event_name, event_date, start_time, end_time, status, notes, sites(name, address, lga, state)",
        )
        .gte("event_date", new Date().toISOString().split("T")[0])
        .in("status", ["planned", "active"])
        .order("event_date", { ascending: true })
        .limit(20);
      if (error) throw error;

      const result = (data || []) as unknown as OutreachEvent[];
      const now = new Date();
      setEvents(result);
      setSource("live");
      setSavedAt(now);
      writeOutreachCache(result, now);
    } catch (err) {
      logger.warn("[OutreachFinder] load failed:", errorName(err));
      setFetchFailed(true);
      showSaved();
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <PageHeader
        title="Find an outreach near you"
        description="Upcoming community health outreaches and where they will be held."
        actions={
          <button
            type="button"
            onClick={() => void loadEvents()}
            disabled={loading}
            className="btn-secondary"
          >
            <ArrowPathIcon
              className={`h-5 w-5 ${loading ? "animate-spin" : ""}`}
              aria-hidden
            />
            {loading ? "Checking…" : "Check for updates"}
          </button>
        }
      />

      <div aria-live="polite" className="space-y-3">
        {isOffline && !loading && (
          <div className="banner banner-info">
            <InformationCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <p>
              This device is not connected to the online outreach calendar.
              {source === "saved"
                ? ` Showing a list saved on this device${savedAt ? ` on ${formatNigerianDateTime(savedAt)}` : " earlier"}. Dates may have changed.`
                : " Ask clinic staff about upcoming outreaches."}
            </p>
          </div>
        )}

        {!isOffline && fetchFailed && !loading && (
          <div className="banner banner-warning" role="status">
            <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <p>
              {isOnline
                ? "We could not reach the outreach calendar."
                : "You are offline."}
              {source === "saved"
                ? ` Showing a list saved on this device${savedAt ? ` on ${formatNigerianDateTime(savedAt)}` : " earlier"}. Dates may have changed.`
                : " Try again when you have a connection."}
            </p>
          </div>
        )}

        {!isOffline && source === "live" && savedAt && !loading && (
          <p className="text-caption text-ink-muted">
            Up to date as of {formatNigerianDateTime(savedAt)}.
          </p>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          <span role="status" className="sr-only">
            Loading outreach events
          </span>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="panel space-y-2 p-4" aria-hidden>
              <Skeleton className="h-5 w-56" />
              <Skeleton className="h-4 w-72 max-w-full" />
            </div>
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={MapPinIcon}
            title="No upcoming outreaches listed"
            description={
              isOffline || fetchFailed
                ? "Upcoming outreaches will appear here once this device can reach the outreach calendar."
                : "No outreaches are planned at the moment. Check again later."
            }
          />
        </div>
      ) : (
        <ul className="space-y-3">
          {events.map((event) => {
            const start = shortTime(event.start_time);
            const end = shortTime(event.end_time);
            return (
              <li key={event.id} className="panel p-4">
                <h2 className="text-h3 text-ink">{event.event_name}</h2>
                <dl className="mt-2 space-y-1 text-body text-ink-secondary">
                  <div>
                    <dt className="sr-only">Place</dt>
                    <dd className="flex items-start gap-2">
                      <MapPinIcon className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" aria-hidden />
                      <span>
                        {event.sites
                          ? `${event.sites.name}, ${event.sites.lga}, ${event.sites.state}`
                          : "Place to be announced"}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="sr-only">Date and time</dt>
                    <dd className="flex items-start gap-2 tabular-nums">
                      <CalendarIcon className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" aria-hidden />
                      <span>
                        {formatNigerianDate(event.event_date) || event.event_date}
                        {start ? ` · ${start}${end ? `–${end}` : ""}` : ""}
                      </span>
                    </dd>
                  </div>
                </dl>
                {event.notes && (
                  <p className="mt-3 text-body text-ink-secondary">{event.notes}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
