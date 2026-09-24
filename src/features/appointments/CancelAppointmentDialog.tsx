import { useEffect, useRef, useState, type ReactNode } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useDialogFocus } from "./useDialogFocus";

interface CancelAppointmentDialogProps {
  /** e.g. "Cancel the appointment for Ada Obi?" */
  title: string;
  /** What is being cancelled: time, type. */
  summary: ReactNode;
  /** What happens next, one line each. */
  consequences: string[];
  busy: boolean;
  error?: string | null;
  confirmLabel?: string;
  keepLabel?: string;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

/**
 * Confirmation before cancelling an appointment or televisit. Escape and
 * the keep button close it; focus starts on the keep button so a stray
 * Enter never cancels.
 */
export function CancelAppointmentDialog({
  title,
  summary,
  consequences,
  busy,
  error,
  confirmLabel = "Cancel appointment",
  keepLabel = "Keep appointment",
  onConfirm,
  onClose,
}: CancelAppointmentDialogProps) {
  const [reason, setReason] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, () => {
    if (!busy) onClose();
  });

  // The pressed button is disabled while saving; keep focus in the dialog
  // so Tab, Escape and the error announcement still work.
  useEffect(() => {
    if (busy) dialogRef.current?.focus();
  }, [busy]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby="cancel-appointment-title"
        aria-describedby="cancel-appointment-desc"
        className="max-h-full w-full max-w-md overflow-y-auto rounded-lg border border-line bg-surface p-6 shadow-2xl"
      >
        <h2 id="cancel-appointment-title" className="text-h2 text-ink">
          {title}
        </h2>
        <div
          id="cancel-appointment-desc"
          className="mt-2 space-y-2 text-body text-ink-secondary"
        >
          <div>{summary}</div>
          {consequences.length > 0 && (
            <ul className="list-disc space-y-1 pl-5">
              {consequences.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4">
          <label htmlFor="cancel-appointment-reason" className="field-label">
            Reason (optional)
          </label>
          <textarea
            id="cancel-appointment-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className="input-field"
            placeholder="e.g. Patient asked to rebook"
            disabled={busy}
          />
          <p className="field-hint">Saved with the appointment notes.</p>
        </div>

        {error && (
          <div className="banner banner-danger mt-4" role="alert">
            <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            data-autofocus
            onClick={onClose}
            disabled={busy}
            className="btn-secondary"
          >
            {keepLabel}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason)}
            disabled={busy}
            className="btn-danger"
          >
            {busy ? "Cancelling…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
