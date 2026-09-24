import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowPathIcon,
  ChatBubbleLeftRightIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  PaperAirplaneIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import { db, generateId, createAuditLog } from "@/db";
import { useAuthStore } from "@/stores/auth";
import { can } from "@/auth/roles";
import { useToast } from "@/stores/toast";
import { isSupabaseEnabled } from "@/lib/supabaseClient";
import { useCloudSession } from "@/lib/cloudSession";
import { EmptyState } from "@/components/ui/EmptyState";
import { PharmacySkeleton } from "@/components/ui/Skeleton";
import {
  getPatientReminders,
  getPendingReminders,
  getRecentReminders,
  getReminderStatusCounts,
  markReminderFailed,
  markReminderSent,
  type ReminderStatusCounts,
  type SMSReminder,
} from "@/services/sms";
import {
  cancelDeviceMessage,
  isNotificationWorkerRunning,
  processNow,
  retryDeviceMessage,
  sendReminderNow,
  startNotificationWorker,
  stopNotificationWorker,
} from "@/services/notificationWorker";
import { SendingReadiness } from "@/features/notifications/OutboxBadges";
import { OutboxDetail } from "@/features/notifications/OutboxDetail";
import { OutboxList } from "@/features/notifications/OutboxList";
import { ScheduleReminderForm } from "@/features/notifications/ScheduleReminderForm";
import {
  useDeviceOutbox,
  useNow,
  useOnlineStatus,
} from "@/features/notifications/useOutboxStatus";
import {
  DELIVERY_STATE_META,
  FILTERABLE_STATES,
  STAFF_FAILURE_PREFIX,
  STAFF_SENT_NOTE,
  countByState,
  describeFailure,
  describeRun,
  formatWhen,
  fromServerReminder,
  sortOutbox,
  type DeliveryState,
  type OutboxItem,
  type RunResult,
  type SendingBlocker,
} from "@/features/notifications/smsOutbox";

interface SMSReminderManagerProps {
  /** Show only this patient's reminders (and fix the scheduling form to them). */
  patientId?: string;
  /** Prefill the scheduling form from this dispense. */
  dispenseId?: string;
}

type Filter = "all" | DeliveryState;
type ServerStatus =
  | "loading"
  | "ready"
  | "error"
  | "not_configured"
  | "offline"
  | "signed_out";

const SERVER_LIST_LIMIT = 200;
const AUTO_INTERVAL_MS = 30_000;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  ...FILTERABLE_STATES.map((s) => ({ id: s, label: DELIVERY_STATE_META[s].filterLabel })),
];

function auditEntity(item: OutboxItem): string {
  if (item.store === "server") return "medication_reminders";
  return item.store === "outbox" ? "deviceOutbox" : "outboundMessages";
}

/** Why "Send now" did not try to send a server reminder. */
function sendNowSkippedText(skipped: SendingBlocker | "busy"): string {
  switch (skipped) {
    case "offline":
      return "This device is offline. Try again when it is back online.";
    case "busy":
      return "A send run is in progress and may be sending this reminder. Check its state in a moment before sending it again.";
    case "not_configured":
      return "SMS sending is not set up on this device.";
    case "signed_out":
      return "Nobody is signed in online on this device. Sign in online with a staff account, then send again. A PIN unlock is not enough.";
    case "not_permitted":
      return "The signed-in account's role cannot send SMS to patients. Nothing was sent.";
    default:
      // A reason this screen does not know yet: say only what is certain.
      return "This device could not send it right now. Nothing was sent.";
  }
}

/** What happens next to a device message queued again (after Retry). */
function waitNote(blocker: SendingBlocker | null, autoSending: boolean): string {
  switch (blocker) {
    case null:
      return autoSending
        ? "Automatic sending will try it shortly."
        : "Press Send due messages now to send it.";
    case "not_configured":
      return "It stays on this device: sending is not set up here.";
    case "offline":
      return "It waits on this device until it is back online and sending runs.";
    case "signed_out":
      return "It waits on this device until a staff member signs in online and sending runs.";
    case "not_permitted":
      return "It waits on this device until a pharmacist, nurse, doctor, lead clinician or administrator signs in online and sending runs.";
    default:
      return "It waits on this device until sending is available.";
  }
}

