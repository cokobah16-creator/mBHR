import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { db, type Consultation, type Dispense, type Patient, type Vital } from "@/db";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { loadInRange } from "@/features/reports/localRecords";
import {
  addLocalDays,
  startOfLocalDay,
  toTime,
  type TimestampLike,
} from "@/features/reports/reportUtils";
import { formatTime } from "@/utils/dateFormat";
import {
  HeartIcon,
  DocumentTextIcon,
  BeakerIcon,
  ClockIcon,
} from "@heroicons/react/24/outline";

interface ActivityItem {
  id: string;
  type: "vital" | "consultation" | "dispense";
  patientId: string;
  patientName: string;
  timestamp: number;
  details: string;
}

const TYPE_META: Record<
  ActivityItem["type"],
  { label: string; icon: typeof HeartIcon; marker: string }
> = {
  vital: { label: "Vitals", icon: HeartIcon, marker: "bg-stage-vitals" },
  consultation: { label: "Consultation", icon: DocumentTextIcon, marker: "bg-stage-consult" },
  dispense: { label: "Dispensed", icon: BeakerIcon, marker: "bg-stage-pharmacy" },
};

const LIMIT = 10;

function newestFirst<T>(rows: T[], at: (row: T) => TimestampLike): T[] {
  return [...rows]
    .sort((a, b) => (toTime(at(b)) ?? 0) - (toTime(at(a)) ?? 0))
    .slice(0, LIMIT);
}

export function RecentActivity() {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const loadRecentActivity = useCallback(async () => {
    try {
      const today = startOfLocalDay(new Date());
      const tomorrow = addLocalDays(today, 1);

      const [vitals, consultations, dispenses] = await Promise.all([
        loadInRange<Vital>(db.vitals, "takenAt", today, tomorrow),
        loadInRange<Consultation>(db.consultations, "createdAt", today, tomorrow),
        loadInRange<Dispense>(db.dispenses, "dispensedAt", today, tomorrow),
      ]);

      const recentVitals = newestFirst(vitals, (v) => v.takenAt);
      const recentConsults = newestFirst(consultations, (c) => c.createdAt);
      const recentDispenses = newestFirst(dispenses, (d) => d.dispensedAt);

      const patientIds = [
        ...new Set([
          ...recentVitals.map((v) => v.patientId),
          ...recentConsults.map((c) => c.patientId),
          ...recentDispenses.map((d) => d.patientId),
        ]),
      ];
      const patients = await db.patients.bulkGet(patientIds);
      const byId = new Map<string, Patient>();
      patients.forEach((p) => p && byId.set(p.id, p));
      const nameOf = (id: string) => {
        const p = byId.get(id);
        return p ? `${p.givenName} ${p.familyName}` : null;
      };

      const items: ActivityItem[] = [];
      for (const vital of recentVitals) {
        const name = nameOf(vital.patientId);
        if (!name) continue;
        const parts: string[] = [];
        if (vital.systolic && vital.diastolic) parts.push(`BP ${vital.systolic}/${vital.diastolic}`);
        if (vital.pulseBpm) parts.push(`Pulse ${vital.pulseBpm}`);
        items.push({
          id: vital.id,
          type: "vital",
          patientId: vital.patientId,
          patientName: name,
          timestamp: toTime(vital.takenAt) ?? 0,
          details: parts.length ? parts.join(" · ") : "Vitals recorded",
        });
      }
      for (const consultation of recentConsults) {
        const name = nameOf(consultation.patientId);
        if (!name) continue;
        items.push({
          id: consultation.id,
          type: "consultation",
          patientId: consultation.patientId,
          patientName: name,
          timestamp: toTime(consultation.createdAt) ?? 0,
          details: consultation.providerName ? `Seen by ${consultation.providerName}` : "Consultation saved",
        });
      }
      for (const dispense of recentDispenses) {
        const name = nameOf(dispense.patientId);
        if (!name) continue;
        items.push({
          id: dispense.id,
          type: "dispense",
          patientId: dispense.patientId,
          patientName: name,
          timestamp: toTime(dispense.dispensedAt) ?? 0,
          details: `${dispense.itemName} × ${dispense.qty}`,
        });
      }

      // Most recent 10 across all three kinds.
      items.sort((a, b) => b.timestamp - a.timestamp);
      setActivities(items.slice(0, LIMIT));
      setFailed(false);
    } catch (error) {
      console.error("Error loading recent activity:", error instanceof Error ? error.name : error);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecentActivity();
  }, [loadRecentActivity]);

  if (loading) {
    return (
      <div className="divide-y divide-line">
        <span role="status" className="sr-only">Loading recent activity</span>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3" aria-hidden>
            <Skeleton className="h-8 w-8" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
            <Skeleton className="h-3 w-10" />
          </div>
        ))}
      </div>
    );
  }

  if (failed) {
    return (
      <div className="banner banner-danger" role="alert">
        Recent activity could not be read from this device. Reload the page to try again.
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <EmptyState
        icon={ClockIcon}
        title="No activity recorded today"
        description="Vitals, consultations and dispensing saved on this device today will appear here."
      />
    );
  }

  return (
    <ul className="divide-y divide-line" aria-label="Recent activity today">
      {activities.map((activity) => {
        const meta = TYPE_META[activity.type];
        const Icon = meta.icon;
        return (
          <li key={`${activity.type}-${activity.id}`} className="relative flex items-center gap-3 px-4 py-3">
            <span className={`absolute inset-y-2 left-0 w-1 rounded-full ${meta.marker}`} aria-hidden />
            <span className="rounded-md border border-line bg-surface-sunken p-1.5">
              <Icon className="h-4 w-4 text-ink-secondary" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <Link
                to={`/patients/${activity.patientId}`}
                className="block truncate text-label text-ink hover:underline"
              >
                {activity.patientName}
              </Link>
              <p className="truncate text-caption text-ink-muted">
                <span className="text-ink-secondary">{meta.label}</span> · {activity.details}
              </p>
            </div>
            <time
              className="shrink-0 text-caption tabular-nums text-ink-muted"
              dateTime={new Date(activity.timestamp).toISOString()}
            >
              {formatTime(activity.timestamp)}
            </time>
          </li>
        );
      })}
    </ul>
  );
}
