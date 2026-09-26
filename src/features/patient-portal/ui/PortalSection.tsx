import { useId, type ReactNode } from "react";

/**
 * A titled part of a portal page. Groups related items under a real heading
 * instead of wrapping every sentence in its own card.
 *
 * `variant="list"` puts children in one bordered surface with dividers, for
 * rows such as visits, results or messages; `"plain"` leaves layout to the
 * children.
 */
export function PortalSection({
  title,
  description,
  action,
  variant = "plain",
  headingLevel = 2,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** A link or button about the whole section, e.g. "See all visits". */
  action?: ReactNode;
  variant?: "plain" | "list";
  headingLevel?: 2 | 3;
  children: ReactNode;
}) {
  const headingId = useId();
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <Heading
            id={headingId}
            className={headingLevel === 2 ? "text-h2 text-ink" : "text-h3 text-ink"}
          >
            {title}
          </Heading>
          {description && (
            <p className="mt-0.5 text-body text-ink-muted">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {variant === "list" ? (
        <div className="panel divide-y divide-line overflow-hidden">{children}</div>
      ) : (
        children
      )}
    </section>
  );
}