/** Why the send buttons are off, under the Sending panel's buttons. */
function sendingBlockedText(blocker: SendingBlocker): string {
  switch (blocker) {
    case "offline":
      return "Sending needs an internet connection. Reminders you schedule are still saved on this device.";
    case "not_configured":
      return "Sending needs the mBHR server. Reminders you schedule are still saved on this device.";
    case "signed_out":
      return "Sending needs a staff member signed in online. A PIN unlock is not enough. Reminders you schedule are still saved on this device.";
    case "not_permitted":
      return "The signed-in staff member's role cannot send SMS. Reminders you schedule are still saved on this device.";
    default:
      return "Sending is not available on this device right now. Reminders you schedule are still saved on this device.";
  }
}

/**
 * The SMS reminder outbox: every reminder on this device and on the server,
 * with its real delivery state, plus scheduling, sending, retry and cancel.
 */
export function SMSReminderManager({ patientId, dispenseId }: SMSReminderManagerProps) {
  const currentUser = useAuthStore((s) => s.currentUser);
  const canManage = !!currentUser && can(currentUser.role, "dispense");
  const { push } = useToast();
  const online = useOnlineStatus();
  const now = useNow();
  // The server only sends, and only lists reminders, for a staff member
  // signed in online; a PIN unlock of an offline workspace has no session.
  // "unknown" (not read yet) is not treated as signed out.
  const signedOut = useCloudSession() === "signed_out";

  const blocker: SendingBlocker | null = !isSupabaseEnabled
    ? "not_configured"
    : !online
      ? "offline"
      : signedOut
        ? "signed_out"
        : null;

  const [filter, setFilter] = useState<Filter>("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [autoSending, setAutoSending] = useState(() => isNotificationWorkerRunning());
  const [lastRun, setLastRun] = useState<{ at: Date; text: string } | null>(null);
  const lastTriggerRef = useRef<HTMLElement | null>(null);
  const scheduleButtonRef = useRef<HTMLButtonElement>(null);
  const wasSchedulingRef = useRef(false);

  const [serverStatus, setServerStatus] = useState<ServerStatus>("loading");
  const [serverReminders, setServerReminders] = useState<SMSReminder[]>([]);
  const [serverCounts, setServerCounts] = useState<ReminderStatusCounts | null>(null);
  const [recentCount, setRecentCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // Counts server loads, so a slow load that finishes after a newer one (for
  // example after signing out or going offline) does not overwrite it.
  const serverLoadRef = useRef(0);

  // When the scheduling form closes without opening a message, put focus
  // back on the button that opened it (it is disabled while the form is open).
  useEffect(() => {
    if (wasSchedulingRef.current && !scheduling && !selectedKey) {
      scheduleButtonRef.current?.focus();
    }
    wasSchedulingRef.current = scheduling;
  }, [scheduling, selectedKey]);

  // ---- data ---------------------------------------------------------------

  const deviceItems = useDeviceOutbox({ patientId });

  const loadServer = useCallback(async () => {
    const load = ++serverLoadRef.current;
    const notLoaded = (status: ServerStatus) => {
      setServerStatus(status);
      setServerReminders([]);
      setServerCounts(null);
      setRefreshing(false);
    };
    if (!isSupabaseEnabled) {
      notLoaded("not_configured");
      return;
    }
    if (!online) {
      notLoaded("offline");
      return;
    }
    // Without an online sign-in the server returns no reminders, which
    // would read as "none on the server".
    if (signedOut) {
      notLoaded("signed_out");
      return;
    }
    setRefreshing(true);
    setServerStatus((s) => (s === "ready" ? s : "loading"));
    try {
      const [recent, due, counts] = await Promise.all([
        patientId ? getPatientReminders(patientId) : getRecentReminders(SERVER_LIST_LIMIT),
        // Due reminders are always listed, even if older than the recent window.
        patientId ? Promise.resolve([] as SMSReminder[]) : getPendingReminders(),
        patientId ? Promise.resolve(null) : getReminderStatusCounts(),
      ]);
      if (load !== serverLoadRef.current) return;
      const byId = new Map<string, SMSReminder>();
      [...recent, ...due].forEach((r) => byId.set(r.id ?? `${r.patientId}:${r.scheduledAt}`, r));
      setServerReminders(Array.from(byId.values()));
      setRecentCount(recent.length);
      setServerCounts(counts);
      setServerStatus("ready");
    } catch (error) {
      console.error(
        "Server reminders not loaded:",
        error instanceof Error ? error.name : typeof error,
      );
      if (load !== serverLoadRef.current) return;
      setServerReminders([]);
      setServerCounts(null);
      setServerStatus("error");
    } finally {
      if (load === serverLoadRef.current) setRefreshing(false);
    }
  }, [patientId, online, signedOut]);

  useEffect(() => {
    loadServer();
  }, [loadServer]);

  // The worker updates server rows in the background; refresh while it runs.
  useEffect(() => {
    if (!autoSending) return;
    const id = setInterval(() => {
      loadServer();
    }, 60_000);
    return () => clearInterval(id);
  }, [autoSending, loadServer]);

  const items = useMemo(() => {
    if (deviceItems === undefined) return undefined;
    return sortOutbox([...deviceItems, ...serverReminders.map(fromServerReminder)]);
  }, [deviceItems, serverReminders]);

  const counts = useMemo(() => countByState(items ?? []), [items]);

  const visible = useMemo(
    () => (items ?? []).filter((i) => filter === "all" || i.state === filter),
    [items, filter],
  );

  const patientIds = useMemo(
    () => Array.from(new Set((items ?? []).map((i) => i.patientId).filter(Boolean))),
    [items],
  );
  const patientIdsKey = patientIds.join("|");
  // patientIdsKey changes exactly when the id list does.
  const patientRows = useLiveQuery(
    () => (patientIds.length ? db.patients.bulkGet(patientIds) : []),
    [patientIdsKey],
  );
  const patientNames = useMemo(() => {
    const names = new Map<string, string>();
    (patientRows ?? []).forEach((p) => {
      if (p) names.set(p.id, `${p.givenName} ${p.familyName}`.trim());
    });
    return names;
  }, [patientRows]);

  const selected = selectedKey ? (items ?? []).find((i) => i.key === selectedKey) : undefined;

  // ---- actions ------------------------------------------------------------

  const allowed = (): boolean => {
    if (currentUser && can(currentUser.role, "dispense")) return true;
    push({
      id: generateId(),
      tone: "error",
      title: "Not allowed",
      body: "Only pharmacists and admins can send, retry or cancel reminders.",
    });
    return false;
  };

  const audit = (action: string, entity: string, id: string) => {
    if (!currentUser) return;
    createAuditLog(currentUser.role, action, entity, id).catch((error) =>
      console.warn("Audit log not written:", error instanceof Error ? error.name : typeof error),
    );
  };

  const handleRetry = async (item: OutboxItem) => {
    if (item.store === "server" || !allowed()) return;
    setBusy(true);
    try {
      const requeued = await retryDeviceMessage(item.store, item.id);
      if (!requeued) {
        push({
          id: generateId(),
          tone: "warning",
          title: "Not queued again",
          body: "Its state changed in the meantime. Check its state in the list.",
        });
        return;
      }
      audit("sms_reminder_retry", auditEntity(item), item.id);
      push({
        id: generateId(),
        tone: "info",
        title: "Reminder queued again",
        body: waitNote(blocker, autoSending),
      });
    } catch (error) {
      console.error("Retry not saved:", error instanceof Error ? error.name : typeof error);
      push({
        id: generateId(),
        tone: "error",
        title: "Could not queue the reminder again",
        body: "Nothing was changed. Try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async (item: OutboxItem) => {
    if (item.store === "server" || !allowed()) return;
    setBusy(true);
    try {
      const cancelled = await cancelDeviceMessage(item.store, item.id);
      if (!cancelled) {
        push({
          id: generateId(),
          tone: "warning",
          title: "Not cancelled",
          body: "It is no longer queued and may be sending now. Check its state in the list.",
        });
        return;
      }
      audit("sms_reminder_cancelled", auditEntity(item), item.id);
      push({
        id: generateId(),
        tone: "success",
        title: "Reminder cancelled",
        body: "It will not be sent. The record stays in the outbox.",
      });
    } catch (error) {
      console.error("Cancel not saved:", error instanceof Error ? error.name : typeof error);
      push({
        id: generateId(),
        tone: "error",
        title: "Could not cancel the reminder",
        body: "Nothing was changed. Try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSendNow = async (item: OutboxItem) => {
    if (item.store !== "server" || !allowed()) return;
    const reminder = serverReminders.find((r) => r.id === item.id);
    if (!reminder) return;
    setBusy(true);
    try {
      const result = await sendReminderNow(reminder);
      if (result.skipped) {
        push({
          id: generateId(),
          tone: "warning",
          title: "Not sent",
          body: sendNowSkippedText(result.skipped),
        });
        return;
      }
      audit("sms_reminder_send_now", auditEntity(item), item.id);
      if (result.ok) {
        push({
          id: generateId(),
          tone: result.recordUpdated === false ? "warning" : "success",
          title: "Accepted by the SMS provider",
          body:
            result.recordUpdated === false
              ? "The server record could not be updated, so the list may still show it as waiting. Do not send it again."
              : "No delivery receipt is recorded, so delivery is not confirmed.",
        });
      } else {
        push({
          id: generateId(),
          tone: "error",
          title: "Not sent",
          body: describeFailure(result.error),
        });
      }
      await loadServer();
    } catch (error) {
      console.error("Send now failed:", error instanceof Error ? error.name : typeof error);
      push({
        id: generateId(),
        tone: "error",
        title: "Could not send the reminder",
        body: "The server could not be reached. Try again when the connection is better.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleMarkSent = async (item: OutboxItem) => {
    if (item.store !== "server" || !allowed()) return;
    setBusy(true);
    try {
      // The note is what lets the list say "Marked sent by staff" rather
      // than "Sent to provider".
      await markReminderSent(item.id, STAFF_SENT_NOTE);
      audit("sms_reminder_marked_sent_manually", auditEntity(item), item.id);
      push({
        id: generateId(),
        tone: "success",
        title: "Marked as sent",
        body: "Recorded as sent by staff. mBHR did not send this message.",
      });
      await loadServer();
    } catch (error) {
      console.error("Mark sent failed:", error instanceof Error ? error.name : typeof error);
      push({
        id: generateId(),
        tone: "error",
        title: "Could not update the reminder",
        body: "The server could not be reached. Nothing was changed.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleMarkFailed = async (item: OutboxItem, reason: string) => {
    if (item.store !== "server" || !allowed()) return;
    setBusy(true);
    try {
      await markReminderFailed(item.id, `${STAFF_FAILURE_PREFIX} ${reason}`);
      audit("sms_reminder_marked_failed_manually", auditEntity(item), item.id);
      push({
        id: generateId(),
        tone: "success",
        title: "Marked as failed",
        body: "It will not be sent.",
      });
      await loadServer();
    } catch (error) {
      console.error("Mark failed failed:", error instanceof Error ? error.name : typeof error);
      push({
        id: generateId(),
        tone: "error",
        title: "Could not update the reminder",
        body: "The server could not be reached. Nothing was changed.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleProcessNow = async () => {
    if (!allowed()) return;
    setProcessing(true);
    try {
      const result: RunResult = await processNow();
      setLastRun({ at: new Date(), text: describeRun(result) });
      await loadServer();
    } catch (error) {
      console.error("Send run failed:", error instanceof Error ? error.name : typeof error);
      setLastRun({
        at: new Date(),
        text: "The send run stopped with an error. Queued reminders are still on this device.",
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleToggleAuto = () => {
    if (!allowed()) return;
    if (isNotificationWorkerRunning()) stopNotificationWorker();
    else startNotificationWorker(AUTO_INTERVAL_MS);
    setAutoSending(isNotificationWorkerRunning());
  };

  const selectItem = (item: OutboxItem) => {
    lastTriggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedKey(item.key);
  };

  const closeDetail = () => {
    setSelectedKey(null);
    lastTriggerRef.current?.focus();
  };

  // ---- render -------------------------------------------------------------

  const serverNote = (() => {
    switch (serverStatus) {
      case "not_configured":
        return {
          tone: "banner-info",
          text: "Server reminders are not shown: this device is not connected to the mBHR server. Reminders saved on this device are listed.",
        };
      case "offline":
        return {
          tone: "banner-info",
          text: "Server reminders are not available offline. Reminders saved on this device are listed.",
        };
      case "signed_out":
        return {
          tone: "banner-info",
          text: "Server reminders are not shown: nobody is signed in online on this device. Reminders saved on this device are listed. Sign in online with a staff account to see server reminders.",
        };
      case "error":
        return {
          tone: "banner-warning",
          text: "Server reminders could not be loaded. Reminders saved on this device are still listed. Try Refresh.",
        };
      default:
        return null;
    }
  })();

  const finished = serverCounts ? serverCounts.sent + serverCounts.failed : 0;

  return (
    <div className="space-y-4">
      {scheduling && canManage && (
        <ScheduleReminderForm
          patientId={patientId}
          dispenseId={dispenseId}
          blocker={blocker}
          onClose={() => setScheduling(false)}
          onScheduled={(id) => {
            setScheduling(false);
            setFilter("all");
            setSelectedKey(`queue:${id}`);
          }}
        />
      )}

      <section className="panel" aria-labelledby="sms-sending-title">
        <div className="panel-header">
          <h2 id="sms-sending-title" className="panel-title">
            Sending
          </h2>
        </div>
        <div className="panel-body space-y-3">
          <SendingReadiness blocker={blocker} autoSending={autoSending} />
          <p className="text-caption text-ink-muted">
            Sent to provider means the SMS company accepted the message. Delivered is shown
            only when a delivery receipt is recorded.
          </p>
          <p role="status" aria-live="polite" className="text-label text-ink-secondary">
            {processing
              ? "Sending due messages…"
              : lastRun
                ? `Last run ${formatWhen(lastRun.at)}: ${lastRun.text}`
                : ""}
          </p>
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
            <button
              ref={scheduleButtonRef}
              type="button"
              className="btn-primary"
              onClick={() => {
                setScheduling(true);
                setSelectedKey(null);
              }}
              disabled={scheduling}
            >
              <PlusIcon className="h-5 w-5" aria-hidden />
              Schedule reminder
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={handleProcessNow}
              disabled={processing || blocker !== null}
              aria-describedby={blocker ? "sms-sending-blocked" : undefined}
            >
              {processing ? (
                <ArrowPathIcon className="h-5 w-5 animate-spin" aria-hidden />
              ) : (
                <PaperAirplaneIcon className="h-5 w-5" aria-hidden />
              )}
              {processing ? "Sending…" : "Send due messages now"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={handleToggleAuto}
              aria-pressed={autoSending}
              disabled={blocker === "not_configured"}
            >
              Automatic sending: {autoSending ? "On" : "Off"}
            </button>
            {blocker && (
              <p id="sms-sending-blocked" className="w-full text-caption text-ink-muted">
                {sendingBlockedText(blocker)}
              </p>
            )}
          </div>
        ) : (
          <p className="border-t border-line px-4 py-3 text-caption text-ink-muted">
            Only pharmacists and admins can schedule, send, retry or cancel reminders.
          </p>
        )}
      </section>

      {items === undefined ? (
        <PharmacySkeleton />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
          {selected && (
            <div className="lg:col-start-2 lg:row-start-1">
              <OutboxDetail
                key={selected.key}
                item={selected}
                patientName={
                  patientNames.get(selected.patientId) || selected.payloadPatientName
                }
                now={now}
                blocker={blocker}
                autoSending={autoSending}
                canManage={canManage}
                busy={busy}
                onClose={closeDetail}
                onRetry={handleRetry}
                onCancel={handleCancel}
                onSendNow={handleSendNow}
                onMarkSent={handleMarkSent}
                onMarkFailed={handleMarkFailed}
              />
            </div>
          )}

          <section
            className={`panel min-w-0 lg:col-start-1 lg:row-start-1 ${selected ? "" : "lg:col-span-2"}`}
            aria-labelledby="sms-outbox-title"
          >
            <div className="panel-header">
              <h2 id="sms-outbox-title" className="panel-title">
                Outbox
              </h2>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  loadServer();
                }}
                disabled={refreshing}
              >
                <ArrowPathIcon
                  className={`h-5 w-5 ${refreshing ? "animate-spin" : ""}`}
                  aria-hidden
                />
                {refreshing ? "Refreshing…" : "Refresh"}
              </button>
            </div>

            <div
              className="flex flex-wrap gap-2 border-b border-line p-3"
              role="group"
              aria-label="Filter by delivery state"
            >
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  aria-pressed={filter === f.id}
                  className={`min-h-touch-target rounded-md border px-3 py-1.5 text-label tabular-nums transition-colors ${
                    filter === f.id
                      ? "border-primary bg-primary-soft text-primary-fg"
                      : "border-line bg-surface text-ink-secondary hover:bg-surface-hover"
                  }`}
                >
                  {f.label} ({f.id === "all" ? counts.all : counts[f.id]})
                </button>
              ))}
            </div>

            {serverNote && (
              <div className="px-3 pt-3">
                <div className={`banner ${serverNote.tone}`}>
                  {serverNote.tone === "banner-warning" ? (
                    <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
                  ) : (
                    <InformationCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
                  )}
                  <p>{serverNote.text}</p>
                </div>
              </div>
            )}
            {serverStatus === "loading" && (
              <p role="status" className="px-4 pt-3 text-caption text-ink-muted">
                Loading server reminders…
              </p>
            )}

            {items.length === 0 ? (
              <EmptyState
                icon={ChatBubbleLeftRightIcon}
                title="No SMS reminders yet"
                description="Reminders queued when medicines are dispensed, or scheduled here, appear in this list with their real delivery state."
                action={
                  canManage && !scheduling ? (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => setScheduling(true)}
                    >
                      <PlusIcon className="h-5 w-5" aria-hidden />
                      Schedule reminder
                    </button>
                  ) : undefined
                }
              />
            ) : visible.length === 0 ? (
              <EmptyState
                icon={ChatBubbleLeftRightIcon}
                title={`No messages in "${FILTERS.find((f) => f.id === filter)?.label}"`}
                description="Choose another filter to see the other messages."
                action={
                  <button type="button" className="btn-secondary" onClick={() => setFilter("all")}>
                    Show all
                  </button>
                }
              />
            ) : (
              <div className="mt-3 border-t border-line">
                <OutboxList
                  items={visible}
                  patientNames={patientNames}
                  now={now}
                  blocker={blocker}
                  selectedKey={selectedKey}
                  onSelect={selectItem}
                />
              </div>
            )}

            <div className="space-y-1 border-t border-line bg-surface-sunken px-4 py-3 text-caption text-ink-muted">
              <p>
                Showing {visible.length} of {counts.all}{" "}
                {counts.all === 1 ? "message" : "messages"}.
              </p>
              {serverStatus === "ready" && serverCounts && (
                <p>
                  On the server: {serverCounts.total} reminders in total, {serverCounts.pending}{" "}
                  waiting, {serverCounts.sent} sent to provider, {serverCounts.failed} failed
                  {finished > 0
                    ? ` (provider accepted ${Math.round((serverCounts.sent / finished) * 100)}% of finished attempts)`
                    : ""}
                  .
                  {recentCount >= SERVER_LIST_LIMIT
                    ? ` The list shows the ${SERVER_LIST_LIMIT} most recent, plus any that are due now.`
                    : ""}
                </p>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
