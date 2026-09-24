import {
  ArrowPathIcon,
  CheckCircleIcon,
  ClipboardDocumentIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  PhoneIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { formatTime } from "@/utils/dateFormat";
import { sendLinkLabel, type LinkDelivery } from "./televisitModel";

/** One line saying what happened to the meeting-link SMS. */
export function LinkDeliveryStatus({
  delivery,
}: {
  delivery: LinkDelivery | undefined;
}) {
  if (!delivery) return null;
  if (delivery.state === "sending") {
    return (
      <p className="flex items-center gap-1.5 text-caption text-ink-muted">
        <ArrowPathIcon className="h-4 w-4 shrink-0" aria-hidden />
        Sending the link by SMS…
      </p>
    );
  }
  if (delivery.state === "sent") {
    return (
      <p className="flex items-center gap-1.5 text-caption text-success-fg">
        <CheckCircleIcon className="h-4 w-4 shrink-0" aria-hidden />
        Link sent by SMS to {delivery.to} at {formatTime(delivery.at)}. Delivery
        to the phone is not tracked.
      </p>
    );
  }
  return (
    <p className="flex items-start gap-1.5 text-caption text-warning-fg">
      <ExclamationTriangleIcon className="mt-px h-4 w-4 shrink-0" aria-hidden />
      <span>
        Link not sent by SMS ({formatTime(delivery.at)}). {delivery.reason}
      </span>
    </p>
  );
}

interface TelevisitLinkNoticeProps {
  headline: string;
  link?: string;
  delivery?: LinkDelivery;
  /** Shown when no SMS has been attempted yet. */
  notSentMessage?: string;
  canSend: boolean;
  /** Why sending is unavailable (offline, read-only role). */
  sendBlockedReason?: string;
  onSend: () => void;
  onCopy: () => void;
  onDismiss: () => void;
}

/**
 * Result of booking or moving a televisit: the link and exactly what
 * happened to the SMS. Never says "sent" unless the send call succeeded.
 */
export function TelevisitLinkNotice({
  headline,
  link,
  delivery,
  notSentMessage = "The meeting link has not been sent to the patient.",
  canSend,
  sendBlockedReason,
  onSend,
  onCopy,
  onDismiss,
}: TelevisitLinkNoticeProps) {
  const tone =
    delivery?.state === "sent"
      ? "banner-success"
      : delivery?.state === "failed" || !delivery
        ? "banner-warning"
        : "banner-info";
  const Icon =
    delivery?.state === "sent"
      ? CheckCircleIcon
      : delivery?.state === "sending"
        ? InformationCircleIcon
        : ExclamationTriangleIcon;
  const showSend = delivery?.state !== "sending";

  return (
    <div className={`banner ${tone}`} role="status" aria-live="polite">
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium">{headline}</p>
        {delivery ? (
          <LinkDeliveryStatus delivery={delivery} />
        ) : (
          <p className="text-caption">{notSentMessage}</p>
        )}
        {link && (
          <p className="break-all text-caption text-ink-secondary">{link}</p>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          {link && (
            <button
              type="button"
              onClick={onCopy}
              className="btn-secondary px-3"
            >
              <ClipboardDocumentIcon className="h-4 w-4" aria-hidden />
              Copy link
            </button>
          )}
          {showSend && (
            <button
              type="button"
              onClick={onSend}
              disabled={!canSend}
              className="btn-secondary px-3"
            >
              <PhoneIcon className="h-4 w-4" aria-hidden />
              {sendLinkLabel(delivery)}
            </button>
          )}
        </div>
        {!canSend && sendBlockedReason && (
          <p className="text-caption">{sendBlockedReason}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="btn-ghost -my-1 px-2"
      >
        <XMarkIcon className="h-5 w-5" aria-hidden />
      </button>
    </div>
  );
}
