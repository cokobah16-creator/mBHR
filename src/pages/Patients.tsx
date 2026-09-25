import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { db, Patient } from "@/db";
import { useAuthStore } from "@/stores/auth";
import { can } from "@/auth/roles";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { PatientListSkeleton } from "@/components/ui/Skeleton";
import { formatPatientId, patientAge } from "@/utils/patient";
import { patientMatchesQuery } from "@/utils/patientSearch";
import { formatNigerianDate } from "@/utils/dateFormat";
import {
  MagnifyingGlassIcon,
  UserPlusIcon,
  UserIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

const PAGE_SIZE = 50;

const SEX_SHORT: Record<string, string> = { male: "M", female: "F", other: "O" };

export function Patients() {
  const role = useAuthStore((s) => s.currentUser?.role);
  const [patients, setPatients] = useState<Patient[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);

  useEffect(() => {
    db.patients
      .orderBy("createdAt")
      .reverse()
      .toArray()
      .then((rows) => setPatients(rows.filter((p) => !p.mergeInto)))
      .catch((error) => {
        console.error("Error loading patients:", error);
        setLoadError(true);
        setPatients([]);
      });
  }, []);

  // Reset paging when the search changes.
  useEffect(() => setLimit(PAGE_SIZE), [searchQuery]);

  const filtered = useMemo(
    () => (patients ?? []).filter((p) => patientMatchesQuery(p, searchQuery)),
    [patients, searchQuery],
  );
  const visible = filtered.slice(0, limit);
  const canRegister = !!role && can(role, "register");

  const header = (
    <PageHeader
      title="Patients"
      description={
        patients
          ? `${patients.length.toLocaleString()} patient record${patients.length === 1 ? "" : "s"} on this device`
          : "Patient records on this device"
      }
      actions={
        canRegister && (
          <Link to="/register" className="btn-primary">
            <UserPlusIcon className="h-5 w-5" aria-hidden />
            Register patient
          </Link>
        )
      }
    />
  );

  if (patients === null) {
    return (
      <div>
        {header}
        <PatientListSkeleton />
      </div>
    );
  }

  return (
    <div>
      {header}

      <div className="panel overflow-hidden">
        <div className="border-b border-line p-3 sm:p-4">
          <label htmlFor="patient-search" className="sr-only">
            Search patients
          </label>
          <div className="relative max-w-md">
            <MagnifyingGlassIcon
              className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-muted"
              aria-hidden
            />
            <input
              id="patient-search"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-field pl-10 pr-10"
              placeholder="Name, phone number or MBHR ID"
              autoComplete="off"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-1 top-1/2 -translate-y-1/2 btn-ghost px-2"
                aria-label="Clear search"
              >
                <XMarkIcon className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
          {searchQuery && (
            <p className="mt-2 text-caption text-ink-muted" role="status">
              {filtered.length} match{filtered.length === 1 ? "" : "es"}
            </p>
          )}
        </div>

        {loadError ? (
          <div className="banner banner-danger m-4" role="alert">
            Patient records could not be read on this device. Reload the page;
            if it keeps failing, check the device has free storage.
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={UserIcon}
            title={searchQuery ? "No matching patients" : "No patients registered yet"}
            description={
              searchQuery
                ? "Check the spelling, try the phone number, or register them as a new patient."
                : "Patients registered on this device, or synced to it, appear here."
            }
            action={
              canRegister && (
                <Link to="/register" className="btn-primary">
                  <UserPlusIcon className="h-5 w-5" aria-hidden />
                  Register patient
                </Link>
              )
            }
          />
        ) : (
          <>
            <table className="data-table hidden md:table">
              <thead>
                <tr>
                  <th scope="col">Patient</th>
                  <th scope="col">Sex / age</th>
                  <th scope="col">Phone</th>
                  <th scope="col">Location</th>
                  <th scope="col">Registered</th>
                  <th scope="col">ID</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => {
                  const age = patientAge(p.dob);
                  return (
                    <tr key={p.id}>
                      <td>
                        <Link
                          to={`/patients/${p.id}`}
                          className="font-medium text-ink hover:underline"
                        >
                          {p.givenName} {p.familyName}
                        </Link>
                      </td>
                      <td className="text-ink-secondary">
                        {SEX_SHORT[p.sex] ?? "—"} · {age ?? "—"}
                      </td>
                      <td className="text-ink-secondary">{p.phone || "—"}</td>
                      <td className="text-ink-secondary">
                        {[p.lga, p.state].filter(Boolean).join(", ") || "—"}
                      </td>
                      <td className="text-ink-secondary">
                        {formatNigerianDate(p.createdAt)}
                      </td>
                      <td className="font-mono text-caption text-ink-muted">
                        {formatPatientId(p.id)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <ul className="divide-y divide-line md:hidden">
              {visible.map((p) => {
                const age = patientAge(p.dob);
                return (
                  <li key={p.id}>
                    <Link
                      to={`/patients/${p.id}`}
                      className="block px-4 py-3 active:bg-surface-sunken"
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-medium text-ink">
                          {p.givenName} {p.familyName}
                        </span>
                        <span className="shrink-0 font-mono text-caption text-ink-muted">
                          {formatPatientId(p.id)}
                        </span>
                      </span>
                      <span className="block text-caption text-ink-secondary">
                        {SEX_SHORT[p.sex] ?? "—"} · {age ?? "—"} yrs
                        {p.phone ? ` · ${p.phone}` : ""}
                        {p.lga ? ` · ${p.lga}` : ""}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>

            {filtered.length > visible.length && (
              <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
                <span className="text-caption text-ink-muted">
                  Showing {visible.length} of {filtered.length.toLocaleString()}
                </span>
                <button
                  type="button"
                  onClick={() => setLimit((l) => l + PAGE_SIZE)}
                  className="btn-secondary"
                >
                  Show {Math.min(PAGE_SIZE, filtered.length - visible.length)} more
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
