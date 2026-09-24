import { useEffect, useRef, type KeyboardEvent } from "react";
import { SignalSlashIcon } from "@heroicons/react/24/outline";
import type { BulkStrategy, BulkSummary } from "./resolutionSummary";

const HEADINGS: Record<BulkStrategy, string> = {
  keep_local: "Keep the device copy for the selected conflicts?",
  keep_remote: "Keep the server copy for the selected conflicts?",
  ignore: "Dismiss the selected conflicts?",
};

const REASON_ERROR_ID = "bulk-conflict-reason-error";
const REASON_HINT_ID = "bulk-conflict-reason-hint";

const CONFIRM: Record<BulkStrategy, string> = {
  keep_local: "Keep device copies",
  keep_remote: "Keep server copies",
  ignore: "Dismiss conflicts",
};

interface BulkResolveDialogProps {
  strategy: BulkStrategy;
  summary: BulkSummary;
  selectedCount: number;
  reason: string;
  onReasonChange: (value: string) => void;
  reasonError: string | null;
  busy: boolean;
  /** This device's copies are still being read; the summary may change. */
  checking?: boolean;
  online: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function BulkResolveDialog({
  strategy,
  summary,
  selectedCount,
  reason,
  onReasonChange,
  reasonError,
  busy,
  checking = false,
  online,
  onConfirm,
  onCancel,
}: BulkResolveDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    return () => previous?.focus();
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      if (busy) return;
      e.stopPropagation();
      onCancel();
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
    if (e.shiftKey && (active === first || !root.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const nothingToDo = summary.eligibleIds.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="bulk-conflict-title"
        aria-describedby="bulk-conflict-desc"
        onKeyDown={onKeyDown}
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-xl"
      >
        <div className="space-y-4 overflow-y-auto p-6">
          <h2 id="bulk-conflict-title" className="text-h2 text-ink">
            {HEADINGS[strategy]}
          </h2>
          <div id="bulk-conflict-desc" className="space-y-2 text-body text-ink">
            <p className="text-ink-secondary">
              {selectedCount} selected. What will happen:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              {summary.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          {!nothingToDo && (
            <div>
              <label htmlFor="bulk-conflict-reason" className="field-label">
                Reason
              </label>
              <textarea
                id="bulk-conflict-reason"
                value={reason}
                onChange={(e) => onReasonChange(e.target.value)}
                rows={2}
                className="input-field"
                required
                aria-invalid={!!reasonError}
                aria-describedby={reasonError ? REASON_ERROR_ID : REASON_HINT_ID}
              />
              {reasonError ? (
                <p id={REASON_ERROR_ID} className="field-error" role="alert">
                  {reasonError}
                </p>
              ) : (
                <p id={REASON_HINT_ID} className="field-hint">
                  Saved with each decision in the audit log.
                </p>
              )}
            </div>
          )}
          {checking && (
            <p role="status" className="text-caption text-ink-muted">
              Checking which of these records are stored on this device…
            </p>
          )}
          {!online && (
            <div className="banner banner-warning">
              <SignalSlashIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <p>You are offline. Reconnect to save these decisions on the server.</p>
            </div>
          )}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-line px-6 py-3 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            className="btn-secondary"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={onConfirm}
            disabled={busy || checking || nothingToDo || !online}
          >
            {busy ? "Saving…" : `${CONFIRM[strategy]} (${summary.eligibleIds.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
