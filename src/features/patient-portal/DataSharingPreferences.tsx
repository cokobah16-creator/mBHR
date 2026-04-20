import { useState, useEffect } from "react";
import {
  ShieldCheckIcon,
  BuildingOfficeIcon,
  BellIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import { supabase } from "../../lib/supabase";
import { TEFCA_EXCHANGE_PURPOSES } from "../../services/fhir/tefcaAuth";

interface DataSharingPreferences {
  id?: string;
  patient_id: string;
  allow_ias_access: boolean;
  allow_treatment_access: boolean;
  allow_payment_access: boolean;
  allow_operations_access: boolean;
  blocked_organizations: string[];
  require_notification: boolean;
}

interface AccessLogEntry {
  id: string;
  requesting_organization: string;
  exchange_purpose: string;
  resources_requested: string[];
  resources_returned: number;
  created_at: string;
  success: boolean;
}

interface Props {
  patientId: string;
}

export function DataSharingPreferences({ patientId }: Props) {
  const [preferences, setPreferences] = useState<DataSharingPreferences>({
    patient_id: patientId,
    allow_ias_access: true,
    allow_treatment_access: true,
    allow_payment_access: false,
    allow_operations_access: false,
    blocked_organizations: [],
    require_notification: true,
  });
  const [accessLogs, setAccessLogs] = useState<AccessLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPreferences();
    loadAccessLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  const loadPreferences = async () => {
    const { data } = await supabase
      .from("patient_data_sharing_preferences")
      .select("*")
      .eq("patient_id", patientId)
      .maybeSingle();

    if (data) {
      setPreferences(data);
    }
    setLoading(false);
  };

  const loadAccessLogs = async () => {
    const { data } = await supabase
      .from("tefca_access_logs")
      .select("*")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false })
      .limit(10);

    if (data) {
      setAccessLogs(data);
    }
  };

  const savePreferences = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      if (preferences.id) {
        const { error: updateError } = await supabase
          .from("patient_data_sharing_preferences")
          .update({
            allow_ias_access: preferences.allow_ias_access,
            allow_treatment_access: preferences.allow_treatment_access,
            allow_payment_access: preferences.allow_payment_access,
            allow_operations_access: preferences.allow_operations_access,
            blocked_organizations: preferences.blocked_organizations,
            require_notification: preferences.require_notification,
          })
          .eq("id", preferences.id);

        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from("patient_data_sharing_preferences")
          .insert(preferences);

        if (insertError) throw insertError;
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save preferences",
      );
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getPurposeLabel = (purpose: string) => {
    const purposeInfo =
      TEFCA_EXCHANGE_PURPOSES[purpose as keyof typeof TEFCA_EXCHANGE_PURPOSES];
    return purposeInfo?.display || purpose;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
            <ShieldCheckIcon className="w-6 h-6 text-green-600" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              Data Sharing Preferences
            </h2>
            <p className="text-gray-600">
              Control how your health data is shared
            </p>
          </div>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
          <div className="flex gap-3">
            <InformationCircleIcon className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-amber-900">TEFCA Data Sharing</h3>
              <p className="text-sm text-amber-700 mt-1">
                These settings control how your health information may be shared
                through the Trusted Exchange Framework (TEFCA) with other
                healthcare organizations.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4 mb-6">
          <h3 className="font-medium text-gray-900">Allow data access for:</h3>

          <label className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
            <input
              type="checkbox"
              checked={preferences.allow_ias_access}
              onChange={(e) =>
                setPreferences({
                  ...preferences,
                  allow_ias_access: e.target.checked,
                })
              }
              className="w-5 h-5 mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <span className="font-medium text-gray-900">
                Individual Access Services (IAS)
              </span>
              <p className="text-sm text-gray-600">
                Allow yourself to access and download your own health records
                through third-party apps. This is required for personal health
                record apps.
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
            <input
              type="checkbox"
              checked={preferences.allow_treatment_access}
              onChange={(e) =>
                setPreferences({
                  ...preferences,
                  allow_treatment_access: e.target.checked,
                })
              }
              className="w-5 h-5 mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <span className="font-medium text-gray-900">Treatment</span>
              <p className="text-sm text-gray-600">
                Allow healthcare providers to access your records for treatment
                purposes. This helps doctors and hospitals provide better care.
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
            <input
              type="checkbox"
              checked={preferences.allow_payment_access}
              onChange={(e) =>
                setPreferences({
                  ...preferences,
                  allow_payment_access: e.target.checked,
                })
              }
              className="w-5 h-5 mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <span className="font-medium text-gray-900">Payment</span>
              <p className="text-sm text-gray-600">
                Allow health plans and clearinghouses to access records for
                payment activities. This may be needed for insurance claims.
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
            <input
              type="checkbox"
              checked={preferences.allow_operations_access}
              onChange={(e) =>
                setPreferences({
                  ...preferences,
                  allow_operations_access: e.target.checked,
                })
              }
              className="w-5 h-5 mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <span className="font-medium text-gray-900">
                Healthcare Operations
              </span>
              <p className="text-sm text-gray-600">
                Allow access for quality assessment, training, and other
                healthcare operations. Data is typically de-identified for these
                purposes.
              </p>
            </div>
          </label>
        </div>

        <div className="mb-6">
          <label className="flex items-center gap-3 p-4 bg-blue-50 rounded-lg cursor-pointer">
            <input
              type="checkbox"
              checked={preferences.require_notification}
              onChange={(e) =>
                setPreferences({
                  ...preferences,
                  require_notification: e.target.checked,
                })
              }
              className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div className="flex items-center gap-2">
              <BellIcon className="w-5 h-5 text-blue-600" />
              <span className="font-medium text-blue-900">
                Notify me when my data is accessed
              </span>
            </div>
          </label>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
            <ExclamationTriangleIcon className="w-5 h-5 text-red-600" />
            <p className="text-red-700">{error}</p>
          </div>
        )}

        {saved && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3">
            <CheckCircleIcon className="w-5 h-5 text-green-600" />
            <p className="text-green-700">Your preferences have been saved.</p>
          </div>
        )}

        <button
          onClick={savePreferences}
          disabled={saving}
          className="w-full py-4 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
        >
          {saving ? (
            <>
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <ShieldCheckIcon className="w-5 h-5" />
              Save Preferences
            </>
          )}
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-6">
          <BuildingOfficeIcon className="w-6 h-6 text-gray-600" />
          <h3 className="font-semibold text-gray-900">
            Recent Data Access History
          </h3>
        </div>

        {accessLogs.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <ShieldCheckIcon className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>No external access to your data has been recorded.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {accessLogs.map((log) => (
              <div
                key={log.id}
                className={`p-4 rounded-lg border ${
                  log.success
                    ? "bg-gray-50 border-gray-200"
                    : "bg-red-50 border-red-200"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-gray-900">
                      {log.requesting_organization}
                    </p>
                    <p className="text-sm text-gray-600">
                      {getPurposeLabel(log.exchange_purpose)}
                    </p>
                  </div>
                  <span
                    className={`text-xs px-2 py-1 rounded-full ${
                      log.success
                        ? "bg-green-100 text-green-700"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    {log.success ? "Granted" : "Denied"}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-4 text-sm text-gray-500">
                  <span>{formatDate(log.created_at)}</span>
                  <span>{log.resources_returned} records</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
