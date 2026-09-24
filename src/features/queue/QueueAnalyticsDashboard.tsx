import { useState, useEffect, useCallback } from "react";
import { predictiveQueue } from "@/services/predictiveQueue";
import type {
  QueuePrediction,
  StaffingRecommendation,
  QueueOptimization,
  HistoricalPattern,
  QueueMetrics,
} from "@/services/predictiveQueue";
import { mbhrDb } from "@/db/mbhr";
import { FLOW_STAGE_LABELS } from "@/services/patientFlow";
import { StatusBadge, type Tone } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { QueueSkeleton } from "@/components/ui/Skeleton";
import { formatTime } from "@/utils/dateFormat";
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";

const STAGES = ["registration", "vitals", "consult", "pharmacy"] as const;
type Stage = (typeof STAGES)[number];

function isStage(value: string): value is Stage {
  return (STAGES as readonly string[]).includes(value);
}

const stageLabel = (stage: string) => (isStage(stage) ? FLOW_STAGE_LABELS[stage] : stage);

/** The service falls back to this when no service time has been measured. */
const DEFAULT_SERVICE_MINUTES = 4;

const RISK_META: Record<QueuePrediction["bottleneckRisk"], { label: string; tone: Tone }> = {
  none: { label: "No hold-up expected", tone: "success" },
  low: { label: "Low risk of hold-up", tone: "info" },
  moderate: { label: "Moderate risk of hold-up", tone: "warning" },
  high: { label: "High risk of hold-up", tone: "danger" },
  critical: { label: "Severe hold-up likely", tone: "critical" },
};

const URGENCY_META: Record<StaffingRecommendation["urgency"], { label: string; tone: Tone }> = {
  high: { label: "Act now", tone: "danger" },
  medium: { label: "Watch", tone: "warning" },
  low: { label: "No change needed", tone: "success" },
};

const REFRESH_MS = 30000;

