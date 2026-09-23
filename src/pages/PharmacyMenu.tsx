import { Link } from "react-router-dom";
import { ChevronRightIcon, LockClosedIcon } from "@heroicons/react/24/outline";
import { useAuthStore } from "@/stores/auth";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { pharmacyTasksForRole } from "@/features/pharmacy/pharmacyTasks";

export default function PharmacyMenu() {
  const role = useAuthStore((s) => s.currentUser?.role);
  const available = pharmacyTasksForRole(role);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Pharmacy"
        description="Choose a pharmacy task."
        breadcrumbs={[{ label: "Dashboard", to: "/dashboard" }, { label: "Pharmacy" }]}
      />

      {available.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={LockClosedIcon}
            title="No pharmacy tasks for your role"
            description="Dispensing, stock and reports are for pharmacists and administrators. Ask an administrator if you need access."
            action={
              <Link to="/dashboard" className="btn-secondary">
                Back to dashboard
              </Link>
            }
          />
        </div>
      ) : (
        <nav aria-label="Pharmacy tasks">
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {available.map(({ to, title, desc, Icon }) => (
              <li key={to}>
                <Link
                  to={to}
                  className="flex h-full min-h-touch-target items-start gap-3 rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-strong hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                >
                  <span className="rounded-md border border-line bg-surface-sunken p-2">
                    <Icon className="h-5 w-5 text-ink-secondary" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-h3 text-ink">{title}</span>
                    <span className="mt-0.5 block text-body text-ink-muted">{desc}</span>
                  </span>
                  <ChevronRightIcon className="mt-1 h-4 w-4 shrink-0 text-ink-disabled" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
