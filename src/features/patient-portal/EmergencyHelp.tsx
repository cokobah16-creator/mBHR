import { useEffect, useRef } from "react";
import {
  ExclamationTriangleIcon,
  PhoneIcon,
  XMarkIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import { readPortalUser } from "./portalSession";

interface EmergencyHelpProps {
  onClose: () => void;
}

// Nigeria's national toll-free emergency number.
const EMERGENCY_NUMBER = "112";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Emergency help dialog, reachable from every portal page. It only offers
 * what the phone can really do: place a call. The portal cannot alert a
 * health worker, so it says so instead of pretending.
 */
export function EmergencyHelp({ onClose }: EmergencyHelpProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const callRef = useRef<HTMLAnchorElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Focus the call button, keep Tab inside the dialog, close on Escape and
  // hand focus back to whatever opened it.
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    callRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
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

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, []);

  const patientId = readPortalUser()?.patientId || "";

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-ink/60"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="emergency-help-title"
        aria-describedby="emergency-help-desc"
        className="relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-danger-line bg-danger-soft px-5 py-3">
          <div className="flex items-center gap-3">
            <ExclamationTriangleIcon
              className="h-7 w-7 shrink-0 text-danger"
              aria-hidden
            />
            <h2 id="emergency-help-title" className="text-h1 text-danger-fg">
              Emergency help
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost text-danger-fg hover:text-danger-fg"
            aria-label="Close emergency help"
          >
            <XMarkIcon className="h-6 w-6" aria-hidden />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <p id="emergency-help-desc" className="text-body text-ink">
            If someone is badly hurt, cannot breathe, or is very unwell right
            now, call for help or go to the nearest hospital or health centre.
          </p>

          <div>
            <a
              ref={callRef}
              href={`tel:${EMERGENCY_NUMBER}`}
              className="btn-danger min-h-[56px] w-full text-h3"
            >
              <PhoneIcon className="h-6 w-6" aria-hidden />
              Call {EMERGENCY_NUMBER}
            </a>
            <p className="mt-1.5 text-center text-caption text-ink-muted">
              {EMERGENCY_NUMBER} is Nigeria&apos;s free emergency number.
            </p>
          </div>

          {patientId && (
            <div className="rounded-lg border border-line bg-surface-sunken p-4">
              <p className="text-label text-ink-secondary">Your patient ID</p>
              <p className="mt-1 break-all font-mono text-h3 text-ink">
                {patientId}
              </p>
              <p className="mt-1 text-caption text-ink-muted">
                Show this to a health worker so they can find your outreach
                record.
              </p>
            </div>
          )}

          <div className="banner banner-info">
            <InformationCircleIcon
              className="mt-0.5 h-5 w-5 shrink-0"
              aria-hidden
            />
            <p>
              This portal cannot call or alert anyone for you. Messages to the
              clinic are not checked all the time, so do not use them in an
              emergency.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="btn-secondary w-full"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
