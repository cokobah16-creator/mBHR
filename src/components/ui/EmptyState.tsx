import type { ComponentType, ReactNode, SVGProps } from "react";

interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  action?: ReactNode;
  className?: string;
}

/**
 * Explains what belongs in an empty area and what to do next. Keep the
 * copy literal: "No patients waiting for vitals." beats a slogan.
 */
export function EmptyState({
  title,
  description,
  icon: Icon,
  action,
  className = "",
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center px-6 py-10 ${className}`}
    >
      {Icon && <Icon className="h-8 w-8 text-ink-disabled mb-3" aria-hidden />}
      <p className="text-h3 text-ink">{title}</p>
      {description && (
        <p className="mt-1 text-body text-ink-muted max-w-sm">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
