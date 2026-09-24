/**
 * Session Warning Dialog
 *
 * Displays a warning when user session is about to expire
 * Provides options to extend the session or logout
 */

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  ExclamationTriangleIcon,
  ClockIcon,
} from "@heroicons/react/24/outline";
import { formatTimeRemaining } from "@/utils/sessionManager";

interface SessionWarningProps {
  isOpen: boolean;
  timeRemaining: number;
  userType: "staff" | "patient";
  onExtend: () => void;
  onLogout: () => void;
}

/** 305 → "5:05". */
function clockFormat(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * What screen readers hear. It changes only at a few points (each whole
 * minute, then 30 and 10 seconds) so the live region does not read out every
 * tick.
 */
function spokenRemaining(seconds: number): string {
  if (seconds <= 0) return "Your session has timed out.";
  if (seconds > 60) {
    return `About ${formatTimeRemaining(Math.ceil(seconds / 60) * 60)} left before you are signed out.`;
  }
  if (seconds > 30) return "Less than 1 minute left before you are signed out.";
  if (seconds > 10) return "30 seconds left before you are signed out.";
  return "10 seconds left before you are signed out.";
}

export function SessionWarning({
  isOpen,
  timeRemaining,
  userType,
  onExtend,
  onLogout,
}: SessionWarningProps) {
  const [countdown, setCountdown] = useState(timeRemaining);
  const dialogRef = useRef<HTMLDivElement>(null);
  const stayRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setCountdown(timeRemaining);
  }, [timeRemaining]);

  useEffect(() => {
    if (!isOpen) return;

    const timer = setInterval(() => {
      setCountdown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen]);

  // Move focus into the dialog on open and give it back on close.
  useEffect(() => {
    if (!isOpen) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    stayRef.current?.focus();
    return () => previous?.focus();
  }, [isOpen]);

  // Escape keeps the session: the dialog must never sign someone out by
  // accident.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onExtend();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onExtend]);

  if (!isOpen) return null;

  const isUrgent = countdown < 60; // Less than 1 minute
  const Icon = isUrgent ? ExclamationTriangleIcon : ClockIcon;

  // Keep Tab inside the dialog while it is open.
  const trapFocus = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !dialogRef.current) return;
    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
      "button:not([disabled])",
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="session-warning-title"
        aria-describedby="session-warning-desc session-warning-time"
        onKeyDown={trapFocus}
        className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <Icon
            className={`h-6 w-6 shrink-0 mt-0.5 ${
              isUrgent ? "text-danger" : "text-warning"
            }`}
            aria-hidden
          />
          <div className="min-w-0">
            <h2 id="session-warning-title" className="text-h2 text-ink">
              {isUrgent ? "Session expiring soon" : "Session about to expire"}
            </h2>
            <p id="session-warning-desc" className="mt-1 text-body text-ink-secondary">
              {userType === "staff"
                ? "Your staff session will expire due to inactivity."
                : "Your patient portal session will expire due to inactivity."}
            </p>
          </div>
        </div>

        <div
          className={`mt-4 rounded-lg border p-4 text-center ${
            isUrgent
              ? "border-danger-line bg-danger-soft"
              : "border-warning-line bg-warning-soft"
          }`}
        >
          <p
            className={`text-label ${
              isUrgent ? "text-danger-fg" : "text-warning-fg"
            }`}
          >
            Time left before you are signed out
          </p>
          <p
            className={`mt-1 text-display tabular-nums ${
              isUrgent ? "text-danger-fg" : "text-warning-fg"
            }`}
            aria-hidden
          >
            {clockFormat(countdown)}
          </p>
          <p
            id="session-warning-time"
            className="sr-only"
            aria-live="polite"
            aria-atomic="true"
          >
            {spokenRemaining(countdown)}
          </p>
        </div>

        <ul className="mt-4 space-y-1.5 text-body text-ink-secondary">
          <li className="flex items-start gap-2">
            <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-disabled" />
            Choose Stay signed in to keep working.
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-disabled" />
            Records you have already saved stay on this device. Anything not
            yet saved on the current screen may be lost when you are signed
            out.
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-disabled" />
            Signing out after inactivity protects patient privacy on shared
            devices.
          </li>
        </ul>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onLogout}
            className="btn-secondary sm:w-auto"
          >
            Sign out now
          </button>
          <button
            ref={stayRef}
            type="button"
            onClick={onExtend}
            className="btn-primary flex-1"
          >
            Stay signed in
          </button>
        </div>

        {userType === "patient" && (
          <p className="mt-4 text-center text-caption text-ink-muted">
            For your security, sessions automatically expire after periods of
            inactivity.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Session Status Indicator
 * Shows current session status in the header/navbar
 */
interface SessionStatusProps {
  timeRemaining: number;
  userType: "staff" | "patient";
}

export function SessionStatus({
  timeRemaining,
  userType: _userType,
}: SessionStatusProps) {
  const hours = Math.floor(timeRemaining / 3600);
  const minutes = Math.floor((timeRemaining % 3600) / 60);

  const isWarning = timeRemaining < 600; // Less than 10 minutes
  const isUrgent = timeRemaining < 300; // Less than 5 minutes

  if (timeRemaining < 0) return null;

  const tone = isUrgent
    ? "badge-danger"
    : isWarning
      ? "badge-warning"
      : "badge-neutral";
  const Icon = isWarning ? ExclamationTriangleIcon : ClockIcon;

  return (
    <span className={`badge ${tone} text-label`}>
      <Icon className="h-4 w-4" aria-hidden />
      <span className="sr-only">Session time left: </span>
      <span className="font-medium tabular-nums">
        {hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`}
      </span>
      {isWarning && <span className="sr-only"> (expiring soon)</span>}
    </span>
  );
}
