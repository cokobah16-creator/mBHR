import { useEffect, useState, useCallback } from "react";
import Dexie, { type IndexableType } from "dexie";
import { useAuthStore } from "@/stores/auth";
import { db } from "@/db";
import { can } from "@/auth/roles";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  ChartBarIcon,
  UsersIcon,
  ClockIcon,
  HeartIcon,
  TrophyIcon,
  ExclamationTriangleIcon,
  CalendarIcon,
  ArrowDownTrayIcon,
} from "@heroicons/react/24/outline";

// Date range helpers to ensure valid IndexedDB keys
const toISO = (v?: Date | string | null) => {
  if (!v) return undefined;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
};

const makeBoundsISO = (
  from?: Date | string | null,
  to?: Date | string | null,
): [IndexableType, IndexableType] => {
  const lo = toISO(from) ?? (Dexie.minKey as IndexableType);
  const hi = toISO(to) ?? (Dexie.maxKey as IndexableType);
  return [lo, hi];
};

const rangeOrAll = <T,>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: Dexie.Table<T, any>,
  index: string,
  from?: Date | string | null,
  to?: Date | string | null,
) => {
  if (from || to) {
    const [lo, hi] = makeBoundsISO(from, to);
    return table.where(index).between(lo, hi, true, true);
  }
  return table.orderBy(index);
};

const CHART_COLORS = [
  "#2563eb",
  "#16a34a",
  "#9333ea",
  "#ea580c",
  "#0891b2",
  "#e11d48",
];

