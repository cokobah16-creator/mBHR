import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { clinicalDecisionSupport } from "@/services/clinicalDecisionSupport";
import type {
  ClinicalAlert,
  PatientRiskProfile,
} from "@/services/clinicalDecisionSupport";
import { db, createAuditLog, generateId, type Patient } from "@/db";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/stores/toast";
import { can } from "@/auth/roles";
import { StatusBadge, type Tone } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonText } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { tabId, panelId } from "@/components/ui/tabIds";
import { formatNigerianDateTime } from "@/utils/dateFormat";
import { latestByIndex } from "@/features/reports/localRecords";
import {
  CheckCircleIcon,
  ClockIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";

type Severity = ClinicalAlert["severity"];
type SeverityFilter = "all" | Severity;
type TabKey = "alerts" | "risk" | "adherence";

const SEVERITY_META: Record<Severity, { label: string; tone: Tone }> = {
  critical: { label: "Critical", tone: "critical" },
  high: { label: "High", tone: "danger" },
  moderate: { label: "Moderate", tone: "warning" },
  low: { label: "Low", tone: "info" },
};

const RISK_META: Record<PatientRiskProfile["overallRisk"], { label: string; tone: Tone }> = {
  critical: { label: "Critical risk", tone: "critical" },
  high: { label: "High risk", tone: "danger" },
  moderate: { label: "Moderate risk", tone: "warning" },
  low: { label: "Low risk", tone: "neutral" },
};

const FACTOR_TONE: Record<"low" | "moderate" | "high", Tone> = {
  high: "danger",
  moderate: "warning",
  low: "neutral",
};

const RECENT_PATIENT_LIMIT = 20;
const ID_PREFIX = "cds";

function isSeverityFilter(value: string): value is SeverityFilter {
  return (
    value === "all" ||
    value === "critical" ||
    value === "high" ||
    value === "moderate" ||
    value === "low"
  );
}

function isTabKey(value: string): value is TabKey {
  return value === "alerts" || value === "risk" || value === "adherence";
}

interface HighRiskPatient {
  patientId: string;
  name: string;
  profile: PatientRiskProfile;
}

export function ClinicalInsightsDashboard() {
  const currentUser = useAuthStore((state) => state.currentUser);
  const push = useToast((s) => s.push);
  const [alerts, setAlerts] = useState<ClinicalAlert[]>([]);
  const [highRiskPatients, setHighRiskPatients] = useState<HighRiskPatient[]>([]);
  const [userNames, setUserNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedTab, setSelectedTab] = useState<TabKey>("alerts");
  const [filterSeverity, setFilterSeverity] = useState<SeverityFilter>("all");
  const [showAcknowledged, setShowAcknowledged] = useState(false);
  const [ackBusyId, setAckBusyId] = useState<string | null>(null);

  // Acknowledging an alert is a clinical action (consult permission).
  const canAcknowledge = !!currentUser && can(currentUser.role, "consult");

  const loadData = useCallback(async () => {
    try {
      setLoadFailed(false);

      const [allAlerts, users] = await Promise.all([
        db.clinicalAlerts.orderBy("createdAt").reverse().toArray(),
        db.users.toArray(),
      ]);

      let filteredAlerts = showAcknowledged
        ? allAlerts
        : allAlerts.filter((a) => !a.acknowledged);
      if (filterSeverity !== "all") {
        filteredAlerts = filteredAlerts.filter((a) => a.severity === filterSeverity);
      }
      setAlerts(filteredAlerts);
      setUserNames(new Map<string, string>(users.map((u) => [u.id, u.fullName])));

      const recentPatients = await latestByIndex<Patient>(
        db.patients,
        "updatedAt",
        RECENT_PATIENT_LIMIT,
        (p) => p.updatedAt,
      );

      const riskProfiles = await Promise.all(
        recentPatients.map(async (patient): Promise<HighRiskPatient | null> => {
          try {
            const profile = await clinicalDecisionSupport.assessPatientRisk(patient.id);
            if (profile.overallRisk === "high" || profile.overallRisk === "critical") {
              return {
                patientId: patient.id,
                name: `${patient.givenName} ${patient.familyName}`,
                profile,
              };
            }
          } catch (error) {
            console.error(
              "Risk assessment failed:",
              error instanceof Error ? error.name : error,
            );
          }
          return null;
        }),
      );

      setHighRiskPatients(
        riskProfiles.filter((p): p is HighRiskPatient => p !== null),
      );
    } catch (error) {
      console.error(
        "Failed to load clinical insights:",
        error instanceof Error ? error.name : error,
      );
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [showAcknowledged, filterSeverity]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAcknowledgeAlert = async (alert: ClinicalAlert) => {
    if (!currentUser || !can(currentUser.role, "consult")) {
      push({
        id: generateId(),
        tone: "warning",
        title: "Only clinicians can acknowledge alerts",
        body: "Ask a doctor or lead clinician to review this alert.",
      });
      return;
    }
    setAckBusyId(alert.id);
    try {
      await clinicalDecisionSupport.acknowledgeAlert(alert.id, currentUser.id);
    } catch (error) {
      console.error(
        "Acknowledge alert failed:",
        error instanceof Error ? error.name : error,
      );
      push({
        id: generateId(),
        tone: "error",
        title: "Alert not acknowledged",
        body: "The change was not saved. Try again.",
      });
      setAckBusyId(null);
      return;
    }
    // The acknowledgement is saved at this point; a failed audit entry must
    // not be reported as a failed acknowledgement.
    let audited = true;
    try {
      await createAuditLog(currentUser.role, "acknowledge_clinical_alert", "clinicalAlerts", alert.id);
    } catch (error) {
      audited = false;
      console.error(
        "Audit log for alert acknowledgement failed:",
        error instanceof Error ? error.name : error,
      );
    }
    push({
      id: generateId(),
      tone: audited ? "success" : "warning",
      title: "Alert acknowledged",
      body: audited
        ? "Saved on this device."
        : "Saved on this device, but the audit log entry could not be written.",
    });
    setAckBusyId(null);
    await loadData();
  };

  return (
    <section className="space-y-4" aria-labelledby="cds-title">
      <div>
        <h2 id="cds-title" className="text-h2 text-ink">
          Clinical decision support
        </h2>
        <p className="text-body text-ink-muted">
          Rule-based alerts from recorded vitals and history, to help
          clinicians spot patients who need another look.
        </p>
      </div>

      <div className="panel">
        <Tabs<TabKey>
          tabs={[
            { id: "alerts", label: "Clinical alerts", badge: loading ? undefined : alerts.length },
            { id: "risk", label: "High-risk patients", badge: loading ? undefined : highRiskPatients.length },
            { id: "adherence", label: "Medication adherence" },
          ]}
          active={selectedTab}
          onChange={(id) => {
            if (isTabKey(id)) setSelectedTab(id);
          }}
          idPrefix={ID_PREFIX}
          label="Clinical decision support sections"
          className="px-2"
        />

        <div
          role="tabpanel"
          id={panelId(ID_PREFIX, selectedTab)}
          aria-labelledby={tabId(ID_PREFIX, selectedTab)}
          className="panel-body"
        >
          {loadFailed && (
            <div className="banner banner-danger mb-4" role="alert">
              <span className="flex-1">Clinical alerts could not be read from this device.</span>
              <button type="button" onClick={loadData} className="btn-secondary">
                Try again
              </button>
            </div>
          )}

          {loading ? (
            <div>
              <span role="status" className="sr-only">
                Loading clinical alerts
              </span>
              <SkeletonText lines={5} />
            </div>
          ) : (
            <>
              {selectedTab === "alerts" && (
                <div className="space-y-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <label className="flex min-h-touch-target items-center gap-2 text-body text-ink-secondary">
                      <input
                        type="checkbox"
                        checked={showAcknowledged}
                        onChange={(e) => setShowAcknowledged(e.target.checked)}
                        className="h-4 w-4 rounded border-line-strong text-primary focus:ring-primary"
                      />
                      Show acknowledged alerts
                    </label>
                    <div className="sm:w-48">
                      <label htmlFor="cds-severity" className="field-label">
                        Severity
                      </label>
                      <select
                        id="cds-severity"
                        value={filterSeverity}
                        onChange={(e) => {
                          if (isSeverityFilter(e.target.value)) setFilterSeverity(e.target.value);
                        }}
                        className="input-field"
                      >
                        <option value="all">All severities</option>
                        <option value="critical">Critical</option>
                        <option value="high">High</option>
                        <option value="moderate">Moderate</option>
                        <option value="low">Low</option>
                      </select>
                    </div>
                  </div>

                  {!canAcknowledge && alerts.some((a) => !a.acknowledged) && (
                    <p className="text-caption text-ink-muted">
                      Alerts can be acknowledged by doctors, lead clinicians and administrators.
                    </p>
                  )}

                  {alerts.length === 0 ? (
                    <EmptyState
                      icon={CheckCircleIcon}
                      title={showAcknowledged ? "No clinical alerts" : "No alerts waiting for review"}
                      description="Alerts are created when recorded vitals or history match a rule."
                    />
                  ) : (
                    <ul className="divide-y divide-line rounded-md border border-line">
                      {alerts.map((alert) => {
                        const meta = SEVERITY_META[alert.severity];
                        return (
                          <li key={alert.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start">
                            <div className="min-w-0 flex-1">
                              <div className="mb-1 flex flex-wrap items-center gap-2">
                                <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                                <span className="text-caption capitalize text-ink-muted">
                                  {alert.alertType.replace(/_/g, " ")}
                                </span>
                              </div>
                              <p className="font-medium text-ink">{alert.message}</p>
                              <p className="text-body text-ink-secondary">{alert.details}</p>
                              <p className="mt-1 text-caption text-ink-muted">
                                {formatNigerianDateTime(alert.createdAt)}
                                {alert.acknowledged && (
                                  <>
                                    {" · "}
                                    <span className="inline-flex items-center gap-1 text-success-fg">
                                      <CheckCircleIcon className="h-3.5 w-3.5" aria-hidden />
                                      Acknowledged
                                      {alert.acknowledgedBy
                                        ? ` by ${userNames.get(alert.acknowledgedBy) ?? "another user"}`
                                        : ""}
                                    </span>
                                  </>
                                )}
                              </p>
                              <Link
                                to={`/patients/${alert.patientId}`}
                                className="mt-1 inline-block text-label text-primary-fg hover:underline"
                              >
                                Open patient record
                              </Link>
                            </div>
                            {!alert.acknowledged && canAcknowledge && (
                              <button
                                type="button"
                                onClick={() => handleAcknowledgeAlert(alert)}
                                disabled={ackBusyId === alert.id}
                                className="btn-secondary shrink-0"
                              >
                                {ackBusyId === alert.id ? "Saving…" : "Acknowledge"}
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}

              {selectedTab === "risk" && (
                <div className="space-y-3">
                  <p className="text-caption text-ink-muted">
                    Checks the {RECENT_PATIENT_LIMIT} most recently updated patient
                    records on this device with fixed rules.
                  </p>
                  {highRiskPatients.length === 0 ? (
                    <EmptyState
                      icon={CheckCircleIcon}
                      title="No high-risk patients found"
                      description={`None of the ${RECENT_PATIENT_LIMIT} most recently updated patients matched a high-risk rule.`}
                    />
                  ) : (
                    <ul className="space-y-3">
                      {highRiskPatients.map(({ patientId, name, profile }) => {
                        const risk = RISK_META[profile.overallRisk];
                        return (
                          <li key={patientId} className="rounded-md border border-line p-4">
                            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <p className="text-h3 text-ink">{name}</p>
                                <StatusBadge tone={risk.tone} className="mt-1">
                                  {risk.label}
                                </StatusBadge>
                              </div>
                              <Link to={`/patients/${patientId}`} className="btn-ghost text-label">
                                View patient
                              </Link>
                            </div>

                            <div className="space-y-3">
                              <div>
                                <p className="section-label mb-1">Risk factors</p>
                                <ul className="space-y-1">
                                  {profile.riskFactors.map((rf, idx) => (
                                    <li key={idx} className="flex flex-wrap items-start gap-2 text-body text-ink-secondary">
                                      <StatusBadge tone={FACTOR_TONE[rf.severity]} icon={rf.severity !== "low"}>
                                        {rf.severity}
                                      </StatusBadge>
                                      <span>
                                        <span className="font-medium text-ink">{rf.factor}:</span> {rf.description}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </div>

                              {profile.predictedComplications.length > 0 && (
                                <div>
                                  <p className="section-label mb-1">Possible complications (rule-based)</p>
                                  <ul className="flex flex-wrap gap-2">
                                    {profile.predictedComplications.map((comp, idx) => (
                                      <li key={idx}>
                                        <StatusBadge tone="warning">{comp}</StatusBadge>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {profile.recommendedActions.length > 0 && (
                                <div>
                                  <p className="section-label mb-1">Suggested actions</p>
                                  <ul className="list-disc space-y-1 pl-5">
                                    {profile.recommendedActions.map((action, idx) => (
                                      <li key={idx} className="text-body text-ink-secondary">
                                        {action}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}

              {selectedTab === "adherence" && (
                <EmptyState
                  icon={ClockIcon}
                  title="Not available in this version"
                  description="Medication adherence checks are not built yet, so no adherence figures are shown."
                />
              )}
            </>
          )}
        </div>
      </div>

      <div className="banner banner-info">
        <InformationCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
        <p>
          These alerts come from fixed rules applied to recorded vitals, history
          and risk factors. They are prompts to look again, not diagnoses; the
          treating clinician decides.
        </p>
      </div>
    </section>
  );
}
