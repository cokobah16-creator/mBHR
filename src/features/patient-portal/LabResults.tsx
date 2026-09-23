import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import * as logger from "@/lib/logger";
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  BeakerIcon,
  ChevronRightIcon,
} from "@heroicons/react/24/outline";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PortalListSkeleton, PortalNotice, PortalPage } from "./PortalPage";
import { formatPortalDate, labHasResult, labStatusInfo } from "./portalStatus";
import { readPortalUser } from "./portalSession";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

interface LabResult {
  id: string;
  test_name: string;
  test_type: string;
  result_value: string;
  unit: string;
  reference_range: string;
  status: "pending" | "completed" | "reviewed";
  ordered_date: string;
  result_date?: string;
  notes?: string;
  abnormal: boolean;
}

const PAGE_TITLE = "Lab results";
const PAGE_DESCRIPTION =
  "Tests the clinic has added to your portal, newest first. A result shows once the clinic enters it.";

/** Shown only when the record itself marks the result as abnormal. */
function OutsideRangeBadge() {
  return (
    <StatusBadge tone="warning" icon>
      Outside the usual range
    </StatusBadge>
  );
}

export function LabResults() {
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const [results, setResults] = useState<LabResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [selectedResult, setSelectedResult] = useState<LabResult | null>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const lastOpenedId = useRef<string | null>(null);

  const loadLabResults = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");

    try {
      const portalUser = readPortalUser();
      if (!portalUser) {
        navigate("/patient/login", { replace: true });
        return;
      }

      const { data, error: resultsError } = await supabase
        .from("patient_lab_results")
        .select("*")
        .eq("patient_id", portalUser.patientId)
        .order("ordered_date", { ascending: false });

      if (resultsError) throw resultsError;

      setResults(data || []);
      setLoaded(true);
    } catch (err) {
      logger.error(
        "Error loading lab results:",
        err instanceof Error ? err.name : "unknown",
      );
      // Offline, the "You are offline" notice already explains it.
      setError(
        navigator.onLine
          ? "We could not load your lab results. Please try again."
          : "",
      );
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  // Try once even when offline (this phone may have kept a copy from the last
  // time it was online), then reload when the connection comes back.
  const attempted = useRef(false);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    if (!online && attempted.current) return;
    attempted.current = true;
    loadLabResults();
  }, [online, loadLabResults]);

  // Move focus with the view so keyboard and screen-reader users follow it.
  useEffect(() => {
    if (selectedResult) {
      detailHeadingRef.current?.focus();
    } else if (lastOpenedId.current) {
      document
        .getElementById(`lab-result-${lastOpenedId.current}`)
        ?.focus();
    }
  }, [selectedResult]);

  const openResult = (result: LabResult) => {
    lastOpenedId.current = result.id;
    setSelectedResult(result);
  };

  if (!supabase) {
    return (
      <PortalPage title={PAGE_TITLE} description={PAGE_DESCRIPTION}>
        <PortalNotice tone="info" title="Lab results are not available here">
          This portal is not connected to the clinic&apos;s online records, so
          lab results cannot be shown. Ask the outreach team about your results
          at your next visit.
        </PortalNotice>
      </PortalPage>
    );
  }

  if (loading && !loaded) {
    return <PortalListSkeleton label="Loading your lab results" />;
  }

  if (selectedResult) {
    const status = labStatusInfo(selectedResult.status);
    const hasResult = labHasResult(selectedResult.status);
    return (
      <PortalPage title={PAGE_TITLE}>
        <button
          type="button"
          onClick={() => setSelectedResult(null)}
          className="btn-ghost -ml-3"
        >
          <ArrowLeftIcon className="h-5 w-5" aria-hidden />
          Back to all results
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
                {selectedResult.test_name}
              </h2>
              {selectedResult.test_type && (
                <p className="text-body text-ink-muted">
                  {selectedResult.test_type}
                </p>
              )}
            </div>
            <StatusBadge tone={status.tone} icon>
              {status.label}
            </StatusBadge>
          </div>

          <div className="panel-body space-y-4">
            <p className="text-body text-ink-secondary">
              Ordered on {formatPortalDate(selectedResult.ordered_date)}
              {selectedResult.result_date && (
                <>
                  . Result recorded on{" "}
                  {formatPortalDate(selectedResult.result_date)}
                </>
              )}
              .
            </p>

            {hasResult ? (
              <div className="rounded-lg border border-line bg-surface-sunken p-4">
                <p className="text-label text-ink-secondary">Your result</p>
                <p className="mt-1 text-display tabular-nums text-ink">
                  {selectedResult.result_value || "—"}
                  {selectedResult.unit && (
                    <span className="ml-2 text-body font-normal text-ink-muted">
                      {selectedResult.unit}
                    </span>
                  )}
                </p>
                {selectedResult.reference_range && (
                  <p className="mt-1 text-body text-ink-secondary">
                    Usual range: {selectedResult.reference_range}
                  </p>
                )}
                {selectedResult.abnormal && (
                  <div className="mt-3">
                    <OutsideRangeBadge />
                  </div>
                )}
              </div>
            ) : (
              <PortalNotice tone="info">
                There is no result for this test yet. It will show here once
                the clinic enters it.
              </PortalNotice>
            )}

            {selectedResult.notes && (
              <div>
                <h3 className="text-label text-ink-secondary">
                  Notes on this test
                </h3>
                <p className="mt-1 whitespace-pre-wrap text-body text-ink">
                  {selectedResult.notes}
                </p>
              </div>
            )}

            {hasResult && (
              <PortalNotice tone={selectedResult.abnormal ? "warning" : "info"}>
                {selectedResult.abnormal
                  ? "This result is outside the usual range. Talk to your clinician about this result."
                  : "Talk to your clinician about this result if you have questions."}
              </PortalNotice>
            )}
          </div>
        </section>
      </PortalPage>
    );
  }

  return (
    <PortalPage title={PAGE_TITLE} description={PAGE_DESCRIPTION}>
      {!online && (
        <PortalNotice tone="offline" title="You are offline">
          {loaded
            ? "You are seeing the results loaded when this phone was last online. They may be out of date."
            : "Connect to the internet to see your lab results."}
        </PortalNotice>
      )}

      {error && (
        <PortalNotice
          tone="danger"
          action={
            online ? (
              <button
                type="button"
                onClick={loadLabResults}
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

      {loaded && results.length === 0 && (
        <div className="panel">
          <EmptyState
            icon={BeakerIcon}
            title="No lab results yet"
            description="When the clinic adds a test or a result for you, it will show here. If you are waiting for a result, ask the outreach team."
          />
        </div>
      )}

      {results.length > 0 && (
        <ul className="panel divide-y divide-line" aria-label="Lab results">
          {results.map((result) => {
            const status = labStatusInfo(result.status);
            return (
              <li key={result.id}>
                <button
                  id={`lab-result-${result.id}`}
                  type="button"
                  onClick={() => openResult(result)}
                  className="flex min-h-touch-target w-full items-start gap-3 p-4 text-left transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-body font-medium text-ink">
                      {result.test_name}
                    </span>
                    {result.test_type && (
                      <span className="block text-caption text-ink-muted">
                        {result.test_type}
                      </span>
                    )}
                    <span className="mt-2 flex flex-wrap items-center gap-2">
                      <StatusBadge tone={status.tone} icon>
                        {status.label}
                      </StatusBadge>
                      {result.abnormal && labHasResult(result.status) && (
                        <OutsideRangeBadge />
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-caption text-ink-muted">
                      Ordered
                    </span>
                    <span className="block whitespace-nowrap text-caption text-ink-secondary">
                      {formatPortalDate(result.ordered_date)}
                    </span>
                  </span>
                  <ChevronRightIcon
                    className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted"
                    aria-hidden
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </PortalPage>
  );
}
