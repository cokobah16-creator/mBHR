import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArchiveBoxIcon,
  ArrowPathIcon,
  CalendarDaysIcon,
  ChatBubbleLeftRightIcon,
} from "@heroicons/react/24/outline";
import { EmptyState } from "@/components/ui/EmptyState";
import { isSupabaseEnabled } from "@/lib/supabaseClient";
import { getMedications } from "@/services/patientService";
import { getPatientDashboard } from "@/services/patientPortalData";
import * as logger from "@/lib/logger";
import { PortalListSkeleton, PortalNotice, PortalPage } from "./PortalPage";
import { formatPortalDate } from "./portalStatus";
import {
  readActiveProfile,
  readPortalUser,
  resolveActivePatientId,
} from "./portalSession";
import { useOnlineStatus } from "./useOnlineStatus";

interface MedicineItem {
  key: string;
  name: string;
  dosage: string | null;
  directions: string | null;
  givenAt: string | Date;
  visitId: string | null;
}

const PAGE_TITLE = "Your medicines";

// getPatientDashboard returns at most this many medicines from this device.
const LOCAL_MEDICINES_LIMIT = 10;

/**
 * Medicines the pharmacy recorded as given to the patient. The portal cannot
 * place refill orders, so it points to the ways a patient can really ask:
 * a secure message or an appointment request.
 */
export function PrescriptionRefills() {
  const online = useOnlineStatus();
  const [medicines, setMedicines] = useState<MedicineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  const loadMedicines = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const portalUser = readPortalUser();
      if (!portalUser || !portalUser.patientId) {
        setError(
          "We could not find your sign-in on this phone. Please log in again.",
        );
        return;
      }

      if (isSupabaseEnabled) {
        const res = await getMedications(portalUser.patientId);
        if (res.error || !res.data) {
          // Offline, the "You are offline" notice already explains it.
          setError(
            navigator.onLine
              ? "We could not load your medicines. Please try again."
              : "",
          );
          return;
        }
        setMedicines(
          res.data.map((m) => ({
            key: m.id,
            name: m.itemName,
            dosage: m.dosage,
            directions: m.directions,
            givenAt: m.dispensedAt,
            visitId: m.visitId,
          })),
        );
      } else {
        // No online portal: read what the pharmacy saved on this device, for
        // the same profile the home page shows (only one this account owns).
        const data = await getPatientDashboard(
          portalUser.id,
          resolveActivePatientId(portalUser, readActiveProfile()),
        );
        if (!data) {
          setError("We could not load your medicines. Please try again.");
          return;
        }
        setMedicines(
          data.activeMedications.map((m, i) => ({
            key: `${m.medicationName}-${i}`,
            name: m.medicationName,
            dosage: m.dosage || null,
            directions: m.directions || null,
            givenAt: m.dispensedAt,
            visitId: null,
          })),
        );
      }
      setLoaded(true);
    } catch (err) {
      logger.error(
        "Error loading medicines:",
        err instanceof Error ? err.name : "unknown",
      );
      // Offline, the "You are offline" notice already explains it.
      setError(
        isSupabaseEnabled && !navigator.onLine
          ? ""
          : "We could not load your medicines. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // Try once even when offline (this phone may have kept a copy from the last
  // time it was online), then reload when the connection comes back.
  const attempted = useRef(false);
  const canLoad = !isSupabaseEnabled || online;

  useEffect(() => {
    if (!canLoad && attempted.current) return;
    attempted.current = true;
    loadMedicines();
  }, [canLoad, loadMedicines]);

  if (loading && !loaded) {
    return <PortalListSkeleton label="Loading your medicines" />;
  }

  const description = isSupabaseEnabled
    ? "Medicines the outreach pharmacy recorded as given to you, newest first."
    : "Medicines the outreach pharmacy saved on this device for you, newest first.";

  return (
    <PortalPage title={PAGE_TITLE} description={description}>
      {isSupabaseEnabled && !online && (
        <PortalNotice tone="offline" title="You are offline">
          {loaded
            ? "You are seeing the medicines loaded when this phone was last online. They may be out of date."
            : "Connect to the internet to see your medicines."}
        </PortalNotice>
      )}

      {error && (
        <PortalNotice
          tone="danger"
          action={
            canLoad ? (
              <button
                type="button"
                onClick={loadMedicines}
                className="btn-secondary"
              >
                <ArrowPathIcon className="h-5 w-5" aria-hidden />
                Try again
              </button>
            ) : undefined
          }
        >
          {error}
        </PortalNotice>
      )}

      {loaded && medicines.length === 0 && (
        <div className="panel">
          <EmptyState
            icon={ArchiveBoxIcon}
            title="No medicines recorded yet"
            description="Medicines given to you at an outreach visit will show here once the pharmacy records them."
          />
        </div>
      )}

      {!isSupabaseEnabled && medicines.length >= LOCAL_MEDICINES_LIMIT && (
        <p className="text-caption text-ink-muted">
          Showing the {LOCAL_MEDICINES_LIMIT} most recent medicines saved on
          this device.
        </p>
      )}

      {medicines.length > 0 && (
        <ul className="panel divide-y divide-line" aria-label="Your medicines">
          {medicines.map((med) => (
            <li key={med.key} className="p-4">
              <h2 className="text-h3 text-ink">{med.name}</h2>
              {med.dosage && (
                <p className="text-body text-ink-secondary">{med.dosage}</p>
              )}
              {med.directions && (
                <p className="mt-1 text-body text-ink">
                  <span className="text-ink-muted">How to take it: </span>
                  {med.directions}
                </p>
              )}
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-muted">
                <span>Given on {formatPortalDate(med.givenAt)}</span>
                {med.visitId && isSupabaseEnabled && (
                  <Link
                    to={`/patient/visit/${med.visitId}`}
                    className="inline-flex min-h-touch-target items-center text-label text-primary-fg underline-offset-2 hover:underline"
                  >
                    See the visit
                  </Link>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}

      <section className="panel" aria-labelledby="refill-title">
        <div className="panel-header">
          <h2 id="refill-title" className="panel-title">
            Need more of a medicine?
          </h2>
        </div>
        <div className="panel-body space-y-3">
          {isSupabaseEnabled ? (
            <>
              <p className="text-body text-ink-secondary">
                You cannot order a refill in the portal. Send a message to the
                clinic team or ask for an appointment. The clinic team can tell
                you what to do next.
              </p>
              <div className="flex flex-wrap gap-2">
                <Link
                  to="/patient/messages"
                  state={{ compose: "refill" }}
                  className="btn-primary"
                >
                  <ChatBubbleLeftRightIcon className="h-5 w-5" aria-hidden />
                  Message the clinic
                </Link>
                <Link
                  to="/patient/appointments/request"
                  className="btn-secondary"
                >
                  <CalendarDaysIcon className="h-5 w-5" aria-hidden />
                  Ask for an appointment
                </Link>
              </div>
            </>
          ) : (
            <p className="text-body text-ink-secondary">
              You cannot order a refill in the portal. Ask the outreach team at
              your next visit.
            </p>
          )}
        </div>
      </section>
    </PortalPage>
  );
}
