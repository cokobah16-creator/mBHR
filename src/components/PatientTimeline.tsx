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
} from "@heroicons/react/24/outline";
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

const KIND_META: Record<
  TimelineEventKind,
  { color: string; ring: string; icon: typeof HeartIcon }
> = {
  registration: {
    color: "text-blue-600 bg-blue-50",
    ring: "ring-blue-200",
    icon: UserPlusIcon,
  },
  visit_start: {
    color: "text-indigo-600 bg-indigo-50",
    ring: "ring-indigo-200",
    icon: PlayIcon,
  },
  visit_close: {
    color: "text-gray-600 bg-gray-50",
    ring: "ring-gray-200",
    icon: CheckBadgeIcon,
  },
  vitals: {
    color: "text-emerald-600 bg-emerald-50",
    ring: "ring-emerald-200",
    icon: HeartIcon,
  },
  consultation: {
    color: "text-purple-600 bg-purple-50",
    ring: "ring-purple-200",
    icon: DocumentTextIcon,
  },
  referral: {
    color: "text-rose-600 bg-rose-50",
    ring: "ring-rose-200",
    icon: ArrowUturnRightIcon,
  },
  dispense: {
    color: "text-amber-600 bg-amber-50",
    ring: "ring-amber-200",
    icon: ClipboardDocumentCheckIcon,
  },
  message: {
    color: "text-sky-600 bg-sky-50",
    ring: "ring-sky-200",
    icon: ChatBubbleLeftRightIcon,
  },
  appointment: {
    color: "text-teal-600 bg-teal-50",
    ring: "ring-teal-200",
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
          console.error("Patient timeline failed:", err);
          setError("Could not load timeline.");
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
      <div className="card flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card bg-red-50 border border-red-200">
        <p className="text-sm text-red-800">{error}</p>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="card text-center py-8">
        <ClockIcon className="w-10 h-10 mx-auto text-gray-300 mb-2" />
        <p className="text-sm text-gray-500">
          No activity recorded for this patient yet.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">
        Patient Timeline
      </h3>

      <div className="space-y-6">
        {grouped.map(({ dayKey, label, events: dayEvents }) => (
          <div key={dayKey}>
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
              {label}
            </div>
            <ol className="relative border-l border-gray-200 ml-3 space-y-4">
              {dayEvents.map((ev) => {
                const meta = KIND_META[ev.kind];
                const Icon = meta.icon;
                return (
                  <li key={ev.id} className="ml-6">
                    <span
                      className={`absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-white ${meta.color} ${meta.ring}`}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:gap-3">
                      <p className="text-sm font-medium text-gray-900">
                        {ev.title}
                      </p>
                      <span className="text-xs text-gray-500">
                        {formatTime(ev.at)}
                      </span>
                    </div>
                    {ev.detail && (
                      <p className="text-sm text-gray-600 mt-1 break-words">
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
