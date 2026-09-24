import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowPathIcon,
  PaperAirplaneIcon,
  PhoneIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { composeOutboxMessageText } from "@/services/notificationWorker";
import { DeliveryStateBadge } from "@/features/notifications/OutboxBadges";
import {
  MAX_SEND_ATTEMPTS,
  canCancel,
  canMarkServerManually,
  canRetry,
  canSendServerNow,
  estimateSmsParts,
  explainState,
  formatPhone,
  formatWhen,
  isStuckSending,
  sentAtLabel,
  telHref,
  type OutboxItem,
  type SendingBlocker,
} from "@/features/notifications/smsOutbox";

interface OutboxDetailProps {
  item: OutboxItem;
  patientName?: string;
  now: Date;
  blocker: SendingBlocker | null;
  autoSending: boolean;
  /** Current user may send, retry, cancel and mark reminders. */
  canManage: boolean;
  busy: boolean;
  onClose: () => void;
  onRetry: (item: OutboxItem) => void;
  onCancel: (item: OutboxItem) => void;
  onSendNow: (item: OutboxItem) => void;
  onMarkSent: (item: OutboxItem) => void;
  onMarkFailed: (item: OutboxItem, reason: string) => void;
}

type Confirming = null | "cancel" | "markSent" | "markFailed";

const FAIL_REASON_ERROR_ID = "outbox-fail-reason-error";
const FAIL_REASON_HINT_ID = "outbox-fail-reason-hint";

/**
 * Full record of one message: the full phone number (for dialling), the
 * exact text, every stored time and the actions the stored state allows.
 * Render with key={item.key} so confirmations reset between messages.
 */
