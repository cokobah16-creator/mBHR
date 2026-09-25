import { useCallback, useEffect, useRef, useState } from "react";
import { UserPlusIcon, CloudIcon } from "@heroicons/react/24/outline";
import { supabase } from "@/lib/supabase";
import { bulkEnrollPatients } from "@/services/unifiedPortalEnrollment";
import { useAuthStore } from "@/stores/auth";
import { formatNigerianDate } from "@/utils/dateFormat";
import { ADULT_AGE, isMinor } from "@/utils/patient";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge, type Tone } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { ConfirmDialog } from "@/features/admin/ConfirmDialog";
import { canManagePortalEnrollment } from "@/features/admin/adminSections";
import { useServerStatus } from "@/features/admin/useServerStatus";
import type { ServerState } from "@/features/admin/serverStatus";
import {
  groupFailureReasons,
  type BulkRunError,
} from "@/features/admin/portalStats";

/** A row of the server's `patients` table, as selected below. */
interface ServerPatientRow {
  id: string;
  given_name: string;
  family_name: string;
  dob: string;
  email: string | null;
  phone: string | null;
  portal_enabled: boolean | null;
}

interface EnrollmentResult {
  total: number;
  success: number;
  failed: number;
  errors: BulkRunError[];
  names: Map<string, string>;
}

const SERVER_LIMIT = 100;

const SERVER_TONE: Record<ServerState, Tone> = {
  available: "success",
  offline: "warning",
  "not-configured": "neutral",
};

const BREADCRUMBS = [
  { label: "Administration", to: "/admin" },
  { label: "Patient portal", to: "/admin/portal-dashboard" },
  { label: "Create server accounts" },
];

function rowName(p: ServerPatientRow) {
  return `${p.given_name} ${p.family_name}`;
}

