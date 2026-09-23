import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowPathIcon,
  ChatBubbleLeftRightIcon,
  ExclamationTriangleIcon,
  PaperAirplaneIcon,
} from "@heroicons/react/24/outline";
import { generateId } from "@/db";
import { useAuthStore } from "@/stores/auth";
import { can } from "@/auth/roles";
import { useToast } from "@/stores/toast";
import { isSupabaseEnabled } from "@/lib/supabaseClient";
import { Skeleton } from "@/components/ui/Skeleton";
import { isNotificationWorkerRunning, processNow } from "@/services/notificationWorker";
import { SendingReadiness } from "@/features/notifications/OutboxBadges";
import {
  useDeviceOutbox,
  useNow,
  useOnlineStatus,
} from "@/features/notifications/useOutboxStatus";
import {
  DELIVERY_STATE_META,
  FILTERABLE_STATES,
  countByState,
  describeRun,
  formatWhen,
  isDue,
  isStuckSending,
  type SendingBlocker,
} from "@/features/notifications/smsOutbox";

/**
 * Dashboard summary of SMS stored on this device, by real delivery state.
 * "Sent to provider" is not "delivered"; delivered needs a stored receipt.
 */
export function MessageOutbox() {
  const currentUser = useAuthStore((s) => s.currentUser);
  // Messaging management follows the existing gate on this widget.
  const canView = !!currentUser && can(currentUser.role, "export");
  // Same roles as the /pharmacy/sms-reminders route.
  const canOpenReminders =
    !!currentUser && (currentUser.role === "pharmacist" || currentUser.role === "admin");
  const { push } = useToast();
  const online = useOnlineStatus();
  const now = useNow();
  const items = useDeviceOutbox({ enabled: canView });
  const [processing, setProcessing] = useState(false);
  const [lastRun, setLastRun] = useState<{ at: Date; text: string } | null>(null);
  const [autoSending, setAutoSending] = useState(() => isNotificationWorkerRunning());

  const blocker: SendingBlocker | null = !isSupabaseEnabled
    ? "not_configured"
    : !online
      ? "offline"
      : null;

  const counts = useMemo(() => countByState(items ?? []), [items]);
  const dueCount = useMemo(
    () => (items ?? []).filter((i) => i.state === "queued" && isDue(i, now)).length,
    [items, now],
  );
  const stuckCount = useMemo(
    () => (items ?? []).filter((i) => isStuckSending(i, now)).length,
    [items, now],
  );
  const unconfirmedCount = useMemo(
    () => (items ?? []).filter((i) => i.sentConfirmation === "unconfirmed").length,
    [items],
  );

  const handleSend = async () => {
    if (!currentUser || !can(currentUser.role, "export")) {
      push({
        id: generateId(),
        tone: "error",
        title: "Not allowed",
        body: "Your role cannot send messages from the outbox.",
      });
      return;
    }
    setProcessing(true);
    try {
      const result = await processNow();
      const text = describeRun(result);
      setLastRun({ at: new Date(), text });
      setAutoSending(isNotificationWorkerRunning());
      push({
        id: generateId(),
        tone: result.skipped || (result.failed ?? 0) > 0 ? "warning" : "success",
        title: "Send run finished",
        body: text,
      });
    } catch (error) {
      console.error("Outbox send run failed:", error instanceof Error ? error.name : error);
      push({
        id: generateId(),
        tone: "error",
        title: "Messages were not sent",
        body: "Queued messages are still on this device. Try again.",
      });
    } finally {
      setProcessing(false);
    }
  };

  if (!canView) return null;

  const sendHint =
    blocker === "offline"
      ? "Sending needs an internet connection."
      : blocker === "not_configured"
        ? "Sending needs the mBHR server, which is not set up on this device."
        : dueCount === 0 && counts.queued > 0
          ? "Queued messages are scheduled for later; none are due yet."
          : dueCount === 0
            ? "Nothing is waiting to be sent."
            : `${dueCount} ${dueCount === 1 ? "message is" : "messages are"} due.`;

  return (
    <section className="panel" aria-labelledby="message-outbox-title">
      <div className="panel-header">
        <div className="flex min-w-0 items-center gap-2">
          <ChatBubbleLeftRightIcon className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden />
          <h2 id="message-outbox-title" className="panel-title">
            SMS outbox on this device
          </h2>
        </div>
        {canOpenReminders && (
          <Link to="/pharmacy/sms-reminders" className="btn-ghost">
            Open SMS reminders
          </Link>
        )}
      </div>

      <div className="panel-body space-y-4">
        {items === undefined ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-hidden>
            {FILTERABLE_STATES.map((s) => (
              <Skeleton key={s} className="h-14" />
            ))}
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {FILTERABLE_STATES.map((s) => (
              <div key={s} className="rounded-md border border-line px-3 py-2">
                <dt className="text-caption text-ink-muted">
                  {DELIVERY_STATE_META[s].filterLabel}
                </dt>
                <dd className="text-h3 tabular-nums text-ink">{counts[s]}</dd>
              </div>
            ))}
          </dl>
        )}

        {counts.failed > 0 && (
          <div className="banner banner-danger">
            <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
            <p>
              {counts.failed} {counts.failed === 1 ? "message has" : "messages have"} failed and
              will not be sent unless retried.
              {canOpenReminders ? " Open SMS reminders to see why and retry." : ""}
            </p>
          </div>
        )}

        {stuckCount > 0 && (
          <div className="banner banner-warning">
            <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
            <p>
              {stuckCount} {stuckCount === 1 ? "message shows" : "messages show"} Sending with no
              result recorded. {stuckCount === 1 ? "It" : "They"} may or may not have reached the
              patient.
            </p>
          </div>
        )}

        {unconfirmedCount > 0 && (
          <div className="banner banner-warning">
            <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
            <p>
              {unconfirmedCount} {unconfirmedCount === 1 ? "message is" : "messages are"} marked
              sent, but no SMS provider acceptance is stored. Older versions of mBHR and test
              gateways marked messages sent without sending them, so{" "}
              {unconfirmedCount === 1 ? "it" : "they"} may not have reached the patient.
            </p>
          </div>
        )}

        <SendingReadiness blocker={blocker} autoSending={autoSending} />

        {lastRun && (
          <p className="text-label text-ink-secondary">
            Last run {formatWhen(lastRun.at)}: {lastRun.text}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-line px-4 py-3 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={handleSend}
          disabled={processing || blocker !== null || dueCount === 0}
          aria-describedby="message-outbox-send-hint"
          className="btn-secondary"
        >
          {processing ? (
            <ArrowPathIcon className="h-5 w-5 animate-spin" aria-hidden />
          ) : (
            <PaperAirplaneIcon className="h-5 w-5" aria-hidden />
          )}
          {processing ? "Sending…" : "Send due messages now"}
        </button>
        <p id="message-outbox-send-hint" className="text-caption text-ink-muted">
          {sendHint}
        </p>
      </div>
    </section>
  );
}
