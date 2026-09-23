import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase, isSupabaseEnabled } from "@/lib/supabaseClient";
import { requestPasswordReset } from "@/services/passwordReset";
import * as logger from "@/lib/logger";
import {
  ArrowPathIcon,
  CheckCircleIcon,
  DevicePhoneMobileIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  KeyIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { panelId, tabId } from "@/components/ui/tabIds";
import { UpdatePHR } from "./UpdatePHR";
import {
  errorName,
  readPortalUser,
  type PortalSessionUser,
} from "./account/portalSession";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

type AccountTab = "profile" | "notifications" | "security";

const TABS: { id: AccountTab; label: string }[] = [
  { id: "profile", label: "Your details" },
  { id: "notifications", label: "Reminders" },
  { id: "security", label: "Security" },
];

function isAccountTab(id: string): id is AccountTab {
  return TABS.some((t) => t.id === id);
}

interface NotificationPrefs {
  emailReminders: boolean;
  smsReminders: boolean;
  appointmentAlerts: boolean;
  labResults: boolean;
}

const NOTIFICATION_OPTIONS: {
  key: keyof NotificationPrefs;
  title: string;
  description: string;
}[] = [
  {
    key: "emailReminders",
    title: "Email reminders",
    description: "Appointment reminders sent to your email address",
  },
  {
    key: "smsReminders",
    title: "Text message reminders",
    description: "Appointment reminders sent by SMS to your phone",
  },
  {
    key: "appointmentAlerts",
    title: "Appointment updates",
    description: "A message when an upcoming appointment is booked or changed",
  },
  {
    key: "labResults",
    title: "Test results",
    description: "A message when new test results are ready to view",
  },
];

const IDS = "account";

export function ManageAccount() {
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  const [activeTab, setActiveTab] = useState<AccountTab>("profile");
  const [portalUser, setPortalUser] = useState<PortalSessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [prefsLoadFailed, setPrefsLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [notifMessage, setNotifMessage] = useState<{
    tone: "success" | "danger";
    text: string;
  } | null>(null);
  const [securityMessage, setSecurityMessage] = useState<{
    tone: "success" | "danger";
    text: string;
  } | null>(null);
  const [notifications, setNotifications] = useState<NotificationPrefs>({
    emailReminders: true,
    smsReminders: true,
    appointmentAlerts: true,
    labResults: true,
  });

  const loadAccountInfo = useCallback(async () => {
    setLoading(true);
    setPrefsLoadFailed(false);
    try {
      const user = readPortalUser();
      if (!user) {
        navigate("/patient/login", { replace: true });
        return;
      }
      setPortalUser(user);

      if (!supabase || !user.id) return;

      // Load notification preferences
      const { data, error: loadError } = await supabase
        .from("patient_portal_preferences")
        .select("*")
        .eq("portal_user_id", user.id)
        .maybeSingle();

      if (loadError) throw loadError;

      if (data) {
        setNotifications({
          emailReminders: data.email_reminders ?? true,
          smsReminders: data.sms_reminders ?? true,
          appointmentAlerts: data.appointment_alerts ?? true,
          labResults: data.lab_results_alerts ?? true,
        });
      }
    } catch (err) {
      logger.error("[ManageAccount] load failed:", errorName(err));
      setPrefsLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    void loadAccountInfo();
  }, [loadAccountInfo]);

  const saveNotificationPreferences = async () => {
    if (!supabase || !portalUser?.id) return;
    setSaving(true);
    setNotifMessage(null);

    try {
      const { error: upsertError } = await supabase
        .from("patient_portal_preferences")
        .upsert(
          {
            portal_user_id: portalUser.id,
            email_reminders: notifications.emailReminders,
            sms_reminders: notifications.smsReminders,
            appointment_alerts: notifications.appointmentAlerts,
            lab_results_alerts: notifications.labResults,
          },
          { onConflict: "portal_user_id" },
        );

      if (upsertError) throw upsertError;

      setNotifMessage({
        tone: "success",
        text: "Your reminder choices were saved to your online account.",
      });
    } catch (err) {
      logger.error("[ManageAccount] save preferences failed:", errorName(err));
      setNotifMessage({
        tone: "danger",
        text: "Your reminder choices were not saved. Check your internet connection and try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  const initiatePasswordReset = async () => {
    setSendingReset(true);
    setSecurityMessage(null);

    try {
      const { data } = supabase
        ? await supabase.auth.getUser()
        : { data: { user: null } };
      const email = data.user?.email ?? portalUser?.email;
      if (!email) {
        setSecurityMessage({
          tone: "danger",
          text: "There is no email address on this account. Ask clinic staff to help you reset your password.",
        });
        return;
      }
      const result = await requestPasswordReset(email, "patient");
      if (result.ok) {
        setSecurityMessage({
          tone: "success",
          text: `If ${email} is the email address on your account, a reset link is on its way. Check your inbox and spam folder.`,
        });
      } else {
        setSecurityMessage({ tone: "danger", text: result.message });
      }
    } catch (err) {
      logger.error("[ManageAccount] password reset failed:", errorName(err));
      setSecurityMessage({
        tone: "danger",
        text: "We could not send a reset link. Check your internet connection and try again.",
      });
    } finally {
      setSendingReset(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <PageSkeleton />
      </div>
    );
  }

  const onTabChange = (id: string) => {
    if (isAccountTab(id)) setActiveTab(id);
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <PageHeader
        title="Manage account"
        description="Your details, reminder choices and account security."
      />

      <div className="panel">
        <Tabs
          tabs={TABS}
          active={activeTab}
          onChange={onTabChange}
          idPrefix={IDS}
          label="Account sections"
          className="px-2"
        />

        <div
          role="tabpanel"
          id={panelId(IDS, activeTab)}
          aria-labelledby={tabId(IDS, activeTab)}
          tabIndex={0}
          className="p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:p-6"
        >
          {activeTab === "profile" && (
            <div className="space-y-5">
              <UpdatePHR embedded />
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line p-4">
                <div className="flex items-start gap-3">
                  <UserGroupIcon className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" aria-hidden />
                  <div>
                    <p className="text-body font-medium text-ink">People you care for</p>
                    <p className="text-caption text-ink-muted">
                      See, add or remove profiles for family members you look after.
                    </p>
                  </div>
                </div>
                <Link
                  to="/patient/caregiver/add"
                  className="btn-secondary"
                  aria-label="Manage people you care for"
                >
                  Manage
                </Link>
              </div>
            </div>
          )}

          {activeTab === "notifications" && (
            <div className="space-y-5">
              <div>
                <h2 className="text-h2 text-ink">Reminders</h2>
                <p className="mt-1 text-body text-ink-muted">
                  Choose how you would like to hear from the clinic.
                </p>
                {isSupabaseEnabled && (
                  <p className="mt-2 flex items-start gap-2 text-caption text-ink-muted">
                    <InformationCircleIcon className="h-4 w-4 shrink-0" aria-hidden />
                    <span>
                      Your choices are saved to your online account as a record
                      of your wishes. Reminders the clinic sends do not check
                      them automatically yet, so tell clinic staff if you do not
                      want to be contacted a certain way.
                    </span>
                  </p>
                )}
              </div>

              {!isSupabaseEnabled ? (
                <div className="banner banner-info">
                  <InformationCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                  <p>
                    Reminder choices are kept in your online account. This
                    device is not connected to one, so they cannot be changed
                    here.
                  </p>
                </div>
              ) : prefsLoadFailed ? (
                <div className="banner banner-danger" role="alert">
                  <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                  <div className="space-y-3">
                    <p>
                      We could not load your reminder choices. Nothing has been
                      changed.
                    </p>
                    <button
                      type="button"
                      onClick={() => void loadAccountInfo()}
                      className="btn-secondary"
                    >
                      <ArrowPathIcon className="h-5 w-5" aria-hidden />
                      Try again
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <fieldset className="space-y-2">
                    <legend className="sr-only">Reminder choices</legend>
                    {NOTIFICATION_OPTIONS.map((o) => {
                      const id = `notif-${o.key}`;
                      return (
                        <label
                          key={o.key}
                          htmlFor={id}
                          className="flex min-h-touch-target cursor-pointer items-start gap-3 rounded-md border border-line p-3 transition-colors hover:bg-surface-hover"
                        >
                          <input
                            id={id}
                            type="checkbox"
                            checked={notifications[o.key]}
                            onChange={(e) => {
                              setNotifMessage(null);
                              setNotifications({
                                ...notifications,
                                [o.key]: e.target.checked,
                              });
                            }}
                            disabled={saving}
                            className="mt-0.5 h-5 w-5 shrink-0 rounded border-line-strong text-primary focus:ring-primary"
                          />
                          <span>
                            <span className="block text-body font-medium text-ink">
                              {o.title}
                            </span>
                            <span className="block text-caption text-ink-muted">
                              {o.description}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </fieldset>

                  <div aria-live="polite">
                    {notifMessage && (
                      <div
                        className={`banner ${notifMessage.tone === "success" ? "banner-success" : "banner-danger"}`}
                      >
                        {notifMessage.tone === "success" ? (
                          <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                        ) : (
                          <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                        )}
                        <p>{notifMessage.text}</p>
                      </div>
                    )}
                  </div>

                  {!isOnline && (
                    <p className="text-caption text-ink-muted">
                      You are offline. Saving needs an internet connection.
                    </p>
                  )}

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => void saveNotificationPreferences()}
                      disabled={saving || !isOnline}
                      className="btn-primary"
                    >
                      {saving ? "Saving…" : "Save reminder choices"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === "security" && (
            <div className="space-y-6">
              <section aria-labelledby="security-password-title" className="space-y-3">
                <h2 id="security-password-title" className="flex items-center gap-2 text-h2 text-ink">
                  <KeyIcon className="h-5 w-5 text-ink-muted" aria-hidden />
                  {isSupabaseEnabled ? "Password" : "PIN"}
                </h2>
                {isSupabaseEnabled ? (
                  <>
                    <p className="text-body text-ink-secondary">
                      We will email you a link to choose a new password. Once you
                      change it, you will be logged out on every device,
                      including this one.
                    </p>
                    <div aria-live="polite">
                      {securityMessage && (
                        <div
                          className={`banner ${securityMessage.tone === "success" ? "banner-success" : "banner-danger"}`}
                        >
                          {securityMessage.tone === "success" ? (
                            <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                          ) : (
                            <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                          )}
                          <p>{securityMessage.text}</p>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => void initiatePasswordReset()}
                      disabled={sendingReset || !isOnline}
                      className="btn-primary"
                    >
                      {sendingReset ? "Sending…" : "Email me a reset link"}
                    </button>
                    {!isOnline && (
                      <p className="text-caption text-ink-muted">
                        You are offline. Sending a reset link needs an internet
                        connection.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-body text-ink-secondary">
                    You log in on this device with the 6-digit PIN you chose when
                    you registered. To change or reset your PIN, ask clinic staff
                    to help you.
                  </p>
                )}
              </section>

              <section
                aria-labelledby="security-devices-title"
                className="space-y-3 border-t border-line pt-6"
              >
                <h2 id="security-devices-title" className="text-h2 text-ink">
                  Where you are logged in
                </h2>
                <div className="flex items-center gap-3 rounded-md border border-line bg-surface-sunken p-3">
                  <DevicePhoneMobileIcon className="h-6 w-6 shrink-0 text-ink-muted" aria-hidden />
                  <div>
                    <p className="text-body font-medium text-ink">This device</p>
                    <p className="text-caption text-ink-muted">
                      Logged in now. On a shared phone or computer, log out from
                      the menu when you finish.
                    </p>
                  </div>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
