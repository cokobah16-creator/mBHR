import { useEffect, useState, useCallback } from "react";
import { db } from "@/db";
import { useAuthStore } from "@/stores/auth";
import { can } from "@/auth/roles";
import {
  UsersIcon,
  UserPlusIcon,
  HeartIcon,
  DocumentTextIcon,
  BeakerIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import * as logger from "@/lib/logger";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatTile } from "@/features/reports/StatTile";
import { DataScopeNote } from "@/features/reports/DataScopeNote";
import { countInRange } from "@/features/reports/localRecords";
import {
  addLocalDays,
  describeChange,
  startOfLocalDay,
} from "@/features/reports/reportUtils";
import { formatNigerianDate, formatTime } from "@/utils/dateFormat";

interface DayCounts {
  registrations: number;
  vitals: number;
  consultations: number;
  dispenses: number;
  visits: number;
}

interface AnalyticsData {
  today: DayCounts;
  yesterday: DayCounts;
  weekTotal: DayCounts;
  weekStart: Date;
  bottlenecks: string[];
  loadedAt: Date;
}

type Period = "today" | "week";

const REFRESH_MS = 60000;

/**
 * Counts straight from the stored records for [start, end) in local time.
 * (The old pre-aggregated daily cache only ever counted registrations and
 * vitals, so consultations and dispensing read as 0 once it existed.)
 */
async function countPeriod(start: Date, end: Date): Promise<DayCounts> {
  const [registrations, vitals, consultations, dispenses, visits] =
    await Promise.all([
      countInRange(db.patients, "createdAt", start, end),
      countInRange(db.vitals, "takenAt", start, end),
      countInRange(db.consultations, "createdAt", start, end),
      countInRange(db.dispenses, "dispensedAt", start, end),
      countInRange(db.visits, "startedAt", start, end),
    ]);
  return { registrations, vitals, consultations, dispenses, visits };
}

/** Rule of thumb: a stage has recorded under two-thirds of the stage before it. */
function identifyBottlenecks(todayData: DayCounts): string[] {
  const bottlenecks: string[] = [];
  if (todayData.registrations > todayData.vitals * 1.5) {
    bottlenecks.push("Vitals may be falling behind registration.");
  }
  if (todayData.vitals > todayData.consultations * 1.5) {
    bottlenecks.push("Consultation may be falling behind vitals.");
  }
  if (todayData.consultations > todayData.dispenses * 1.5) {
    bottlenecks.push("Pharmacy may be falling behind consultation.");
  }
  return bottlenecks;
}

export function OfflineAnalytics() {
  const currentUser = useAuthStore((s) => s.currentUser);
  // Only admins and leads (export permission) see clinic-wide figures.
  const canView = !!currentUser && can(currentUser.role, "export");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<Period>("today");

  const loadAnalyticsData = useCallback(async () => {
    try {
      const today = startOfLocalDay(new Date());
      const tomorrow = addLocalDays(today, 1);
      const yesterday = addLocalDays(today, -1);
      const weekStart = addLocalDays(today, -6);

      const [todayData, yesterdayData, weekData] = await Promise.all([
        countPeriod(today, tomorrow),
        countPeriod(yesterday, today),
        countPeriod(weekStart, tomorrow),
      ]);

      setData({
        today: todayData,
        yesterday: yesterdayData,
        weekTotal: weekData,
        weekStart,
        bottlenecks: identifyBottlenecks(todayData),
        loadedAt: new Date(),
      });
      setFailed(false);
    } catch (error) {
      logger.error(
        "Error loading analytics:",
        error instanceof Error ? error.name : error,
      );
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canView) return;
    loadAnalyticsData();
    const interval = setInterval(loadAnalyticsData, REFRESH_MS);
    return () => clearInterval(interval);
  }, [canView, loadAnalyticsData]);

  if (!canView) {
    return null;
  }

  const header = (
    <div className="panel-header flex-wrap">
      <h2 id="clinic-activity-title" className="panel-title">
        Clinic activity
      </h2>
      <div className="flex gap-1" role="group" aria-label="Period">
        {(
          [
            ["today", "Today"],
            ["week", "Last 7 days"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setSelectedPeriod(key)}
            aria-pressed={selectedPeriod === key}
            className={`min-h-touch-target rounded-md border px-3 text-label transition-colors ${
              selectedPeriod === key
                ? "border-primary bg-primary-soft font-semibold text-primary-fg"
                : "border-line bg-surface text-ink-secondary hover:bg-surface-hover"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );

  if (loading) {
    return (
      <section className="panel" aria-labelledby="clinic-activity-title">
        {header}
        <div className="panel-body">
          <span role="status" className="sr-only">
            Loading clinic activity
          </span>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5" aria-hidden>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="panel space-y-2 p-4">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-8 w-14" />
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="panel" aria-labelledby="clinic-activity-title">
        {header}
        <div className="panel-body">
          <div className="banner banner-danger" role="alert">
            Clinic activity could not be read from this device. It will try
            again in a minute.
          </div>
        </div>
      </section>
    );
  }

  const isToday = selectedPeriod === "today";
  const displayData = isToday ? data.today : data.weekTotal;
  const periodLabel = isToday
    ? `Today, ${formatNigerianDate(data.loadedAt)}`
    : `${formatNigerianDate(data.weekStart)} – ${formatNigerianDate(data.loadedAt)}`;

  const metrics: {
    name: string;
    key: keyof DayCounts;
    icon: typeof UsersIcon;
  }[] = [
    { name: "Visits started", key: "visits", icon: UsersIcon },
    { name: "New patients registered", key: "registrations", icon: UserPlusIcon },
    { name: "Vitals recorded", key: "vitals", icon: HeartIcon },
    { name: "Consultations", key: "consultations", icon: DocumentTextIcon },
    { name: "Dispensing records", key: "dispenses", icon: BeakerIcon },
  ];

  return (
    <section className="panel" aria-labelledby="clinic-activity-title">
      {header}
      <div className="panel-body space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {metrics.map((metric) => (
            <StatTile
              key={metric.key}
              label={metric.name}
              value={displayData[metric.key].toLocaleString("en-NG")}
              icon={metric.icon}
              footer={
                isToday
                  ? describeChange(
                      data.today[metric.key],
                      data.yesterday[metric.key],
                      "yesterday",
                    )
                  : undefined
              }
            />
          ))}
        </div>

        {isToday && data.bottlenecks.length > 0 && (
          <div className="banner banner-warning">
            <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
            <div>
              <p className="font-medium">Possible hold-ups today</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {data.bottlenecks.map((bottleneck) => (
                  <li key={bottleneck}>{bottleneck}</li>
                ))}
              </ul>
              <p className="mt-1 text-caption">
                Rule of thumb: shown when a stage has recorded fewer than
                two-thirds as many as the stage before it today. Check the
                queue before moving staff.
              </p>
            </div>
          </div>
        )}

        {failed && (
          <p className="text-caption text-danger-fg" role="status">
            The last refresh failed; these figures are from{" "}
            {formatTime(data.loadedAt)}.
          </p>
        )}

        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <DataScopeNote period={periodLabel} />
          <p className="shrink-0 text-caption text-ink-muted">
            Updated {formatTime(data.loadedAt)} · refreshes every minute
          </p>
        </div>
      </div>
    </section>
  );
}
