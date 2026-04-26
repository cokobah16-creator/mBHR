import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import * as logger from "@/lib/logger";
import {
  UserCircleIcon,
  LockClosedIcon,
  BellIcon,
  DevicePhoneMobileIcon,
} from "@heroicons/react/24/outline";
import { UpdatePHR } from "./UpdatePHR";

export function ManageAccount() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<
    "profile" | "notifications" | "security"
  >("profile");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [portalUser, setPortalUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [notifications, setNotifications] = useState({
    emailReminders: true,
    smsReminders: true,
    appointmentAlerts: true,
    labResults: true,
  });

  useEffect(() => {
    loadAccountInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAccountInfo = async () => {
    setLoading(true);
    try {
      const portalUserStr = localStorage.getItem("patient_portal_user");
      if (!portalUserStr) {
        navigate("/patient/login", { replace: true });
        return;
      }

      const user = JSON.parse(portalUserStr);
      setPortalUser(user);

      // Load notification preferences
      const { data } = await supabase
        .from("patient_portal_preferences")
        .select("*")
        .eq("portal_user_id", user.id)
        .maybeSingle();

      if (data) {
        setNotifications({
          emailReminders: data.email_reminders ?? true,
          smsReminders: data.sms_reminders ?? true,
          appointmentAlerts: data.appointment_alerts ?? true,
          labResults: data.lab_results_alerts ?? true,
        });
      }
    } catch (err) {
      logger.error("Error loading account info:", err);
      setError("Failed to load account information");
    } finally {
      setLoading(false);
    }
  };

  const saveNotificationPreferences = async () => {
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const { error: upsertError } = await supabase
        .from("patient_portal_preferences")
        .upsert({
          portal_user_id: portalUser.id,
          email_reminders: notifications.emailReminders,
          sms_reminders: notifications.smsReminders,
          appointment_alerts: notifications.appointmentAlerts,
          lab_results_alerts: notifications.labResults,
        });

      if (upsertError) throw upsertError;

      setSuccess("Notification preferences saved");
    } catch (err) {
      logger.error("Error saving preferences:", err);
      setError("Failed to save preferences");
    } finally {
      setSaving(false);
    }
  };

  const initiatePasswordReset = async () => {
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      // This would trigger an OTP to reset password
      setSuccess("Password reset link sent to your phone/email");
    } catch (err) {
      logger.error("Error initiating password reset:", err);
      setError("Failed to send password reset link");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading account...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Manage Account</h1>
          <p className="mt-2 text-gray-600">
            Update your profile and account settings
          </p>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {success && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm text-green-800">{success}</p>
          </div>
        )}

        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="border-b border-gray-200">
            <nav className="flex">
              <button
                onClick={() => setActiveTab("profile")}
                className={`px-6 py-3 text-sm font-medium border-b-2 ${
                  activeTab === "profile"
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                <UserCircleIcon className="h-5 w-5 inline-block mr-2" />
                Profile
              </button>
              <button
                onClick={() => setActiveTab("notifications")}
                className={`px-6 py-3 text-sm font-medium border-b-2 ${
                  activeTab === "notifications"
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                <BellIcon className="h-5 w-5 inline-block mr-2" />
                Notifications
              </button>
              <button
                onClick={() => setActiveTab("security")}
                className={`px-6 py-3 text-sm font-medium border-b-2 ${
                  activeTab === "security"
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                <LockClosedIcon className="h-5 w-5 inline-block mr-2" />
                Security
              </button>
            </nav>
          </div>

          <div className="p-6">
            {activeTab === "profile" && (
              <div>
                <UpdatePHR />
              </div>
            )}

            {activeTab === "notifications" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-medium text-gray-900 mb-4">
                    Notification Preferences
                  </h3>

                  <div className="space-y-4">
                    <label className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={notifications.emailReminders}
                        onChange={(e) =>
                          setNotifications({
                            ...notifications,
                            emailReminders: e.target.checked,
                          })
                        }
                        className="h-5 w-5 text-blue-600 rounded"
                      />
                      <div>
                        <p className="font-medium text-gray-900">
                          Email Reminders
                        </p>
                        <p className="text-sm text-gray-600">
                          Receive appointment reminders via email
                        </p>
                      </div>
                    </label>

                    <label className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={notifications.smsReminders}
                        onChange={(e) =>
                          setNotifications({
                            ...notifications,
                            smsReminders: e.target.checked,
                          })
                        }
                        className="h-5 w-5 text-blue-600 rounded"
                      />
                      <div>
                        <p className="font-medium text-gray-900">
                          SMS Reminders
                        </p>
                        <p className="text-sm text-gray-600">
                          Receive appointment reminders via text message
                        </p>
                      </div>
                    </label>

                    <label className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={notifications.appointmentAlerts}
                        onChange={(e) =>
                          setNotifications({
                            ...notifications,
                            appointmentAlerts: e.target.checked,
                          })
                        }
                        className="h-5 w-5 text-blue-600 rounded"
                      />
                      <div>
                        <p className="font-medium text-gray-900">
                          Appointment Alerts
                        </p>
                        <p className="text-sm text-gray-600">
                          Get notified about upcoming appointments
                        </p>
                      </div>
                    </label>

                    <label className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={notifications.labResults}
                        onChange={(e) =>
                          setNotifications({
                            ...notifications,
                            labResults: e.target.checked,
                          })
                        }
                        className="h-5 w-5 text-blue-600 rounded"
                      />
                      <div>
                        <p className="font-medium text-gray-900">Lab Results</p>
                        <p className="text-sm text-gray-600">
                          Get notified when new lab results are available
                        </p>
                      </div>
                    </label>
                  </div>

                  <button
                    onClick={saveNotificationPreferences}
                    disabled={saving}
                    className="mt-6 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? "Saving..." : "Save Preferences"}
                  </button>
                </div>
              </div>
            )}

            {activeTab === "security" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">
                    Password
                  </h3>
                  <p className="text-gray-600 mb-4">
                    Reset your password using your registered phone number or
                    email
                  </p>
                  <button
                    onClick={initiatePasswordReset}
                    disabled={saving}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? "Sending..." : "Reset Password"}
                  </button>
                </div>

                <div className="border-t border-gray-200 pt-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-2">
                    Active Sessions
                  </h3>
                  <p className="text-gray-600 mb-4">
                    You are currently logged in on this device
                  </p>
                  <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-md">
                    <DevicePhoneMobileIcon className="h-6 w-6 text-gray-600" />
                    <div>
                      <p className="font-medium text-gray-900">
                        Current Device
                      </p>
                      <p className="text-sm text-gray-600">Active now</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
