import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** What will happen if the person confirms. */
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busyLabel?: string;
  busy?: boolean;
  /** Use the danger button and alertdialog role (removals, revocations). */
  destructive?: boolean;
  /** Shown inside the dialog when the action failed; the dialog stays open. */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A confirmation step that states the effect of an action before it runs.
 * Focus starts on the safe choice, Tab stays inside, Escape cancels (unless
 * the action is in progress) and focus returns to where it was on close.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  busyLabel,
  busy = false,
  destructive = false,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descId = `${baseId}-desc`;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    cancelRef.current?.focus();
    return () => {
      previous?.focus();
    };
  }, [open]);

  // While busy both buttons are disabled, which drops keyboard focus out of
  // the dialog. If it stays open (for example to show an error), bring focus
  // back so Tab and Escape keep working.
  useEffect(() => {
    if (!open || busy) return;
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) {
      cancelRef.current?.focus();
    }
  }, [open, busy]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      if (!busy) {
        e.stopPropagation();
        onCancel();
      }
      return;
    }
    if (e.key !== "Tab" || !dialogRef.current) return;
    const items = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
    );
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center">
      <div
        ref={dialogRef}
        role={destructive ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onKeyDown={onKeyDown}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-line bg-surface p-6 shadow-2xl"
      >
        <h2 id={titleId} className="text-h2 text-ink">
          {title}
        </h2>
        <div id={descId} className="mt-2 space-y-3 text-body text-ink-secondary">
          {children}
        </div>

        {error && (
          <div className="banner banner-danger mt-4" role="alert">
            <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="btn-secondary"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={destructive ? "btn-danger" : "btn-primary"}
          >
            {busy ? (busyLabel ?? "Please wait…") : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
