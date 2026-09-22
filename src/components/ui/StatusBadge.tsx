import type { ReactNode } from "react";
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ExclamationCircleIcon,
  InformationCircleIcon,
  MinusCircleIcon,
} from "@heroicons/react/20/solid";

export type Tone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "critical";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "badge-neutral",
  info: "badge-info",
  success: "badge-success",
  warning: "badge-warning",
  danger: "badge-danger",
  critical: "badge-critical",
};

const TONE_ICON: Record<Tone, typeof CheckCircleIcon> = {
  neutral: MinusCircleIcon,
  info: InformationCircleIcon,
  success: CheckCircleIcon,
  warning: ExclamationTriangleIcon,
  danger: ExclamationCircleIcon,
  critical: ExclamationCircleIcon,
};

interface StatusBadgeProps {
  tone?: Tone;
  children: ReactNode;
  /**
   * Show the tone's icon. Defaults to on for warning/danger/critical so the
   * state is never communicated by colour alone.
   */
  icon?: boolean;
  className?: string;
}

/**
 * The single status badge used across mBHR. Colour is semantic — use it for
 * state (abnormal vital, pending sync, allergy), never for decoration.
 */
export function StatusBadge({
  tone = "neutral",
  children,
  icon,
  className = "",
}: StatusBadgeProps) {
  const showIcon =
    icon ?? (tone === "warning" || tone === "danger" || tone === "critical");
  const Icon = TONE_ICON[tone];
  return (
    <span className={`badge ${TONE_CLASS[tone]} ${className}`}>
      {showIcon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />}
      {children}
    </span>
  );
}