export function OutboxDetail({
  item,
  patientName,
  now,
  blocker,
  autoSending,
  canManage,
  busy,
  onClose,
  onRetry,
  onCancel,
  onSendNow,
  onMarkSent,
  onMarkFailed,
}: OutboxDetailProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [failReason, setFailReason] = useState("");
  const [failReasonError, setFailReasonError] = useState("");
  const [composed, setComposed] = useState<{ key: string; text: string | null } | null>(
    null,
  );

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // A confirmation only applies to the state it was opened for.
  useEffect(() => {
    setConfirming(null);
  }, [item.state]);

  const needsCompose = !item.text && item.store !== "server" && !!item.templateKey;
  const { key, templateKey, locale, payload } = item;

  useEffect(() => {
    if (!needsCompose) return;
    let cancelled = false;
    composeOutboxMessageText({ templateKey, locale, payload: payload ?? {} })
      .then((text) => {
        if (!cancelled) setComposed({ key, text });
      })
      .catch(() => {
        if (!cancelled) setComposed({ key, text: null });
      });
    return () => {
      cancelled = true;
    };
  }, [needsCompose, key, templateKey, locale, payload]);

  const text: string | null | undefined = item.text
    ? item.text
    : composed && composed.key === item.key
      ? composed.text
      : undefined;
  const parts = text ? estimateSmsParts(text) : null;

  const ctx = { now, blocker, autoSending };
  const retryable = canRetry(item, now);
  const cancellable = canCancel(item);
  const sendable = canSendServerNow(item, now);
  const markable = canMarkServerManually(item, now);
  const hasActions = retryable || cancellable || sendable || markable;

  const submitMarkFailed = () => {
    if (!failReason.trim()) {
      setFailReasonError("Enter why it was not sent.");
      return;
    }
    onMarkFailed(item, failReason.trim());
  };

  return (
    <section className="panel" aria-labelledby="outbox-detail-title">
      <div className="panel-header">
        <h2
          id="outbox-detail-title"
          ref={headingRef}
          tabIndex={-1}
          className="panel-title focus:outline-none"
        >
          {item.title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="btn-ghost min-w-touch-target px-2"
          aria-label="Close message details"
        >
          <XMarkIcon className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <div className="panel-body space-y-4">
        <div className="space-y-1.5">
          <DeliveryStateBadge item={item} now={now} blocker={blocker} />
          <p className="text-body text-ink-secondary">{explainState(item, ctx)}</p>
        </div>

        <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2 text-body">
          <dt className="text-ink-muted">Patient</dt>
          <dd className="min-w-0 text-ink">
            {patientName ? (
              <>
                {patientName}{" "}
                <Link
                  to={`/patients/${item.patientId}`}
                  className="inline-flex min-h-touch-target items-center text-label text-primary hover:underline"
                >
                  Open record
                </Link>
              </>
            ) : (
              <span className="text-ink-muted">Patient record is not on this device</span>
            )}
          </dd>

          <dt className="text-ink-muted">Phone</dt>
          <dd className="text-ink">
            {item.phone ? (
              <a
                href={telHref(item.phone)}
                className="inline-flex min-h-touch-target items-center gap-1.5 tabular-nums text-primary hover:underline"
              >
                <PhoneIcon className="h-4 w-4" aria-hidden />
                {formatPhone(item.phone)}
                <span className="sr-only"> (call)</span>
              </a>
            ) : (
              <span className="text-ink-muted">No number stored</span>
            )}
          </dd>

          <dt className="text-ink-muted">Stored</dt>
          <dd className="text-ink">
            {item.store === "server" ? "On the mBHR server" : "On this device"}
          </dd>

          {item.scheduledFor && (
            <>
              <dt className="text-ink-muted">Send from</dt>
              <dd className="tabular-nums text-ink">{formatWhen(item.scheduledFor)}</dd>
            </>
          )}
          {item.createdAt && (
            <>
              <dt className="text-ink-muted">Created</dt>
              <dd className="tabular-nums text-ink">{formatWhen(item.createdAt)}</dd>
            </>
          )}
          {item.lastAttemptAt && (
            <>
              <dt className="text-ink-muted">Last attempt</dt>
              <dd className="tabular-nums text-ink">{formatWhen(item.lastAttemptAt)}</dd>
            </>
          )}
          {item.store !== "server" && (
            <>
              <dt className="text-ink-muted">Attempts</dt>
              <dd className="tabular-nums text-ink">
                {item.attempts} of {MAX_SEND_ATTEMPTS}
              </dd>
            </>
          )}
          {item.sentAt && (
            <>
              <dt className="text-ink-muted">{sentAtLabel(item.sentConfirmation)}</dt>
              <dd className="tabular-nums text-ink">{formatWhen(item.sentAt)}</dd>
            </>
          )}
          <dt className="text-ink-muted">Delivery receipt</dt>
          <dd className="tabular-nums text-ink">
            {item.deliveredAt ? formatWhen(item.deliveredAt) : "None stored"}
          </dd>
        </dl>

        <div>
          <p className="section-label">Message text</p>
          {text === undefined ? (
            <p className="mt-1 text-body text-ink-muted">Preparing the message text…</p>
          ) : text === null ? (
            <p className="mt-1 text-body text-ink-muted">
              The message text could not be prepared on this device.
            </p>
          ) : (
            <>
              <p className="mt-1 whitespace-pre-wrap break-words rounded-md border border-line bg-surface-sunken px-3 py-2 text-body text-ink">
                {text}
              </p>
              <p className="field-hint">
                {parts?.chars} characters, about {parts?.parts} SMS
                {needsCompose &&
                  ". Prepared from the SMS template; the server's version in the patient's language is used when it is available."}
              </p>
            </>
          )}
        </div>

        {/* A sent message can still carry the error of an earlier attempt. */}
        {item.errorMessage && item.state !== "sent" && item.state !== "delivered" && (
          <details className="text-body">
            <summary className="cursor-pointer py-3 text-label leading-5 text-ink-secondary">
              Technical detail
            </summary>
            <p className="mt-1 break-words text-caption text-ink-muted">{item.errorMessage}</p>
          </details>
        )}

        {confirming === "cancel" && (
          <div className="banner banner-warning flex-col" role="group" aria-label="Confirm cancel">
            <p>
              Cancel this reminder for {patientName || "this patient"}? It will not be sent.
              The record stays in the outbox as Cancelled.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-danger"
                disabled={busy}
                onClick={() => onCancel(item)}
              >
                Cancel reminder
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => setConfirming(null)}
                // The button that opened this is gone; start on the safe choice.
                autoFocus
              >
                Keep reminder
              </button>
            </div>
          </div>
        )}

        {confirming === "markSent" && (
          <div className="banner banner-warning flex-col" role="group" aria-label="Confirm mark as sent">
            <p>
              Mark as sent only if the patient got this message another way, for example you
              sent it from a phone. mBHR will not send it.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={() => onMarkSent(item)}
              >
                Mark as sent
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => setConfirming(null)}
                // The button that opened this is gone; start on the safe choice.
                autoFocus
              >
                Back
              </button>
            </div>
          </div>
        )}

        {confirming === "markFailed" && (
          <form
            className="rounded-md border border-line p-3 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submitMarkFailed();
            }}
            noValidate
          >
            <div>
              <label htmlFor="outbox-fail-reason" className="field-label">
                Why was it not sent?
              </label>
              <input
                id="outbox-fail-reason"
                className="input-field"
                autoFocus
                value={failReason}
                onChange={(e) => {
                  setFailReason(e.target.value);
                  setFailReasonError("");
                }}
                aria-invalid={failReasonError ? true : undefined}
                aria-describedby={failReasonError ? FAIL_REASON_ERROR_ID : FAIL_REASON_HINT_ID}
                placeholder="e.g. Patient stopped the medicine"
              />
              {failReasonError ? (
                <p id={FAIL_REASON_ERROR_ID} className="field-error">
                  {failReasonError}
                </p>
              ) : (
                <p id={FAIL_REASON_HINT_ID} className="field-hint">
                  The reminder will not be sent. Use this to stop a reminder that is no longer
                  needed.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="btn-danger" disabled={busy}>
                Mark as failed
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => setConfirming(null)}
              >
                Back
              </button>
            </div>
          </form>
        )}
      </div>

      {hasActions && confirming === null && (
        <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
          {!canManage ? (
            <p className="text-caption text-ink-muted">
              Only pharmacists and admins can send, retry or cancel reminders.
            </p>
          ) : (
            <>
              {retryable && (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy}
                  onClick={() => onRetry(item)}
                >
                  <ArrowPathIcon className="h-5 w-5" aria-hidden />
                  {isStuckSending(item, now) ? "Queue again" : "Retry"}
                </button>
              )}
              {sendable && (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy || blocker !== null}
                  onClick={() => onSendNow(item)}
                  aria-describedby={blocker ? "outbox-send-blocked" : undefined}
                >
                  <PaperAirplaneIcon className="h-5 w-5" aria-hidden />
                  {item.state === "failed" ? "Send again" : "Send now"}
                </button>
              )}
              {markable && (
                <>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy}
                    onClick={() => setConfirming("markSent")}
                  >
                    I sent it myself
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={busy}
                    onClick={() => setConfirming("markFailed")}
                  >
                    Mark as failed
                  </button>
                </>
              )}
              {cancellable && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => setConfirming("cancel")}
                >
                  Cancel reminder
                </button>
              )}
              {sendable && blocker && (
                <p id="outbox-send-blocked" className="w-full text-caption text-ink-muted">
                  {blocker === "offline"
                    ? "Sending needs an internet connection. This device is offline."
                    : "Sending needs the mBHR server, which is not set up on this device."}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
