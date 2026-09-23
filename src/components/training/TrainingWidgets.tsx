import type { ReactNode } from "react";
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { formatClock, type SaveState } from "./trainingRules";

/** A labelled number in a training page's score strip. */
export function TrainingStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <p className="text-caption text-ink-muted">{label}</p>
      <p className="text-stat tabular-nums text-ink">{value}</p>
      {hint && <p className="text-caption text-ink-muted">{hint}</p>}
    </div>
  );
}

/**
 * Countdown shown during a round. Low time is said in words and with an
 * icon, never by colour or flashing alone. Screen readers are not told
 * every second; they get one polite message when time is running low.
 */
export function RoundTimer({
  secondsLeft,
  lowAt,
  label = "Time left",
}: {
  secondsLeft: number;
  /** At or below this many seconds the timer switches to its warning state. */
  lowAt: number;
  label?: string;
}) {
  const low = secondsLeft <= lowAt;
  return (
    <div
      className={`rounded-lg border px-4 py-3 ${
        low ? "border-warning-line bg-warning-soft" : "border-line bg-surface"
      }`}
    >
      <p className={`text-caption ${low ? "text-warning-fg" : "text-ink-muted"}`}>
        {label}
      </p>
      <p
        role="timer"
        aria-label={`${label}: ${formatClock(secondsLeft)}`}
        className={`flex items-center gap-1.5 text-stat tabular-nums ${
          low ? "text-warning-fg" : "text-ink"
        }`}
      >
        {low ? (
          <ExclamationTriangleIcon className="h-6 w-6 shrink-0" aria-hidden />
        ) : (
          <ClockIcon className="h-6 w-6 shrink-0 text-ink-muted" aria-hidden />
        )}
        {formatClock(secondsLeft)}
      </p>
      <p className="sr-only" aria-live="polite">
        {low ? "Time is running low." : ""}
      </p>
      {low && <p className="text-caption text-warning-fg">Time is running low</p>}
    </div>
  );
}

/** How a round's score is worked out; every line must match the real maths. */
export function ScoringRules({
  title = "How tokens are worked out",
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface-sunken p-4 text-left">
      <p className="section-label mb-2">{title}</p>
      <ul className="list-disc space-y-1 pl-5 text-body text-ink-secondary">
        {children}
      </ul>
    </div>
  );
}

/**
 * Honest save state for a finished game session. Sessions are stored on
 * this device and only add tokens after an admin approves them.
 */
export function SessionSaveStatus({
  state,
  tokens,
  onRetry,
}: {
  state: SaveState;
  tokens: number | null;
  onRetry?: () => void;
}) {
  if (state === "idle") return null;
  return (
    <div aria-live="polite">
      {state === "saving" && (
        <div className="banner banner-info">
          <ArrowPathIcon className="h-5 w-5 shrink-0" aria-hidden />
          <p>Saving your result on this device…</p>
        </div>
      )}
      {state === "saved" && (
        <div className="banner banner-success">
          <CheckCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
          <p>
            Result saved on this device.
            {tokens !== null && (
              <>
                {" "}
                <span className="font-semibold">{tokens} tokens</span> are
                waiting for an admin to approve them; they are added to your
                game wallet after approval.
              </>
            )}
          </p>
        </div>
      )}
      {state === "failed" && (
        <div className="banner banner-danger" role="alert">
          <ExclamationCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
          <div className="flex-1">
            <p>
              Your result could not be saved, so no tokens will be added. Your
              score is still shown below.
            </p>
            {onRetry && (
              <button type="button" onClick={onRetry} className="btn-secondary mt-2">
                Try saving again
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
