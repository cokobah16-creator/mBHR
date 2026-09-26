import type { ComponentType, ReactNode, SVGProps } from "react";
import {
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  CheckCircleIcon,
  SignalSlashIcon,
} from "@heroicons/react/24/outline";

export type NoticeTone = "info" | "success" | "warning" | "danger" | "offline";

const NOTICE_CLASS: Record<NoticeTone, string> = {
  info: "banner-info",
  success: "banner-success",
  warning: "banner-warning",
  danger: "banner-danger",
  offline: "banner-warning",
};

const NOTICE_ICON: Record<NoticeTone, ComponentType<SVGProps<SVGSVGElement>>> =
  {
    info: InformationCircleIcon,
    success: CheckCircleIcon,
    warning: ExclamationTriangleIcon,
    danger: ExclamationCircleIcon,
    offline: SignalSlashIcon,
  };

/**
 * A banner with an icon and text, so the state never relies on colour.
 * Danger notices are announced immediately; the rest politely.
 */
export function PatientFriendlyAlert({
  tone,
  title,
  children,
  action,
}: {
  tone: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const Icon = NOTICE_ICON[tone];
  return (
    <div
      className={`banner ${NOTICE_CLASS[tone]}`}
      role={tone === "danger" ? "alert" : "status"}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={title ? "mt-0.5" : ""}>{children}</div>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}
