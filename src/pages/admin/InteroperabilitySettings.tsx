import { useCallback, useEffect, useState } from "react";
import { ArrowPathIcon, InformationCircleIcon } from "@heroicons/react/24/outline";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { supabase } from "@/lib/supabaseClient";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useCloudSession } from "@/lib/cloudSession";
import { useAuthStore } from "@/stores/auth";
import { can, getRoleDisplayName, type Role } from "@/auth/roles";
import { formatNigerianDateTime } from "@/utils/dateFormat";
import type { InteropRpcClient, RpcFailure } from "@/services/interopRpc";
import {
  describeFlags,
  fetchMetadataSummary,
  loadAdminStatus,
  reasonLabel,
  type AdminStatus,
  type AuditRow,
  type FetchLike,
  type InterfaceState,
  type MetadataSummary,
} from "@/services/interopStatus";

interface Props {
  /** For tests: the client to call (defaults to the app's Supabase client). */
  client?: InteropRpcClient | null;
  /** For tests: fetch (defaults to window.fetch). */
  fetchImpl?: FetchLike | null;
  /** For tests: the site origin (defaults to window.location.origin). */
  origin?: string;
}

type ActivityState =
  | { kind: "loading" }
  | { kind: "ready"; data: AdminStatus }
  | { kind: "unavailable"; reason: RpcFailure | "not_signed_in" };

const STATE_LABEL: Record<InterfaceState, string> = {
  on: "On",
  off: "Off",
  unavailable: "Not responding",
  unknown: "Unknown",
  offline: "Unknown (offline)",
};

function activityMessage(reason: RpcFailure | "not_signed_in"): string {
  switch (reason) {
    case "missing":
      return "Request history is not available on this server yet.";
    case "offline":
      return "You are offline. Request history needs an internet connection.";
    case "not_signed_in":
    case "signed_out":
      return "Sign in online to see request history.";
    case "denied":
      return "Your account cannot see request history.";
    default:
      return "Request history could not be loaded. Try again later.";
  }
}

/** Only roles the server lets read the status (audit_access or users). */
function canSeeInteropActivity(role: Role | null | undefined): boolean {
  if (!role) return false;
  return can(role, "audit_access") || can(role, "users");
}

function roleLabel(role: string | null): string {
  if (!role) return "";
  return getRoleDisplayName(role as Role);
}

function Count({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <dt className="text-caption text-ink-muted">{label}</dt>
      <dd className="text-h3 text-ink tabular-nums">{value === null ? "–" : value}</dd>
    </div>
  );
}

