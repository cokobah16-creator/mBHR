import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ExclamationTriangleIcon, InformationCircleIcon } from "@heroicons/react/24/outline";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useDialogFocus } from "@/features/appointments/useDialogFocus";
import { getLoginStatus, type AccountView } from "@/services/staffAccounts";
import { formatNigerianDateTime } from "@/utils/dateFormat";
import { STAFF_COPY, statusLabel } from "./staffAccountView";

interface StaffLoginStatusDialogProps {
  /** The staff member's id. */
  userId: string;
  /** Their name, for the title while their details load. */
  fullName: string;
  /** Closes the dialog. */
  onClose: () => void;
  /** Called with the fresh details, so the list can show them too. */
  onLoaded?: (account: AccountView) => void;
}

const COPY = STAFF_COPY.loginStatus;

function when(value: string | null | undefined): string {
  return (value && formatNigerianDateTime(value)) || COPY.missing;
}

/**
 * Only the new invitation and reset page records when a password is set, so
 * an older or repaired account, or one that already signs in, has no date
 * even when it has a password.
 */
function passwordSet(account: AccountView): string {
  if (account.passwordSetAt) return when(account.passwordSetAt);
  if (account.createdVia !== "users_screen" || account.lastSignInAt) return COPY.notRecorded;
  return COPY.missing;
}

function createdBy(account: AccountView): string {
  if (account.createdVia === "not_recorded") return COPY.notRecorded;
  if (account.createdVia === "repair") return COPY.createdByRepair(account.createdByName);
  return account.createdByName || COPY.missing;
}

/**
 * Login status for one staff member, read fresh from the server: their
 * email, account status, when they were invited, confirmed their email, set
 * a password and last signed in online, and who created or disabled the
 * account.
 *
 * Render it only while it is open.
 */
export default function StaffLoginStatusDialog({
  userId,
  fullName,
  onClose,
  onLoaded,
}: StaffLoginStatusDialogProps) {
  const [account, setAccount] = useState<AccountView | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, onClose);

  const onLoadedRef = useRef(onLoaded);
  useEffect(() => {
    onLoadedRef.current = onLoaded;
  });

  // Only the latest request may change what is shown.
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setFailure(null);
    const result = await getLoginStatus(userId);
    if (seq !== requestSeq.current) return;
    setLoading(false);
    if (result.ok === false) {
      setFailure(result.message);
      return;
    }
    const fresh = result.data.account;
    setAccount(fresh);
    onLoadedRef.current?.(fresh);
  }, [userId]);

  useEffect(() => {
    void load();
    return () => {
      requestSeq.current += 1;
    };
  }, [load]);

  const rows: [string, ReactNode][] = [];
  if (account) {
    const status = statusLabel(account.status, account.statusDetail, account.disablePartial);
    rows.push(
      [COPY.email, account.email || COPY.missing],
      [
        COPY.status,
        <span key="status" className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={status.tone} icon>
            {status.label}
          </StatusBadge>
          {status.caption && <span className="text-caption text-ink-muted">{status.caption}</span>}
        </span>,
      ],
      [COPY.invitationSent, when(account.invitedAt)],
      [COPY.emailConfirmed, when(account.emailConfirmedAt)],
      [COPY.passwordSet, passwordSet(account)],
      [COPY.lastSignIn, when(account.lastSignInAt)],
      [COPY.created, when(account.createdAt)],
      [COPY.createdBy, createdBy(account)],
      [COPY.disabledOn, when(account.disabledAt)],
      [COPY.disabledBy, account.disabledByName || COPY.missing],
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby="staff-login-status-title"
        aria-busy={loading || undefined}
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-lg border border-line bg-surface shadow-2xl"
      >
        <div className="panel-header">
          <h2 id="staff-login-status-title" className="panel-title">
            {COPY.title(account?.fullName || fullName)}
          </h2>
        </div>
        <div className="panel-body space-y-4">
          {loading && (
            <p role="status" className="text-body text-ink-secondary">
              {COPY.loading}
            </p>
          )}

          {!loading && failure && (
            <div className="banner banner-danger" role="alert">
              <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
              <span className="flex-1">{failure}</span>
              <button type="button" onClick={() => void load()} className="btn-secondary">
                {STAFF_COPY.tryAgain}
              </button>
            </div>
          )}

          {!loading && account && (
            <>
              <dl className="divide-y divide-line">
                {rows.map(([label, value]) => (
                  <div key={label} className="grid grid-cols-2 gap-4 py-2">
                    <dt className="text-caption font-medium text-ink-secondary">{label}</dt>
                    <dd className="text-body text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="field-hint">{COPY.passwordSetNote}</p>
              {account.status === "disabled" && account.statusDetail === "switched_off" && (
                <div className="banner banner-info">
                  <InformationCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
                  <span>{COPY.switchedOffNote}</span>
                </div>
              )}
              {account.linkedPatientRecord === true && (
                <div className="banner banner-info">
                  <InformationCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
                  <span>{COPY.linkedPatientRecord}</span>
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex justify-end border-t border-line px-4 py-3">
          <button type="button" onClick={onClose} className="btn-secondary">
            {COPY.close}
          </button>
        </div>
      </div>
    </div>
  );
}
