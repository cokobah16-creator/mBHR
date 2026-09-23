import { useEffect, useState } from "react";
import type { ComponentType, ReactNode, RefObject, SVGProps } from "react";
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  CheckIcon,
  ClockIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  SignalIcon,
  SignalSlashIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import type { MessagePriority } from "@/services/palaverRoom";
import {
  PRIORITY_LABEL,
  formatClock,
  formatFullTimestamp,
  formatMessageTime,
  priorityTone,
  type ConnectionKind,
  type ConnectionSummary,
} from "./messagingModel";
import type { UnsentState } from "./unsentMessages";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

/** After this long in "Sending…", say that the request is slow. */
const SLOW_SEND_MS = 20_000;

// ── Panel header ─────────────────────────────────────────────────────────────

export function PanelHeader({
  headingId,
  headingRef,
  title,
  subtitle,
  icon: HeaderIcon,
  onBack,
  backLabel = "Back",
  onClose,
  closeLabel,
  actions,
}: {
  headingId: string;
  headingRef?: RefObject<HTMLHeadingElement>;
  title: string;
  subtitle?: ReactNode;
  icon?: Icon;
  onBack?: () => void;
  backLabel?: string;
  onClose?: () => void;
  closeLabel: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-2">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="btn-ghost min-w-touch-target px-2"
          aria-label={backLabel}
        >
          <ArrowLeftIcon className="h-5 w-5" aria-hidden />
        </button>
      ) : (
        HeaderIcon && (
          <HeaderIcon
            className="ml-2 h-5 w-5 shrink-0 text-ink-muted"
            aria-hidden
          />
        )
      )}
      <div className="min-w-0 flex-1 px-1">
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="truncate text-h2 text-ink focus:outline-none"
        >
          {title}
        </h2>
        {subtitle && (
          <p className="truncate text-caption text-ink-muted">{subtitle}</p>
        )}
      </div>
      {actions}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="btn-ghost min-w-touch-target px-2"
          aria-label={closeLabel}
        >
          <XMarkIcon className="h-5 w-5" aria-hidden />
        </button>
      )}
    </header>
  );
}

// ── Connection line ──────────────────────────────────────────────────────────

const CONNECTION_ICON: Record<ConnectionKind, Icon> = {
  not_configured: ExclamationTriangleIcon,
  offline: SignalSlashIcon,
  live: SignalIcon,
  connecting: ArrowPathIcon,
  polling: ClockIcon,
};

const CONNECTION_ICON_CLASS: Record<ConnectionKind, string> = {
  not_configured: "text-warning",
  offline: "text-warning",
  live: "text-success",
  connecting: "text-ink-muted",
  polling: "text-ink-muted",
};

/**
 * One line under the header that says whether messages can be sent and
 * whether new ones arrive live, plus when the list was last checked.
 */
export function ConnectionBar({
  summary,
  lastCheckedAt,
  refreshing,
  onRefresh,
}: {
  summary: ConnectionSummary;
  lastCheckedAt: Date | null;
  refreshing: boolean;
  onRefresh?: () => void;
}) {
  const StateIcon = CONNECTION_ICON[summary.kind];
  const canRefresh =
    !!onRefresh && summary.kind !== "not_configured" && summary.kind !== "offline";
  return (
    <div className="flex shrink-0 items-start gap-2 border-b border-line bg-surface-sunken px-4 py-2">
      <StateIcon
        className={`mt-0.5 h-4 w-4 shrink-0 ${CONNECTION_ICON_CLASS[summary.kind]}`}
        aria-hidden
      />
      <p className="min-w-0 flex-1 text-caption text-ink-secondary">
        <span role="status" className="font-semibold text-ink">
          {summary.label}.
        </span>{" "}
        {summary.detail}
        {lastCheckedAt && (
          <>
            {" "}
            Last checked{" "}
            <time dateTime={lastCheckedAt.toISOString()}>
              {formatClock(lastCheckedAt)}
            </time>
            .
          </>
        )}
      </p>
      {canRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="btn-ghost -my-2 shrink-0 px-2 text-caption disabled:opacity-60"
        >
          <ArrowPathIcon className="h-4 w-4" aria-hidden />
          {refreshing ? "Checking…" : "Refresh"}
        </button>
      )}
    </div>
  );
}

