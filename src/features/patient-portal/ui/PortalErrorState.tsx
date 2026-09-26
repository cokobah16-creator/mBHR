import type { ReactNode } from "react";
import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { useT } from "@/hooks/useT";
import { PatientFriendlyAlert, type NoticeTone } from "./PatientFriendlyAlert";

/**
 * Why a portal page could not show its information. Each kind has its own
 * words so a patient can tell "no internet" from "the clinic's system did not
 * answer" from "you need to sign in again". Never shows raw error text.
 */
export type PortalErrorKind =
  | "offline"
  | "timeout"
  | "failed"
  | "signedOut"
  | "accessOff";

const TONE: Record<PortalErrorKind, NoticeTone> = {
  offline: "offline",
  timeout: "warning",
  failed: "danger",
  signedOut: "warning",
  accessOff: "info",
};

/** Kinds where trying again can help. */
const RETRYABLE = new Set<PortalErrorKind>(["offline", "timeout", "failed"]);

export function PortalErrorState({
  kind,
  what,
  onRetry,
  retrying = false,
  action,
}: {
  kind: PortalErrorKind;
  /** What could not be loaded, already translated: "your lab results". */
  what?: string;
  onRetry?: () => void;
  retrying?: boolean;
  /** Extra action, e.g. a sign-in link for `signedOut`. */
  action?: ReactNode;
}) {
  const { t } = useT();
  const subject = what || t("portal.state.error.defaultWhat");
  const showRetry = !!onRetry && RETRYABLE.has(kind);
  return (
    <PatientFriendlyAlert
      tone={TONE[kind]}
      title={t(`portal.state.error.${kind}.title`, { what: subject })}
      action={
        showRetry || action ? (
          <div className="flex flex-wrap gap-2">
            {showRetry && (
              <button
                type="button"
                onClick={onRetry}
                disabled={retrying}
                className="btn-secondary"
              >
                <ArrowPathIcon className="h-5 w-5" aria-hidden />
                {retrying ? t("portal.state.retrying") : t("portal.error.retry")}
              </button>
            )}
            {action}
          </div>
        ) : undefined
      }
    >
      {t(`portal.state.error.${kind}.body`, { what: subject })}
    </PatientFriendlyAlert>
  );
}