interface AnalyticsData {
  overview: {
    totalPatients: number;
    todayRegistrations: number;
    activeVisits: number;
    completedVisits: number;
    avgWaitTime: number;
    tokensAwarded: number;
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
    stage: string;
    avgWaitMinutes: number;
    throughput: number;
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

function downloadCSV(filename: string, headers: string[], rows: string[][]) {
  const csvContent = [
    headers.join(","),
    ...rows.map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
    ),
  ].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function AnalyticsDashboard() {
  const { currentUser } = useAuthStore();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({
    from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0],
    to: new Date().toISOString().split("T")[0],
  });

  const hasAccess = !!currentUser && can(currentUser.role, "export");

  const loadAnalyticsData = useCallback(async () => {
    setLoading(true);
    try {
      const fromDate = dateRange.from
        ? new Date(dateRange.from + "T00:00:00.000Z")
        : null;
      const toDate = dateRange.to
        ? new Date(dateRange.to + "T23:59:59.999Z")
        : null;

      // Calculate days in range
      const startMs = fromDate?.getTime() ?? Date.now() - 7 * 86400000;
      const endMs = toDate?.getTime() ?? Date.now();
      const dayCount = Math.max(1, Math.ceil((endMs - startMs) / 86400000));

      // Overview metrics
      const [
        totalPatients,
        todayCount,
        activeVisits,
        completedVisits,
        pendingCount,
        wallets,
        totalSessions,
      ] = await Promise.all([
        db.patients.count(),
        rangeOrAll(db.patients, "createdAt", fromDate, toDate).count(),
        db.visits.where("status").equals("open").count(),
        db.visits.where("status").equals("closed").count(),
        db.gameSessions.filter((s) => !s.committed && !!s.finishedAt).count(),
        db.gamificationWallets.orderBy("tokens").reverse().limit(5).toArray(),
        db.gameSessions.count(),
      ]);

      // Calculate real average wait time from queue
      const queueItems = await db.queue
        .where("status")
        .equals("done")
        .toArray();
      let avgWaitTime = 0;
      if (queueItems.length > 0) {
        const totalWait = queueItems.reduce((sum, item) => {
          if (
            (item as unknown as Record<string, unknown>).queuedAt &&
            item.updatedAt
          ) {
            return (
              sum +
              (new Date(item.updatedAt).getTime() -
                new Date(
                  (item as unknown as Record<string, unknown>)
                    .queuedAt as string,
                ).getTime())
            );
          }
          return sum;
        }, 0);
        avgWaitTime = Math.round(totalWait / queueItems.length / 60000); // minutes
      }

      // Throughput data for each day in range
      const throughputData: AnalyticsData["throughput"] = [];
      for (let i = dayCount - 1; i >= 0; i--) {
        const date = new Date(endMs - i * 86400000);
        const dayStart = new Date(
          date.getFullYear(),
          date.getMonth(),
          date.getDate(),
        );
        const dayEnd = new Date(
          date.getFullYear(),
          date.getMonth(),
          date.getDate() + 1,
        );

        const [registrations, vitalsCount, consultations, dispenses] =
          await Promise.all([
            rangeOrAll(db.patients, "createdAt", dayStart, dayEnd).count(),
            rangeOrAll(db.vitals, "takenAt", dayStart, dayEnd).count(),
            rangeOrAll(db.consultations, "createdAt", dayStart, dayEnd).count(),
            rangeOrAll(db.dispenses, "dispensedAt", dayStart, dayEnd).count(),
          ]);

        throughputData.push({
          date: dayStart.toISOString().split("T")[0],
          label: dayStart.toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          }),
          registrations,
          vitals: vitalsCount,
          consultations,
          dispenses,
        });
      }

      // Queue metrics with real wait time calculation
      const queueMetrics = await Promise.all(
        ["registration", "vitals", "consult", "pharmacy"].map(async (stage) => {
          const waiting = await db.queue
            .where("stage")
            .equals(stage)
            .and((q) => q.status === "waiting")
            .count();
          const doneInStage = await db.queue
            .where("stage")
            .equals(stage)
            .and((q) => q.status === "done")
            .toArray();
          let stageAvgWait = 0;
          if (doneInStage.length > 0) {
            const totalWait = doneInStage.reduce((sum, item) => {
              if (
                (item as unknown as Record<string, unknown>).queuedAt &&
                item.updatedAt
              ) {
                return (
                  sum +
                  (new Date(item.updatedAt).getTime() -
                    new Date(
                      (item as unknown as Record<string, unknown>)
                        .queuedAt as string,
                    ).getTime())
                );
              }
              return sum;
            }, 0);
            stageAvgWait = Math.round(totalWait / doneInStage.length / 60000);
          }
          return {
            stage,
            avgWaitMinutes: stageAvgWait,
            throughput: doneInStage.length,
            currentWaiting: waiting,
          };
        }),
      );

      // Patient demographics by state
      const allPatients = await db.patients.toArray();
      const stateCounts = new Map<string, number>();
      allPatients.forEach((p) => {
        const state = p.state || "Unknown";
        stateCounts.set(state, (stateCounts.get(state) || 0) + 1);
      });
      const demographics = Array.from(stateCounts.entries())
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 6);

      // Top performers
      const users = await db.users.toArray();
      const userMap = new Map(users.map((u) => [u.id, u.fullName]));
      const topPerformers = wallets.map((wallet) => ({
        name: userMap.get(wallet.volunteerId) || "Unknown",
        tokens: wallet.tokens,
        badges: wallet.badges.length,
      }));

      setData({
        overview: {
          totalPatients,
          todayRegistrations: todayCount,
          activeVisits,
          completedVisits,
          avgWaitTime,
          tokensAwarded: wallets.reduce((sum, w) => sum + w.tokens, 0),
        },
        throughput: throughputData,
        queueMetrics,
        demographics,
        gamification: {
          totalSessions,
          pendingApprovals: pendingCount,
          topPerformers,
        },
      });
    } catch (error) {
      console.error("Error loading analytics data:", error);
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  const exportAnalyticsCSV = useCallback(() => {
    if (!data) return;
    downloadCSV(
      `analytics-${dateRange.from}-to-${dateRange.to}.csv`,
      ["Date", "Registrations", "Vitals", "Consultations", "Dispenses"],
      data.throughput.map((d) => [
        d.date,
        String(d.registrations),
        String(d.vitals),
        String(d.consultations),
        String(d.dispenses),
      ]),
    );
  }, [data, dateRange]);

  const exportQueueCSV = useCallback(() => {
    if (!data) return;
    downloadCSV(
      `queue-metrics-${dateRange.from}-to-${dateRange.to}.csv`,
      ["Stage", "Currently Waiting", "Avg Wait (min)", "Total Processed"],
      data.queueMetrics.map((q) => [
        q.stage,
        String(q.currentWaiting),
        String(q.avgWaitMinutes),
        String(q.throughput),
      ]),
    );
  }, [data, dateRange]);

  const exportGamificationCSV = useCallback(() => {
    if (!data) return;
    downloadCSV(
      `gamification-${dateRange.from}-to-${dateRange.to}.csv`,
      ["Name", "Tokens", "Badges"],
      data.gamification.topPerformers.map((p) => [
        p.name,
        String(p.tokens),
        String(p.badges),
      ]),
    );
  }, [data, dateRange]);

  useEffect(() => {
    if (hasAccess) {
      loadAnalyticsData();
    }
  }, [hasAccess, loadAnalyticsData]);

  if (!hasAccess) {
    return (
      <div className="text-center py-12">
        <ChartBarIcon className="h-12 w-12 mx-auto text-gray-400 mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">
          Access Restricted
        </h3>
        <p className="text-gray-600">
          Only administrators can access the analytics dashboard.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center space-x-3">
          <ChartBarIcon className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Analytics Dashboard
            </h1>
            <p className="text-gray-600">Loading clinic performance data...</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="card animate-pulse">
              <div className="h-20 bg-gray-200 rounded"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* Header with Date Filter */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <ChartBarIcon className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Analytics Dashboard
            </h1>
            <p className="text-gray-600">Clinic performance and insights</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <CalendarIcon className="h-5 w-5 text-gray-400" />
          <input
            type="date"
            value={dateRange.from}
            onChange={(e) =>
              setDateRange({ ...dateRange, from: e.target.value })
            }
            className="input-field text-sm py-2"
          />
          <span className="text-gray-500">to</span>
          <input
            type="date"
            value={dateRange.to}
            onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })}
            className="input-field text-sm py-2"
          />
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="card bg-blue-50 border-blue-200">
          <div className="flex items-center">
            <div className="flex-shrink-0 p-2 rounded-lg bg-blue-100">
              <UsersIcon className="h-6 w-6 text-blue-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-blue-600">
                Total Patients
              </p>
              <p className="text-2xl font-bold text-blue-800">
                {data.overview.totalPatients}
              </p>
            </div>
          </div>
        </div>

