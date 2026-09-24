import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowPathIcon,
  CalendarIcon,
  ChevronRightIcon,
} from "@heroicons/react/24/outline";
import { EmptyState } from "@/components/ui/EmptyState";
import { getPatientMedicalHistory } from "@/services/patientPortalData";
import type { PatientMedicalRecord } from "@/types/patientPortal";
import { isSupabaseEnabled } from "@/lib/supabaseClient";
import * as logger from "@/lib/logger";
import { PortalListSkeleton, PortalNotice, PortalPage } from "./PortalPage";
import { appendUnique, formatPortalLongDate } from "./portalStatus";
import { readPortalUser } from "./portalSession";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

const PAGE_SIZE = 10;

const PAGE_TITLE = "Your visits";
const PAGE_DESCRIPTION =
  "Visits recorded by the outreach team. A visit shows here once it is finished and uploaded from the clinic's device.";

function VitalsSummary({
  vitals,
}: {
  vitals: NonNullable<PatientMedicalRecord["vitals"]>;
}) {
  const items: { label: string; value: string }[] = [];
  if (vitals.systolic && vitals.diastolic) {
    items.push({
      label: "Blood pressure",
      value: `${vitals.systolic}/${vitals.diastolic} mmHg`,
    });
  }
  if (vitals.pulseBpm) {
    items.push({ label: "Heart rate", value: `${vitals.pulseBpm} per minute` });
  }
  if (vitals.tempC) {
    items.push({ label: "Temperature", value: `${vitals.tempC}°C` });
  }
  if (items.length === 0) return null;
  return (
    <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-body">
      {items.map((item) => (
        <div key={item.label} className="flex gap-1">
          <dt className="text-ink-muted">{item.label}:</dt>
          <dd className="font-medium tabular-nums text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function MedicalHistory() {
  const online = useOnlineStatus();
  const [records, setRecords] = useState<PatientMedicalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const loadRecords = useCallback(async (pageToLoad: number) => {
    setLoading(true);
    setError("");

    try {
      const portalUser = readPortalUser();
      if (!portalUser) {
        setError("We could not find your sign-in on this phone. Please log in again.");
        return;
      }
      if (!portalUser.patientId || !portalUser.id) {
        setError("Your sign-in details are incomplete. Please log in again.");
        return;
      }

      const result = await getPatientMedicalHistory(
        portalUser.id,
        portalUser.patientId,
        PAGE_SIZE,
        (pageToLoad - 1) * PAGE_SIZE,
      );
      if (result) {
        // "Load more" adds the next page under the visits already shown.
        setRecords((prev) =>
          pageToLoad === 1
            ? result.records
            : appendUnique(prev, result.records, (r) => r.visitId),
        );
        setHasMore(result.total > pageToLoad * PAGE_SIZE);
      } else {
        setError("We could not load your visits. Please try again.");
      }
    } catch (err) {
      logger.error(
        "Error loading medical history:",
        err instanceof Error ? err.name : "unknown",
      );
      // Offline, the "You are offline" notice already explains it.
      setError(
        navigator.onLine ? "We could not load your visits. Please try again." : "",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // The visit history lives in the online portal. Try once even when offline:
  // this phone may have kept a copy from the last time it was online. After
  // that, reload when the connection comes back.
  const attempted = useRef(false);

  useEffect(() => {
    if (!isSupabaseEnabled) {
      setLoading(false);
      return;
    }
    if (!online && attempted.current) return;
    attempted.current = true;
    loadRecords(page);
  }, [online, page, loadRecords]);

  if (!isSupabaseEnabled) {
    return (
      <PortalPage title={PAGE_TITLE} description={PAGE_DESCRIPTION}>
        <PortalNotice tone="info" title="Visit history is not available here">
          This portal is not connected to the clinic&apos;s online records, so
          your full visit history cannot be shown. Your home page shows what
          is saved on this device.
        </PortalNotice>
        <Link to="/patient/dashboard" className="btn-secondary">
          Go to home
        </Link>
      </PortalPage>
    );
  }

  if (loading && records.length === 0) {
    return <PortalListSkeleton label="Loading your visits" />;
  }

  return (
    <PortalPage title={PAGE_TITLE} description={PAGE_DESCRIPTION}>
      {!online && (
        <PortalNotice tone="offline" title="You are offline">
          {records.length > 0
            ? "You are seeing the visits loaded when this phone was last online. They may be out of date. Connect to the internet to load more."
            : "Connect to the internet to see your visits."}
        </PortalNotice>
      )}

      {error && (
        <PortalNotice
          tone="danger"
          action={
            online ? (
              <button
                type="button"
                onClick={() => loadRecords(page)}
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

      {records.length === 0 && !loading && !error && online ? (
        <div className="panel">
          <EmptyState
            icon={CalendarIcon}
            title="No visits yet"
            description="After you are seen at an outreach and the visit is finished, it will show here. If you think a visit is missing, ask the outreach team at your next visit."
          />
        </div>
      ) : (
        records.length > 0 && (
          <ul className="space-y-3" aria-label="Visits, newest first">
            {records.map((record) => (
              <li key={record.visitId}>
                <Link
                  to={`/patient/visit/${record.visitId}`}
                  className="flex items-start gap-3 rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-strong hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <CalendarIcon
                    className="mt-0.5 h-6 w-6 shrink-0 text-ink-muted"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-h3 text-ink">
                      {formatPortalLongDate(record.visitDate)}
                    </p>
                    {record.chiefComplaint && (
                      <p className="text-body text-ink-secondary">
                        {record.chiefComplaint}
                      </p>
                    )}

                    {record.vitals && <VitalsSummary vitals={record.vitals} />}

                    {record.consultation &&
                      record.consultation.diagnoses?.length > 0 && (
                        <p className="mt-2 text-body">
                          <span className="text-ink-muted">Diagnosis: </span>
                          <span className="font-medium text-ink">
                            {record.consultation.diagnoses.join(", ")}
                          </span>
                        </p>
                      )}
                    {record.consultation?.providerName && (
                      <p className="text-body text-ink-muted">
                        Seen by {record.consultation.providerName}
                      </p>
                    )}

                    {record.prescriptions &&
                      record.prescriptions.length > 0 && (
                        <div className="mt-2">
                          <p className="text-caption text-ink-muted">
                            Medicines given
                          </p>
                          <ul className="mt-1 flex flex-wrap gap-1.5">
                            {record.prescriptions.map((rx, idx) => (
                              <li
                                key={`${rx.medicationName}-${idx}`}
                                className="badge badge-neutral"
                              >
                                {rx.medicationName}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                  </div>
                  <ChevronRightIcon
                    className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted"
                    aria-hidden
                  />
                  <span className="sr-only">Open visit details</span>
                </Link>
              </li>
            ))}
          </ul>
        )
      )}

      {hasMore && records.length > 0 && (
        <div className="text-center">
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={loading || !online}
            className="btn-secondary"
          >
            {loading ? "Loading…" : "Show older visits"}
          </button>
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {loading && records.length > 0 ? "Loading older visits" : ""}
      </p>
    </PortalPage>
  );
}
