import type { ComponentType, ReactNode, SVGProps } from "react";
import {
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  CheckCircleIcon,
  SignalSlashIcon,
} from "@heroicons/react/24/outline";
import { PageHeader, type Crumb } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Page frame for patient portal screens: one readable column, a clear title
 * and a line saying what the page shows and where it comes from.
 */
export function PortalPage({
  title,
  description,
  breadcrumbs,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  breadcrumbs?: Crumb[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <PageHeader
        title={title}
        description={description}
        breadcrumbs={breadcrumbs}
        actions={actions}
      />
      <div className="space-y-5">{children}</div>
    </div>
  );
}

type NoticeTone = "info" | "success" | "warning" | "danger" | "offline";

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
export function PortalNotice({
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

/** Loading placeholder shaped like a portal list page. */
export function PortalListSkeleton({
  label = "Loading",
  rows = 4,
}: {
  label?: string;
  rows?: number;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <span role="status" className="sr-only">
        {label}
      </span>
      <div className="space-y-4" aria-hidden>
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
        <div className="panel divide-y divide-line">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="space-y-2 p-4">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-64 max-w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
