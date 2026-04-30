import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowLeftIcon,
  ArrowDownTrayIcon,
  CalendarDaysIcon,
  UsersIcon,
  HeartIcon,
  ShieldExclamationIcon,
  ClipboardDocumentCheckIcon,
  ArrowUturnRightIcon,
  UserGroupIcon,
  MapPinIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import { db, Site } from "@/db";
import { useAuthStore } from "@/stores/auth";
import { addSite, setSiteActive } from "@/services/sites";
import {
  getOutreachSummary,
  listOutreachSites,
  rangeBounds,
  summaryToCsvRows,
  OutreachSummary,
} from "@/services/outreachReports";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoToLocalDate(iso: string): Date {
  // Treat the ISO yyyy-mm-dd string as a local date.
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function downloadCsv(
  rows: Record<string, string | number>[],
  filename: string,
) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}_${todayIsoDate()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function OutreachReports() {
  const { currentUser } = useAuthStore();
  const isAdmin = currentUser?.role === "admin";
  const [startInput, setStartInput] = useState<string>(todayIsoDate());
  const [endInput, setEndInput] = useState<string>(todayIsoDate());
  const [siteName, setSiteName] = useState<string>("");
  const [sites, setSites] = useState<string[]>([]);
  const [summary, setSummary] = useState<OutreachSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [showSiteAdmin, setShowSiteAdmin] = useState(false);
  const [newSiteName, setNewSiteName] = useState("");
  const [siteSaveError, setSiteSaveError] = useState("");

  const registrySitesQuery = useLiveQuery(
    () => db.sites.orderBy("name").toArray(),
    [],
  );
  const registrySites: Site[] = useMemo(
    () => registrySitesQuery ?? [],
    [registrySitesQuery],
  );

  const bounds = useMemo(
    () => rangeBounds(isoToLocalDate(startInput), isoToLocalDate(endInput)),
    [startInput, endInput],
  );

  useEffect(() => {
    listOutreachSites()
      .then(setSites)
      .catch(() => setSites([]));
    // Re-run whenever the registry changes so the dropdown stays in sync.
  }, [registrySites]);

  const handleAddSite = async () => {
    setSiteSaveError("");
    try {
      await addSite(newSiteName);
      setNewSiteName("");
    } catch (err) {
      setSiteSaveError(
        err instanceof Error ? err.message : "Could not add site.",
      );
    }
  };

  const handleToggleSiteActive = async (id: string, active: boolean) => {
    try {
      await setSiteActive(id, active);
    } catch (err) {
      console.error("Could not update site:", err);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    getOutreachSummary({
      start: bounds.start,
      end: bounds.end,
      siteName: siteName || undefined,
    })
      .then((s) => {
        if (!cancelled) setSummary(s);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("Outreach summary failed:", err);
          setError("Could not build the report from local data.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bounds.start, bounds.end, siteName]);

  const handleExport = () => {
    if (!summary) return;
    downloadCsv(summaryToCsvRows(summary), "outreach_summary");
  };

  const totalAge = summary
    ? Object.values(summary.ageBands).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link to="/dashboard" className="text-blue-600 hover:text-blue-800">
            <ArrowLeftIcon className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Outreach Summary
            </h1>
            <p className="text-gray-600 text-sm">
              Aggregate of patients seen, demographics, conditions, dispenses,
              referrals, and volunteer attendance for an outreach window.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleExport}
          disabled={!summary || summary.visits === 0}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ArrowDownTrayIcon className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label
            htmlFor="from"
            className="block text-xs font-medium text-gray-500 mb-1"
          >
            From
          </label>
          <input
            id="from"
            type="date"
            value={startInput}
            max={endInput}
            onChange={(e) => setStartInput(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label
            htmlFor="to"
            className="block text-xs font-medium text-gray-500 mb-1"
          >
            To (inclusive)
          </label>
          <input
            id="to"
            type="date"
            value={endInput}
            min={startInput}
            onChange={(e) => setEndInput(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label
            htmlFor="site"
            className="block text-xs font-medium text-gray-500 mb-1"
          >
            Site
          </label>
          <select
            id="site"
            value={siteName}
            onChange={(e) => setSiteName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isAdmin && (
        <div className="bg-white rounded-lg border border-gray-200">
          <button
            type="button"
            onClick={() => setShowSiteAdmin((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-left text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <span className="flex items-center gap-2">
              <MapPinIcon className="w-4 h-4 text-gray-400" />
              Manage outreach sites
              <span className="text-xs text-gray-500">
                ({registrySites.length} registered)
              </span>
            </span>
            <span className="text-xs text-blue-600">
              {showSiteAdmin ? "Hide" : "Show"}
            </span>
          </button>

          {showSiteAdmin && (
            <div className="border-t border-gray-100 p-4 space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newSiteName}
                  onChange={(e) => setNewSiteName(e.target.value)}
                  placeholder="New site name (e.g. Lagos Outreach 2026)"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={handleAddSite}
                  disabled={!newSiteName.trim()}
                  className="inline-flex items-center gap-1 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  <PlusIcon className="w-4 h-4" />
                  Add
                </button>
              </div>
              {siteSaveError && (
                <p className="text-xs text-red-600">{siteSaveError}</p>
              )}
              {registrySites.length === 0 ? (
                <p className="text-xs text-gray-500 italic">
                  No sites registered yet. Visits started without a registry
                  entry still appear in the dropdown above using their visit
                  siteName.
                </p>
              ) : (
                <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
                  {registrySites.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between px-3 py-2 text-sm"
                    >
                      <span
                        className={
                          s.active === 1
                            ? "text-gray-900"
                            : "text-gray-400 line-through"
                        }
                      >
                        {s.name}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          handleToggleSiteActive(s.id, s.active !== 1)
                        }
                        className="text-xs text-blue-600 hover:text-blue-800"
                      >
                        {s.active === 1 ? "Disable" : "Enable"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading && !summary && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      )}

      {summary && (
        <>
          {/* Headline KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              icon={<UsersIcon className="w-6 h-6 text-blue-600" />}
              label="Patients Seen"
              value={summary.patientsSeen.toLocaleString()}
              bg="bg-blue-50"
            />
            <KpiCard
              icon={<CalendarDaysIcon className="w-6 h-6 text-emerald-600" />}
              label="Visits"
              value={summary.visits.toLocaleString()}
              bg="bg-emerald-50"
            />
            <KpiCard
              icon={<ShieldExclamationIcon className="w-6 h-6 text-red-600" />}
              label="High-Risk Cases"
              value={summary.highRiskCases.toLocaleString()}
              bg="bg-red-50"
            />
            <KpiCard
              icon={<ArrowUturnRightIcon className="w-6 h-6 text-amber-600" />}
              label="Referrals"
              value={summary.referrals.toLocaleString()}
              bg="bg-amber-50"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Section
              title="Gender Breakdown"
              icon={<HeartIcon className="w-5 h-5 text-rose-500" />}
            >
              <BarRow
                label="Female"
                value={summary.gender.female}
                total={summary.patientsSeen}
                color="bg-rose-500"
              />
              <BarRow
                label="Male"
                value={summary.gender.male}
                total={summary.patientsSeen}
                color="bg-blue-500"
              />
              <BarRow
                label="Other / Unknown"
                value={summary.gender.other + summary.gender.unknown}
                total={summary.patientsSeen}
                color="bg-gray-400"
              />
            </Section>

            <Section
              title="Age Bands"
              icon={<UsersIcon className="w-5 h-5 text-indigo-500" />}
            >
              {Object.entries(summary.ageBands).map(([band, count]) => (
                <BarRow
                  key={band}
                  label={band}
                  value={count}
                  total={totalAge}
                  color="bg-indigo-500"
                />
              ))}
            </Section>

            <Section
              title="Common Conditions"
              icon={
                <ClipboardDocumentCheckIcon className="w-5 h-5 text-purple-500" />
              }
            >
              {summary.conditions.length === 0 ? (
                <Empty text="No diagnoses recorded for this window." />
              ) : (
                summary.conditions.map((c) => (
                  <BarRow
                    key={c.diagnosis}
                    label={c.diagnosis}
                    value={c.count}
                    total={summary.conditions[0].count}
                    color="bg-purple-500"
                  />
                ))
              )}
            </Section>

            <Section
              title="Medicines Dispensed"
              icon={
                <ClipboardDocumentCheckIcon className="w-5 h-5 text-teal-500" />
              }
            >
              {summary.medicines.length === 0 ? (
                <Empty text="No dispenses recorded for this window." />
              ) : (
                summary.medicines.map((m) => (
                  <BarRow
                    key={m.name}
                    label={`${m.name} (${m.events} events)`}
                    value={m.unitsDispensed}
                    total={summary.medicines[0].unitsDispensed}
                    color="bg-teal-500"
                  />
                ))
              )}
            </Section>

            <Section
              title="Volunteer Attendance"
              icon={<UserGroupIcon className="w-5 h-5 text-green-500" />}
              fullWidth
            >
              {summary.volunteers.length === 0 ? (
                <Empty text="No staff activity recorded for this window." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                          Name
                        </th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                          Role
                        </th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                          Stage Events
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {summary.volunteers.map((v) => (
                        <tr key={v.actorId} className="hover:bg-gray-50">
                          <td className="px-4 py-2 text-sm text-gray-900">
                            {v.fullName}
                          </td>
                          <td className="px-4 py-2 text-sm capitalize text-gray-600">
                            {v.role}
                          </td>
                          <td className="px-4 py-2 text-sm text-right text-gray-900">
                            {v.events.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  bg,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  bg: string;
}) {
  return (
    <div className={`${bg} rounded-lg p-4`}>
      <div className="flex items-center gap-3">
        {icon}
        <div>
          <p className="text-sm text-gray-600">{label}</p>
          <p className="text-xl font-bold text-gray-900">{value}</p>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
  fullWidth = false,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <div
      className={`bg-white rounded-lg border border-gray-200 p-4 space-y-3 ${
        fullWidth ? "lg:col-span-2" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="font-semibold text-gray-900">{title}</h2>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function BarRow({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="font-medium text-gray-800 truncate pr-2">{label}</span>
        <span className="text-gray-600 shrink-0">
          {value.toLocaleString()}
          {total > 0 ? ` (${pct}%)` : ""}
        </span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full`}
          style={{ width: `${total > 0 ? Math.max(2, pct) : 0}%` }}
        />
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-gray-500 italic">{text}</p>;
}
