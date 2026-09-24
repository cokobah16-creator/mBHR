import { useEffect, useMemo, useState } from "react";
import {
  CalendarDaysIcon,
  ChatBubbleLeftRightIcon,
  ClipboardDocumentCheckIcon,
  DocumentTextIcon,
  HeartIcon,
  PlayIcon,
  CheckBadgeIcon,
  ArrowUturnRightIcon,
  UserPlusIcon,
  ClockIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import {
  getPatientTimeline,
  TimelineEvent,
  TimelineEventKind,
} from "@/services/patientTimeline";
import { formatNigerianDate, formatTime } from "@/utils/dateFormat";

interface PatientTimelineProps {
  patientId: string;
  /** Optional refresh trigger from the parent (e.g. after editing patient). */
  refreshKey?: unknown;
}

// Patient-flow events carry their stage colour as a small marker; other
// events are neutral. The icon and title always say what happened.
const NEUTRAL = "text-ink-secondary bg-surface-sunken";
const NEUTRAL_RING = "ring-line";

const KIND_META: Record<
  TimelineEventKind,
  { color: string; ring: string; icon: typeof HeartIcon }
> = {
  registration: {
    color: "text-stage-registration bg-stage-registration-soft",
    ring: "ring-stage-registration-line",
    icon: UserPlusIcon,
  },
  visit_start: {
    color: NEUTRAL,
    ring: NEUTRAL_RING,
    icon: PlayIcon,
  },
  visit_close: {
    color: NEUTRAL,
    ring: NEUTRAL_RING,
    icon: CheckBadgeIcon,
  },
  vitals: {
    color: "text-stage-vitals bg-stage-vitals-soft",
    ring: "ring-stage-vitals-line",
    icon: HeartIcon,
  },
  consultation: {
    color: "text-stage-consult bg-stage-consult-soft",
    ring: "ring-stage-consult-line",
    icon: DocumentTextIcon,
  },
  referral: {
    color: NEUTRAL,
    ring: NEUTRAL_RING,
    icon: ArrowUturnRightIcon,
  },
  dispense: {
    color: "text-stage-pharmacy bg-stage-pharmacy-soft",
    ring: "ring-stage-pharmacy-line",
    icon: ClipboardDocumentCheckIcon,
  },
  message: {
    color: NEUTRAL,
    ring: NEUTRAL_RING,
    icon: ChatBubbleLeftRightIcon,
  },
  appointment: {
    color: NEUTRAL,
    ring: NEUTRAL_RING,
    icon: CalendarDaysIcon,
  },
};

export function PatientTimeline({
  patientId,
  refreshKey,
}: PatientTimelineProps) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    setError("");
    getPatientTimeline(patientId)
      .then((evs) => {
        if (!cancelled) setEvents(evs);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error(
            "Patient timeline failed:",
            err instanceof Error ? err.name : err,
          );
          setError(
            "The timeline could not be read from this device. Reload the page to try again.",
          );
          setEvents([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [patientId, refreshKey]);

  const grouped = useMemo(() => groupByDay(events ?? []), [events]);

  if (events === null) {
    return (
      <div className="card space-y-4" aria-busy="true">
        <span role="status" className="sr-only">
          Loading timeline
        </span>
        <Skeleton className="h-4 w-32" />
        <SkeletonText lines={4} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="banner banner-danger" role="alert">
        <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
        <span>{error}</span>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="panel">
        <EmptyState
          icon={ClockIcon}
          title="No activity recorded yet"
          description="Registration, visits, vital signs, consultations and medicines for this patient will appear here."
        />
      </div>
    );
  }

  return (
    <div className="card">
      <h3 className="text-h3 text-ink mb-4">Patient timeline</h3>

      <div className="space-y-6">
        {grouped.map(({ dayKey, label, events: dayEvents }) => (
          <div key={dayKey}>
            <h4 className="section-label mb-3">{label}</h4>
            <ol className="relative border-l border-line ml-3 space-y-4">
              {dayEvents.map((ev) => {
                const meta = KIND_META[ev.kind];
                const Icon = meta.icon;
                return (
                  <li key={ev.id} className="ml-6">
                    <span
                      className={`absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full ring-2 ${meta.color} ${meta.ring}`}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:gap-3">
                      <p className="text-body font-medium text-ink">
                        {ev.title}
                      </p>
                      <span className="text-caption tabular-nums text-ink-muted">
                        {formatTime(ev.at)}
                      </span>
                    </div>
                    {ev.detail && (
                      <p className="text-body text-ink-secondary mt-1 break-words">
                        {ev.detail}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
}

function groupByDay(events: TimelineEvent[]): Array<{
  dayKey: string;
  label: string;
  events: TimelineEvent[];
}> {
  const buckets = new Map<string, TimelineEvent[]>();
  for (const ev of events) {
    const d = ev.at;
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const arr = buckets.get(key);
    if (arr) arr.push(ev);
    else buckets.set(key, [ev]);
  }
  const out: Array<{
    dayKey: string;
    label: string;
    events: TimelineEvent[];
  }> = [];
  for (const [dayKey, bucket] of buckets) {
    const sample = bucket[0].at;
    out.push({
      dayKey,
      label: formatNigerianDate(sample),
      events: bucket,
    });
  }
  return out;
}
