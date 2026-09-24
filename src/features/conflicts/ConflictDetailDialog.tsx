import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowLeftIcon,
  ExclamationTriangleIcon,
  SignalSlashIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  conflictQueueService,
  ConflictQueueError,
  type ConflictAuditEntry,
  type ConflictResolution,
  type FieldChangeDelta,
  type ResolutionStrategy,
} from "@/services/conflictQueue";
import {
  ConflictComparisonCard,
  ConflictResolutionActions,
} from "@/components/ConflictComparisonCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Tabs } from "@/components/ui/Tabs";
import { panelId, tabId } from "@/components/ui/tabIds";
import { generateId } from "@/db";
import { useToast } from "@/stores/toast";
import logger from "@/lib/logger";
import { ConflictHistory } from "./ConflictHistory";
import { ResolutionConfirmation } from "./ResolutionConfirmation";
import { RecordedDecision } from "./RecordedDecision";
import {
  approverLabel,
  conflictTypeLabel,
  displayStatus,
  formatConflictAge,
  formatTimestamp,
  recordTypeLabel,
  sensitivityMeta,
  sideLabels,
  staffLabel,
  strategyLabel,
} from "./conflictLabels";
import {
  countChosen,
  recordedSelections,
  type FieldSelections,
} from "./conflictDiff";
import {
  planDeviceWrite,
  type DevicePlan,
  type DeviceSnapshot,
} from "./devicePlan";
import { summariseResolution } from "./resolutionSummary";
import {
  approveDeniedMessage,
  canApproveDecision,
  canResolveConflict,
  decisionNeedsApproval,
  resolveDeniedMessage,
} from "./conflictPermissions";
import {
  applyRecordedDecision,
  approveWithPlan,
  reasonRequired,
  rejectDecision,
  resolveWithPlan,
  REASON_REQUIRED,
  type ActionResult,
  type ConflictActor,
} from "./conflictActions";
import { loadLocalContext, loadStaffNames, type LocalConflictContext } from "./localContext";

type DetailTab = "compare" | "history";
const isDetailTab = (id: string): id is DetailTab => id === "compare" || id === "history";

type Pending =
  | { mode: "resolve"; strategy: ResolutionStrategy }
  | { mode: "approve" }
  | { mode: "apply" };

const EMPTY_SNAPSHOT: DeviceSnapshot = { table: null, record: null, partner: null };
const REASON_HINT_REQUIRED =
  "Required for conflicts with high-sensitivity patient details. Saved in the audit log.";
const REASON_HINT_OPTIONAL = "Optional. Saved in the audit log.";
const REASON_ERROR_ID = "conflict-reason-error";
const REASON_HINT_ID = "conflict-reason-hint";
const CLOSED = ["resolved", "ignored", "auto_resolved"];
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ConflictDetailDialogProps {
  conflict: ConflictResolution;
  actor: ConflictActor | null;
  online: boolean;
  staffNames: Record<string, string>;
  onClose: () => void;
  /** Called after an action changed the conflict; the message is announced. */
  onChanged: (message: string) => void;
}

function shortId(id: string): string {
  return `…${id.replace(/-/g, "").slice(-6).toUpperCase()}`;
}

