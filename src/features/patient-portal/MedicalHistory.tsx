import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowPathIcon,
  CalendarIcon,
  ChevronRightIcon,
} from "@heroicons/react/24/outline";
import { EmptyState } from "@/components/ui/EmptyState";
import { getPatientMedicalHistory } from "@/services/patientPortalData";
import type { PatientMedicalRecord, PortalDataError } from "@/types/patientPortal";
import { isSupabaseEnabled } from "@/lib/supabaseClient";
import * as logger from "@/lib/logger";
import { PortalListSkeleton, PortalNotice, PortalPage } from "./PortalPage";
import { appendUnique, formatPortalLongDate } from "./portalStatus";
import { readPortalUser } from "./portalSession";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useT } from "@/hooks/useT";

const PAGE_SIZE = 10;

// Error messages are kept as translation keys so the loader does not depend on `t`.
const LOAD_FAILED = "portal.visits.loadFailed";

/** Why the visits were not loaded, when the notice is not a failure. */
type NotLoaded = Extract<PortalDataError, "offline" | "unavailable">;

function NotConnectedNotice() {
  const { t } = useT();
  return (
    <PortalNotice tone="info" title={t("portal.visits.notConnectedTitle")}>
      {t("portal.visits.notConnected")}
    </PortalNotice>
  );
}

function VitalsSummary({
  vitals,
}: {
  vitals: NonNullable<PatientMedicalRecord["vitals"]>;
}) {
  const { t } = useT();
  const items: { label: string; value: string }[] = [];
  if (vitals.systolic && vitals.diastolic) {
    items.push({
      label: t("portal.visit.bloodPressure"),
      value: `${vitals.systolic}/${vitals.diastolic} mmHg`,
    });
  }
  if (vitals.pulseBpm) {
    items.push({
      label: t("portal.visit.heartRate"),
      value: t("portal.visits.perMinute", { value: vitals.pulseBpm }),
    });
  }
  if (vitals.tempC) {
    items.push({ label: t("portal.visit.temperature"), value: `${vitals.tempC}°C` });
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
  const { t } = useT();
  const online = useOnlineStatus();
  const [records, setRecords] = useState<PatientMedicalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Set when the last load did not reach the visits (offline, or no online
  // records): the list shown is then "not loaded", never "no visits".
  const [notLoaded, setNotLoaded] = useState<NotLoaded | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const loadRecords = useCallback(async (pageToLoad: number) => {
    setLoading(true);
    setError("");
    setNotLoaded(null);

    try {
      const portalUser = readPortalUser();
      if (!portalUser) {
        setError("portal.visits.noSignIn");
        return;
      }
      if (!portalUser.patientId || !portalUser.id) {
        setError("portal.visits.signInIncomplete");
        return;
      }

      const result = await getPatientMedicalHistory(
        portalUser.id,
        portalUser.patientId,
        PAGE_SIZE,
        (pageToLoad - 1) * PAGE_SIZE,
      );
      if (result.error) {
        // Nothing was loaded: keep the visits already shown.
        if (result.error === "offline" || result.error === "unavailable") {
          setNotLoaded(result.error);
        } else {
          setError(LOAD_FAILED);
        }
        return;
      }
      // "Load more" adds the next page under the visits already shown.
      setRecords((prev) =>
        pageToLoad === 1
          ? result.records
          : appendUnique(prev, result.records, (r) => r.visitId),
      );
      setHasMore(result.total > pageToLoad * PAGE_SIZE);
    } catch (err) {
      logger.error(
        "Error loading medical history:",
        err instanceof Error ? err.name : "unknown",
      );
      // Offline, the "You are offline" notice explains it.
      if (navigator.onLine) setError(LOAD_FAILED);
      else setNotLoaded("offline");
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
      <PortalPage title={t("portal.visits.title")} description={t("portal.visits.description")}>
        <NotConnectedNotice />
        <Link to="/patient/dashboard" className="btn-secondary">
          {t("portal.visits.goHome")}
        </Link>
      </PortalPage>
    );
  }

  if (loading && records.length === 0) {
    return <PortalListSkeleton label={t("portal.state.loading.visits")} />;
  }

  return (
    <PortalPage title={t("portal.visits.title")} description={t("portal.visits.description")}>
      {(!online || notLoaded === "offline") && (
        <PortalNotice
          tone="offline"
          title={t("portal.visits.offlineTitle")}
          action={
            online ? (
              <button
                type="button"
                onClick={() => loadRecords(page)}
                disabled={loading}
                className="btn-secondary"
              >
                <ArrowPathIcon className="h-5 w-5" aria-hidden />
                {t("portal.error.retry")}
              </button>
            ) : undefined
          }
        >
          {records.length > 0
            ? t("portal.visits.offlineStale")
            : t("portal.visits.offlineEmpty")}
        </PortalNotice>
      )}

      {notLoaded === "unavailable" && <NotConnectedNotice />}

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
                {t("portal.error.retry")}
              </button>
            ) : undefined
          }
        >
          {t(error)}
        </PortalNotice>
      )}

      {records.length === 0 && !loading && !error && !notLoaded && online ? (
        <div className="panel">
          <EmptyState
            icon={CalendarIcon}
            title={t("portal.visits.emptyTitle")}
            description={t("portal.visits.emptyBody")}
          />
        </div>
      ) : (
        records.length > 0 && (
          <ul className="space-y-3" aria-label={t("portal.visits.listLabel")}>
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
                          <span className="text-ink-muted">{t("portal.visits.diagnosisLabel")} </span>
                          <span className="font-medium text-ink">
                            {record.consultation.diagnoses.join(", ")}
                          </span>
                        </p>
                      )}
                    {record.consultation?.providerName && (
                      <p className="text-body text-ink-muted">
                        {t("portal.visit.seenBy", { name: record.consultation.providerName })}
                      </p>
                    )}

                    {record.prescriptions &&
                      record.prescriptions.length > 0 && (
                        <div className="mt-2">
                          <p className="text-caption text-ink-muted">
                            {t("portal.visit.medicinesGiven")}
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
                  <span className="sr-only">{t("portal.visits.openVisit")}</span>
                </Link>
              </li>
            ))}
          </ul>
        )
      )}

      {hasMore && records.length > 0 && !error && !notLoaded && (
        <div className="text-center">
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={loading || !online}
            className="btn-secondary"
          >
            {loading ? t("portal.visits.loadingShort") : t("portal.visits.showOlder")}
          </button>
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {loading && records.length > 0 ? t("portal.visits.loadingOlder") : ""}
      </p>
    </PortalPage>
  );
}