        <div className="card bg-green-50 border-green-200">
          <div className="flex items-center">
            <div className="flex-shrink-0 p-2 rounded-lg bg-green-100">
              <HeartIcon className="h-6 w-6 text-green-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-green-600">
                Active / Completed Visits
              </p>
              <p className="text-2xl font-bold text-green-800">
                {data.overview.activeVisits} / {data.overview.completedVisits}
              </p>
            </div>
          </div>
        </div>

        <div className="card bg-orange-50 border-orange-200">
          <div className="flex items-center">
            <div className="flex-shrink-0 p-2 rounded-lg bg-orange-100">
              <ClockIcon className="h-6 w-6 text-orange-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-orange-600">
                Avg Wait Time
              </p>
              <p className="text-2xl font-bold text-orange-800">
                {data.overview.avgWaitTime > 0
                  ? `${data.overview.avgWaitTime}m`
                  : "N/A"}
              </p>
            </div>
          </div>
        </div>

        <div className="card bg-purple-50 border-purple-200">
          <div className="flex items-center">
            <div className="flex-shrink-0 p-2 rounded-lg bg-purple-100">
              <TrophyIcon className="h-6 w-6 text-purple-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-purple-600">
                Tokens Awarded
              </p>
              <p className="text-2xl font-bold text-purple-800">
                {data.overview.tokensAwarded}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Throughput Line Chart */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Daily Throughput
        </h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data.throughput}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey="registrations"
              stroke="#2563eb"
              strokeWidth={2}
              dot={{ r: 4 }}
              name="Registrations"
            />
            <Line
              type="monotone"
              dataKey="vitals"
              stroke="#16a34a"
              strokeWidth={2}
              dot={{ r: 4 }}
              name="Vitals"
            />
            <Line
              type="monotone"
              dataKey="consultations"
              stroke="#9333ea"
              strokeWidth={2}
              dot={{ r: 4 }}
              name="Consultations"
            />
            <Line
              type="monotone"
              dataKey="dispenses"
              stroke="#ea580c"
              strokeWidth={2}
              dot={{ r: 4 }}
              name="Dispenses"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Charts Row: Queue Bar Chart + Demographics Pie */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Queue Status Bar Chart */}
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Queue Status
          </h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data.queueMetrics}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="stage" tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar
                dataKey="currentWaiting"
                fill="#2563eb"
                name="Waiting"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="throughput"
                fill="#16a34a"
                name="Processed"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            {data.queueMetrics.map((q) => (
              <div
                key={q.stage}
                className="flex justify-between px-2 py-1 bg-gray-50 rounded"
              >
                <span className="capitalize text-gray-700">{q.stage}</span>
                <span className="text-gray-500">
                  {q.avgWaitMinutes > 0
                    ? `~${q.avgWaitMinutes}m wait`
                    : "No data"}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Demographics Pie Chart */}
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Patients by State
          </h3>
          {data.demographics.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={data.demographics}
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    dataKey="value"
                    label={({ name, percent }) =>
                      `${name} (${(percent * 100).toFixed(0)}%)`
                    }
                  >
                    {data.demographics.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={CHART_COLORS[index % CHART_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 flex flex-wrap gap-2 justify-center">
                {data.demographics.map((d, i) => (
                  <span
                    key={d.name}
                    className="text-xs flex items-center gap-1"
                  >
                    <span
                      className="inline-block w-3 h-3 rounded-full"
                      style={{
                        backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                      }}
                    />
                    {d.name}: {d.value}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <p className="text-gray-500 text-center py-12">
              No patient data yet
            </p>
          )}
        </div>
      </div>

      {/* Gamification Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Performers */}
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Top Performers
          </h3>
          {data.gamification.topPerformers.length > 0 ? (
            <div className="space-y-3">
              {data.gamification.topPerformers.map((performer, index) => (
                <div key={index} className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center text-white font-bold text-sm">
                      {index + 1}
                    </div>
                    <div>
                      <span className="font-medium text-gray-900">
                        {performer.name}
                      </span>
                      <span className="text-sm text-gray-600 ml-2">
                        {performer.badges} badges
                      </span>
                    </div>
                  </div>
                  <span className="text-lg font-bold text-primary">
                    {performer.tokens}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-8">
              No gamification data yet
            </p>
          )}
        </div>

        {/* Gamification Overview */}
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Gamification Overview
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-gray-700">Total Game Sessions</span>
              <span className="text-lg font-bold text-gray-900">
                {data.gamification.totalSessions}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-700">Pending Approvals</span>
              <div className="flex items-center space-x-2">
                {data.gamification.pendingApprovals > 0 && (
                  <ExclamationTriangleIcon className="h-4 w-4 text-yellow-600" />
                )}
                <span className="text-lg font-bold text-gray-900">
                  {data.gamification.pendingApprovals}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-700">Total Tokens Awarded</span>
              <span className="text-lg font-bold text-primary">
                {data.overview.tokensAwarded}
              </span>
            </div>
          </div>

          {data.gamification.pendingApprovals > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <button className="btn-primary w-full text-sm">
                Review Pending Approvals
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Export Section */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Data Export
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <button
            onClick={exportAnalyticsCSV}
            className="btn-secondary text-sm flex items-center justify-center gap-2"
          >
            <ArrowDownTrayIcon className="h-4 w-4" />
            Throughput (CSV)
          </button>
          <button
            onClick={exportQueueCSV}
            className="btn-secondary text-sm flex items-center justify-center gap-2"
          >
            <ArrowDownTrayIcon className="h-4 w-4" />
            Queue Metrics (CSV)
          </button>
          <button
            onClick={exportGamificationCSV}
            className="btn-secondary text-sm flex items-center justify-center gap-2"
          >
            <ArrowDownTrayIcon className="h-4 w-4" />
            Gamification (CSV)
          </button>
        </div>
      </div>
    </div>
  );
}
