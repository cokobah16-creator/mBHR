import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/stores/toast";
import { db, generateId, type Consultation, type Dispense, type Vital } from "@/db";
import { can } from "@/auth/roles";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  UsersIcon,
  UserPlusIcon,
  ClockIcon,
  HeartIcon,
  ArrowDownTrayIcon,
  ChartBarIcon,
  LockClosedIcon,
  TrophyIcon,
} from "@heroicons/react/24/outline";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { formatNigerianDate, formatTime } from "@/utils/dateFormat";
import { FLOW_STAGE_LABELS } from "@/services/patientFlow";
import { StatTile } from "@/features/reports/StatTile";
import { BarList } from "@/features/reports/BarList";
import { DataScopeNote } from "@/features/reports/DataScopeNote";
import { useCsvExport } from "@/features/reports/useCsvExport";
import { loadInRange } from "@/features/reports/localRecords";
import {
  ACTIVITY_SERIES,
  CHART_AXIS,
  CHART_GRID,
} from "@/features/reports/chartTheme";
import {
  addLocalDays,
  averageMinutes,
  countByLocalDay,
  isInRange,
  listLocalDays,
  localDateKey,
  localRangeBounds,
} from "@/features/reports/reportUtils";

const STAGES = ["registration", "vitals", "consult", "pharmacy"] as const;

interface AnalyticsData {
  loadedAt: Date;
  /** The date inputs these figures were built for (yyyy-mm-dd, inclusive). */
  range: { from: string; to: string; start: Date; end: Date };
  overview: {
    totalPatients: number;
    periodRegistrations: number;
    activeVisits: number;
    completedVisits: number;
    /** Joining a stage's queue → finishing it, for stages finished in the period. */
    avgStage: { minutes: number; count: number } | null;
    tokensEarned: number;
  };
  throughput: Array<{
    date: string;
    label: string;
    registrations: number;
    vitals: number;
    consultations: number;
    dispenses: number;
  }>;
  queueMetrics: Array<{
    stage: (typeof STAGES)[number];
    avgStage: { minutes: number; count: number } | null;
    finished: number;
    currentWaiting: number;
  }>;
  demographics: Array<{
    name: string;
    value: number;
  }>;
  gamification: {
    totalSessions: number;
    pendingApprovals: number;
    topPerformers: Array<{
      name: string;
      tokens: number;
      badges: number;
    }>;
  };
}

