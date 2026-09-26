import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  BeakerIcon,
  ChevronRightIcon,
} from "@heroicons/react/24/outline";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PortalListSkeleton, PortalNotice, PortalPage } from "./PortalPage";
import {
  formatPortalDate,
  labStatusInfo,
  portalLabAdvice,
  portalLabInterpretationInfo,
  portalLabLoadNotice,
} from "./portalStatus";
import { readActiveProfile, readPortalUser, resolveActivePatientId } from "./portalSession";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useT } from "@/hooks/useT";
import { fetchMyReleasedLabResults } from "@/services/portalLabResults";
import type { PortalLabResult, PortalLabResultsStatus } from "@/types/patientPortal";

// Every result the portal receives has been reviewed and released.
const RELEASED = labStatusInfo("released");

const INTERPRETATIONS = ["normal", "abnormal", "critical"];
const NOTICE_STATUSES = ["unavailable", "offline", "not_signed_in", "not_updated"];

// Key suffix for an interpretation. The English text under these keys is the
// clinical wording in portalStatus.ts, word for word (checked by a test);
// changing it needs clinical sign-off.
function interpretationKey(interpretation: string | null | undefined): string {
  return INTERPRETATIONS.includes(interpretation ?? "") ? String(interpretation) : "unknown";
}

function noticeKey(status: string): string {
  return NOTICE_STATUSES.includes(status) ? status : "failed";
}

function InterpretationBadge({ interpretation }: { interpretation: string }) {
  const { t } = useT();
  const info = portalLabInterpretationInfo(interpretation);
  return (
    <StatusBadge tone={info.tone} icon>
      {t(`portal.lab.interp.${interpretationKey(interpretation)}`)}
    </StatusBadge>
  );
}

