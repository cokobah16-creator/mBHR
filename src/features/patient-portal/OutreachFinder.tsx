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
  localIsoDate,
  directionsUrl,
  readOutreachCache,
  shortTime,
  upcomingOnly,
  writeOutreachCache,
} from "./account/outreachCache";
import { errorName } from "./account/portalSession";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useT } from "@/hooks/useT";

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
  const { t } = useT();
  const [events, setEvents] = useState<OutreachEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<ListSource>("none");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const isOffline = !supabase;
  const today = localIsoDate();
  const savedNoteFn = () =>
    savedAt
      ? t("portal.outreach.savedOn", {
          date: formatNigerianDateTime(savedAt),
        })
      : t("portal.outreach.savedEarlier");

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
        // The device's own date: an outreach today still shows after
        // midnight UTC.
        .gte("event_date", localIsoDate())
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
        title={t("portal.outreach.title")}
        description={t("portal.outreach.description")}
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
            {loading ? t("portal.outreach.checking") : t("portal.outreach.check")}
          </button>
        }
      />

      <div aria-live="polite" className="space-y-3">
        {isOffline && !loading && (
          <div className="banner banner-info">
            <InformationCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <p>
              {t("portal.outreach.notConnected")}{" "}
              {source === "saved"
                ? savedNoteFn()
                : t("portal.outreach.askStaff")}
            </p>
          </div>
        )}

        {!isOffline && fetchFailed && !loading && (
          <div className="banner banner-warning" role="status">
            <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <p>
              {isOnline
                ? t("portal.outreach.unreachable")
                : t("portal.outreach.offline")}{" "}
              {source === "saved"
                ? savedNoteFn()
                : t("portal.outreach.tryLater")}
            </p>
          </div>
        )}

        {!isOffline && source === "live" && savedAt && !loading && (
          <p className="text-caption text-ink-muted">
            {t("portal.outreach.upToDate", { date: formatNigerianDateTime(savedAt) })}
          </p>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          <span role="status" className="sr-only">
            {t("portal.outreach.loading")}
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
            title={t("portal.outreach.emptyTitle")}
            description={
              isOffline || fetchFailed
                ? t("portal.outreach.emptyOffline")
                : t("portal.outreach.emptyNone")
            }
          />
        </div>
      ) : (
        <ul className="space-y-3">
          {events.map((event) => {
            const start = shortTime(event.start_time);
            const end = shortTime(event.end_time);
            const isToday = event.event_date?.slice(0, 10) === today;
            const directions = directionsUrl(event.sites);
            return (
              <li key={event.id} className="panel p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="text-h3 text-ink">{event.event_name}</h2>
                  {isToday && (
                    <span className="badge badge-info">{t("portal.outreach.today")}</span>
                  )}
                </div>
                <dl className="mt-2 space-y-1 text-body text-ink-secondary">
                  <div>
                    <dt className="sr-only">{t("portal.outreach.place")}</dt>
                    <dd className="flex items-start gap-2">
                      <MapPinIcon className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" aria-hidden />
                      <span>
                        {event.sites ? (
                          <>
                            <span className="block">{event.sites.name}</span>
                            <span className="block">
                              {[event.sites.address, event.sites.lga, event.sites.state]
                                .filter(Boolean)
                                .join(", ")}
                            </span>
                          </>
                        ) : (
                          t("portal.outreach.placeTba")
                        )}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="sr-only">{t("portal.outreach.dateTime")}</dt>
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
                {directions && (
                  <a
                    href={directions}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-secondary mt-3"
                  >
                    {t("portal.outreach.directions")}
                    <span className="sr-only"> {t("portal.outreach.opensMap")}</span>
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!loading && events.length > 0 && (
        <p className="text-caption text-ink-muted">{t("portal.outreach.plansChange")}</p>
      )}
    </div>
  );
}