export default function AnalyticsDashboard() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const push = useToast((s) => s.push);
  const exportCsv = useCsvExport();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [dateRange, setDateRange] = useState(() => ({
    from: localDateKey(addLocalDays(new Date(), -7)),
    to: localDateKey(new Date()),
  }));

  const hasAccess = !!currentUser && can(currentUser.role, "export");
  const bounds = localRangeBounds(dateRange.from, dateRange.to);

  const loadAnalyticsData = useCallback(async () => {
    const range = localRangeBounds(dateRange.from, dateRange.to);
    if (!range) {
      setLoading(false);
      return;
    }
    const { start, end } = range;
    setLoading(true);
    setLoadFailed(false);
    try {
      // Records made on this device store Date objects and synced ones store
      // ISO text; loadInRange and the day counts below handle both.
      const [
        allPatients,
        vitals,
        consultations,
        dispenses,
        activeVisits,
        completedVisits,
        pendingCount,
        wallets,
        totalSessions,
        queueItems,
        users,
      ] = await Promise.all([
        db.patients.toArray(),
        loadInRange<Vital>(db.vitals, "takenAt", start, end),
        loadInRange<Consultation>(db.consultations, "createdAt", start, end),
        loadInRange<Dispense>(db.dispenses, "dispensedAt", start, end),
        db.visits.where("status").equals("open").count(),
        db.visits.where("status").equals("closed").count(),
        db.gameSessions.filter((s) => !s.committed && !!s.finishedAt).count(),
        db.gamificationWallets.toArray(),
        db.gameSessions.count(),
        db.queue.toArray(),
        db.users.toArray(),
      ]);

      const counts = {
        registrations: countByLocalDay(allPatients.map((p) => p.createdAt), start, end),
        vitals: countByLocalDay(vitals.map((v) => v.takenAt), start, end),
        consultations: countByLocalDay(consultations.map((c) => c.createdAt), start, end),
        dispenses: countByLocalDay(dispenses.map((d) => d.dispensedAt), start, end),
      };
      const throughput: AnalyticsData["throughput"] = listLocalDays(start, end).map((day) => {
        const key = localDateKey(day);
        return {
          date: key,
          label: day.toLocaleDateString("en-NG", {
            weekday: "short",
            day: "numeric",
            month: "short",
          }),
          registrations: counts.registrations.get(key) ?? 0,
          vitals: counts.vitals.get(key) ?? 0,
          consultations: counts.consultations.get(key) ?? 0,
          dispenses: counts.dispenses.get(key) ?? 0,
        };
      });

      // Queue: stages finished within the period, and who is waiting now.
      const finishedInPeriod = queueItems.filter(
        (q) => q.status === "done" && isInRange(q.updatedAt, start, end),
      );
      const queueMetrics = STAGES.map((stage) => {
        const finished = finishedInPeriod.filter((q) => q.stage === stage);
        return {
          stage,
          avgStage: averageMinutes(finished.map((q) => ({ start: q.queuedAt, end: q.updatedAt }))),
          finished: finished.length,
          currentWaiting: queueItems.filter((q) => q.stage === stage && q.status === "waiting").length,
        };
      });

      // Patients by state (all patient records on this device).
      const stateCounts = new Map<string, number>();
      allPatients.forEach((p) => {
        const state = p.state || "Not recorded";
        stateCounts.set(state, (stateCounts.get(state) || 0) + 1);
      });
      const demographics = Array.from(stateCounts.entries())
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 6);

      const userMap = new Map<string, string>(users.map((u) => [u.id, u.fullName]));
      const topPerformers = [...wallets]
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, 5)
        .map((wallet) => ({
          name: userMap.get(wallet.volunteerId) || "Unknown volunteer",
          tokens: wallet.tokens,
          badges: wallet.badges?.length ?? 0,
        }));

      setData({
        loadedAt: new Date(),
        range: { from: dateRange.from, to: dateRange.to, start, end },
        overview: {
          totalPatients: allPatients.length,
          periodRegistrations: allPatients.filter((p) => isInRange(p.createdAt, start, end)).length,
          activeVisits,
          completedVisits,
          avgStage: averageMinutes(
            finishedInPeriod.map((q) => ({ start: q.queuedAt, end: q.updatedAt })),
          ),
          // Every wallet, not just the top five; lifetime so spent tokens still count.
          tokensEarned: wallets.reduce((sum, w) => sum + (w.lifetimeTokens ?? w.tokens ?? 0), 0),
        },
        throughput,
        queueMetrics,
        demographics,
        gamification: {
          totalSessions,
          pendingApprovals: pendingCount,
          topPerformers,
        },
      });
    } catch (error) {
      console.error(
        "Error loading analytics data:",
        error instanceof Error ? error.name : error,
      );
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [dateRange.from, dateRange.to]);

  useEffect(() => {
    if (hasAccess) {
      loadAnalyticsData();
    }
  }, [hasAccess, loadAnalyticsData]);

  // Exports are an "export" permission action; check it here as well as by
  // only rendering the page for roles that have it.
  const exportAllowed = useCallback((): boolean => {
    if (currentUser && can(currentUser.role, "export")) return true;
    push({
      id: generateId(),
      tone: "warning",
      title: "Export not allowed for your role",
      body: "No file was created. Ask an administrator to export this report.",
    });
    return false;
  }, [currentUser, push]);

  // File names use the period the figures were built for, not the inputs.
  const fileRange = data ? `${data.range.from}-to-${data.range.to}` : "";

  const exportAnalyticsCSV = useCallback(() => {
    if (!data || !exportAllowed()) return;
    exportCsv(
      "daily activity",
      `analytics-${fileRange}.csv`,
      ["Date", "Registrations", "Vitals", "Consultations", "Dispenses"],
      data.throughput.map((d) => [d.date, d.registrations, d.vitals, d.consultations, d.dispenses]),
    );
  }, [data, exportAllowed, exportCsv, fileRange]);

  const exportQueueCSV = useCallback(() => {
    if (!data || !exportAllowed()) return;
    exportCsv(
      "queue figures",
      `queue-metrics-${fileRange}.csv`,
      ["Stage", "Waiting now", "Finished in period", "Average time in stage (min)"],
      data.queueMetrics.map((q) => [
        FLOW_STAGE_LABELS[q.stage],
        q.currentWaiting,
        q.finished,
        q.avgStage ? q.avgStage.minutes : "",
      ]),
    );
  }, [data, exportAllowed, exportCsv, fileRange]);

  const exportGamificationCSV = useCallback(() => {
    if (!data || !exportAllowed()) return;
    exportCsv(
      "volunteer token balances",
      `gamification-${fileRange}.csv`,
      ["Name", "Tokens", "Badges"],
      data.gamification.topPerformers.map((p) => [p.name, p.tokens, p.badges]),
    );
  }, [data, exportAllowed, exportCsv, fileRange]);

  if (!hasAccess) {
    return (
      <div className="mx-auto max-w-7xl">
        <PageHeader title="Analytics" />
        <div className="panel">
          <EmptyState
            icon={LockClosedIcon}
            title="Access restricted"
            description="Analytics is available to administrators, auditors and lead clinicians."
          />
        </div>
      </div>
    );
  }

  if (loading && !data) {
    return <DashboardSkeleton />;
  }

  // Label figures with the period they were read for; while a new range
  // loads (or if it fails) the figures on screen are still the previous ones.
  const shownRange = data?.range ?? bounds;
  const periodLabel = shownRange
    ? `${formatNigerianDate(shownRange.start)} – ${formatNigerianDate(addLocalDays(shownRange.end, -1))}`
    : "";
  const totals = data
    ? data.throughput.reduce(
        (t, d) => ({
          registrations: t.registrations + d.registrations,
          vitals: t.vitals + d.vitals,
          consultations: t.consultations + d.consultations,
          dispenses: t.dispenses + d.dispenses,
        }),
        { registrations: 0, vitals: 0, consultations: 0, dispenses: 0 },
      )
    : null;
  const anyActivity =
    !!totals &&
    totals.registrations + totals.vitals + totals.consultations + totals.dispenses > 0;
  const stateTotal = data?.overview.totalPatients ?? 0;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title="Analytics"
        description="Clinic activity, queue and volunteer figures for a date range."
      />

      <section className="panel" aria-label="Date range">
        <div className="panel-body flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="sm:w-48">
            <label htmlFor="analytics-from" className="field-label">
              From
            </label>
            <input
              id="analytics-from"
              type="date"
              value={dateRange.from}
              max={dateRange.to}
              onChange={(e) => setDateRange((r) => ({ ...r, from: e.target.value }))}
              className="input-field"
              aria-invalid={!bounds}
              aria-describedby={!bounds ? "analytics-range-error" : undefined}
            />
          </div>
          <div className="sm:w-48">
            <label htmlFor="analytics-to" className="field-label">
              To (inclusive)
            </label>
            <input
              id="analytics-to"
              type="date"
              value={dateRange.to}
              min={dateRange.from}
              onChange={(e) => setDateRange((r) => ({ ...r, to: e.target.value }))}
              className="input-field"
              aria-invalid={!bounds}
              aria-describedby={!bounds ? "analytics-range-error" : undefined}
            />
          </div>
          <p className="text-caption text-ink-muted sm:pb-3" aria-live="polite">
            {loading
              ? "Updating…"
              : data
                ? `Read at ${formatTime(data.loadedAt)}`
                : ""}
          </p>
        </div>
        {!bounds && (
          <p id="analytics-range-error" className="field-error px-4 pb-4" role="alert">
            Choose a start date on or before the end date.
          </p>
        )}
      </section>

      {loadFailed && (
        <div className="banner banner-danger" role="alert">
          <span className="flex-1">
            The figures could not be read from this device.
            {data ? " The figures below are from the last successful read." : ""}
          </span>
          <button type="button" onClick={loadAnalyticsData} className="btn-secondary">
            Try again
          </button>
        </div>
      )}

      {bounds && shownRange && <DataScopeNote period={periodLabel} />}

      {data && bounds && (
        <>
          {/* Overview */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="Patient records"
              value={data.overview.totalPatients.toLocaleString("en-NG")}
              hint="All time"
              icon={UsersIcon}
            />
            <StatTile
              label="New patients"
              value={data.overview.periodRegistrations.toLocaleString("en-NG")}
              hint="Registered in this period"
              icon={UserPlusIcon}
            />
            <StatTile
              label="Open / closed visits"
              value={`${data.overview.activeVisits.toLocaleString("en-NG")} / ${data.overview.completedVisits.toLocaleString("en-NG")}`}
              hint="All time, as of now"
              icon={HeartIcon}
            />
            <StatTile
              label="Average time in a stage"
              value={data.overview.avgStage ? `${data.overview.avgStage.minutes} min` : "No data"}
              hint={
                data.overview.avgStage
                  ? `Queue to finish, ${data.overview.avgStage.count} stages finished in this period`
                  : "No stages with a queue time finished in this period"
              }
              icon={ClockIcon}
            />
          </div>

          {/* Daily activity */}
          <section className="panel" aria-labelledby="daily-activity-title">
            <div className="panel-header flex-wrap">
              <h2 id="daily-activity-title" className="panel-title">
                Daily activity
              </h2>
              <span className="text-caption text-ink-muted">Records saved per day</span>
            </div>
            {!anyActivity ? (
              <EmptyState
                icon={ChartBarIcon}
                title="No activity recorded in this period"
                description="Registrations, vitals, consultations and dispensing saved on this device will show here."
              />
            ) : (
              <div className="panel-body space-y-3">
                <div className="h-72" aria-hidden>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.throughput} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
                      <CartesianGrid stroke={CHART_GRID} vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 12, fill: CHART_AXIS }}
                        stroke={CHART_GRID}
                        minTickGap={16}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 12, fill: CHART_AXIS }}
                        stroke={CHART_GRID}
                      />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 13 }} />
                      {ACTIVITY_SERIES.map((s) => (
                        <Line
                          key={s.key}
                          type="monotone"
                          dataKey={s.key}
                          stroke={s.color}
                          strokeWidth={2}
                          strokeDasharray={s.dash}
                          dot={{ r: 4 }}
                          name={s.label}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <details className="rounded-md border border-line">
                  <summary className="flex min-h-touch-target cursor-pointer items-center px-3 text-label text-ink-secondary hover:bg-surface-hover">
                    Show the daily figures as a table
                  </summary>
                  <div className="max-h-96 overflow-auto border-t border-line">
                    <table className="data-table">
                      <caption className="sr-only">Records saved per day, {periodLabel}</caption>
                      <thead>
                        <tr>
                          <th scope="col">Date</th>
                          {ACTIVITY_SERIES.map((s) => (
                            <th key={s.key} scope="col" className="text-right">
                              {s.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.throughput.map((d) => (
                          <tr key={d.date}>
                            <td className="whitespace-nowrap">{d.label}</td>
                            {ACTIVITY_SERIES.map((s) => (
                              <td key={s.key} className="text-right tabular-nums">
                                {d[s.key]}
                              </td>
                            ))}
                          </tr>
                        ))}
                        {totals && (
                          <tr>
                            <td className="font-semibold">Total</td>
                            {ACTIVITY_SERIES.map((s) => (
                              <td key={s.key} className="text-right font-semibold tabular-nums">
                                {totals[s.key]}
                              </td>
                            ))}
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </details>
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Queue */}
            <section className="panel" aria-labelledby="queue-figures-title">
              <div className="panel-header">
                <h2 id="queue-figures-title" className="panel-title">
                  Queue
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Stage</th>
                      <th scope="col" className="text-right">Waiting now</th>
                      <th scope="col" className="text-right">Finished</th>
                      <th scope="col" className="text-right">Avg time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.queueMetrics.map((q) => (
                      <tr key={q.stage}>
                        <td className="font-medium">{FLOW_STAGE_LABELS[q.stage]}</td>
                        <td className="text-right tabular-nums">{q.currentWaiting}</td>
                        <td className="text-right tabular-nums">{q.finished}</td>
                        <td className="text-right tabular-nums text-ink-secondary">
                          {q.avgStage ? `${q.avgStage.minutes} min` : "No data"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-line px-4 py-3 text-caption text-ink-muted">
                Finished and average time cover this period; average time runs
                from joining the stage's queue to finishing it. Waiting is right
                now.
              </p>
            </section>

            {/* States */}
            <section className="panel" aria-labelledby="states-title">
              <div className="panel-header">
                <h2 id="states-title" className="panel-title">
                  Patients by state
                </h2>
                <span className="text-caption text-ink-muted">All patient records · top 6</span>
              </div>
              <div className="panel-body">
                {data.demographics.length > 0 ? (
                  <BarList
                    label="Patient records by state"
                    scale="share"
                    total={stateTotal}
                    items={data.demographics.map((d) => ({
                      key: d.name,
                      label: d.name,
                      value: d.value,
                    }))}
                  />
                ) : (
                  <p className="text-body text-ink-muted">No patient records on this device yet.</p>
                )}
              </div>
            </section>
          </div>

          {/* Volunteer training (gamification) */}
          <section className="panel" aria-labelledby="volunteer-games-title">
            <div className="panel-header flex-wrap">
              <h2 id="volunteer-games-title" className="panel-title flex items-center gap-2">
                <TrophyIcon className="h-5 w-5 text-ink-muted" aria-hidden />
                Volunteer training games
              </h2>
              <span className="text-caption text-ink-muted">All time</span>
            </div>
            <div className="grid grid-cols-1 gap-0 lg:grid-cols-2">
              <div className="border-b border-line p-4 lg:border-b-0 lg:border-r">
                <p className="section-label mb-2">Highest token balances</p>
                {data.gamification.topPerformers.length > 0 ? (
                  <ol className="divide-y divide-line">
                    {data.gamification.topPerformers.map((performer, index) => (
                      <li key={`${performer.name}-${index}`} className="flex items-center gap-3 py-2">
                        <span className="w-6 text-right tabular-nums text-ink-muted">{index + 1}.</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-ink">{performer.name}</span>
                          <span className="text-caption text-ink-muted">
                            {performer.badges} {performer.badges === 1 ? "badge" : "badges"}
                          </span>
                        </span>
                        <span className="tabular-nums text-ink">
                          {performer.tokens.toLocaleString("en-NG")} tokens
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-body text-ink-muted">No volunteer has earned tokens on this device yet.</p>
                )}
              </div>
              <dl className="space-y-3 p-4">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-body text-ink-secondary">Game sessions played</dt>
                  <dd className="tabular-nums text-ink">{data.gamification.totalSessions.toLocaleString("en-NG")}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-body text-ink-secondary">Sessions waiting for approval</dt>
                  <dd className="flex items-center gap-2 tabular-nums text-ink">
                    {data.gamification.pendingApprovals > 0 ? (
                      <StatusBadge tone="warning">{data.gamification.pendingApprovals} to review</StatusBadge>
                    ) : (
                      "None"
                    )}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-body text-ink-secondary">Tokens earned by all volunteers</dt>
                  <dd className="tabular-nums text-ink">{data.overview.tokensEarned.toLocaleString("en-NG")}</dd>
                </div>
                {data.gamification.pendingApprovals > 0 && currentUser?.role === "admin" && (
                  <div className="pt-1">
                    <Link to="/admin/approvals" className="btn-primary w-full">
                      Review pending approvals
                    </Link>
                  </div>
                )}
              </dl>
            </div>
          </section>

          {/* Export */}
          <section className="panel" aria-labelledby="analytics-export-title">
            <div className="panel-header">
              <h2 id="analytics-export-title" className="panel-title">
                Export
              </h2>
              <span className="text-caption text-ink-muted">CSV files, saved to this device</span>
            </div>
            <ul className="divide-y divide-line">
              <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  <span className="block font-medium text-ink">Daily activity</span>
                  <span className="text-caption text-ink-muted">
                    One row per day in the period: new patients, vitals, consultations and dispensing records.
                  </span>
                </span>
                <button type="button" onClick={exportAnalyticsCSV} className="btn-secondary">
                  <ArrowDownTrayIcon className="h-4 w-4" aria-hidden />
                  Daily activity (CSV)
                </button>
              </li>
              <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  <span className="block font-medium text-ink">Queue figures</span>
                  <span className="text-caption text-ink-muted">
                    One row per stage: waiting now, finished and average time in the period.
                  </span>
                </span>
                <button type="button" onClick={exportQueueCSV} className="btn-secondary">
                  <ArrowDownTrayIcon className="h-4 w-4" aria-hidden />
                  Queue figures (CSV)
                </button>
              </li>
              <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  <span className="block font-medium text-ink">Volunteer token balances</span>
                  <span className="text-caption text-ink-muted">
                    The five highest current balances with badge counts. Not limited to the period.
                  </span>
                </span>
                <button type="button" onClick={exportGamificationCSV} className="btn-secondary">
                  <ArrowDownTrayIcon className="h-4 w-4" aria-hidden />
                  Token balances (CSV)
                </button>
              </li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
