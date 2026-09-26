import { useState } from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import type { HealthItem, OverviewResponse } from "@/services/staffAccounts";
import CreateLoginDialog from "./CreateLoginDialog";
import CreateStaffRecordDialog from "./CreateStaffRecordDialog";
import {
  healthBlockedText,
  healthItemText,
  healthRoleNotOffered,
  type HealthItemContext,
  healthTitle,
  STAFF_COPY,
  type StaffMessage,
} from "./staffAccountView";

interface AccountHealthPanelProps {
  /** The server's overview: Account Health, the roles on offer, link lifetime. */
  overview: Pick<OverviewResponse, "health" | "roles" | "inviteLifetimeSeconds"> & {
    /** The staff accounts, to know each problem's role; optional. */
    accounts?: OverviewResponse["accounts"];
  };
  /** Names of staff records that exist on this device only. */
  deviceOnlyNames?: readonly string[];
  /** Whether repairs can run now (the screen is ready and online). */
  canRepair: boolean;
  /** A repair finished: show the toast, then reload the staff list. */
  onRepaired: (message: StaffMessage) => void;
  /**
   * A repair dialog closed after a request whose outcome was never
   * confirmed, so the repair may have happened: reload the staff list.
   */
  onMaybeRepaired?: () => void;
}

const COPY = STAFF_COPY.health;

type RepairKind = "create_login" | "create_staff_record";

type Repairing = { kind: RepairKind; item: HealthItem } | null;

/**
 * Account Health, under the staff list (server mode): staff records that
 * can't sign in online, logins with no staff record, and records that exist
 * on this device only. Collapsed until opened. Repairs open a confirmation
 * dialog first.
 */
export default function AccountHealthPanel({
  overview,
  deviceOnlyNames = [],
  canRepair,
  onRepaired,
  onMaybeRepaired,
}: AccountHealthPanelProps) {
  const [open, setOpen] = useState(false);
  const [repairing, setRepairing] = useState<Repairing>(null);

  const health = overview.health;
  const problems = health?.problems ?? [];
  const count = problems.length + deviceOnlyNames.length;
  const portalLogins = (health?.counts.portalPatients ?? 0) + (health?.counts.portalSignups ?? 0);
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon;

  const contextFor = (item: HealthItem): HealthItemContext => {
    const id = item.userId.toLowerCase();
    const account = overview.accounts?.find((a) => a.userId.toLowerCase() === id);
    return { role: account?.role ?? null, offeredRoles: overview.roles };
  };

  /** The repair a problem's button offers, or null when it has none. */
  const repairKind = (item: HealthItem): RepairKind | null => {
    if (item.blocked) return null;
    // The server refuses a login for a role this administrator can't give.
    if (healthRoleNotOffered(item, contextFor(item))) return null;
    if (item.repair === "create_login" || item.repair === "create_staff_record") {
      return item.repair;
    }
    return null;
  };

  // Why the repair buttons are off, shown in the panel itself: the status
  // line above the list is usually scrolled out of view down here.
  const repairsOffNote =
    !canRepair && problems.some((item) => repairKind(item) !== null)
      ? "account-health-repairs-off"
      : undefined;

  const repairButton = (item: HealthItem) => {
    const kind = repairKind(item);
    if (kind === null) return null;
    return (
      <button
        type="button"
        className="btn-secondary"
        disabled={!canRepair}
        aria-describedby={repairsOffNote}
        onClick={() => setRepairing({ kind, item })}
      >
        {kind === "create_login" ? COPY.createLogin : COPY.createStaffRecord}
      </button>
    );
  };

  return (
    <section className="panel" aria-labelledby="account-health-title">
      <div className="panel-header">
        <h2 id="account-health-title" className="panel-title">
          <button
            type="button"
            className="flex items-center gap-2 text-left"
            aria-expanded={open}
            aria-controls="account-health-body"
            onClick={() => setOpen((v) => !v)}
          >
            <Chevron className="h-5 w-5 shrink-0" aria-hidden />
            {healthTitle(count)}
          </button>
        </h2>
      </div>

      {open && (
        <div id="account-health-body" className="panel-body space-y-3">
          {health?.truncated && (
            <div className="banner banner-warning" role="status">
              <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
              <span>{COPY.truncated}</span>
            </div>
          )}

          {repairsOffNote && (
            <p id={repairsOffNote} className="text-caption text-ink-muted">
              {COPY.repairsUnavailable}
            </p>
          )}

          {count === 0 ? (
            <p className="text-body text-ink-secondary">{COPY.empty}</p>
          ) : (
            <ul className="divide-y divide-line">
              {problems.map((item) => {
                const blocked = healthBlockedText(item, contextFor(item));
                return (
                  <li
                    key={`${item.kind}-${item.userId}`}
                    className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="space-y-1">
                      <p className="text-body text-ink">{healthItemText(item)}</p>
                      {blocked && <p className="text-caption text-ink-muted">{blocked}</p>}
                    </div>
                    {repairButton(item)}
                  </li>
                );
              })}
              {deviceOnlyNames.map((name, i) => (
                <li key={`device-only-${i}`} className="py-3">
                  <p className="text-body text-ink">{COPY.deviceOnly(name)}</p>
                </li>
              ))}
            </ul>
          )}

          <p className="text-caption text-ink-muted">{COPY.counts(portalLogins)}</p>
        </div>
      )}

      {repairing?.kind === "create_login" && (
        <CreateLoginDialog
          userId={repairing.item.userId}
          fullName={repairing.item.fullName ?? ""}
          inviteLifetimeSeconds={overview.inviteLifetimeSeconds}
          onClose={() => setRepairing(null)}
          onCreated={(message) => onRepaired(message)}
          onMaybeCreated={onMaybeRepaired}
        />
      )}
      {repairing?.kind === "create_staff_record" && (
        <CreateStaffRecordDialog
          item={repairing.item}
          roles={overview.roles}
          onClose={() => setRepairing(null)}
          onCreated={(message) => onRepaired(message)}
          onMaybeCreated={onMaybeRepaired}
        />
      )}
    </section>
  );
}