// ── Small pieces ─────────────────────────────────────────────────────────────

export function MessageTime({
  value,
  className = "",
}: {
  value: string;
  className?: string;
}) {
  return (
    <time
      dateTime={value}
      title={formatFullTimestamp(value)}
      className={`shrink-0 text-caption tabular-nums text-ink-muted ${className}`}
    >
      {formatMessageTime(value)}
    </time>
  );
}

/** Urgent / critical badge (with icon); nothing for normal priority. */
export function PriorityBadge({
  priority,
}: {
  priority: MessagePriority | null | undefined;
}) {
  const tone = priorityTone(priority);
  if (!tone || !priority) return null;
  return <StatusBadge tone={tone}>{PRIORITY_LABEL[priority]}</StatusBadge>;
}

/** Delivery line under a message the online service has stored. */
export function SentStatus({
  read,
  readAt,
  readLabel = "Read",
}: {
  /** Pass only when read receipts are reliable for this message type. */
  read?: boolean;
  readAt?: string | null;
  readLabel?: string;
}) {
  return (
    <p className="flex items-center gap-1 text-caption text-ink-muted">
      <CheckIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      Sent
      {read && (
        <>
          {" · "}
          {readLabel}
          {readAt ? ` ${formatMessageTime(readAt)}` : ""}
        </>
      )}
    </p>
  );
}

/**
 * State line and actions for a message the online service has not
 * confirmed: sending, waiting for a connection, or failed.
 */
export function UnsentStatus({
  state,
  errorText,
  onRetry,
  onDiscard,
}: {
  state: UnsentState;
  errorText?: string;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  // Requests have no client timeout, so say when one is taking long instead
  // of showing "Sending…" forever. No retry is offered while it is still in
  // flight: the first attempt may yet be stored, and a retry would send the
  // message twice.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (state !== "sending") return;
    const timer = setTimeout(() => setSlow(true), SLOW_SEND_MS);
    return () => clearTimeout(timer);
  }, [state]);

  if (state === "sending") {
    return (
      <p className="flex items-start gap-1.5 text-caption text-ink-muted">
        <ClockIcon className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          <span className="font-semibold">Sending…</span>
          {slow &&
            " This is taking longer than usual; the connection may be slow. It stays here until the online service answers."}
        </span>
      </p>
    );
  }
  const waiting = state === "waiting";
  const StateIcon = waiting ? SignalSlashIcon : ExclamationCircleIcon;
  return (
    <div className="space-y-1.5">
      <p
        className={`flex items-start gap-1.5 text-caption ${waiting ? "text-warning-fg" : "text-danger-fg"}`}
      >
        <StateIcon className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          <span className="font-semibold">
            {waiting ? "Not sent yet." : "Not sent."}
          </span>{" "}
          {waiting
            ? "Waiting for a connection. It sends when the connection returns while this panel is open. Unsent messages are not saved on the device, so reloading the app discards them."
            : errorText || "The online service did not store it."}
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="btn-secondary min-h-touch-target px-3 py-1.5 text-caption"
        >
          <ArrowPathIcon className="h-4 w-4" aria-hidden />
          {waiting ? "Try now" : "Retry"}
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="btn-ghost px-3 text-caption"
        >
          Discard
        </button>
      </div>
    </div>
  );
}

/** Loading placeholder for a thread list. */
export function ThreadListSkeleton({ label }: { label: string }) {
  return (
    <div>
      <span role="status" className="sr-only">
        {label}
      </span>
      <ul className="divide-y divide-line" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="flex gap-3 px-4 py-3">
            <Skeleton className="mt-1.5 h-2 w-2 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
