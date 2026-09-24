/**
 * Bulk enable portal access for patients stored on this device.
 *
 * - Filter patients who have a phone number or email by registration date,
 *   state and contact method
 * - Select patients, confirm, and enable access (optionally sending invitations)
 * - Honest progress and a result summary with each failure's reason
 * - Download a CSV report of the run
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import {
  UserGroupIcon,
  DocumentArrowDownIcon,
} from "@heroicons/react/24/outline";
import { db, type Patient } from "@/db";
import {
  findEligiblePatients,
  bulkEnablePortalAccess,
  type BulkEnableResult,
} from "@/services/portalEnrollment";
import { listPortalAccessCommandsFor } from "@/services/portalAccess";
import { summarizeBulkAccess } from "@/services/portalAccessRules";
import { can } from "@/auth/roles";
import { NIGERIAN_STATES } from "@/utils/nigeria";
import { formatNigerianDate } from "@/utils/dateFormat";
import { useAuthStore } from "@/stores/auth";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge, type Tone } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { ConfirmDialog } from "@/features/admin/ConfirmDialog";
import { canManagePortalEnrollment } from "@/features/admin/adminSections";
import { useServerStatus } from "@/features/admin/useServerStatus";
import type { ServerState } from "@/features/admin/serverStatus";
import {
  buildRunCsv,
  groupFailureReasons,
  type BulkRunError,
  type BulkRunTarget,
} from "@/features/admin/portalStats";

type ContactMethod = "any" | "email" | "phone";

interface MigrationFilters {
  startDate?: string;
  endDate?: string;
  state?: string;
  contactMethod: ContactMethod;
}

interface MigrationRun {
  targets: BulkRunTarget[];
  sendInvitations: boolean;
  /** Whether the server could be reached when the run started. */
  serverAvailable: boolean;
  completed: number;
  successful: number;
  failed: number;
  errors: BulkRunError[];
  /** Patients whose change was saved (followed live for the server's answer). */
  savedIds: string[];
  invitations?: BulkEnableResult["invitations"];
  status: "running" | "done" | "error";
}

const CONTACT_METHODS: { id: ContactMethod; label: string }[] = [
  { id: "any", label: "Phone or email" },
  { id: "email", label: "Has email" },
  { id: "phone", label: "Has phone" },
];

function isContactMethod(value: string): value is ContactMethod {
  return CONTACT_METHODS.some((m) => m.id === value);
}

const SERVER_TONE: Record<ServerState, Tone> = {
  available: "success",
  offline: "warning",
  "not-configured": "neutral",
};

const BREADCRUMBS = [
  { label: "Administration", to: "/admin" },
  { label: "Patient portal", to: "/admin/portal-dashboard" },
  { label: "Enable portal access" },
];

function patientName(p: Pick<Patient, "givenName" | "familyName">) {
  return `${p.givenName} ${p.familyName}`;
}

