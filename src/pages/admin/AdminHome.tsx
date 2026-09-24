import { Link } from "react-router-dom";
import { ChevronRightIcon } from "@heroicons/react/20/solid";
import { Cog6ToothIcon } from "@heroicons/react/24/outline";
import { useAuthStore } from "@/stores/auth";
import { getRoleDisplayName } from "@/auth/roles";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge, type Tone } from "@/components/ui/StatusBadge";
import { adminSectionsForRole } from "@/features/admin/adminSections";
import { useServerStatus } from "@/features/admin/useServerStatus";
import type { ServerState } from "@/features/admin/serverStatus";

const SERVER_TONE: Record<ServerState, Tone> = {
  available: "success",
  offline: "warning",
  "not-configured": "neutral",
};

/**
 * Administration landing page. Lists only the tools the signed-in role can
 * open; the access rules mirror the route guards in App.tsx (see
 * features/admin/adminSections.ts).
 */
export default function AdminHome() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const server = useServerStatus();
  const sections = adminSectionsForRole(currentUser?.role);
  const needsServer = sections.some((s) => s.entries.some((e) => e.needsServer));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Administration"
        description="Reports, staff access, data and system tools. You see only the tools your role can open."
      />

      {sections.length === 0 ? (
        <section className="panel" aria-label="Administration tools">
          <EmptyState
            icon={Cog6ToothIcon}
            title="No administration tools for your role"
            description={
              currentUser
                ? `Your role (${getRoleDisplayName(currentUser.role)}) has no administration pages. Ask an administrator if you need reports or staff accounts.`
                : "Sign in to see the administration tools for your role."
            }
            action={
              <Link to="/dashboard" className="btn-secondary">
                Back to dashboard
              </Link>
            }
          />
        </section>
      ) : (
        <>
          {needsServer && (
            <div
              className="card flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-3"
              aria-live="polite"
            >
              <span className="section-label">Server connection</span>
              <StatusBadge tone={SERVER_TONE[server.state]} icon>
                {server.label}
              </StatusBadge>
              <span className="text-caption text-ink-muted">
                {server.detail}
              </span>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            {sections.map((section) => {
              const titleId = `admin-section-${section.id}`;
              return (
                <section
                  key={section.id}
                  className="panel"
                  aria-labelledby={titleId}
                >
                  <div className="panel-header flex-col items-start gap-0.5">
                    <h2 id={titleId} className="panel-title">
                      {section.title}
                    </h2>
                    <p className="text-caption text-ink-muted">
                      {section.description}
                    </p>
                  </div>
                  <ul className="divide-y divide-line">
                    {section.entries.map((entry) => (
                      <li key={entry.id}>
                        <Link
                          to={entry.to}
                          className="flex min-h-touch-target items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="text-body font-medium text-ink">
                                {entry.title}
                              </span>
                              {entry.needsServer && !server.available && (
                                <StatusBadge tone="warning">
                                  Needs the server
                                </StatusBadge>
                              )}
                            </span>
                            <span className="mt-0.5 block text-caption text-ink-muted">
                              {entry.description}
                            </span>
                          </span>
                          <ChevronRightIcon
                            className="h-5 w-5 shrink-0 text-ink-disabled"
                            aria-hidden
                          />
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {section.note && (
                    <p className="border-t border-line px-4 py-3 text-caption text-ink-muted">
                      {section.note}
                    </p>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