export function ConflictDetailDialog({
  conflict,
  actor,
  online,
  staffNames,
  onClose,
  onChanged,
}: ConflictDetailDialogProps) {
  const { push } = useToast();
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const confirmRef = useRef<HTMLHeadingElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const viewRecorded = useRef(false);

  const [tab, setTab] = useState<DetailTab>("compare");
  const [context, setContext] = useState<LocalConflictContext | null>(null);
  const [contextLoaded, setContextLoaded] = useState(false);
  const [history, setHistory] = useState<ConflictAuditEntry[] | null>(null);
  const [deltas, setDeltas] = useState<FieldChangeDelta[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyNames, setHistoryNames] = useState<Record<string, string>>({});
  const [eligibility, setEligibility] = useState<{
    needsSecondApproval: boolean;
    hasFirstApproval: boolean;
  } | null>(null);
  const [eligibilityError, setEligibilityError] = useState(false);
  const [selections, setSelections] = useState<FieldSelections>({});
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actorId = actor?.id;
  const actorRole = actor?.role;
  const awaitingApproval =
    conflict.status === "needs_approval" && !!conflict.resolutionStrategy;
  const needsDecision =
    conflict.status === "pending" ||
    (conflict.status === "needs_approval" && !conflict.resolutionStrategy);
  const isClosed = CLOSED.includes(conflict.status);

  // Restore focus to whatever opened the dialog when it closes.
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => previous?.focus();
  }, []);

  // Move focus to the heading of whichever step is showing.
  useEffect(() => {
    (pending ? confirmRef : titleRef).current?.focus();
  }, [pending]);

  useEffect(() => {
    let cancelled = false;
    setContextLoaded(false);
    loadLocalContext(conflict)
      .then((ctx) => {
        if (!cancelled) setContext(ctx);
      })
      .catch(() => {
        if (!cancelled) setContext(null);
      })
      .finally(() => {
        if (!cancelled) setContextLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [conflict]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const [entries, changes] = await Promise.all([
        conflictQueueService.getAuditHistory(conflict.id),
        conflictQueueService.getFieldDeltas(conflict.id),
      ]);
      setHistory(entries);
      setDeltas(changes);
      setHistoryError(null);
      setHistoryNames(await loadStaffNames(entries.map((e) => e.actorId)));
    } catch (e) {
      setHistoryError(
        e instanceof ConflictQueueError ? e.message : "Try again when the connection is back.",
      );
    } finally {
      setHistoryLoading(false);
    }
  }, [conflict.id]);

  useEffect(() => {
    if (online) {
      loadHistory();
    } else {
      setHistoryLoading(false);
      setHistoryError("You are offline. The history is kept on the server.");
    }
  }, [loadHistory, online]);

  // Opening a conflict shows patient details, so the view is audited once.
  useEffect(() => {
    if (viewRecorded.current || !actorId || !actorRole || !online) return;
    viewRecorded.current = true;
    conflictQueueService.recordView(conflict.id, actorId, actorRole).catch(() => undefined);
  }, [conflict.id, actorId, actorRole, online]);

  useEffect(() => {
    if (!awaitingApproval || !actorRole || !online) {
      setEligibility(null);
      return;
    }
    let cancelled = false;
    setEligibilityError(false);
    conflictQueueService
      .checkApprovalEligibility(conflict.id, actorRole)
      .then((e) => {
        if (!cancelled) {
          setEligibility({
            needsSecondApproval: e.needsSecondApproval,
            hasFirstApproval: e.hasFirstApproval,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEligibility(null);
          setEligibilityError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [awaitingApproval, conflict.id, actorRole, online]);

  const role = actorRole ?? null;
  const canDecide = canResolveConflict(role, conflict);
  const canApprove = canApproveDecision(role, conflict);
  const labels = sideLabels(conflict.conflictType);
  const names = { ...staffNames, ...historyNames };
  const recorded = recordedSelections(conflict) ?? {};
  const snapshot = context ?? EMPTY_SNAPSHOT;
  const firstOfTwo =
    awaitingApproval && !!eligibility?.needsSecondApproval && !eligibility.hasFirstApproval;
  // The service refuses a second approval from the first approver.
  const gaveFirstApproval =
    awaitingApproval &&
    !!eligibility?.needsSecondApproval &&
    eligibility.hasFirstApproval &&
    !!actorId &&
    conflict.approvedBy === actorId;
  const manualSupported =
    conflict.conflictType !== "duplicate" || conflict.entityType === "patients";
  const editable = needsDecision && canDecide;
  const chosen = countChosen(conflict.conflictDetails.fields, selections);
  const sens = sensitivityMeta(conflict.phiSensitivity);
  const status = displayStatus(conflict);
  const approver = approverLabel(conflict.requiredApproverRole);
  const fieldLabels = Object.fromEntries(
    conflict.conflictDetails.fields.map((f) => [f.field, f.label]),
  );

  const recordedStrategy = conflict.resolutionStrategy;
  const closedPlan: DevicePlan | null =
    isClosed && conflict.status === "resolved" && recordedStrategy && recordedStrategy !== "ignore" && contextLoaded
      ? planDeviceWrite({
          conflict,
          strategy: recordedStrategy,
          selections: recorded,
          awaitingApproval: false,
          snapshot,
        })
      : null;

  let plan: DevicePlan | null = null;
  if (pending && contextLoaded) {
    if (pending.mode === "resolve") {
      plan = planDeviceWrite({
        conflict,
        strategy: pending.strategy,
        selections,
        awaitingApproval: decisionNeedsApproval(conflict, pending.strategy),
        snapshot,
      });
    } else if (recordedStrategy) {
      plan = planDeviceWrite({
        conflict,
        strategy: recordedStrategy,
        selections: recorded,
        awaitingApproval: pending.mode === "approve" && firstOfTwo,
        snapshot,
      });
    } else {
      plan = { kind: "none", reason: "unsupported_type" };
    }
  }

  const pendingStrategy: ResolutionStrategy =
    pending?.mode === "resolve" ? pending.strategy : recordedStrategy ?? "ignore";
  const summary =
    pending && plan
      ? summariseResolution({
          mode: pending.mode,
          conflict,
          strategy: pendingStrategy,
          plan,
          needsApproval:
            pending.mode === "resolve" && decisionNeedsApproval(conflict, pending.strategy),
          approverName: approver || undefined,
          firstOfTwoApprovals: pending.mode === "approve" && firstOfTwo,
          recordALabel: context?.patient ? `record A (${context.patient.mbhrId})` : undefined,
          recordBLabel: context?.partnerPatient
            ? `record B (${context.partnerPatient.mbhrId})`
            : undefined,
        })
      : null;
  const needsNetwork = pending?.mode !== "apply";

  const requireReason = (message: string): boolean => {
    if (reason.trim()) {
      setReasonError(null);
      return true;
    }
    setReasonError(message);
    reasonRef.current?.focus();
    return false;
  };

  const startResolve = (strategy: ResolutionStrategy) => {
    setError(null);
    if (reasonRequired(conflict) && !requireReason(REASON_REQUIRED)) return;
    setPending({ mode: "resolve", strategy });
  };

  const startApprove = () => {
    setError(null);
    if (reasonRequired(conflict) && !requireReason(REASON_REQUIRED)) return;
    setPending({ mode: "approve" });
  };

  const finish = (result: ActionResult) => {
    if (!result.ok) {
      setError(result.body ?? result.title);
      return;
    }
    const tone =
      result.device === "failed"
        ? "warning"
        : result.status === "needs_approval" || result.status === "first_approval" || result.status === "pending"
          ? "info"
          : "success";
    push({ id: generateId(), tone, title: result.title, body: result.body });
    onChanged(`${result.title}. ${result.body ?? ""}`.trim());
    onClose();
  };

  const confirm = async () => {
    if (!pending || !plan || !actor) return;
    setBusy(true);
    setError(null);
    try {
      if (pending.mode === "resolve") {
        finish(
          await resolveWithPlan({
            conflict,
            strategy: pending.strategy,
            selections,
            justification: reason,
            actor,
            plan,
          }),
        );
      } else if (pending.mode === "approve") {
        finish(
          await approveWithPlan({
            conflict,
            isSecondApproval: !!eligibility?.hasFirstApproval,
            justification: reason,
            actor,
            plan,
          }),
        );
      } else {
        finish(await applyRecordedDecision({ conflict, actor, plan }));
      }
    } catch (e) {
      logger.error("Conflict action failed", e instanceof Error ? e.name : "unknown");
      setError(
        "The action did not finish. Refresh the list to check the conflict's status before trying again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!actor) return;
    setError(null);
    if (!requireReason("Add a reason for sending the decision back.")) return;
    setBusy(true);
    try {
      finish(await rejectDecision({ conflict, reason, actor }));
    } catch (e) {
      logger.error("Conflict rejection failed", e instanceof Error ? e.name : "unknown");
      setError("The rejection did not finish. Refresh the list and try again.");
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      if (busy) return;
      e.stopPropagation();
      if (pending) setPending(null);
      else onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const root = dialogRef.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !root.contains(active) || active === titleRef.current || active === confirmRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // Who the record is about, in one line.
  const p = context?.patient;
  const b = context?.partnerPatient;
  let subject: string;
  if (!contextLoaded) subject = "Checking this device for the record…";
  else if (conflict.conflictType === "duplicate") {
    subject = `Record A: ${p ? `${p.name} · ${p.mbhrId}` : "not on this device"} — Record B: ${b ? `${b.name} · ${b.mbhrId}` : "not on this device"}`;
  } else if (p) subject = `${p.name} · ${p.mbhrId}`;
  else if (conflict.entityType === "patients") subject = `Patient not on this device (record ${shortId(conflict.entityId)})`;
  else subject = `Record ${shortId(conflict.entityId)}${snapshot.record ? "" : " · not on this device"}`;

  const reasonLabel = awaitingApproval ? "Reason for approving or rejecting" : "Reason for this decision";
  const reasonHint = reasonRequired(conflict) ? REASON_HINT_REQUIRED : REASON_HINT_OPTIONAL;

  const detailView = (
    <div className="space-y-5">
      <dl className="grid gap-x-6 gap-y-3 text-body sm:grid-cols-2">
        <div>
          <dt className="text-caption text-ink-muted">Reported</dt>
          <dd className="text-ink">
            {formatTimestamp(conflict.createdAt) || "Time not recorded"}
            {!isClosed && (
              <span className="text-ink-muted"> · open {formatConflictAge(conflict.createdAt)}</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-ink-muted">Sensitivity</dt>
          <dd className="flex flex-wrap items-center gap-2 text-ink">
            <StatusBadge tone={sens.tone} icon>
              {sens.label}
            </StatusBadge>
            <span className="text-caption text-ink-muted">{sens.description}</span>
          </dd>
        </div>
        {approver && (
          <div>
            <dt className="text-caption text-ink-muted">Decision must be approved by</dt>
            <dd className="text-ink">{approver}</dd>
          </div>
        )}
        {conflict.candidateIds.length > 1 && (
          <div>
            <dt className="text-caption text-ink-muted">Other possible matches</dt>
            <dd className="text-ink">
              {conflict.candidateIds.length - 1} more, not shown here
            </dd>
          </div>
        )}
      </dl>
      {conflict.escalationReason && (
        <p className="flex items-start gap-2 text-body text-ink-secondary">
          <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          {conflict.escalationReason}
        </p>
      )}

      <div>
        <Tabs
          tabs={[
            { id: "compare", label: "Compare values" },
            { id: "history", label: "History", badge: history ? history.filter((h) => h.action !== "viewed").length : undefined },
          ]}
          active={tab}
          onChange={(id) => {
            if (isDetailTab(id)) setTab(id);
          }}
          idPrefix="conflict-detail"
          label="Conflict details"
        />
        <div
          role="tabpanel"
          id={panelId("conflict-detail", tab)}
          aria-labelledby={tabId("conflict-detail", tab)}
          className="pt-4"
        >
          {tab === "compare" ? (
            <ConflictComparisonCard
              fields={conflict.conflictDetails.fields}
              localTimestamp={conflict.conflictDetails.localTimestamp}
              remoteTimestamp={conflict.conflictDetails.remoteTimestamp}
              matchScore={conflict.conflictDetails.matchScore}
              matchReasons={conflict.conflictDetails.matchReasons}
              priority={conflict.priority}
              phiSensitivity={conflict.phiSensitivity}
              selectedResolutions={editable ? selections : recorded}
              onFieldSelect={(field, choice) =>
                setSelections((prev) => ({ ...prev, [field]: choice }))
              }
              isReadOnly={!editable || !manualSupported}
              conflictType={conflict.conflictType}
              localChangedBy={
                conflict.conflictDetails.localChangedBy
                  ? staffLabel(conflict.conflictDetails.localChangedBy, names, actorId)
                  : undefined
              }
              remoteChangedBy={
                conflict.conflictDetails.remoteChangedBy
                  ? staffLabel(conflict.conflictDetails.remoteChangedBy, names, actorId)
                  : undefined
              }
              requiredApproverLabel={approver || undefined}
              idPrefix={`conflict-${conflict.id}`}
            />
          ) : (
            <ConflictHistory
              entries={history}
              deltas={deltas}
              loading={historyLoading}
              error={historyError}
              conflictType={conflict.conflictType}
              fieldLabels={fieldLabels}
              staffNames={names}
              currentUserId={actorId}
            />
          )}
        </div>
      </div>

      <section aria-labelledby="conflict-decision-title" className="space-y-4 border-t border-line pt-4">
        <h3 id="conflict-decision-title" className="text-h3 text-ink">
          {isClosed ? "Decision" : awaitingApproval ? "Approval" : "Your decision"}
        </h3>

        {!online && !isClosed && (
          <div className="banner banner-warning">
            <SignalSlashIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <p>You are offline. Decisions are saved on the server, so reconnect to resolve, approve or reject.</p>
          </div>
        )}

        {isClosed && (
          <RecordedDecision
            conflict={conflict}
            names={names}
            currentUserId={actorId}
            plan={closedPlan}
            canApply={canDecide}
            deniedMessage={resolveDeniedMessage(conflict)}
            onApply={() => {
              setError(null);
              setPending({ mode: "apply" });
            }}
          />
        )}

        {awaitingApproval && (
          <div className="rounded-md border border-line bg-surface-sunken p-3">
            <p className="text-label text-ink">
              Proposed: {strategyLabel(recordedStrategy, conflict.conflictType)}
            </p>
            <p className="text-caption text-ink-muted">
              By {staffLabel(conflict.resolvedBy, names, actorId)}
              {conflict.resolvedAt ? ` · ${formatTimestamp(conflict.resolvedAt)}` : ""}
            </p>
            {eligibility?.needsSecondApproval && (
              <p className="mt-2 text-body text-ink-secondary">
                {eligibility.hasFirstApproval
                  ? `First approval recorded by ${staffLabel(conflict.approvedBy, names, actorId)}. A second approver, who is not the first, completes it.`
                  : "This merge needs approval from two different people."}
              </p>
            )}
          </div>
        )}

        {!isClosed && (
          <>
            {(awaitingApproval ? canApprove : canDecide) ? (
              <div>
                <label htmlFor="conflict-reason" className="field-label">
                  {reasonLabel}
                  {reasonRequired(conflict) ? "" : " (optional)"}
                </label>
                <textarea
                  id="conflict-reason"
                  ref={reasonRef}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    if (reasonError) setReasonError(null);
                  }}
                  rows={2}
                  className="input-field"
                  aria-invalid={!!reasonError}
                  aria-describedby={reasonError ? REASON_ERROR_ID : REASON_HINT_ID}
                  required={reasonRequired(conflict)}
                />
                {reasonError ? (
                  <p id={REASON_ERROR_ID} className="field-error" role="alert">
                    {reasonError}
                  </p>
                ) : (
                  <p id={REASON_HINT_ID} className="field-hint">
                    {reasonHint}
                  </p>
                )}
              </div>
            ) : (
              <div className="banner banner-info">
                <p>
                  You can review this conflict but not{" "}
                  {awaitingApproval ? "approve" : "resolve"} it.{" "}
                  {awaitingApproval ? approveDeniedMessage(conflict) : resolveDeniedMessage(conflict)}
                </p>
              </div>
            )}

            {awaitingApproval && canApprove && online && !eligibility && (
              <p className="text-caption text-ink-muted" role="status">
                {eligibilityError
                  ? "Approval requirements could not be checked. Close and reopen this conflict to try again."
                  : "Checking approval requirements…"}
              </p>
            )}

            {gaveFirstApproval && (
              <p className="text-body text-ink-secondary">
                You gave the first approval, so the second must come from someone else.
                You can still send the decision back.
              </p>
            )}

            {awaitingApproval && canApprove && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={startApprove}
                  disabled={busy || !online || !eligibility || gaveFirstApproval}
                >
                  {eligibility?.hasFirstApproval ? "Review second approval" : "Review and approve"}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={reject}
                  disabled={busy || !online}
                >
                  {busy ? "Saving…" : "Send back (reject)"}
                </button>
              </div>
            )}

            {needsDecision && canDecide && (
              <ConflictResolutionActions
                onKeepLocal={() => startResolve("keep_local")}
                onKeepRemote={() => startResolve("keep_remote")}
                onManualResolve={() => startResolve("manual")}
                onIgnore={() => startResolve("ignore")}
                isResolving={busy}
                hasManualSelections={chosen.total > 0 && chosen.chosen === chosen.total}
                requiresApproval={conflict.requiredApproverRole != null}
                conflictType={conflict.conflictType}
                manualSupported={manualSupported}
                manualHint={
                  chosen.total > 0
                    ? `Field by field: ${chosen.chosen} of ${chosen.total} fields chosen above.`
                    : undefined
                }
                disabled={!online}
              />
            )}
          </>
        )}

        {error && !pending && (
          <div className="banner banner-danger" role="alert">
            <p>{error}</p>
          </div>
        )}
      </section>
    </div>
  );

  const confirmView = (
    <div className="space-y-5">
      <button
        type="button"
        className="btn-ghost -ml-3"
        onClick={() => setPending(null)}
        disabled={busy}
      >
        <ArrowLeftIcon className="h-4 w-4" aria-hidden />
        Back to details
      </button>
      <h3 ref={confirmRef} tabIndex={-1} className="text-h2 text-ink focus:outline-none">
        Confirm: {summary?.heading ?? "decision"}
      </h3>
      <ResolutionConfirmation
        summary={summary}
        labels={labels}
        reason={pending?.mode !== "apply" ? reason.trim() : undefined}
        offline={needsNetwork && !online}
      />
      {error && (
        <div className="banner banner-danger" role="alert">
          <p>{error}</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-2 sm:p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflict-dialog-title"
        aria-describedby="conflict-dialog-subject"
        onKeyDown={onKeyDown}
        className="flex max-h-[95vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-6">
          <div className="min-w-0 space-y-1">
            <h2
              id="conflict-dialog-title"
              ref={titleRef}
              tabIndex={-1}
              className="text-h2 text-ink focus:outline-none"
            >
              {conflictTypeLabel(conflict.conflictType)}: {recordTypeLabel(conflict.entityType)}
            </h2>
            <p id="conflict-dialog-subject" className="break-words text-body text-ink-secondary">
              {subject}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <StatusBadge tone={status.tone} icon>
                {status.label}
              </StatusBadge>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close conflict details"
            className="btn-ghost min-w-touch-target shrink-0 px-2"
          >
            <XMarkIcon className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {pending ? confirmView : detailView}
        </div>

        {pending && (
          <div className="flex flex-col-reverse gap-2 border-t border-line px-4 py-3 sm:flex-row sm:justify-end sm:px-6">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setPending(null)}
              disabled={busy}
            >
              Back
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={confirm}
              disabled={
                busy || !summary || summary.blocked || !actor || (needsNetwork && !online)
              }
            >
              {busy ? "Saving…" : summary?.confirmLabel ?? "Confirm"}
            </button>
          </div>
        )}
        <p role="status" aria-live="polite" className="sr-only">
          {busy ? "Saving…" : ""}
        </p>
      </div>
    </div>
  );
}
