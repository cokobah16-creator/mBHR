import { useCallback, useEffect, useState } from "react";
import {
  ArrowPathIcon,
  CheckCircleIcon,
  InformationCircleIcon,
  LockClosedIcon,
} from "@heroicons/react/24/outline";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { supabase } from "@/lib/supabaseClient";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { formatNigerianDate } from "@/utils/dateFormat";
import type { InteropRpcClient, RpcFailure } from "@/services/interopRpc";
import {
  loadMyConsents,
  withdrawConsent,
  WITHDRAW_REASON_MAX,
  type PatientConsentItem,
} from "@/services/interopConsent";
import { ConfirmDialog } from "./account/ConfirmDialog";
import {
  PRIVACY_COPY as COPY,
  STATE_LABEL,
  consentNote,
  consentTitle,
} from "./privacyCopy";

type ListState =
  | { kind: "loading" }
  | { kind: "ready"; items: PatientConsentItem[] }
  | { kind: "unavailable"; reason: RpcFailure | "invalid" };

interface Props {
  /** The page's patient (the portal record the page shows). */
  patientId: string;
  /** For tests: the client to call (defaults to the app's Supabase client). */
  client?: InteropRpcClient | null;
}

function unavailableMessage(reason: RpcFailure | "invalid"): string {
  if (reason === "offline") return COPY.offline;
  if (reason === "missing") return COPY.missing;
  if (reason === "signed_out" || reason === "denied" || reason === "invalid") return COPY.signedOut;
  return COPY.failed;
}

/**
 * "Privacy and data sharing": what mBHR does with the patient's records,
 * and the sharing choices recorded for the page's patient in mBHR's
 * consent records (scopes patient-privacy and research only; a treatment
 * consent or an advance care directive is not listed here).
 * - A permission has a Withdraw button. Withdrawing names the page's
 *   patient, so a sign-in linked to two people changes only this one.
 * - A refusal (any "do not" rule) has none: withdrawing it could allow
 *   sharing, so the patient is told to ask clinic staff (the server
 *   refuses it too). It is named as the patient's refusal to share outside
 *   mBHR only when a rule is for someone outside mBHR (see consentTitle).
 * - A record with no rules says so, and has no button.
 *
 * Separate from the sharing choices on the rest of the page
 * (patient_data_sharing_preferences), which are a record of wishes, not
 * consent records. Any failure here stays inside this section.
 */
export function PrivacyConsentSection({ patientId, client }: Props) {
  const rpcClient: InteropRpcClient | null =
    client !== undefined ? client : (supabase as unknown as InteropRpcClient | null);
  const isOnline = useOnlineStatus();
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [pending, setPending] = useState<PatientConsentItem | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    setList({ kind: "loading" });
    const result = await loadMyConsents(rpcClient, patientId, isOnline);
    if (result.status === "ok") setList({ kind: "ready", items: result.items });
    else setList({ kind: "unavailable", reason: result.status });
  }, [rpcClient, patientId, isOnline]);

  useEffect(() => {
    void load();
  }, [load]);

  const openWithdraw = (item: PatientConsentItem) => {
    setDone(false);
    setReason("");
    setDialogError(null);
    setPending(item);
  };

  const confirmWithdraw = async () => {
    if (!pending) return;
    setBusy(true);
    setDialogError(null);
    const result = await withdrawConsent(rpcClient, pending.id, patientId, reason, isOnline);
    setBusy(false);
    if (result.status === "withdrawn" || result.status === "already_withdrawn") {
      setPending(null);
      setDone(true);
      await load();
      return;
    }
    setDialogError(
      result.status === "offline"
        ? COPY.withdrawOffline
        : result.status === "missing"
          ? COPY.withdrawMissing
          : COPY.withdrawFailed,
    );
  };

  return (
    <section className="panel" aria-labelledby="privacy-consent-title">
      <div className="panel-header">
        <h2 id="privacy-consent-title" className="panel-title">
          {COPY.title}
        </h2>
      </div>
      <div className="panel-body space-y-4">
        <ul className="space-y-1.5 text-body text-ink-secondary">
          {COPY.intro.map((line) => (
            <li key={line} className="flex items-start gap-2">
              <LockClosedIcon className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" aria-hidden />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        <div>
          <h3 className="text-body font-medium text-ink">{COPY.listTitle}</h3>

          <div aria-live="polite">
            {done && (
              <div className="banner banner-success mt-2">
                <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                <p>{COPY.withdrawDone}</p>
              </div>
            )}
          </div>

          {list.kind === "loading" && (
            <p className="mt-2 text-body text-ink-muted" role="status">
              {COPY.loading}
            </p>
          )}

          {list.kind === "unavailable" && (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <p className="flex items-start gap-2 text-body text-ink-secondary">
                <InformationCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                <span>{unavailableMessage(list.reason)}</span>
              </p>
              {list.reason !== "missing" && list.reason !== "invalid" && (
                <button type="button" onClick={() => void load()} className="btn-secondary">
                  <ArrowPathIcon className="h-5 w-5" aria-hidden />
                  {COPY.retry}
                </button>
              )}
            </div>
          )}

          {list.kind === "ready" && list.items.length === 0 && (
            <p className="mt-2 text-body text-ink-secondary">{COPY.empty}</p>
          )}

          {list.kind === "ready" && list.items.length > 0 && (
            <ul className="mt-2 divide-y divide-line rounded-md border border-line">
              {list.items.map((item) => {
                const title = consentTitle(item);
                const note = consentNote(item);
                return (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-start justify-between gap-3 px-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-body font-medium text-ink">{title}</p>
                      <p className="text-caption text-ink-muted">
                        {item.state === "withdrawn" && item.withdrawnAt
                          ? `${COPY.withdrawnOn} ${formatNigerianDate(item.withdrawnAt)}`
                          : item.since
                            ? `${COPY.since} ${formatNigerianDate(item.since)}`
                            : ""}
                        {item.until && item.state !== "withdrawn"
                          ? ` · ${COPY.until} ${formatNigerianDate(item.until)}`
                          : ""}
                      </p>
                      {note && <p className="text-caption text-ink-secondary">{note}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge tone={item.state === "in_place" ? "info" : "neutral"} icon>
                        {STATE_LABEL[item.state]}
                      </StatusBadge>
                      {item.canWithdraw && (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => openWithdraw(item)}
                          disabled={!isOnline}
                          aria-label={`${COPY.withdraw}: ${title}`}
                        >
                          {COPY.withdraw}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={COPY.withdrawTitle}
        confirmLabel={COPY.withdrawConfirm}
        cancelLabel={COPY.withdrawCancel}
        busyLabel={COPY.withdrawBusy}
        busy={busy}
        destructive
        error={dialogError}
        onConfirm={() => void confirmWithdraw()}
        onCancel={() => {
          if (!busy) setPending(null);
        }}
      >
        {pending && <p className="font-medium text-ink">{consentTitle(pending)}</p>}
        {COPY.withdrawBody.map((line) => (
          <p key={line}>{line}</p>
        ))}
        <label htmlFor="privacy-withdraw-reason" className="field-label">
          {COPY.reasonLabel}
        </label>
        <textarea
          id="privacy-withdraw-reason"
          className="input-field"
          rows={2}
          maxLength={WITHDRAW_REASON_MAX}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
        />
      </ConfirmDialog>
    </section>
  );
}
