import { PageHeader } from "@/components/ui/PageHeader";
import { DeviceResetPanel } from "@/components/DeviceResetPanel";

/**
 * Administrator settings. Admin-only (see the route guard in App.tsx).
 * Device recovery lives here rather than on the staff sign-in page so it is
 * only reachable by a signed-in administrator.
 */
export default function Settings() {
  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Dashboard", to: "/dashboard" }, { label: "Settings" }]}
        title="Settings"
        description="Administrator settings for this device."
      />

      <section className="panel" aria-labelledby="device-settings-title">
        <div className="panel-header">
          <h2 id="device-settings-title" className="panel-title">
            Device recovery
          </h2>
        </div>
        <div className="panel-body space-y-3">
          <p className="text-body text-ink-secondary">
            Use this when this device's local data is corrupted and staff can no
            longer work on it. Sync first: anything not yet uploaded is lost.
          </p>
          {/* Asks for an administrator PIN again even though you are signed in */}
          <DeviceResetPanel />
        </div>
      </section>
    </div>
  );
}
