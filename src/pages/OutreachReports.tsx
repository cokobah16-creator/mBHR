import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowDownTrayIcon,
  CalendarDaysIcon,
  UsersIcon,
  ShieldExclamationIcon,
  ArrowUturnRightIcon,
  MapPinIcon,
  PlusIcon,
  ChevronDownIcon,
  ClipboardDocumentCheckIcon,
  BeakerIcon,
  UserGroupIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { db, Site, Visit, Vital, Dispense, generateId } from "@/db";
import { isSupabaseEnabled } from "@/lib/supabaseClient";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/stores/toast";
import { addSite, setSiteActive } from "@/services/sites";
import {
  getOutreachSummary,
  listOutreachSites,
  summaryToCsvRows,
  OutreachSummary,
} from "@/services/outreachReports";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatNigerianDate } from "@/utils/dateFormat";
import { StatTile } from "@/features/reports/StatTile";
import { BarList } from "@/features/reports/BarList";
import { DataScopeNote } from "@/features/reports/DataScopeNote";
import { useCsvExport } from "@/features/reports/useCsvExport";
import { loadTextKeyedInRange } from "@/features/reports/localRecords";
import {
  addLocalDays,
  csvFileName,
  localDateKey,
  localRangeBounds,
} from "@/features/reports/reportUtils";

const SITE_ERROR_ID = "site-save-error";
const SITE_HINT_ID = "site-hint";

/** "23/09/2026 · All sites" or "01/09/2026 – 23/09/2026 · Ikeja". */
function describeScope(start: Date, endExclusive: Date, site?: string): string {
  const last = addLocalDays(endExclusive, -1);
  const range =
    localDateKey(start) === localDateKey(last)
      ? formatNigerianDate(start)
      : `${formatNigerianDate(start)} – ${formatNigerianDate(last)}`;
  return `${range} · ${site || "All sites"}`;
}

