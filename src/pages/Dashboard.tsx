import React, { useEffect, useState, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { useAuthStore } from "@/stores/auth";
import { db } from "@/db";
import { mbhrDb } from "@/db/mbhr";
import { can } from "@/auth/roles";
import { queryCache, createCacheKey } from "@/utils/queryCache";
import { OfflineAnalytics } from "@/components/OfflineAnalytics";
import { EnhancedQueueBoard } from "@/components/EnhancedQueueBoard";
import { ExportButtons } from "@/components/ExportButtons";
import { MessageOutbox } from "@/components/MessageOutbox";
import { SyncDashboard } from "@/components/SyncDashboard";
import { AppointmentCalendar } from "@/features/appointments/AppointmentCalendar";
import {
  UserPlusIcon,
  CubeIcon,
  QueueListIcon,
  CalendarIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getFlagLabel, getFlagTone } from "@/utils/vitals";

export function Dashboard() {
  const { currentUser } = useAuthStore();
  const [stats, setStats] = useState({
    totalPatients: 0,
    todayRegistrations: 0,
    totalUsers: 0,
  });
  const [showAppointments, setShowAppointments] = useState(false);
  const [showSync, setShowSync] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      // Check cache first
      const cacheKey = createCacheKey(
        "dashboard",
        "stats",
        new Date().toDateString(),
      );
      const cached = queryCache.get<typeof stats>(cacheKey);

      if (cached) {
        setStats(cached);
        return;
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const [totalPatients, todayRegistrations, totalUsers] = await Promise.all(
        [
          db.patients.count(),
          db.patients.where("createdAt").between(today, tomorrow).count(),
          db.users.count(),
        ],
      );

      const newStats = {
        totalPatients,
        todayRegistrations,
        totalUsers,
      };

      setStats(newStats);
      // Cache for 5 minutes
      queryCache.set(cacheKey, newStats, 5 * 60 * 1000);
    } catch (error) {
      console.error("Error loading stats:", error);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const startOfToday = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const startOfTodayIso = useMemo(
    () => startOfToday.toISOString(),
    [startOfToday],
  );

  const registeredToday =
    useLiveQuery(
      () => db.patients.where("createdAt").above(startOfToday).count(),
      [startOfToday],
      0,
    ) ?? 0;

  const waitingForVitals =
    useLiveQuery(
      () =>
        db.queue
          .where("stage")
          .equals("vitals")
          .and((q) => q.status !== "done")
          .count(),
      [],
      0,
    ) ?? 0;

  const waitingForDoctor =
    useLiveQuery(
      () =>
        db.queue
          .where("stage")
          .equals("consult")
          .and((q) => q.status !== "done")
          .count(),
      [],
      0,
    ) ?? 0;

  const waitingForPharmacy =
    useLiveQuery(
      () =>
        db.queue
          .where("stage")
          .equals("pharmacy")
          .and((q) => q.status !== "done")
          .count(),
      [],
      0,
    ) ?? 0;

  // Both dispensing paths: visit dispensing (db.dispenses) and
  // prescription dispensing (mbhrDb.dispenses).
  const dispensedToday =
    useLiveQuery(
      async () => {
        const [rx, visit] = await Promise.all([
          mbhrDb.dispenses.where("dispensedAt").above(startOfTodayIso).count(),
          db.dispenses.where("dispensedAt").above(startOfToday).count(),
        ]);
        return rx + visit;
      },
      [startOfTodayIso, startOfToday],
      0,
    ) ?? 0;

  // Patients with at least one abnormal vital sign recorded today
  const flaggedToday =
    useLiveQuery(
      async () => {
        const todaysVitals = await db.vitals
          .where("takenAt")
          .above(startOfToday)
          .toArray();
        const byPatient = new Map<string, Set<string>>();
        for (const v of todaysVitals) {
          if (Array.isArray(v.flags) && v.flags.length > 0) {
            const set = byPatient.get(v.patientId) ?? new Set<string>();
            v.flags.forEach((f) => set.add(f));
            byPatient.set(v.patientId, set);
          }
        }
        const patients = await db.patients.bulkGet([...byPatient.keys()]);
        return patients
          .filter((p): p is NonNullable<typeof p> => Boolean(p))
          .map((p) => ({
            id: p.id,
            name: `${p.givenName} ${p.familyName}`,
            flags: [...(byPatient.get(p.id) ?? [])],
          }));
      },
      [startOfToday],
      [],
    ) ?? [];

  const lowStock =
    useLiveQuery(
      async () =>
        (await db.inventory.toArray())
          .filter((i) => i.onHandQty <= i.reorderThreshold)
          .sort((a, b) => a.onHandQty - b.onHandQty),
      [],
      [],
    ) ?? [];

  const formattedDate = useMemo(() => {
    return new Date().toLocaleDateString("en-NG", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }, []);
  return (
    <div className="space-y-4">
      <PageHeader
        title={`Today · ${formattedDate}`}
        description={`Signed in as ${currentUser?.fullName ?? ""}. What needs attention at this outreach.`}
        actions={
          <>
            {currentUser && can(currentUser.role, "register") && (
              <Link to="/register" className="btn-primary">
                <UserPlusIcon className="h-5 w-5" aria-hidden />
                Register patient
              </Link>
            )}
            <Link to="/queue" className="btn-secondary">
              <QueueListIcon className="h-5 w-5" aria-hidden />
              Open queue
            </Link>
          </>
        }
      />

      {/* Patient flow right now */}
      <section aria-labelledby="flow-title" className="panel">
        <div className="panel-header">
          <h2 id="flow-title" className="panel-title">
            Patient flow now
          </h2>
          <Link to="/queue" className="text-label text-primary hover:underline">
            Manage queue
          </Link>
        </div>
        <dl className="grid grid-cols-2 divide-line sm:grid-cols-4 sm:divide-x">
          {[
            { label: "Registered today", value: registeredToday, marker: "bg-stage-registration" },
            { label: "Waiting for vitals", value: waitingForVitals, marker: "bg-stage-vitals" },
            { label: "Waiting for a clinician", value: waitingForDoctor, marker: "bg-stage-consult" },
            { label: "Waiting at pharmacy", value: waitingForPharmacy, marker: "bg-stage-pharmacy" },
          ].map((m) => (
            <div key={m.label} className="px-4 py-4">
              <dt className="flex items-center gap-2 text-caption text-ink-muted">
                <span className={`h-2 w-2 rounded-full ${m.marker}`} aria-hidden />
                {m.label}
              </dt>
              <dd className="mt-1 text-stat text-ink tabular-nums">{m.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Abnormal vitals */}
        <section aria-labelledby="flagged-title" className="panel">
          <div className="panel-header">
            <h2 id="flagged-title" className="panel-title">
              Abnormal vitals today
            </h2>
            <span className="text-caption text-ink-muted">
              {flaggedToday.length} patient{flaggedToday.length === 1 ? "" : "s"}
            </span>
          </div>
          {flaggedToday.length === 0 ? (
            <p className="panel-body text-body text-ink-muted">
              No abnormal readings recorded today.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {flaggedToday.slice(0, 6).map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <Link to={`/patients/${p.id}`} className="font-medium text-ink hover:underline">
                    {p.name}
                  </Link>
                  <span className="flex flex-wrap gap-1">
                    {p.flags.map((f) => (
                      <StatusBadge key={f} tone={getFlagTone(f)}>
                        {getFlagLabel(f)}
                      </StatusBadge>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Stock */}
        <section aria-labelledby="stock-title" className="panel">
          <div className="panel-header">
            <h2 id="stock-title" className="panel-title">
              Low stock
            </h2>
            <span className="text-caption text-ink-muted">
              {dispensedToday} dispensed today
            </span>
          </div>
          {lowStock.length === 0 ? (
            <p className="panel-body text-body text-ink-muted">
              All items are above their reorder level.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {lowStock.slice(0, 6).map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <span className="text-ink">{i.itemName}</span>
                  <StatusBadge tone={i.onHandQty === 0 ? "danger" : "warning"}>
                    {i.onHandQty === 0 ? "Out of stock" : `${i.onHandQty} ${i.unit} left`}
                  </StatusBadge>
                </li>
              ))}
              {lowStock.length > 6 && (
                <li className="px-4 py-2.5">
                  <Link to="/inventory" className="text-label text-primary hover:underline">
                    See all {lowStock.length} items
                  </Link>
                </li>
              )}
            </ul>
          )}
        </section>
      </div>

      {/* Control Buttons */}
      <div className="flex flex-wrap gap-3">
        {currentUser && can(currentUser.role, "vitals") && (
          <button
            onClick={() => setShowAppointments(!showAppointments)}
            className="btn-secondary"
            aria-expanded={showAppointments}
          >
            <CalendarIcon className="h-5 w-5 text-ink-muted" aria-hidden />
            {showAppointments ? "Hide Appointments" : "Show Appointments"}
          </button>
        )}
        {currentUser && can(currentUser.role, "users") && (
          <button
            onClick={() => setShowSync(!showSync)}
            className="btn-secondary"
            aria-expanded={showSync}
          >
            <ArrowPathIcon className="h-5 w-5 text-ink-muted" aria-hidden />
            {showSync ? "Hide Sync Dashboard" : "Show Sync Dashboard"}
          </button>
        )}
      </div>

      {/* Appointments Section */}
      {showAppointments && currentUser && (
        <AppointmentCalendar createdBy={currentUser.id} />
      )}

      {/* Sync Dashboard */}
      {showSync && currentUser && can(currentUser.role, "users") && (
        <SyncDashboard />
      )}

      {/* Message Outbox */}
      <MessageOutbox />

      {/* Enhanced Analytics */}
      <OfflineAnalytics />

      {/* Enhanced Queue Overview */}
      <EnhancedQueueBoard />

      {/* Data Export */}
      <ExportButtons />

      {/* First-run guidance: only on a device with no patients yet */}
      {stats.totalPatients === 0 && (
        <section aria-labelledby="start-title" className="panel">
          <div className="panel-header">
            <h2 id="start-title" className="panel-title">
              Getting this device ready
            </h2>
          </div>
          <ol className="panel-body space-y-3 text-body">
            <li>
              <span className="font-medium text-ink">1. Choose the outreach site</span>
              <span className="block text-ink-muted">
                Use the site selector at the top of the screen so visits are recorded against the right outreach.
              </span>
            </li>
            <li>
              <span className="font-medium text-ink">2. Check stock</span>
              <span className="block text-ink-muted">
                Add the medicines you brought in Inventory so dispensing and low-stock alerts work.
              </span>
            </li>
            <li>
              <span className="font-medium text-ink">3. Register the first patient</span>
              <span className="block text-ink-muted">
                Registration puts them in the queue for vitals.
              </span>
            </li>
          </ol>
          <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
            <Link to="/register" className="btn-primary">
              <UserPlusIcon className="h-5 w-5" aria-hidden />
              Register patient
            </Link>
            <Link to="/inventory" className="btn-secondary">
              <CubeIcon className="h-5 w-5" aria-hidden />
              Open inventory
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
