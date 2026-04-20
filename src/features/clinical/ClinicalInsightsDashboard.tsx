import { useState, useEffect } from "react";
import { clinicalDecisionSupport } from "@/services/clinicalDecisionSupport";
import type {
  ClinicalAlert,
  PatientRiskProfile,
} from "@/services/clinicalDecisionSupport";
import { db } from "@/db";
import { useAuthStore } from "@/stores/auth";
import {
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ChartBarIcon,
  ClockIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";

export function ClinicalInsightsDashboard() {
  const currentUser = useAuthStore((state) => state.currentUser);
  const [alerts, setAlerts] = useState<ClinicalAlert[]>([]);
  const [highRiskPatients, setHighRiskPatients] = useState<
    Array<{ patientId: string; name: string; profile: PatientRiskProfile }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [selectedTab, setSelectedTab] = useState<
    "alerts" | "risk" | "adherence"
  >("alerts");
  const [filterSeverity, setFilterSeverity] = useState<
    "all" | "critical" | "high" | "moderate" | "low"
  >("all");
  const [showAcknowledged, setShowAcknowledged] = useState(false);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAcknowledged, filterSeverity]);

  const loadData = async () => {
    try {
      setLoading(true);

      const allAlerts = await db.clinicalAlerts
        .orderBy("createdAt")
        .reverse()
        .toArray();

      let filteredAlerts = showAcknowledged
        ? allAlerts
        : allAlerts.filter((a) => !a.acknowledged);

      if (filterSeverity !== "all") {
        filteredAlerts = filteredAlerts.filter(
          (a) => a.severity === filterSeverity,
        );
      }

      setAlerts(filteredAlerts);

      const recentPatients = await db.patients
        .orderBy("updatedAt")
        .reverse()
        .limit(20)
        .toArray();

      const riskProfiles = await Promise.all(
        recentPatients.map(async (patient) => {
          try {
            const profile = await clinicalDecisionSupport.assessPatientRisk(
              patient.id,
            );
            if (
              profile.overallRisk === "high" ||
              profile.overallRisk === "critical"
            ) {
              return {
                patientId: patient.id,
                name: `${patient.givenName} ${patient.familyName}`,
                profile,
              };
            }
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
          } catch (_error) {
            return null;
          }
          return null;
        }),
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setHighRiskPatients(riskProfiles.filter((p) => p !== null) as any);
    } catch (error) {
      console.error("Failed to load clinical insights:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAcknowledgeAlert = async (alertId: string) => {
    if (!currentUser) return;

    await clinicalDecisionSupport.acknowledgeAlert(alertId, currentUser.id);
    await loadData();
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical":
        return "text-red-600 bg-red-50 border-red-200";
      case "high":
        return "text-orange-600 bg-orange-50 border-orange-200";
      case "moderate":
        return "text-yellow-600 bg-yellow-50 border-yellow-200";
      case "low":
        return "text-blue-600 bg-blue-50 border-blue-200";
      default:
        return "text-gray-600 bg-gray-50 border-gray-200";
    }
  };

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case "critical":
        return "bg-red-500";
      case "high":
        return "bg-orange-500";
      case "moderate":
        return "bg-yellow-500";
      case "low":
        return "bg-green-500";
      default:
        return "bg-gray-500";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 flex items-center gap-2">
          <ChartBarIcon className="h-7 w-7 text-blue-600" />
          Clinical Decision Support
        </h2>
        <p className="text-gray-600">
          AI-powered insights to help clinicians make better decisions and
          identify high-risk patients
        </p>
      </div>

      <div className="bg-white rounded-lg shadow-sm">
        <div className="border-b border-gray-200">
          <nav className="flex -mb-px">
            <button
              onClick={() => setSelectedTab("alerts")}
              className={`px-6 py-3 border-b-2 font-medium text-sm ${
                selectedTab === "alerts"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              <div className="flex items-center gap-2">
                <ExclamationTriangleIcon className="h-5 w-5" />
                Clinical Alerts ({alerts.length})
              </div>
            </button>
            <button
              onClick={() => setSelectedTab("risk")}
              className={`px-6 py-3 border-b-2 font-medium text-sm ${
                selectedTab === "risk"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              <div className="flex items-center gap-2">
                <UserGroupIcon className="h-5 w-5" />
                High-Risk Patients ({highRiskPatients.length})
              </div>
            </button>
            <button
              onClick={() => setSelectedTab("adherence")}
              className={`px-6 py-3 border-b-2 font-medium text-sm ${
                selectedTab === "adherence"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              <div className="flex items-center gap-2">
                <ClockIcon className="h-5 w-5" />
                Medication Adherence
              </div>
            </button>
          </nav>
        </div>

        <div className="p-6">
          {selectedTab === "alerts" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={showAcknowledged}
                      onChange={(e) => setShowAcknowledged(e.target.checked)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">
                      Show acknowledged
                    </span>
                  </label>

                  <select
                    value={filterSeverity}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    onChange={(e) => setFilterSeverity(e.target.value as any)}
                    className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                  >
                    <option value="all">All Severities</option>
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="moderate">Moderate</option>
                    <option value="low">Low</option>
                  </select>
                </div>
              </div>

              {alerts.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <CheckCircleIcon className="h-12 w-12 mx-auto mb-3 text-green-500" />
                  <p>No clinical alerts to display</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {alerts.map((alert) => (
                    <div
                      key={alert.id}
                      className={`border rounded-lg p-4 ${getSeverityColor(alert.severity)}`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium uppercase ${getSeverityColor(alert.severity)}`}
                            >
                              {alert.severity}
                            </span>
                            <span className="text-xs text-gray-500">
                              {alert.alertType.replace("_", " ")}
                            </span>
                          </div>
                          <h4 className="font-semibold text-gray-900 mb-1">
                            {alert.message}
                          </h4>
                          <p className="text-sm text-gray-700 mb-2">
                            {alert.details}
                          </p>
                          <div className="text-xs text-gray-500">
                            {new Date(alert.createdAt).toLocaleString()}
                            {alert.acknowledged && (
                              <span className="ml-2 text-green-600">
                                ✓ Acknowledged by {alert.acknowledgedBy}
                              </span>
                            )}
                          </div>
                        </div>
                        {!alert.acknowledged && (
                          <button
                            onClick={() => handleAcknowledgeAlert(alert.id)}
                            className="ml-4 px-3 py-1 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                          >
                            Acknowledge
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {selectedTab === "risk" && (
            <div className="space-y-4">
              {highRiskPatients.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <CheckCircleIcon className="h-12 w-12 mx-auto mb-3 text-green-500" />
                  <p>No high-risk patients identified</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {highRiskPatients.map(({ patientId, name, profile }) => (
                    <div
                      key={patientId}
                      className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h4 className="font-semibold text-gray-900">
                            {name}
                          </h4>
                          <div className="flex items-center gap-2 mt-1">
                            <span
                              className={`h-2 w-2 rounded-full ${getRiskColor(profile.overallRisk)}`}
                            ></span>
                            <span className="text-sm text-gray-600 capitalize">
                              {profile.overallRisk} Risk
                            </span>
                          </div>
                        </div>
                        <a
                          href={`/patients/${patientId}`}
                          className="text-sm text-blue-600 hover:text-blue-800"
                        >
                          View Patient →
                        </a>
                      </div>

                      <div className="space-y-2">
                        <div>
                          <h5 className="text-sm font-medium text-gray-700 mb-1">
                            Risk Factors:
                          </h5>
                          <div className="space-y-1">
                            {profile.riskFactors.map((rf, idx) => (
                              <div
                                key={idx}
                                className="text-sm text-gray-600 flex items-start gap-2"
                              >
                                <span
                                  className={`mt-1 h-1.5 w-1.5 rounded-full flex-shrink-0 ${
                                    rf.severity === "high"
                                      ? "bg-red-500"
                                      : rf.severity === "moderate"
                                        ? "bg-yellow-500"
                                        : "bg-blue-500"
                                  }`}
                                ></span>
                                <span>
                                  <strong>{rf.factor}:</strong> {rf.description}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {profile.predictedComplications.length > 0 && (
                          <div>
                            <h5 className="text-sm font-medium text-gray-700 mb-1">
                              Predicted Complications:
                            </h5>
                            <div className="flex flex-wrap gap-2">
                              {profile.predictedComplications.map(
                                (comp, idx) => (
                                  <span
                                    key={idx}
                                    className="inline-flex items-center px-2 py-1 rounded-md text-xs bg-red-50 text-red-700 border border-red-200"
                                  >
                                    {comp}
                                  </span>
                                ),
                              )}
                            </div>
                          </div>
                        )}

                        {profile.recommendedActions.length > 0 && (
                          <div>
                            <h5 className="text-sm font-medium text-gray-700 mb-1">
                              Recommended Actions:
                            </h5>
                            <ul className="list-disc list-inside space-y-1">
                              {profile.recommendedActions.map((action, idx) => (
                                <li key={idx} className="text-sm text-gray-600">
                                  {action}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {selectedTab === "adherence" && (
            <div className="text-center py-12 text-gray-500">
              <ClockIcon className="h-12 w-12 mx-auto mb-3" />
              <p className="mb-2">Medication Adherence Predictions</p>
              <p className="text-sm">
                This feature analyzes patient factors to predict medication
                adherence risks.
              </p>
              <p className="text-sm text-gray-400 mt-2">
                Integration with prescription data coming soon
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <ExclamationTriangleIcon className="h-5 w-5 text-blue-600 mt-0.5" />
          <div className="text-sm text-blue-900">
            <p className="font-medium mb-1">About Clinical Decision Support</p>
            <p className="text-blue-800">
              This AI-powered system analyzes patient vitals, medical history,
              and risk factors to provide intelligent alerts and
              recommendations. It helps identify high-risk patients early and
              suggests evidence-based interventions.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