export default function OutreachReports() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const isAdmin = currentUser?.role === "admin";
  const push = useToast((s) => s.push);
  const exportCsv = useCsvExport();
  const [startInput, setStartInput] = useState<string>(() => localDateKey(new Date()));
  const [endInput, setEndInput] = useState<string>(() => localDateKey(new Date()));
  const [siteName, setSiteName] = useState<string>("");
  const [sites, setSites] = useState<string[]>([]);
  const [summary, setSummary] = useState<OutreachSummary | null>(null);
  // Records in the chosen period that the summary service could not read.
  const [uncounted, setUncounted] = useState<{ visits: number; other: boolean }>({
    visits: 0,
    other: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [showSiteAdmin, setShowSiteAdmin] = useState(false);
  const [newSiteName, setNewSiteName] = useState("");
  const [siteSaveError, setSiteSaveError] = useState("");
  const [savingSite, setSavingSite] = useState(false);

  const registrySitesQuery = useLiveQuery(
    () => db.sites.orderBy("name").toArray(),
    [],
  );
  const registrySites: Site[] = useMemo(
    () => registrySitesQuery ?? [],
    [registrySitesQuery],
  );

  // Null when the dates are missing or the start is after the end.
  const bounds = useMemo(
    () => localRangeBounds(startInput, endInput),
    [startInput, endInput],
  );
  const boundsStart = bounds?.start.getTime();
  const boundsEnd = bounds?.end.getTime();

  useEffect(() => {
    listOutreachSites()
      .then(setSites)
      .catch(() => setSites([]));
    // Re-run whenever the registry changes so the dropdown stays in sync.
  }, [registrySites]);

  const handleAddSite = async () => {
    setSiteSaveError("");
    // Site registry changes are admin-only; checked here, not just by hiding the form.
    if (currentUser?.role !== "admin") {
      setSiteSaveError("Only administrators can add outreach sites.");
      return;
    }
    const name = newSiteName.trim();
    if (!name) {
      setSiteSaveError("Enter a site name.");
      return;
    }
    setSavingSite(true);
    try {
      const site = await addSite(name);
      setNewSiteName("");
      push({
        id: generateId(),
        tone: "success",
        title: "Site saved on this device",
        body: `${site.name} is available in the site list.`,
      });
    } catch (err) {
      console.error("Could not add site:", err instanceof Error ? err.name : err);
      setSiteSaveError(
        err instanceof Error && err.message === "Site name is required"
          ? "Enter a site name."
          : "The site was not saved. Try again.",
      );
    } finally {
      setSavingSite(false);
    }
  };

  const handleToggleSiteActive = async (site: Site, active: boolean) => {
    if (currentUser?.role !== "admin") {
      setSiteSaveError("Only administrators can change outreach sites.");
      return;
    }
    setSiteSaveError("");
    try {
      await setSiteActive(site.id, active);
      push({
        id: generateId(),
        tone: "success",
        title: active ? "Site enabled" : "Site disabled",
        body: active
          ? `${site.name} can be chosen for new visits again.`
          : `${site.name} is hidden from the site list. Past visits keep it.`,
      });
    } catch (err) {
      console.error("Could not update site:", err instanceof Error ? err.name : err);
      setSiteSaveError(`${site.name} was not updated. Try again.`);
    }
  };

  useEffect(() => {
    if (boundsStart === undefined || boundsEnd === undefined) {
      setSummary(null);
      setUncounted({ visits: 0, other: false });
      setLoading(false);
      return;
    }
    let cancelled = false;
    const start = new Date(boundsStart);
    const end = new Date(boundsEnd);
    const site = siteName || undefined;
    setLoading(true);
    setError("");
    Promise.all([
      getOutreachSummary({ start, end, siteName: site }),
      // The summary service selects visits, vitals and dispensing with Date
      // ranges, which skip records whose time is stored as text (records
      // written by sync). Find those so the page can say what it left out
      // instead of silently under-reporting. Best effort only.
      Promise.all([
        loadTextKeyedInRange<Visit>(db.visits, "startedAt", start, end),
        loadTextKeyedInRange<Vital>(db.vitals, "takenAt", start, end),
        loadTextKeyedInRange<Dispense>(db.dispenses, "dispensedAt", start, end),
      ]).catch(() => null),
    ])
      .then(([s, missed]) => {
        if (cancelled) return;
        setSummary(s);
        if (!missed) {
          setUncounted({ visits: 0, other: false });
          return;
        }
        const [visits, vitals, dispenses] = missed;
        setUncounted({
          visits: (site ? visits.filter((v) => v.siteName === site) : visits).length,
          other: vitals.length + dispenses.length > 0,
        });
      })
      .catch((err) => {
        if (!cancelled) {
          console.error(
            "Outreach summary failed:",
            err instanceof Error ? err.name : err,
          );
          setError("The report could not be built from the records on this device. Try again, or choose a shorter period.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [boundsStart, boundsEnd, siteName]);

  // Label the figures on screen with the period they were built for, which
  // can differ from the inputs while a new report loads or after it fails.
  const scopeLabel = summary
    ? describeScope(summary.filters.start, summary.filters.end, summary.filters.siteName)
    : bounds
      ? describeScope(bounds.start, bounds.end, siteName)
      : "";
  // The summary service cannot read records downloaded by sync (see
  // `uncounted`), so it must not claim to include them.
  const scopeText = isSupabaseEnabled
    ? "Counts records stored on this device. Anything not yet synced to this device is not counted."
    : undefined;

  const handleExport = () => {
    if (!summary) return;
    // The service writes range dates in UTC, which reads as the previous
    // day in Nigeria; write the local dates the report actually covers.
    const rows = summaryToCsvRows(summary).map((row) => {
      if (row.metric === "Date range start") {
        return { ...row, value: localDateKey(summary.filters.start) };
      }
      if (row.metric === "Date range end (exclusive)") {
        return { ...row, value: localDateKey(summary.filters.end) };
      }
      return row;
    });
    if (uncounted.visits > 0) {
      rows.push({
        metric: "Visits in period not counted above (downloaded by sync)",
        value: uncounted.visits,
      });
    }
    if (uncounted.other) {
      rows.push({
        metric: "Vitals or dispensing records in period not counted above (downloaded by sync)",
        value: "yes",
      });
    }
    exportCsv(
      "outreach summary",
      csvFileName("outreach_summary"),
      ["metric", "value"],
      rows.map((r) => [r.metric, r.value]),
    );
  };

  const totalAge = summary
    ? Object.values(summary.ageBands).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title="Outreach summary"
        description="Patients seen, demographics, conditions, dispensing, referrals and staff activity for an outreach period."
        breadcrumbs={[{ label: "Dashboard", to: "/dashboard" }, { label: "Outreach summary" }]}
        actions={
          <button
            type="button"
            onClick={handleExport}
            disabled={!summary || summary.visits === 0 || loading}
            className="btn-secondary"
          >
            <ArrowDownTrayIcon className="h-4 w-4" aria-hidden />
            Export CSV
          </button>
        }
      />

      {/* Filters */}
      <section className="panel" aria-label="Report filters">
        <div className="panel-body grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="from" className="field-label">
              From
            </label>
            <input
              id="from"
              type="date"
              value={startInput}
              max={endInput}
              onChange={(e) => setStartInput(e.target.value)}
              className="input-field"
              aria-invalid={!bounds}
              aria-describedby={!bounds ? "range-error" : undefined}
            />
          </div>
          <div>
            <label htmlFor="to" className="field-label">
              To (inclusive)
            </label>
            <input
              id="to"
              type="date"
              value={endInput}
              min={startInput}
              onChange={(e) => setEndInput(e.target.value)}
              className="input-field"
              aria-invalid={!bounds}
              aria-describedby={!bounds ? "range-error" : undefined}
            />
          </div>
          <div>
            <label htmlFor="site" className="field-label">
              Site
            </label>
            <select
              id="site"
              value={siteName}
              onChange={(e) => setSiteName(e.target.value)}
              className="input-field"
            >
              <option value="">All sites</option>
              {sites.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          {!bounds && (
            <p id="range-error" className="field-error sm:col-span-3" role="alert">
              Choose a start date on or before the end date.
            </p>
          )}
        </div>
      </section>

      {isAdmin && (
        <section className="panel">
          <button
            type="button"
            onClick={() => setShowSiteAdmin((v) => !v)}
            aria-expanded={showSiteAdmin}
            aria-controls="site-admin"
            className="flex min-h-touch-target w-full items-center justify-between gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className="flex items-center gap-2 text-label text-ink">
              <MapPinIcon className="h-4 w-4 text-ink-muted" aria-hidden />
              Manage outreach sites
              <span className="text-caption text-ink-muted">
                ({registrySites.length} registered)
              </span>
            </span>
            <ChevronDownIcon
              className={`h-4 w-4 text-ink-muted transition-transform ${showSiteAdmin ? "rotate-180" : ""}`}
              aria-hidden
            />
          </button>

          {showSiteAdmin && (
            <div id="site-admin" className="space-y-3 border-t border-line p-4">
              <form
                className="flex flex-col gap-2 sm:flex-row sm:items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleAddSite();
                }}
              >
                <div className="flex-1">
                  <label htmlFor="new-site-name" className="field-label">
                    New site name
                  </label>
                  <input
                    id="new-site-name"
                    type="text"
                    value={newSiteName}
                    onChange={(e) => setNewSiteName(e.target.value)}
                    placeholder="e.g. Lagos Outreach 2026"
                    className="input-field"
                    aria-invalid={!!siteSaveError}
                    aria-describedby={siteSaveError ? SITE_ERROR_ID : SITE_HINT_ID}
                  />
                </div>
                <button
                  type="submit"
                  disabled={!newSiteName.trim() || savingSite}
                  className="btn-primary"
                >
                  <PlusIcon className="h-4 w-4" aria-hidden />
                  {savingSite ? "Saving…" : "Add site"}
                </button>
              </form>
              {siteSaveError ? (
                <p id={SITE_ERROR_ID} className="field-error" role="alert">
                  {siteSaveError}
                </p>
              ) : (
                <p id={SITE_HINT_ID} className="field-hint">
                  Sites are saved on this device.
                </p>
              )}
              {registrySites.length === 0 ? (
                <p className="text-body text-ink-muted">
                  No sites registered yet. Visits started without a registry
                  entry still appear in the site list above under the site
                  name on the visit.
                </p>
              ) : (
                <ul className="divide-y divide-line rounded-md border border-line">
                  {registrySites.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between gap-3 px-3 py-1"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-body text-ink">{s.name}</span>
                        <StatusBadge tone={s.active === 1 ? "success" : "neutral"} icon>
                          {s.active === 1 ? "Active" : "Disabled"}
                        </StatusBadge>
                      </span>
                      <button
                        type="button"
                        onClick={() => handleToggleSiteActive(s, s.active !== 1)}
                        className="btn-ghost text-label"
                        aria-label={`${s.active === 1 ? "Disable" : "Enable"} ${s.name}`}
                      >
                        {s.active === 1 ? "Disable" : "Enable"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}

      {error && (
        <div className="banner banner-danger" role="alert">
          {error}
        </div>
      )}

      {(summary || bounds) && <DataScopeNote period={scopeLabel} scope={scopeText} />}

      {summary && (uncounted.visits > 0 || uncounted.other) && (
        <div className="banner banner-warning" role="status">
          <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
          <p>
            {uncounted.visits > 0
              ? `${uncounted.visits.toLocaleString("en-NG")} ${uncounted.visits === 1 ? "visit in this period is" : "visits in this period are"} stored on this device but not counted below.`
              : "Some vitals or dispensing records in this period are stored on this device but may not be counted below."}{" "}
            They were saved by sync in a form this summary cannot read yet, so
            the figures below may be too low.
          </p>
        </div>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {loading ? "Updating the report" : summary ? "Report updated" : ""}
      </p>

      {loading && !summary && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="panel space-y-2 p-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-8 w-14" />
            </div>
          ))}
        </div>
      )}

      {summary && bounds && summary.visits === 0 && uncounted.visits === 0 && !loading && (
        <div className="panel">
          <EmptyState
            icon={CalendarDaysIcon}
            title="No visits recorded for this period"
            description="Choose a different date range or site. Visits from other devices only count here once they have synced to this device."
          />
        </div>
      )}

      {summary && bounds && summary.visits > 0 && (
        <div className={`space-y-4 ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
          {/* Headline figures */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="Patients seen"
              value={summary.patientsSeen.toLocaleString("en-NG")}
              hint="Different patients with a visit"
              icon={UsersIcon}
            />
            <StatTile
              label="Visits"
              value={summary.visits.toLocaleString("en-NG")}
              hint="Visits started in the period"
              icon={CalendarDaysIcon}
            />
            <StatTile
              label="Patients with flagged vitals"
              value={summary.highRiskCases.toLocaleString("en-NG")}
              hint="At least one abnormal reading flagged"
              icon={ShieldExclamationIcon}
            />
            <StatTile
              label="Referrals"
              value={summary.referrals.toLocaleString("en-NG")}
              hint="Marked referred; older notes counted if the plan mentions a referral"
              icon={ArrowUturnRightIcon}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ReportSection title="Sex" icon={UsersIcon}>
              <BarList
                label="Patients by sex"
                scale="share"
                total={summary.patientsSeen}
                items={[
                  { key: "female", label: "Female", value: summary.gender.female },
                  { key: "male", label: "Male", value: summary.gender.male },
                  {
                    key: "other",
                    label: "Other or not recorded",
                    value: summary.gender.other + summary.gender.unknown,
                  },
                ]}
              />
            </ReportSection>

            <ReportSection title="Age bands" icon={UsersIcon} note="Age at the end of the period">
              <BarList
                label="Patients by age band"
                scale="share"
                total={totalAge}
                items={Object.entries(summary.ageBands).map(([band, count]) => ({
                  key: band,
                  label: band === "unknown" ? "Date of birth not recorded" : `${band} years`,
                  value: count,
                }))}
              />
            </ReportSection>

            <ReportSection
              title="Common conditions"
              icon={ClipboardDocumentCheckIcon}
              note="Provisional diagnoses, top 20"
            >
              {summary.conditions.length === 0 ? (
                <p className="text-body text-ink-muted">No diagnoses recorded for this period.</p>
              ) : (
                <BarList
                  label="Diagnoses by number of consultations"
                  scale="max"
                  items={summary.conditions.map((c) => ({
                    key: c.diagnosis,
                    label: c.diagnosis,
                    value: c.count,
                  }))}
                />
              )}
            </ReportSection>

            <ReportSection title="Medicines dispensed" icon={BeakerIcon} note="Units, top 20">
              {summary.medicines.length === 0 ? (
                <p className="text-body text-ink-muted">No dispensing recorded for this period.</p>
              ) : (
                <BarList
                  label="Units dispensed per medicine"
                  scale="max"
                  items={summary.medicines.map((m) => ({
                    key: m.name,
                    label: m.name,
                    value: m.unitsDispensed,
                    detail: `units (${m.events} ${m.events === 1 ? "record" : "records"})`,
                  }))}
                />
              )}
            </ReportSection>

            <ReportSection
              title="Staff activity"
              icon={UserGroupIcon}
              note="Queue steps started or finished by each person"
              fullWidth
            >
              {summary.volunteers.length === 0 ? (
                <p className="text-body text-ink-muted">No staff activity recorded for this period.</p>
              ) : (
                <div className="-mx-4 -mb-4 overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">Name</th>
                        <th scope="col">Role</th>
                        <th scope="col" className="text-right">
                          Queue steps
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.volunteers.map((v) => (
                        <tr key={v.actorId}>
                          <td>{v.fullName}</td>
                          <td className="capitalize text-ink-secondary">{v.role.replace("_", " ")}</td>
                          <td className="text-right tabular-nums">{v.events.toLocaleString("en-NG")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </ReportSection>
          </div>
        </div>
      )}
    </div>
  );
}

function ReportSection({
  title,
  icon: Icon,
  note,
  children,
  fullWidth = false,
}: {
  title: string;
  icon: typeof UsersIcon;
  note?: string;
  children: ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <section className={`panel ${fullWidth ? "lg:col-span-2" : ""}`}>
      <div className="panel-header">
        <h2 className="panel-title flex items-center gap-2">
          <Icon className="h-5 w-5 text-ink-muted" aria-hidden />
          {title}
        </h2>
        {note && <span className="text-caption text-ink-muted">{note}</span>}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}