export function QueueAnalyticsDashboard() {
  const [predictions, setPredictions] = useState<QueuePrediction[]>([]);
  const [staffing, setStaffing] = useState<StaffingRecommendation[]>([]);
  const [optimizations, setOptimizations] = useState<QueueOptimization[]>([]);
  const [patterns, setPatterns] = useState<HistoricalPattern[]>([]);
  const [metrics, setMetrics] = useState<QueueMetrics[]>([]);
  const [measuredMinutes, setMeasuredMinutes] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [selectedStage, setSelectedStage] = useState<Stage>("registration");
  const [autoRefresh, setAutoRefresh] = useState(true);

  const loadData = useCallback(async () => {
    setRefreshing(true);
    try {
      const [pred, staff, opt, pat, met, measured] = await Promise.all([
        predictiveQueue.predictWaitTimes(),
        predictiveQueue.getStaffingRecommendations(),
        predictiveQueue.optimizeQueueOrder(selectedStage),
        predictiveQueue.analyzeHistoricalPatterns(),
        Promise.all(STAGES.map((s) => predictiveQueue.getQueueMetrics(s))),
        // Same lookup as predictiveQueue.getAverageServiceTime, so the note
        // under each estimate matches the figure the estimate really used.
        Promise.all(STAGES.map((s) => mbhrDb.queue_metrics.get(`m-${s}`))),
      ]);

      setPredictions(pred);
      setStaffing(staff);
      setOptimizations(opt);
      setPatterns(pat);
      setMetrics(met);
      const measuredByStage = new Map<string, number>();
      STAGES.forEach((stage, i) => {
        const sec = measured[i]?.avgServiceSec;
        if (sec && sec > 0) measuredByStage.set(stage, Math.max(1, Math.round(sec / 60)));
      });
      setMeasuredMinutes(measuredByStage);
      setLoadedAt(new Date());
      setLoadFailed(false);
    } catch (error) {
      console.error(
        "Failed to load queue analytics:",
        error instanceof Error ? error.name : error,
      );
      setLoadFailed(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedStage]);

  useEffect(() => {
    loadData();
    if (autoRefresh) {
      const interval = setInterval(loadData, REFRESH_MS);
      return () => clearInterval(interval);
    }
  }, [autoRefresh, loadData]);

  const header = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 id="queue-analytics-title" className="text-h2 text-ink">
          Queue estimates
        </h2>
        <p className="text-body text-ink-muted">
          Rough wait estimates and possible hold-ups, worked out on this device
          from today&apos;s queue.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-h-touch-target items-center gap-2 text-body text-ink-secondary">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            className="h-4 w-4 rounded border-line-strong text-primary focus:ring-primary"
          />
          Refresh every 30 seconds
        </label>
        <button type="button" onClick={loadData} disabled={refreshing} className="btn-secondary">
          <ArrowPathIcon className="h-4 w-4" aria-hidden />
          {refreshing ? "Refreshing…" : "Refresh now"}
        </button>
      </div>
    </div>
  );

  if (loading) {
    return (
      <section className="space-y-4" aria-labelledby="queue-analytics-title">
        {header}
        <QueueSkeleton rows={3} />
      </section>
    );
  }

  return (
    <section className="space-y-4" aria-labelledby="queue-analytics-title">
      {header}

      <p className="text-caption text-ink-muted" aria-live="polite">
        {loadedAt ? `Updated ${formatTime(loadedAt)}` : ""}
        {loadFailed ? " · the last refresh failed; figures may be out of date" : ""}
      </p>

      {loadFailed && !loadedAt && (
        <div className="banner banner-danger" role="alert">
          <span className="flex-1">Queue figures could not be read from this device.</span>
          <button type="button" onClick={loadData} className="btn-secondary">
            Try again
          </button>
        </div>
      )}

      {/* Wait estimates per stage */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        {predictions.map((pred) => {
          const risk = RISK_META[pred.bottleneckRisk];
          const measured = measuredMinutes.get(pred.stage);
          return (
            <div key={pred.stage} className="panel p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <h3 className="text-h3 text-ink">{stageLabel(pred.stage)}</h3>
                <StatusBadge tone={risk.tone} icon>
                  {risk.label}
                </StatusBadge>
              </div>
              <dl className="space-y-1.5 text-body">
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-secondary">Waiting now</dt>
                  <dd className="tabular-nums text-ink">{pred.currentWaiting}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-secondary">Estimated wait</dt>
                  <dd className="tabular-nums text-ink">about {pred.predictedWaitMinutes} min</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-secondary">Next call around</dt>
                  <dd className="tabular-nums text-ink">{formatTime(pred.nextPatientETA)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-secondary">Confidence (rule-based)</dt>
                  <dd className="tabular-nums text-ink">{pred.confidence}%</dd>
                </div>
              </dl>
              <p className="mt-2 border-t border-line pt-2 text-caption text-ink-muted">
                {measured !== undefined
                  ? `Uses a measured average of ${measured} min per patient.`
                  : `No service time measured yet; assumes ${DEFAULT_SERVICE_MINUTES} min per patient.`}
              </p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Staffing */}
        <section className="panel" aria-labelledby="staffing-title">
          <div className="panel-header">
            <h3 id="staffing-title" className="panel-title">
              Staffing suggestions
            </h3>
          </div>
          <p className="border-b border-line px-4 py-2 text-caption text-ink-muted">
            Staff on duty are not recorded, so each patient being seen is
            counted as one staff member (at least one per stage).
          </p>
          <ul className="divide-y divide-line">
            {staffing.map((rec) => {
              const urgency = URGENCY_META[rec.urgency];
              return (
                <li key={rec.stage} className="space-y-1.5 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-ink">{stageLabel(rec.stage)}</span>
                    <StatusBadge tone={urgency.tone} icon>
                      {urgency.label}
                    </StatusBadge>
                  </div>
                  <p className="text-body text-ink-secondary">{rec.reason}</p>
                  <p className="text-caption tabular-nums text-ink-muted">
                    Assumed staff {rec.currentStaff} · suggested {rec.recommendedStaff}
                    {rec.recommendedStaff > rec.currentStaff
                      ? ` · ${rec.recommendedStaff - rec.currentStaff} more needed`
                      : ""}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Queue order suggestions */}
        <section className="panel" aria-labelledby="order-title">
          <div className="panel-header flex-wrap">
            <h3 id="order-title" className="panel-title">
              Queue order suggestions
            </h3>
            <div className="w-full sm:w-44">
              <label htmlFor="order-stage" className="sr-only">
                Stage
              </label>
              <select
                id="order-stage"
                value={selectedStage}
                onChange={(e) => {
                  if (isStage(e.target.value)) setSelectedStage(e.target.value);
                }}
                className="input-field"
              >
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {FLOW_STAGE_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="border-b border-line px-4 py-2 text-caption text-ink-muted">
            Rule-based priority from latest vitals, allergies, age and time
            waited. A clinician decides who is seen first.
          </p>
          {optimizations.length === 0 ? (
            <EmptyState
              icon={CheckCircleIcon}
              title="No reordering suggested"
              description={`The ${FLOW_STAGE_LABELS[selectedStage].toLowerCase()} queue order matches the priority rules.`}
            />
          ) : (
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {optimizations.map((opt) => (
                <li key={opt.patientId} className="space-y-1 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-body text-ink">
                      Patient {opt.patientId.slice(0, 8)}
                    </span>
                    <StatusBadge tone="neutral">Priority score {opt.priorityScore}</StatusBadge>
                  </div>
                  <p className="text-body text-ink-secondary">{opt.reason}</p>
                  <p className="text-caption tabular-nums text-ink-muted">
                    Now #{opt.currentPosition} · suggested #{opt.recommendedPosition}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Suggested actions */}
      <section className="panel" aria-labelledby="actions-title">
        <div className="panel-header">
          <h3 id="actions-title" className="panel-title">
            Suggested actions (rule-based)
          </h3>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2">
          {predictions.map((pred) => (
            <div key={pred.stage} className="border-b border-line p-4 lg:odd:border-r">
              <h4 className="mb-2 text-label text-ink">{stageLabel(pred.stage)}</h4>
              <ul className="space-y-1.5">
                {pred.recommendedActions.map((action, idx) => {
                  const urgent = action.startsWith("URGENT");
                  return (
                    <li key={idx} className="flex items-start gap-2 text-body text-ink-secondary">
                      {urgent ? (
                        <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                      ) : (
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-disabled" aria-hidden />
                      )}
                      <span>
                        {urgent ? (
                          <>
                            <span className="font-semibold text-warning-fg">Urgent: </span>
                            {action.replace(/^URGENT:\s*/, "")}
                          </>
                        ) : (
                          action
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Busy hours */}
        <section className="panel" aria-labelledby="patterns-title">
          <div className="panel-header">
            <h3 id="patterns-title" className="panel-title">
              Busy hours, last 30 days
            </h3>
          </div>
          <p className="border-b border-line px-4 py-2 text-caption text-ink-muted">
            From tickets on this device, counted at the stage each ticket is
            at now.
          </p>
          <ul className="divide-y divide-line">
            {patterns.map((pattern, idx) => {
              const stage = STAGES[idx];
              const hasData = Number.isFinite(pattern.averageVolume);
              return (
                <li key={stage ?? idx} className="space-y-1 px-4 py-3">
                  <p className="font-medium text-ink">{stage ? FLOW_STAGE_LABELS[stage] : "Stage"}</p>
                  {hasData ? (
                    <>
                      <p className="text-body tabular-nums text-ink-secondary">
                        About {pattern.averageVolume} tickets in an active hour
                      </p>
                      {pattern.peakTimes.length > 0 ? (
                        <p className="text-caption text-ink-muted">
                          Busiest: {pattern.peakTimes.join(", ")}
                        </p>
                      ) : (
                        <p className="text-caption text-ink-muted">No hour stands out as busier.</p>
                      )}
                      {pattern.recommendations
                        .filter((r) => !r.startsWith("Peak times identified"))
                        .map((rec) => (
                          <p key={rec} className="text-caption text-ink-muted">
                            {rec}
                          </p>
                        ))}
                    </>
                  ) : (
                    <p className="text-body text-ink-muted">No tickets in the last 30 days.</p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        {/* Today */}
        <section className="panel" aria-labelledby="today-title">
          <div className="panel-header">
            <h3 id="today-title" className="panel-title">
              Tickets today
            </h3>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Stage</th>
                <th scope="col" className="text-right">
                  Tickets created today
                </th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((metric) => (
                <tr key={metric.stage}>
                  <td className="font-medium">{stageLabel(metric.stage)}</td>
                  <td className="text-right tabular-nums">{metric.throughput}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-4 py-3 text-caption text-ink-muted">
            Counted at the stage each ticket is at now. Service time, efficiency
            and satisfaction are not shown: this device does not measure them yet.
          </p>
        </section>
      </div>

      <div className="banner banner-info">
        <InformationCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
        <p>
          Estimates are calculated on this device from the current queue, any
          measured service times and patient priority. They work offline and
          are approximate: use them as a guide for staffing, not a promise to
          patients.
        </p>
      </div>
    </section>
  );
}