/** A date as YYYY-MM-DD on this device's calendar (the rule isMinor uses). */
function localYmd(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function BulkPortalMigration() {
  const role = useAuthStore((s) => s.currentUser?.role);
  const canRun = canManagePortalEnrollment(role);
  const server = useServerStatus();

  const [patients, setPatients] = useState<ServerPatientRow[]>([]);
  const [selectedPatients, setSelectedPatients] = useState<Set<string>>(
    new Set(),
  );
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [runError, setRunError] = useState(false);
  const [results, setResults] = useState<EnrollmentResult | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const loadEligiblePatients = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setLoadError(false);
    try {
      const now = new Date();
      const today = localYmd(now);
      // Born on or before this day: 18 or older today.
      const adultCutoff = localYmd(
        new Date(now.getFullYear() - ADULT_AGE, now.getMonth(), now.getDate()),
      );
      const { data, error } = await supabase
        .from("patients")
        .select(
          "id, given_name, family_name, dob, email, phone, portal_enabled",
        )
        .or("email.not.is.null,phone.not.is.null")
        // Children never get portal accounts, so leave them out before the
        // limit or they would fill the list for good. Keep a missing or
        // future date of birth: isMinor treats those as "needs review".
        // (Each .or() is its own filter; the server ANDs them.)
        .or(`dob.is.null,dob.lte.${adultCutoff},dob.gt.${today}`)
        .eq("portal_enabled", false)
        .order("created_at", { ascending: false })
        .limit(SERVER_LIMIT);

      if (error) throw error;
      // Portal accounts are for adults: children are not listed, and
      // bulkEnrollPatients refuses them. This check also catches the one
      // day (29 February) when the cutoff above is a day too late.
      const rows = (data as ServerPatientRow[] | null) || [];
      setPatients(rows.filter((p) => isMinor(p.dob) !== true));
      setLoaded(true);
    } catch (error) {
      console.error(
        "Error loading patients:",
        error instanceof Error ? error.name : "request failed",
      );
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load once the server can be reached (and again if it comes back after
  // being offline and nothing has loaded yet).
  useEffect(() => {
    if (server.available && !loaded) loadEligiblePatients();
  }, [server.available, loaded, loadEligiblePatients]);

  const togglePatient = (patientId: string) => {
    const newSelected = new Set(selectedPatients);
    if (newSelected.has(patientId)) {
      newSelected.delete(patientId);
    } else {
      newSelected.add(patientId);
    }
    setSelectedPatients(newSelected);
  };

  const selectAll = () => {
    setSelectedPatients(new Set(patients.map((p) => p.id)));
  };

  const deselectAll = () => {
    setSelectedPatients(new Set());
  };

  const handleBulkEnroll = async () => {
    setConfirming(false);
    if (!canRun || selectedPatients.size === 0 || !server.available) return;

    const ids = Array.from(selectedPatients);
    const names = new Map(
      patients.filter((p) => selectedPatients.has(p.id)).map((p) => [p.id, rowName(p)]),
    );
    setProcessing(true);
    setRunError(false);
    setResults(null);
    try {
      const result = await bulkEnrollPatients(ids);
      setResults({ total: ids.length, ...result, names });
      setSelectedPatients(new Set());
      if (result.success > 0) await loadEligiblePatients();
    } catch (error) {
      console.error(
        "Bulk enrollment error:",
        error instanceof Error ? error.name : error,
      );
      setRunError(true);
    } finally {
      setProcessing(false);
      resultRef.current?.focus();
    }
  };

  const count = selectedPatients.size;
  const plural = (n: number) => `${n} patient${n === 1 ? "" : "s"}`;

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={BREADCRUMBS}
        title="Create portal accounts on the server"
        description="Create patient portal sign-in accounts for patients in the server database who have an email or phone number."
      />

      <div className="card flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-3" aria-live="polite">
        <span className="section-label">Server connection</span>
        <StatusBadge tone={SERVER_TONE[server.state]} icon>
          {server.label}
        </StatusBadge>
        <span className="text-caption text-ink-muted">
          {server.available
            ? "This page works on the server's patient records, not the records stored on this device."
            : server.state === "offline"
              ? "Connect to the internet to load patients from the server. Nothing on this page works offline."
              : "This device is not connected to a server, so portal accounts cannot be created here."}
        </span>
      </div>

      {!canRun && (
        <div className="banner banner-warning" role="status">
          Only an administrator can create portal accounts.
        </div>
      )}

      <div ref={resultRef} tabIndex={-1} aria-live="polite" className="focus:outline-none">
        {runError && (
          <div className="banner banner-danger" role="alert">
            <span className="flex-1">
              The server did not finish creating accounts. Some may have been
              created; reload the list and try the remaining patients again.
            </span>
            <button
              type="button"
              onClick={loadEligiblePatients}
              disabled={loading || !server.available}
              className="btn-secondary"
            >
              Reload list
            </button>
          </div>
        )}
        {results && (
          <section className="panel" aria-labelledby="enroll-result-title">
            <div className="panel-header">
              <h2 id="enroll-result-title" className="panel-title">
                Result
              </h2>
            </div>
            <div className="panel-body space-y-3">
              <div
                className={`banner ${results.failed === 0 ? "banner-success" : "banner-warning"}`}
              >
                <p>
                  {/* The service also counts a patient who already had a
                      portal account as a success, so do not say "created". */}
                  Portal account ready on the server for {results.success} of{" "}
                  {plural(results.total)}.
                  {results.failed > 0 && ` ${results.failed} failed.`} No
                  invitation was sent: tell patients to register at the patient
                  portal with their email address, or sign in if they already
                  have an account.
                </p>
              </div>
              {results.errors.length > 0 && (
                <div>
                  <h3 className="text-label text-ink">Why patients failed</h3>
                  <ul className="mt-1 space-y-1 text-body text-ink-secondary">
                    {groupFailureReasons(results.errors).map((g) => (
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
                      {results.errors.map((err) => (
                        <li key={err.patientId} className="px-3 py-2 text-caption">
                          <span className="font-medium text-ink">
                            {results.names.get(err.patientId) ?? err.patientId}
                          </span>
                          <span className="text-ink-muted"> · {err.error}</span>
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

      <section className="panel" aria-labelledby="enroll-list-title">
        <div className="panel-header flex-col items-stretch gap-3 sm:flex-row sm:items-center">
          <div>
            <h2 id="enroll-list-title" className="panel-title">
              Patients without portal accounts
            </h2>
            <p className="text-caption text-ink-muted">
              {count} of {plural(patients.length)} selected. Shows up to{" "}
              {SERVER_LIMIT}, newest first.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={selectAll}
              className="btn-secondary"
              disabled={loading || processing || patients.length === 0}
            >
              Select all
            </button>
            <button
              type="button"
              onClick={deselectAll}
              className="btn-secondary"
              disabled={loading || processing || count === 0}
            >
              Clear selection
            </button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={!canRun || count === 0 || processing || !server.available}
              className="btn-primary"
            >
              <UserPlusIcon className="h-5 w-5" aria-hidden />
              {processing ? "Creating accounts…" : `Create ${count} account${count === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>

        {!server.available ? (
          <EmptyState
            icon={CloudIcon}
            title={
              server.state === "offline"
                ? "Not available offline"
                : "No server connected"
            }
            description={server.detail}
          />
        ) : loading ? (
          <div>
            <span role="status" className="sr-only">
              Loading patients from the server
            </span>
            <div className="divide-y divide-line" aria-hidden>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3">
                  <Skeleton className="h-5 w-5" />
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="ml-auto h-4 w-24" />
                </div>
              ))}
            </div>
          </div>
        ) : loadError ? (
          <div className="panel-body">
            <div className="banner banner-danger" role="alert">
              <span className="flex-1">
                Patients could not be loaded from the server.
              </span>
              <button
                type="button"
                onClick={loadEligiblePatients}
                className="btn-secondary"
              >
                Try again
              </button>
            </div>
          </div>
        ) : patients.length === 0 ? (
          <EmptyState
            icon={UserPlusIcon}
            title="No patients waiting for a portal account"
            description="Every patient on the server with an email or phone number already has portal access or is under 18."
          />
        ) : (
          <ul className="divide-y divide-line">
            {patients.map((patient) => {
              const inputId = `enroll-${patient.id}`;
              return (
                <li key={patient.id}>
                  <label
                    htmlFor={inputId}
                    className="flex min-h-touch-target cursor-pointer items-start gap-3 px-4 py-3 hover:bg-surface-hover"
                  >
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={selectedPatients.has(patient.id)}
                      onChange={() => togglePatient(patient.id)}
                      disabled={processing}
                      className="mt-0.5 h-5 w-5 rounded border-line-strong text-primary focus:ring-primary"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-ink">
                        {rowName(patient)}
                      </span>
                      <span className="block text-caption text-ink-muted">
                        Date of birth{" "}
                        {formatNigerianDate(patient.dob) || patient.dob}
                      </span>
                      <span className="block text-caption text-ink-secondary">
                        {[
                          patient.email && `Email: ${patient.email}`,
                          patient.phone && `Phone: ${patient.phone}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="panel" aria-labelledby="enroll-how-title">
        <div className="panel-header">
          <h2 id="enroll-how-title" className="panel-title">
            How it works
          </h2>
        </div>
        <ul className="panel-body list-disc space-y-1 pl-9 text-body text-ink-secondary">
          <li>Select patients who should have portal access.</li>
          <li>A portal account is created on the server for each one.</li>
          <li>
            Patients register at the patient portal with their email address,
            then sign in with their email and password.
          </li>
          <li>Only patients with an email or phone number can be enrolled.</li>
          <li>
            Patients under 18 are not listed: portal accounts are for adults.
          </li>
          <li>
            Patients whose email or phone number is already registered in the
            portal are skipped and listed as failed.
          </li>
        </ul>
      </section>

      <ConfirmDialog
        open={confirming}
        title={`Create portal accounts for ${plural(count)}?`}
        confirmLabel={`Create ${count} account${count === 1 ? "" : "s"}`}
        onConfirm={handleBulkEnroll}
        onCancel={() => setConfirming(false)}
      >
        <p>
          A portal account is created on the server for each selected patient,
          and their server record is marked as portal-enabled.
        </p>
        <p>
          No invitation is sent. Patients whose email or phone number is already
          registered are skipped.
        </p>
        <p className="font-medium text-ink">
          Only continue if these patients agreed to use the portal.
        </p>
      </ConfirmDialog>
    </div>
  );
}
