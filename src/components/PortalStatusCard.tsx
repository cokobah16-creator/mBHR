/**
 * Portal Status Card Component
 *
 * Displays patient portal enrollment status with:
 * - Enable/disable toggle
 * - Verification status
 * - Last login date
 * - Invitation history
 * - Send/resend invitation button with rate limiting
 */

import React, { useState, useEffect } from "react";
import {
  ShieldCheckIcon,
  EnvelopeIcon,
  PhoneIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowPathIcon,
  ExclamationCircleIcon,
  GlobeAltIcon,
  ClipboardDocumentIcon,
  ClipboardDocumentCheckIcon,
} from "@heroicons/react/24/outline";
import {
  getPortalStatus,
  sendPortalInvitation,
  enablePortalAccess,
  disablePortalAccess,
  type PortalStatusInfo,
} from "@/services/portalEnrollment";
import { formatNigerianDate } from "@/utils/dateFormat";
import { useToast } from "@/stores/toast";

interface PortalStatusCardProps {
  patientId: string;
  patientName: string;
  onStatusChange?: () => void;
}

export function PortalStatusCard({
  patientId,
  patientName,
  onStatusChange,
}: PortalStatusCardProps) {
  const [status, setStatus] = useState<PortalStatusInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [countdown, setCountdown] = useState<number>(0);
  const [offlineLink, setOfflineLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { push: pushToast } = useToast();

  useEffect(() => {
    loadStatus();
  }, [patientId]);

  // Countdown timer for rate limiting
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const portalStatus = await getPortalStatus(patientId);
      setStatus(portalStatus);

      // Set countdown if rate limited
      if (portalStatus && portalStatus.nextResendTime) {
        const secondsUntil = Math.max(
          0,
          Math.floor(
            (portalStatus.nextResendTime.getTime() - Date.now()) / 1000,
          ),
        );
        setCountdown(secondsUntil);
      }
    } catch (error) {
      console.error("Error loading portal status:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleTogglePortal = async () => {
    if (!status) return;

    setToggling(true);
    try {
      const result = status.enabled
        ? await disablePortalAccess(patientId)
        : await enablePortalAccess(patientId, { termsAccepted: true });

      if (result.success) {
        pushToast({
          id: crypto.randomUUID(),
          title: "Success",
          body: `Portal access ${status.enabled ? "disabled" : "enabled"} successfully`,
        });
        await loadStatus();
        onStatusChange?.();
      } else {
        pushToast({
          id: crypto.randomUUID(),
          title: "Error",
          body: result.error || "Failed to update portal access",
        });
      }
    } catch (error: any) {
      pushToast({
        id: crypto.randomUUID(),
        title: "Error",
        body: error.message || "An error occurred",
      });
    } finally {
      setToggling(false);
    }
  };

  const handleSendInvitation = async () => {
    setSending(true);
    try {
      const result = await sendPortalInvitation(patientId);

      if (result.success) {
        if (result.registrationUrl) {
          // Offline mode: persist the link in the card so staff can share it
          setOfflineLink(result.registrationUrl);
        } else {
          pushToast({
            id: crypto.randomUUID(),
            title: "Invitation Sent",
            body: "Portal invitation sent successfully. The patient can now register using their contact details and date of birth.",
          });
        }
        await loadStatus();
        onStatusChange?.();
      } else {
        pushToast({
          id: crypto.randomUUID(),
          title: "Error",
          body: result.error || "Failed to send invitation",
        });
      }
    } catch (error: any) {
      pushToast({
        id: crypto.randomUUID(),
        title: "Error",
        body: error.message || "Failed to send invitation",
      });
    } finally {
      setSending(false);
    }
  };

  const handleCopyLink = async () => {
    if (!offlineLink) return;
    await navigator.clipboard.writeText(offlineLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const formatCountdown = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  if (loading) {
    return (
      <div className="card">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="card bg-gray-50">
        <div className="flex items-center space-x-3">
          <ExclamationCircleIcon className="h-6 w-6 text-gray-400" />
          <p className="text-gray-600">Portal status unavailable</p>
        </div>
      </div>
    );
  }

  const getStatusBadge = () => {
    if (!status.enabled) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
          Disabled
        </span>
      );
    }
    if (status.verified) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
          <CheckCircleIcon className="h-3.5 w-3.5 mr-1" />
          Verified
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
        <ClockIcon className="h-3.5 w-3.5 mr-1" />
        Pending Verification
      </span>
    );
  };

  const getInviteStatusBadge = () => {
    if (!status.inviteStatus) return null;

    const statusConfig = {
      queued: { color: "bg-blue-100 text-blue-800", label: "Queued" },
      sent: { color: "bg-indigo-100 text-indigo-800", label: "Sent" },
      delivered: { color: "bg-green-100 text-green-800", label: "Delivered" },
      failed: { color: "bg-red-100 text-red-800", label: "Failed" },
    };

    const config = statusConfig[status.inviteStatus];
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${config.color}`}
      >
        {config.label}
      </span>
    );
  };

  return (
    <div className="card">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <GlobeAltIcon className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Patient Portal Access
            </h3>
            <p className="text-sm text-gray-600">
              Online medical records and appointments
            </p>
          </div>
        </div>
        {getStatusBadge()}
      </div>

      <div className="space-y-4">
        {/* Portal Status Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Enabled/Disabled Status */}
          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
            <div className="flex items-center space-x-2">
              <ShieldCheckIcon className="h-5 w-5 text-gray-500" />
              <span className="text-sm font-medium text-gray-700">
                Portal Access
              </span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={status.enabled}
                onChange={handleTogglePortal}
                disabled={toggling}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          {/* Contact Method */}
          {status.contactMethod && (
            <div className="flex items-center space-x-2 p-3 bg-gray-50 rounded-lg">
              {status.contactMethod === "email" ? (
                <EnvelopeIcon className="h-5 w-5 text-gray-500" />
              ) : (
                <PhoneIcon className="h-5 w-5 text-gray-500" />
              )}
              <div>
                <p className="text-sm font-medium text-gray-700">
                  {status.contactMethod === "email" ? "Email" : "SMS"}
                </p>
                <p className="text-xs text-gray-600">Contact method</p>
              </div>
            </div>
          )}

          {/* Last Login */}
          {status.lastLogin && (
            <div className="flex items-center space-x-2 p-3 bg-gray-50 rounded-lg">
              <ClockIcon className="h-5 w-5 text-gray-500" />
              <div>
                <p className="text-sm font-medium text-gray-700">
                  {formatNigerianDate(status.lastLogin)}
                </p>
                <p className="text-xs text-gray-600">Last login</p>
              </div>
            </div>
          )}

          {/* Invitation Count */}
          {status.inviteCount > 0 && (
            <div className="flex items-center space-x-2 p-3 bg-gray-50 rounded-lg">
              <EnvelopeIcon className="h-5 w-5 text-gray-500" />
              <div>
                <p className="text-sm font-medium text-gray-700">
                  {status.inviteCount}{" "}
                  {status.inviteCount === 1 ? "invitation" : "invitations"}
                </p>
                <p className="text-xs text-gray-600">Sent</p>
              </div>
            </div>
          )}
        </div>

        {/* Invitation Status */}
        {status.enabled && status.lastInviteSent && (
          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">
                Last Invitation
              </span>
              {getInviteStatusBadge()}
            </div>
            <p className="text-sm text-gray-600">
              Sent {formatNigerianDate(status.lastInviteSent)}
            </p>
          </div>
        )}

        {/* Offline registration link panel */}
        {offlineLink && (
          <div className="border-t pt-4">
            <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 space-y-3">
              <p className="text-sm font-semibold text-amber-900">
                No email service — share this link with the patient
              </p>
              <p className="text-xs text-amber-800">
                Email requires Supabase/SMTP. Instead, read this link aloud,
                show it on screen, or copy it and send via WhatsApp/SMS from
                your own device.
              </p>
              <div className="flex items-center gap-2 bg-white border border-amber-300 rounded-md px-3 py-2">
                <span className="text-xs text-gray-700 truncate flex-1 font-mono">
                  {offlineLink}
                </span>
                <button
                  onClick={handleCopyLink}
                  className="shrink-0 flex items-center gap-1 text-xs font-medium text-amber-800 hover:text-amber-900"
                  title="Copy to clipboard"
                >
                  {copied ? (
                    <>
                      <ClipboardDocumentCheckIcon className="h-4 w-4 text-green-600" />
                      <span className="text-green-700">Copied!</span>
                    </>
                  ) : (
                    <>
                      <ClipboardDocumentIcon className="h-4 w-4" />
                      Copy
                    </>
                  )}
                </button>
              </div>
              <p className="text-xs text-amber-800">
                The patient's email will be pre-filled when they open this link.
                They will need to enter their <strong>date of birth</strong> to
                complete registration.
              </p>
            </div>
          </div>
        )}

        {/* Send/Resend Button */}
        {status.enabled && (
          <div className="border-t pt-4 space-y-3">
            {status.contactMethod ? (
              <button
                onClick={handleSendInvitation}
                disabled={sending || countdown > 0}
                className={`w-full flex items-center justify-center space-x-2 py-2.5 px-4 rounded-lg font-medium transition-colors ${
                  countdown === 0 && !sending
                    ? "bg-blue-600 hover:bg-blue-700 text-white"
                    : "bg-gray-100 text-gray-400 cursor-not-allowed"
                }`}
              >
                {sending ? (
                  <>
                    <ArrowPathIcon className="h-5 w-5 animate-spin" />
                    <span>Sending...</span>
                  </>
                ) : countdown > 0 ? (
                  <>
                    <ClockIcon className="h-5 w-5" />
                    <span>Resend available in {formatCountdown(countdown)}</span>
                  </>
                ) : (
                  <>
                    <EnvelopeIcon className="h-5 w-5" />
                    <span>
                      {status.inviteCount > 0 ? "Resend" : "Send"} Portal
                      Invitation
                    </span>
                  </>
                )}
              </button>
            ) : (
              <div className="text-center py-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4">
                Add an email or phone number to this patient's record before sending a portal invitation.
              </div>
            )}

            {/* Patient access instructions for staff */}
            {status.inviteCount > 0 && !status.verified && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-xs font-semibold text-blue-800 mb-1">
                  What to tell the patient:
                </p>
                <p className="text-xs text-blue-700">
                  Go to <strong>{window.location.origin}/patient/login</strong>,
                  click "Register here", and enter your{" "}
                  {status.contactMethod === "email" ? "email address" : "phone number"}{" "}
                  + date of birth.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Enable Portal Prompt */}
        {!status.enabled && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-800">
              Enable portal access to allow {patientName.split(" ")[0]} to view
              medical records, schedule appointments, and communicate securely
              online.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