export function PortalMigration() {
  const role = useAuthStore((s) => s.currentUser?.role);
  // Page rule (administrators) and the portal_manage permission.
  const canRun = canManagePortalEnrollment(role) && !!role && can(role, "portal_manage");
  const server = useServerStatus();

  const [filters, setFilters] = useState<MigrationFilters>({
    contactMethod: "any",
  });
  const [eligiblePatients, setEligiblePatients] = useState<Patient[]>([]);
  const [selectedPatients, setSelectedPatients] = useState<Set<string>>(
    new Set(),
  );
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState<null | { sendInvitations: boolean }>(
    null,
  );
  const [run, setRun] = useState<MigrationRun | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // Follow the server's answers for the patients of the last run.
  const savedIds = useMemo(() => run?.savedIds ?? [], [run?.savedIds]);
  const followed = useLiveQuery(
    async () => {
      if (savedIds.length === 0) return null;
      const [patients, commands] = await Promise.all([
        db.patients.bulkGet(savedIds),
        listPortalAccessCommandsFor(savedIds),
      ]);
      return { patients, commands };
    },
    [savedIds],
    null,
  );
  const accessSummary = useMemo(
    () =>
      followed
        ? summarizeBulkAccess(
            savedIds,
            followed.patients,
            followed.commands,
            server.state !== "not-configured",
          )
        : null,
    [followed, savedIds, server.state],
  );

  const loadEligiblePatients = useCallback(async () => {
    setLoading(true);
    try {
      const patients = await findEligiblePatients({
        // Local midnight: new Date("YYYY-MM-DD") would be UTC midnight
        // (01:00 in Nigeria) and drop patients registered just after midnight.
        startDate: filters.startDate
          ? new Date(`${filters.startDate}T00:00:00`)
          : undefined,
        // Include patients registered on the end date itself.
        endDate: filters.endDate
          ? new Date(`${filters.endDate}T23:59:59.999`)
          : undefined,
        state: filters.state || undefined,
        contactMethod: filters.contactMethod,
      });
      setEligiblePatients(patients);
      setSelectedPatients(new Set());
    } catch (error) {
      console.error(
        "Error loading eligible patients:",
        error instanceof Error ? error.name : error,
      );
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadEligiblePatients();
  }, [loadEligiblePatients]);

  const running = run?.status === "running";
  const allSelected =
    eligiblePatients.length > 0 &&
    selectedPatients.size === eligiblePatients.length;

  const handleSelectAll = () => {
    if (allSelected) {
      setSelectedPatients(new Set());
    } else {
      setSelectedPatients(new Set(eligiblePatients.map((p) => p.id)));
    }
  };

  const handleTogglePatient = (patientId: string) => {
    const newSelected = new Set(selectedPatients);
    if (newSelected.has(patientId)) {
      newSelected.delete(patientId);
    } else {
      newSelected.add(patientId);
    }
    setSelectedPatients(newSelected);
  };

  const handleStartMigration = async (sendInvitations: boolean) => {
    setConfirming(null);
    if (!canRun) return;
    const targets: BulkRunTarget[] = eligiblePatients
      .filter((p) => selectedPatients.has(p.id))
      .map((p) => ({ id: p.id, name: patientName(p) }));
    if (targets.length === 0) return;

    setRun({
      targets,
      sendInvitations,
      serverAvailable: server.available,
      completed: 0,
      successful: 0,
      failed: 0,
      errors: [],
      savedIds: [],
      status: "running",
    });

    try {
      const result = await bulkEnablePortalAccess(
        targets.map((t) => t.id),
        {
          sendInvitations,
          batchSize: 50,
          onProgress: (completed) => {
            setRun((prev) => (prev ? { ...prev, completed } : prev));
          },
        },
      );
      setRun((prev) =>
        prev
          ? {
              ...prev,
              completed: result.success + result.failed,
              successful: result.success,
              failed: result.failed,
              errors: result.errors,
              savedIds: targets
                .map((t) => t.id)
                .filter((id) => !result.errors.some((e) => e.patientId === id)),
              invitations: result.invitations,
              status: "done",
            }
          : prev,
      );
    } catch (error) {
      console.error(
        "Bulk portal enable failed:",
        error instanceof Error ? error.name : error,
      );
      setRun((prev) => (prev ? { ...prev, status: "error" } : prev));
    }

    // Refresh eligible patients list
    await loadEligiblePatients();
    resultRef.current?.focus();
  };

  const handleExportCSV = () => {
    if (!run) return;
    const csv = buildRunCsv(run.targets, run.errors);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `portal-migration-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const total = run?.targets.length ?? 0;
  const progressPercentage =
    run && total > 0 ? Math.round((run.completed / total) * 100) : 0;
  const nameById = new Map(run?.targets.map((t) => [t.id, t.name]) ?? []);
  const selectedCount = selectedPatients.size;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={BREADCRUMBS}
        title="Enable portal access"
        description="Ask the clinic server to turn on patient portal access for patients on this device who have a phone number or email."
      />

      {!canRun && (
        <div className="banner banner-warning" role="status">
          Only an administrator can turn on portal access here. You can view
          this list but not change it.
        </div>
      )}

      <section className="panel" aria-labelledby="migration-filters-title">
        <div className="panel-header">
          <h2 id="migration-filters-title" className="panel-title">
            Which patients
          </h2>
          <span className="text-caption text-ink-muted">
            Patients without portal access who have a phone number or email
          </span>
        </div>
        <div className="panel-body grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="migration-start" className="field-label">
              Registered from
            </label>
            <input
              id="migration-start"
              type="date"
              value={filters.startDate || ""}
              onChange={(e) =>
                setFilters({ ...filters, startDate: e.target.value })
              }
              className="input-field"
            />
          </div>

          <div>
            <label htmlFor="migration-end" className="field-label">
              Registered to
            </label>
            <input
              id="migration-end"
              type="date"
              value={filters.endDate || ""}
              onChange={(e) =>
                setFilters({ ...filters, endDate: e.target.value })
              }
              className="input-field"
            />
          </div>

          <div>
            <label htmlFor="migration-state" className="field-label">
              State
            </label>
            <select
              id="migration-state"
              value={filters.state || ""}
              onChange={(e) =>
                setFilters({ ...filters, state: e.target.value })
              }
              className="input-field"
            >
              <option value="">All states</option>
              {NIGERIAN_STATES.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="migration-contact" className="field-label">
              Contact details
            </label>
            <select
              id="migration-contact"
              value={filters.contactMethod}
              onChange={(e) => {
                const next: string = e.target.value;
                if (isContactMethod(next)) {
                  setFilters({ ...filters, contactMethod: next });
                }
              }}
              className="input-field"
            >
              {CONTACT_METHODS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <div className="card flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-3">
        <span className="section-label">Invitations</span>
        <StatusBadge tone={SERVER_TONE[server.state]} icon>
          {server.label}
        </StatusBadge>
        <span className="text-caption text-ink-muted">
          {server.available
            ? "Invitations are sent by email, or by SMS when a patient has no email."
            : "Invitations need the server and an internet connection. You can still ask for access now; it is sent at the next sync, and invitations can go out from each patient's record once the server confirms."}
        </span>
      </div>

      {/* Progress and results */}
      <div ref={resultRef} tabIndex={-1} aria-live="polite" className="focus:outline-none">
        {run && running && (
          <section className="panel panel-body space-y-2" aria-label="Progress">
            <div className="flex items-center justify-between text-label text-ink">
              <span>
                Enabling portal access: {run.completed} of {total} patients
              </span>
              <span className="tabular-nums">{progressPercentage}%</span>
            </div>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
              role="progressbar"
              aria-label="Portal access progress"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={run.completed}
            >
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
            <p className="text-caption text-ink-muted">
              Keep this page open until it finishes.
            </p>
          </section>
        )}

        {run && run.status === "error" && (
          <div className="banner banner-danger" role="alert">
            The run stopped before it finished. Changes for some patients may
            already be saved on this device and waiting for the server; check
            the list below and try the rest again.
          </div>
        )}

        {run && run.status === "done" && (
          <section className="panel" aria-labelledby="migration-result-title">
            <div className="panel-header">
              <h2 id="migration-result-title" className="panel-title">
                Result
              </h2>
              <button
                type="button"
                onClick={handleExportCSV}
                className="btn-secondary"
              >
                <DocumentArrowDownIcon className="h-5 w-5" aria-hidden />
                Download CSV report
              </button>
            </div>
            <div className="panel-body space-y-3">
              <div
                className={`banner ${run.failed === 0 ? "banner-success" : "banner-warning"}`}
              >
                <p>
                  {`Portal access asked for ${run.successful} of ${plural(total, "patient")}.`}
                  {run.failed > 0 && ` ${run.failed} failed.`}{" "}
                  {server.state === "not-configured"
                    ? "Saved on this device only: no server is connected."
                    : "Saved on this device. The clinic server decides; its answers show below as they arrive."}
                </p>
              </div>
              {accessSummary && server.state !== "not-configured" && (
                <ul className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3" aria-live="polite">
                  <li className="bg-surface-sunken px-3 py-2">
                    <StatusBadge tone="success" icon>
                      Confirmed by the server
                    </StatusBadge>
                    <p className="mt-1 text-label text-ink tabular-nums">
                      {plural(accessSummary.confirmed, "patient")}
                    </p>
                  </li>
                  <li className="bg-surface-sunken px-3 py-2">
                    <StatusBadge tone="warning" icon>
                      Waiting for the server
                    </StatusBadge>
                    <p className="mt-1 text-label text-ink tabular-nums">
                      {plural(accessSummary.waiting, "patient")}
                    </p>
                    {accessSummary.waiting > 0 && (
                      <p className="text-caption text-ink-muted">
                        {server.available
                          ? "Sent again at the next sync if no answer arrives."
                          : "Sent when this device is online and syncs."}
                      </p>
                    )}
                  </li>
                  <li className="bg-surface-sunken px-3 py-2">
                    <StatusBadge tone={accessSummary.refused.length > 0 ? "danger" : "neutral"} icon>
                      Refused by the server
                    </StatusBadge>
                    <p className="mt-1 text-label text-ink tabular-nums">
                      {plural(accessSummary.refused.length, "patient")}
                    </p>
                  </li>
                </ul>
              )}
              {accessSummary && accessSummary.refused.length > 0 && (
                <div>
                  <h3 className="text-label text-ink">Why the server refused</h3>
                  <ul className="mt-1 space-y-1 text-body text-ink-secondary">
                    {groupFailureReasons(
                      accessSummary.refused.map((r) => ({ patientId: r.patientId, error: r.message })),
                    ).map((g) => (
                      <li key={g.reason}>
                        {g.count} × {g.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {run.sendInvitations && (
                <p className="text-body text-ink-secondary">
                  {!run.serverAvailable
                    ? "The server could not be reached when this ran, so no email or SMS was sent. Send invitations from each patient's record once the server has confirmed their access."
                    : run.invitations
                      ? `${plural(run.invitations.sent, "invitation")} sent by email or SMS. ${
                          run.invitations.notSent.length > 0
                            ? `${plural(run.invitations.notSent.length, "patient")} not invited: invitations wait until the server confirms access, and no message went out where the email or SMS service did not confirm it. Send those from each patient's record.`
                            : ""
                        }`
                      : "No invitations were sent."}
                </p>
              )}
              {run.invitations && run.invitations.notSent.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-label text-primary">
                    Show patients not invited
                  </summary>
                  <ul className="mt-2 max-h-64 divide-y divide-line overflow-y-auto rounded-md border border-line">
                    {run.invitations.notSent.map((e) => (
                      <li key={e.patientId} className="px-3 py-2 text-caption">
                        <span className="font-medium text-ink">
                          {nameById.get(e.patientId) ?? e.patientId}
                        </span>
                        <span className="text-ink-muted"> · {e.error}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {run.errors.length > 0 && (
                <div>
                  <h3 className="text-label text-ink">Why patients failed</h3>
                  <ul className="mt-1 space-y-1 text-body text-ink-secondary">
                    {groupFailureReasons(run.errors).map((g) => (
                      <li key={g.reason}>
                        {g.count} × {g.reason}
                      </li>
                    ))}
                  </ul>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-label text-primary">
                      Show each failed patient
                    </summary>
                    <ul className="mt-2 max-h-64 divide-y divide-line overflow-y-auto rounded-md border border-line">
                      {run.errors.map((e) => (
                        <li key={e.patientId} className="px-3 py-2 text-caption">
                          <span className="font-medium text-ink">
                            {nameById.get(e.patientId) ?? e.patientId}
                          </span>
                          <span className="text-ink-muted"> · {e.error}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      {/* Patient List */}
      <section className="panel" aria-labelledby="migration-list-title">
        <div className="panel-header flex-col items-stretch gap-3 lg:flex-row lg:items-center">
          <h2 id="migration-list-title" className="panel-title">
            Eligible patients ({eligiblePatients.length})
            <span className="ml-2 text-caption font-normal text-ink-muted">
              {selectedCount} selected
            </span>
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleSelectAll}
              disabled={eligiblePatients.length === 0 || running}
              className="btn-secondary"
            >
              {allSelected ? "Clear selection" : "Select all"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming({ sendInvitations: false })}
              disabled={!canRun || selectedCount === 0 || running}
              className="btn-secondary"
            >
              Enable access only
            </button>
            <button
              type="button"
              onClick={() => setConfirming({ sendInvitations: true })}
              disabled={
                !canRun || selectedCount === 0 || running || !server.available
              }
              className="btn-primary"
            >
              Enable and send invitations
            </button>
          </div>
        </div>

        {loading ? (
          <div>
            <span role="status" className="sr-only">
              Loading eligible patients
            </span>
            <div className="divide-y divide-line" aria-hidden>
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3">
                  <Skeleton className="h-4 w-4" />
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="ml-auto h-4 w-24" />
                </div>
              ))}
            </div>
          </div>
        ) : eligiblePatients.length === 0 ? (
          <EmptyState
            icon={UserGroupIcon}
            title="No eligible patients"
            description="Every patient matching these filters already has portal access or has no phone number or email. Change the filters or add contact details on a patient's record."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col" className="w-12">
                    <label className="-m-2 flex min-h-touch-target min-w-touch-target cursor-pointer items-center justify-center">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={handleSelectAll}
                        disabled={running}
                        aria-label="Select all eligible patients"
                        className="h-5 w-5 rounded border-line-strong text-primary focus:ring-primary"
                      />
                    </label>
                  </th>
                  <th scope="col">Name</th>
                  <th scope="col" className="hidden md:table-cell">
                    Date of birth
                  </th>
                  <th scope="col">Phone</th>
                  <th scope="col" className="hidden md:table-cell">
                    Email
                  </th>
                  <th scope="col" className="hidden lg:table-cell">
                    State
                  </th>
                  <th scope="col" className="hidden lg:table-cell">
                    Registered
                  </th>
                </tr>
              </thead>
              <tbody>
                {eligiblePatients.map((patient) => (
                  <tr key={patient.id}>
                    <td>
                      <label className="-m-2 flex min-h-touch-target min-w-touch-target cursor-pointer items-center justify-center">
                        <input
                          type="checkbox"
                          checked={selectedPatients.has(patient.id)}
                          onChange={() => handleTogglePatient(patient.id)}
                          disabled={running}
                          aria-label={`Select ${patientName(patient)}`}
                          className="h-5 w-5 rounded border-line-strong text-primary focus:ring-primary"
                        />
                      </label>
                    </td>
                    <td>
                      <Link
                        to={`/patients/${patient.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {patientName(patient)}
                      </Link>
                    </td>
                    <td className="hidden text-ink-secondary tabular-nums md:table-cell">
                      {formatNigerianDate(patient.dob) || patient.dob}
                    </td>
                    <td className="text-ink-secondary tabular-nums">
                      {patient.phone || "None"}
                    </td>
                    <td className="hidden text-ink-secondary md:table-cell">
                      {patient.email || "None"}
                    </td>
                    <td className="hidden text-ink-secondary lg:table-cell">
                      {patient.state}
                    </td>
                    <td className="hidden text-ink-secondary tabular-nums lg:table-cell">
                      {formatNigerianDate(patient.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={!!confirming}
        title={
          confirming?.sendInvitations
            ? `Enable portal access and invite ${plural(selectedCount, "patient")}?`
            : `Enable portal access for ${plural(selectedCount, "patient")}?`
        }
        confirmLabel={
          confirming?.sendInvitations
            ? `Enable and invite ${selectedCount}`
            : `Enable access for ${selectedCount}`
        }
        onConfirm={() => handleStartMigration(!!confirming?.sendInvitations)}
        onCancel={() => setConfirming(null)}
      >
        <p>
          Portal access is asked for {plural(selectedCount, "patient")}
          {server.state === "not-configured"
            ? " on this device. No server is connected, so nothing is uploaded and patients cannot use the online portal until one is."
            : ". The change is saved on this device and sent to the clinic server, which confirms it (or refuses it, for example when access was turned off there more recently). Patients can use the portal once the server confirms."}
        </p>
        {confirming?.sendInvitations && (
          <p>
            Invitations go only to patients whose access the server has
            confirmed: by email, or by SMS if they have no email. Patients
            invited very recently are not sent another.
          </p>
        )}
        <p className="font-medium text-ink">
          Only continue if these patients agreed to use the portal. This tool
          does not ask them.
        </p>
      </ConfirmDialog>
    </div>
  );
}
