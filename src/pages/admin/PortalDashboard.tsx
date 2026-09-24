/**
 * Patient portal overview for administrators.
 *
 * Counts come from the patient records stored on this device:
 * - patients with portal access, verified contacts and recent portal use
 * - a searchable, filterable list with each patient's portal status
 * - links to the bulk enrollment tools
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  UserGroupIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import { db, type Patient } from "@/db";
import { formatNigerianDate } from "@/utils/dateFormat";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import {
  PORTAL_FILTERS,
  PORTAL_STATUS,
  computePortalStats,
  filterPortalPatients,
  isPortalFilter,
  percentOf,
  portalStatusOf,
  type PortalFilter,
  type PortalStats,
} from "@/features/admin/portalStats";

const PAGE_LIMIT = 50;

const BREADCRUMBS = [
  { label: "Administration", to: "/admin" },
  { label: "Patient portal" },
];

function pct(part: number, whole: number, suffix: string) {
  const value = percentOf(part, whole);
  return value === null ? "No patients to compare yet" : `${value}% ${suffix}`;
}

export function PortalDashboard() {
  const [patients, setPatients] = useState<Patient[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<PortalFilter>("all");

  const loadData = useCallback(async () => {
    setLoadError(false);
    try {
      setPatients(await db.patients.toArray());
    } catch (error) {
      console.error(
        "Error loading portal dashboard data:",
        error instanceof Error ? error.name : error,
      );
      setLoadError(true);
      setPatients((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const stats: PortalStats | null = useMemo(
    () => (patients ? computePortalStats(patients) : null),
    [patients],
  );

  const filteredPatients = useMemo(
    () => filterPortalPatients(patients ?? [], searchQuery, statusFilter),
    [patients, searchQuery, statusFilter],
  );

  const header = (
    <PageHeader
      breadcrumbs={BREADCRUMBS}
      title="Patient portal overview"
      description="Portal access for the patients stored on this device. Counts do not include records that have not synced to this device."
      actions={
        <>
          <Link to="/admin/bulk-portal-migration" className="btn-secondary">
            Create server accounts
          </Link>
          <Link to="/admin/portal-migration" className="btn-primary">
            Enable portal access
          </Link>
        </>
      }
    />
  );

  if (patients === null || stats === null) {
    return (
      <div>
        {header}
        <DashboardSkeleton />
      </div>
    );
  }

  const metrics = [
    {
      label: "Patients on this device",
      value: stats.totalPatients,
      note: "All registered patients",
    },
    {
      label: "Portal enabled",
      value: stats.portalEnabled,
      note: pct(stats.portalEnabled, stats.totalPatients, "of patients"),
    },
    {
      label: "Verified",
      value: stats.verified,
      note: pct(stats.verified, stats.portalEnabled, "of portal-enabled patients"),
    },
    {
      label: "Pending verification",
      value: stats.pendingVerification,
      note: "Enabled, not yet signed in",
    },
    {
      label: "Active in the last 30 days",
      value: stats.active30Days,
      note: pct(stats.active30Days, stats.verified, "of verified patients"),
    },
    {
      label: "Patients invited",
      value: stats.invitationsSent,
      note: "Sent at least one invitation",
    },
  ];

  const visible = filteredPatients.slice(0, PAGE_LIMIT);

  return (
    <div className="space-y-4">
      {header}

      {loadError && (
        <div className="banner banner-danger" role="alert">
          <span className="flex-1">
            Patient records could not be read from this device, so these
            numbers may be incomplete.
          </span>
          <button type="button" onClick={loadData} className="btn-secondary">
            Try again
          </button>
        </div>
      )}

      <section className="panel" aria-labelledby="portal-stats-title">
        <div className="panel-header">
          <h2 id="portal-stats-title" className="panel-title">
            Portal adoption
          </h2>
          <span className="text-caption text-ink-muted">From this device</span>
        </div>
        <dl className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3">
          {metrics.map((m) => (
            <div key={m.label} className="bg-surface px-4 py-4">
              <dt className="text-caption text-ink-muted">{m.label}</dt>
              <dd className="mt-1 text-stat text-ink tabular-nums">{m.value}</dd>
              <dd className="text-caption text-ink-muted">{m.note}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="panel" aria-labelledby="portal-patients-title">
        <div className="panel-header flex-col items-stretch gap-3 sm:flex-row sm:items-center">
          <h2 id="portal-patients-title" className="panel-title">
            Patients ({filteredPatients.length})
          </h2>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative sm:w-64">
              <label htmlFor="portal-search" className="sr-only">
                Search patients by name, email or phone
              </label>
              <MagnifyingGlassIcon
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
                aria-hidden
              />
              <input
                id="portal-search"
                type="search"
                placeholder="Search name, email or phone"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input-field pl-9"
              />
            </div>
            <div className="flex items-center gap-2">
              <label
                htmlFor="portal-filter"
                className="text-label text-ink-secondary whitespace-nowrap"
              >
                Show
              </label>
              <select
                id="portal-filter"
                value={statusFilter}
                onChange={(e) => {
                  const next: string = e.target.value;
                  if (isPortalFilter(next)) setStatusFilter(next);
                }}
                className="input-field"
              >
                {PORTAL_FILTERS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {patients.length === 0 ? (
          <EmptyState
            icon={UserGroupIcon}
            title="No patients on this device"
            description="Registered patients appear here with their portal status."
          />
        ) : filteredPatients.length === 0 ? (
          <p className="panel-body text-body text-ink-muted">
            No patients match this search or filter.
          </p>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Contact</th>
                    <th scope="col">Portal status</th>
                    <th scope="col">Last portal activity</th>
                    <th scope="col" className="text-right">
                      Invitations
                    </th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((patient) => {
                    const st = PORTAL_STATUS[portalStatusOf(patient)];
                    return (
                      <tr key={patient.id}>
                        <td className="font-medium text-ink">
                          {patient.givenName} {patient.familyName}
                        </td>
                        <td className="text-caption text-ink-secondary">
                          {patient.phone && (
                            <span className="block tabular-nums">{patient.phone}</span>
                          )}
                          {patient.email && <span className="block">{patient.email}</span>}
                          {!patient.phone && !patient.email && (
                            <span className="text-ink-muted">None recorded</span>
                          )}
                        </td>
                        <td>
                          <StatusBadge tone={st.tone} icon>
                            {st.label}
                          </StatusBadge>
                        </td>
                        <td className="text-caption text-ink-muted tabular-nums">
                          {patient.lastPortalActivity
                            ? formatNigerianDate(patient.lastPortalActivity)
                            : "Never"}
                        </td>
                        <td className="text-right tabular-nums">
                          {patient.portalInvitation?.count || 0}
                        </td>
                        <td className="text-right">
                          <Link
                            to={`/patients/${patient.id}`}
                            className="btn-ghost"
                            aria-label={`Open record for ${patient.givenName} ${patient.familyName}`}
                          >
                            Open record
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-line md:hidden">
              {visible.map((patient) => {
                const st = PORTAL_STATUS[portalStatusOf(patient)];
                return (
                  <li key={patient.id}>
                    <Link
                      to={`/patients/${patient.id}`}
                      className="flex min-h-touch-target items-center gap-3 px-4 py-3 hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-ink">
                          {patient.givenName} {patient.familyName}
                        </span>
                        <span className="block text-caption text-ink-muted">
                          {patient.lastPortalActivity
                            ? `Last active ${formatNigerianDate(patient.lastPortalActivity)}`
                            : "No portal activity"}
                          {" · "}
                          {patient.portalInvitation?.count || 0} invitation
                          {(patient.portalInvitation?.count || 0) === 1 ? "" : "s"}
                        </span>
                      </span>
                      <StatusBadge tone={st.tone} icon>
                        {st.label}
                      </StatusBadge>
                    </Link>
                  </li>
                );
              })}
            </ul>

            {filteredPatients.length > PAGE_LIMIT && (
              <p className="border-t border-line px-4 py-3 text-caption text-ink-muted">
                Showing {PAGE_LIMIT} of {filteredPatients.length} patients.
                Search or filter to narrow the list.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