export function LabResults() {
  const navigate = useNavigate();
  const { t } = useT();
  const online = useOnlineStatus();
  const pageTitle = t("portal.lab.title");
  const pageDescription = t("portal.lab.description");
  const [results, setResults] = useState<PortalLabResult[]>([]);
  const [status, setStatus] = useState<PortalLabResultsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [selectedResult, setSelectedResult] = useState<PortalLabResult | null>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const lastOpenedId = useRef<string | null>(null);
  const requestRef = useRef(0);
  const loadedRef = useRef(false);

  const loadLabResults = useCallback(async () => {
    const portalUser = readPortalUser();
    if (!portalUser) {
      navigate("/patient/login", { replace: true });
      return;
    }
    const request = ++requestRef.current;
    setLoading(true);
    // Only the signed-in account's own records (or a managed profile listed
    // on it); the server checks ownership again.
    const patientId = resolveActivePatientId(portalUser, readActiveProfile());
    // accountId: if this phone is signed in online as someone else, say
    // "sign in" rather than showing their (empty) list as this patient's.
    const outcome = await fetchMyReleasedLabResults({
      patientId: patientId || undefined,
      accountId: portalUser.id || undefined,
    });
    if (request !== requestRef.current) return;
    setStatus(outcome.status);
    if (outcome.status === "ok") {
      // Held in this page only; lab results are never saved on the phone.
      setResults(outcome.results);
      loadedRef.current = true;
      setLoaded(true);
    }
    setLoading(false);
  }, [navigate]);

  // Load on arrival and again when the connection comes back.
  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    // Offline after a load: keep the list shown rather than replace it
    // with the offline notice. It reloads when the connection returns.
    if (!online && loadedRef.current) return;
    void loadLabResults();
  }, [online, loadLabResults]);

  // Move focus with the view so keyboard and screen-reader users follow it.
  useEffect(() => {
    if (selectedResult) {
      detailHeadingRef.current?.focus();
    } else if (lastOpenedId.current) {
      document.getElementById(`lab-result-${lastOpenedId.current}`)?.focus();
    }
  }, [selectedResult]);

  const openResult = (result: PortalLabResult) => {
    lastOpenedId.current = result.resultId;
    setSelectedResult(result);
  };

  if (!supabase) {
    return (
      <PortalPage title={pageTitle} description={pageDescription}>
        <PortalNotice tone="info" title={t("portal.lab.notice.unavailable.title")}>
          {t("portal.lab.notice.unavailable.body")}
        </PortalNotice>
      </PortalPage>
    );
  }

  if (loading && !loaded) {
    return <PortalListSkeleton label={t("portal.lab.loading")} />;
  }

  if (selectedResult) {
    const advice = portalLabAdvice(selectedResult.interpretation);
    return (
      <PortalPage title={pageTitle}>
        <button
          type="button"
          onClick={() => setSelectedResult(null)}
          className="btn-ghost -ml-3"
        >
          <ArrowLeftIcon className="h-5 w-5" aria-hidden />
          {t("portal.lab.back")}
        </button>

        <section className="panel" aria-labelledby="lab-detail-title">
          <div className="panel-header flex-wrap">
            <div className="min-w-0">
              <h2
                id="lab-detail-title"
                ref={detailHeadingRef}
                tabIndex={-1}
                className="text-h2 text-ink focus:outline-none"
              >
                {selectedResult.testName}
              </h2>
              {selectedResult.specimenType && (
                <p className="text-body text-ink-muted">
                  {t("portal.lab.sample", { type: selectedResult.specimenType })}
                </p>
              )}
            </div>
            <StatusBadge tone={RELEASED.tone} icon>
              {t("portal.lab.released", RELEASED.label)}
            </StatusBadge>
          </div>

          <div className="panel-body space-y-4">
            <p className="text-body text-ink-secondary">
              {selectedResult.orderedAt && (
                <>{t("portal.lab.orderedOn", { date: formatPortalDate(selectedResult.orderedAt) })} </>
              )}
              {selectedResult.resultDate && (
                <>{t("portal.lab.recordedOn", { date: formatPortalDate(selectedResult.resultDate) })} </>
              )}
              {selectedResult.releasedAt && (
                <>{t("portal.lab.sharedOn", { date: formatPortalDate(selectedResult.releasedAt) })}</>
              )}
            </p>

            <div className="rounded-lg border border-line bg-surface-sunken p-4">
              <p className="text-label text-ink-secondary">{t("portal.lab.yourResult")}</p>
              <p className="mt-1 text-display tabular-nums text-ink">
                {selectedResult.resultValue || "—"}
                {selectedResult.resultUnit && (
                  <span className="ml-2 text-body font-normal text-ink-muted">
                    {selectedResult.resultUnit}
                  </span>
                )}
              </p>
              {selectedResult.referenceRange && (
                <p className="mt-1 text-body text-ink-secondary">
                  {t("portal.lab.usualRange", { range: selectedResult.referenceRange })}
                </p>
              )}
              <div className="mt-3">
                <InterpretationBadge interpretation={selectedResult.interpretation} />
              </div>
            </div>

            {selectedResult.patientNote && (
              <div>
                <h3 className="text-label text-ink-secondary">
                  {t("portal.lab.clinicNote")}
                </h3>
                <p className="mt-1 whitespace-pre-wrap text-body text-ink">
                  {selectedResult.patientNote}
                </p>
              </div>
            )}

            <PortalNotice tone={advice.tone}>
              {t(`portal.lab.advice.${interpretationKey(selectedResult.interpretation)}`)}
            </PortalNotice>
          </div>
        </section>
      </PortalPage>
    );
  }

  const notice = status ? portalLabLoadNotice(status) : null;
  // Offline after a successful load: keep showing what was loaded.
  const showOfflineStale = !online && loaded;

  return (
    <PortalPage title={pageTitle} description={pageDescription}>
      {showOfflineStale ? (
        <PortalNotice tone="offline" title={t("portal.lab.notice.offline.title")}>
          {t("portal.lab.offlineStale")}
        </PortalNotice>
      ) : (
        notice && (
          <PortalNotice
            tone={status === "offline" ? "offline" : notice.tone}
            title={t(`portal.lab.notice.${noticeKey(status ?? "")}.title`)}
            action={
              notice.retry && online ? (
                <button
                  type="button"
                  onClick={() => void loadLabResults()}
                  className="btn-secondary"
                  disabled={loading}
                >
                  <ArrowPathIcon className="h-5 w-5" aria-hidden />
                  {loading ? t("portal.lab.tryingAgain") : t("portal.error.retry")}
                </button>
              ) : undefined
            }
          >
            {t(`portal.lab.notice.${noticeKey(status ?? "")}.body`)}
            {loaded && ` ${t("portal.lab.lastLoaded")}`}
          </PortalNotice>
        )
      )}

      {loaded && results.length === 0 && (
        <div className="panel">
          <EmptyState
            icon={BeakerIcon}
            title={t("portal.lab.emptyTitle")}
            description={t("portal.lab.emptyBody")}
          />
        </div>
      )}

      {results.length > 0 && (
        <ul className="panel divide-y divide-line" aria-label={pageTitle}>
          {results.map((result) => (
            <li key={result.resultId}>
              <button
                id={`lab-result-${result.resultId}`}
                type="button"
                onClick={() => openResult(result)}
                className="flex min-h-touch-target w-full items-start gap-3 p-4 text-left transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-medium text-ink">
                    {result.testName}
                  </span>
                  <span className="block text-caption text-ink-secondary tabular-nums">
                    {result.resultValue || "—"}
                    {result.resultUnit ? ` ${result.resultUnit}` : ""}
                  </span>
                  <span className="mt-2 flex flex-wrap items-center gap-2">
                    <InterpretationBadge interpretation={result.interpretation} />
                    {result.patientNote && (
                      <span className="text-caption text-ink-muted">
                        {t("portal.lab.clinicNote")}
                      </span>
                    )}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-caption text-ink-muted">{t("portal.lab.result")}</span>
                  <span className="block whitespace-nowrap text-caption text-ink-secondary">
                    {result.resultDate ? formatPortalDate(result.resultDate) : t("portal.lab.noDate")}
                  </span>
                </span>
                <ChevronRightIcon
                  className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted"
                  aria-hidden
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </PortalPage>
  );
}