function AuditTable({ title, rows, empty }: { title: string; rows: AuditRow[]; empty: string }) {
  return (
    <div>
      <h3 className="text-body font-medium text-ink">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-1 text-body text-ink-secondary">{empty}</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full text-caption">
            <thead>
              <tr className="text-left text-ink-muted">
                <th scope="col" className="py-1 pr-3 font-medium">Time</th>
                <th scope="col" className="py-1 pr-3 font-medium">Resource</th>
                <th scope="col" className="py-1 pr-3 font-medium">Action</th>
                <th scope="col" className="py-1 pr-3 font-medium">Decision</th>
                <th scope="col" className="py-1 pr-3 font-medium">Reason</th>
                <th scope="col" className="py-1 pr-3 font-medium">Role</th>
                <th scope="col" className="py-1 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r, i) => (
                <tr key={`${r.occurredAt}-${i}`} className="text-ink-secondary">
                  <td className="py-1 pr-3 whitespace-nowrap tabular-nums">
                    {formatNigerianDateTime(r.occurredAt)}
                  </td>
                  <td className="py-1 pr-3">{r.resourceType ?? ""}</td>
                  <td className="py-1 pr-3">{r.action}</td>
                  <td className="py-1 pr-3">
                    {r.decision === "deny" ? "Refused" : r.decision === "permit" ? "Allowed" : ""}
                  </td>
                  <td className="py-1 pr-3">{reasonLabel(r.reason)}</td>
                  <td className="py-1 pr-3">{roleLabel(r.role)}</td>
                  <td className="py-1 tabular-nums">{r.httpStatus ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Admin Settings -> Interoperability (read-only). Whether the FHIR interface
 * answers on this site, its version and resources, its on/off flags, and
 * recent requests and refusals. Never shows ids, tokens, keys or patient
 * data (the service layer keeps only documented fields).
 */
export function InteroperabilitySettings({ client, fetchImpl, origin }: Props) {
  const rpcClient: InteropRpcClient | null =
    client !== undefined ? client : (supabase as unknown as InteropRpcClient | null);
  const siteOrigin =
    origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  const isOnline = useOnlineStatus();
  const cloudSession = useCloudSession();
  const role = useAuthStore((s) => s.currentUser?.role ?? null) as Role | null;
  const mayReadActivity = canSeeInteropActivity(role);

  const [metadata, setMetadata] = useState<MetadataSummary | null>(null);
  const [activity, setActivity] = useState<ActivityState>({ kind: "loading" });

  const load = useCallback(async () => {
    setMetadata(null);
    setActivity({ kind: "loading" });
    const doFetch: FetchLike | null =
      fetchImpl !== undefined
        ? fetchImpl
        : typeof fetch === "function"
          ? (fetch.bind(globalThis) as unknown as FetchLike)
          : null;
    const metaPromise = fetchMetadataSummary(doFetch, siteOrigin, isOnline);
    let next: ActivityState;
    if (!mayReadActivity) next = { kind: "unavailable", reason: "denied" };
    else if (!isOnline) next = { kind: "unavailable", reason: "offline" };
    else if (cloudSession !== "signed_in") next = { kind: "unavailable", reason: "not_signed_in" };
    else {
      const result = await loadAdminStatus(rpcClient, isOnline);
      next =
        result.status === "ok"
          ? { kind: "ready", data: result.data }
          : { kind: "unavailable", reason: result.status };
    }
    setActivity(next);
    setMetadata(await metaPromise);
  }, [rpcClient, fetchImpl, siteOrigin, isOnline, cloudSession, mayReadActivity]);

  useEffect(() => {
    void load();
  }, [load]);

  const flagRows = metadata ? describeFlags(metadata.flags) : [];

  return (
    <section className="panel" aria-labelledby="interop-settings-title">
      <div className="panel-header">
        <h2 id="interop-settings-title" className="panel-title">
          Interoperability
        </h2>
        <button type="button" onClick={() => void load()} className="btn-ghost">
          <ArrowPathIcon className="h-5 w-5" aria-hidden />
          Refresh
        </button>
      </div>
      <div className="panel-body space-y-5">
        <p className="text-body text-ink-secondary">
          Read-only. The FHIR interface lets other systems read records from
          mBHR. It is switched on and off in the server settings, not here.
        </p>

        {metadata === null ? (
          <p className="text-body text-ink-muted" role="status">
            Checking the FHIR interface…
          </p>
        ) : (
          <dl className="grid gap-4 text-body sm:grid-cols-2">
            <div>
              <dt className="text-caption text-ink-muted">Enabled</dt>
              <dd className="mt-0.5">
                <StatusBadge tone={metadata.state === "on" ? "info" : "neutral"} icon>
                  {STATE_LABEL[metadata.state]}
                </StatusBadge>
              </dd>
            </div>
            <div>
              <dt className="text-caption text-ink-muted">FHIR version</dt>
              <dd className="mt-0.5 text-ink">{metadata.fhirVersion ?? "–"}</dd>
            </div>
            <div>
              <dt className="text-caption text-ink-muted">Software version</dt>
              <dd className="mt-0.5 text-ink">{metadata.softwareVersion ?? "–"}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-caption text-ink-muted">Base URL</dt>
              <dd className="mt-0.5 break-all font-mono text-caption text-ink">
                {metadata.baseUrl ?? "–"}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-caption text-ink-muted">Resources available</dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">
                {metadata.resources.length === 0 ? (
                  <span className="text-ink-secondary">–</span>
                ) : (
                  metadata.resources.map((r) => (
                    <StatusBadge key={r} tone="neutral">
                      {r}
                    </StatusBadge>
                  ))
                )}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-caption text-ink-muted">Settings</dt>
              <dd className="mt-1">
                <ul className="flex flex-wrap gap-1.5" aria-label="Interface settings">
                  {flagRows.map((f) => (
                    <li key={f.key}>
                      <StatusBadge tone="neutral">
                        {f.label}: {f.value}
                      </StatusBadge>
                    </li>
                  ))}
                </ul>
                {metadata.state === "on" && flagRows.every((f) => f.value === "Unknown") && (
                  <p className="mt-1 text-caption text-ink-muted">
                    The server did not report its settings.
                  </p>
                )}
              </dd>
            </div>
          </dl>
        )}

        <div className="space-y-4 border-t border-line pt-4">
          <h3 className="text-body font-semibold text-ink">Recent activity</h3>
          {activity.kind === "loading" && (
            <p className="text-body text-ink-muted" role="status">
              Loading request history…
            </p>
          )}
          {activity.kind === "unavailable" && (
            <p className="flex items-start gap-2 text-body text-ink-secondary">
              <InformationCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <span>{activityMessage(activity.reason)}</span>
            </p>
          )}
          {activity.kind === "ready" && (
            <>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Count label="Requests (24 hours)" value={activity.data.requests24h} />
                <Count label="Refused (24 hours)" value={activity.data.denials24h} />
                <Count label="Requests (7 days)" value={activity.data.requests7d} />
                <Count label="Refused (7 days)" value={activity.data.denials7d} />
              </dl>
              {activity.data.consent && (
                <p className="text-caption text-ink-secondary">
                  Consent records: {activity.data.consent.records ?? "–"} in total,{" "}
                  {activity.data.consent.active ?? "–"} active,{" "}
                  {activity.data.consent.withdrawn ?? "–"} withdrawn.
                </p>
              )}
              <AuditTable
                title="Recent requests"
                rows={activity.data.recent}
                empty="No requests recorded."
              />
              <AuditTable
                title="Recent refusals"
                rows={activity.data.recentDenials}
                empty="No refusals recorded."
              />
            </>
          )}
        </div>
      </div>
    </section>
  );
}
