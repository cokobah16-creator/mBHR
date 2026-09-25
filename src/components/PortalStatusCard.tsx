/**
 * Portal Status Card Component
 *
 * Displays patient portal enrollment status with:
 * - Enable/disable switch. Turning access on asks staff to tick that the
 *   patient has agreed; turning it off asks for confirmation.
 * - Verification status
 * - Last login date
 * - Invitation history
 * - Send/resend invitation button with rate limiting, and an honest
 *   message when no email could be sent (including when the server refused
 *   because nobody is signed in online). Invitations go by email only: for
 *   a patient with no email the button makes a registration link to share.
 *
 * The switch saves on this device, and also on the server when the device
 * is online, someone is signed in online, and the server takes the change
 * (the online portal checks the server). The dialog says which to expect
 * and the toast says which happened.
 */

import { useCallback, useEffect, useState } from "react";
import {
  EnvelopeIcon,
  ClipboardDocumentIcon,
  ClipboardDocumentCheckIcon,
  LinkIcon,
} from "@heroicons/react/24/outline";
import {
  getPortalStatus,
  sendPortalInvitation,
  enablePortalAccess,
  disablePortalAccess,
  type InvitationNotSentReason,
  type PortalStatusInfo,
  type ServerPortalWrite,
} from "@/services/portalEnrollment";
import { formatNigerianDate } from "@/utils/dateFormat";
import { useToast } from "@/stores/toast";
import { useAuthStore } from "@/stores/auth";
import { can } from "@/auth/roles";
import { generateId } from "@/db";
import { getErrorMessage } from "@/utils/errors";
import { StatusBadge, type Tone } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import { ConfirmDialog } from "@/features/admin/ConfirmDialog";
import { useServerStatus } from "@/features/admin/useServerStatus";
import { ONLINE_SIGN_IN_HINT, useCloudSession } from "@/lib/cloudSession";

interface PortalStatusCardProps {
  patientId: string;
  patientName: string;
  onStatusChange?: () => void;
}

// "sent" is recorded both when the server sent the message and when no
// message could be sent and staff were given a link to share instead.
const INVITE_STATUS: Record<
  NonNullable<PortalStatusInfo["inviteStatus"]>,
  { label: string; tone: Tone }
> = {
  queued: { label: "Queued", tone: "info" },
  sent: { label: "Sent or link shared", tone: "info" },
  delivered: { label: "Delivered", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

// Why no invitation went out. For "not_permitted" (403): every role that
// sees the button may send email, so it means the server does not accept the
// account (inactive, or a different role on the server).
function notSentReasonText(reason: InvitationNotSentReason): string {
  switch (reason) {
    case "sms_not_available":
      return "This patient has no email, and invitations cannot be sent by SMS yet.";
    case "not_signed_in":
      return `The server sends email only for staff signed in online. A PIN unlock is not enough. ${ONLINE_SIGN_IN_HINT}`;
    default:
      return "The server does not let your staff account send email. It may not be active, or its role on the server may not allow it. Ask an administrator to check your account.";
  }
}

/** Toast text after the switch: where the change was saved. */
function savedWhere(
  enable: boolean,
  server: ServerPortalWrite | undefined,
): string {
  switch (server) {
    case "updated":
      return enable
        ? "Saved on this device and on the server, which the online portal checks."
        : "Turned off on this device and on the server, which the online portal checks.";
    case "no-server":
      return "Saved on this device only: no server is connected.";
    case "offline":
      return enable
        ? "Saved on this device only. This device is offline, so the server was not updated."
        : "Turned off on this device only. This device is offline, so the server was not updated and an online portal account may still work.";
    case "not-signed-in":
      return enable
        ? `Saved on this device only. You are not signed in online, so the server was not updated. ${ONLINE_SIGN_IN_HINT}`
        : `Turned off on this device only. You are not signed in online, so the server was not updated and an online portal account may still work. ${ONLINE_SIGN_IN_HINT}`;
    case "not-updated":
      return enable
        ? "Saved on this device only. The server did not take the change: the patient's record may not be uploaded yet. Once it is, turn access off and on again."
        : "Turned off on this device only. The server did not take the change, so an online portal account may still work.";
    default:
      return enable ? "Saved on this device." : "Turned off on this device.";
  }
}

const formatCountdown = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

export function PortalStatusCard({
  patientId,
  patientName,
  onStatusChange,
}: PortalStatusCardProps) {
  const role = useAuthStore((s) => s.currentUser?.role);
  // Portal access is part of the patient's registration details.
  const canEdit = !!role && can(role, "register");
  const server = useServerStatus();
  // After a PIN unlock there is no online sign-in, and the server refuses to
  // send email; say so before staff press the button.
  const notSignedInOnline = useCloudSession() === "signed_out";
  const firstName = patientName.split(" ")[0];
  const titleId = `portal-card-${patientId}`;

  const [status, setStatus] = useState<PortalStatusInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [confirmEnable, setConfirmEnable] = useState(false);
  // Staff attestation for turning access on. Starts unticked every time.
  const [patientAgreed, setPatientAgreed] = useState(false);
  const [countdown, setCountdown] = useState<number>(0);
  const [inviteLink, setInviteLink] = useState<{
    url: string;
    delivered: boolean;
    notSentReason?: InvitationNotSentReason;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const { push: pushToast } = useToast();

  const loadStatus = useCallback(async () => {
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
      console.error(
        "Error loading portal status:",
        error instanceof Error ? error.name : error,
      );
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // Countdown timer for rate limiting
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const closeEnableDialog = () => {
    setConfirmEnable(false);
    setPatientAgreed(false);
  };

  const setPortalAccess = async (enable: boolean) => {
    // Access is turned on only after staff tick that the patient agreed.
    const agreed = patientAgreed;
    if (enable && !agreed) return;
    setConfirmDisable(false);
    closeEnableDialog();
    if (!status) return;
    if (!canEdit) {
      pushToast({
        id: generateId(),
        tone: "error",
        title: "Not allowed",
        body: "Your role cannot change portal access.",
      });
      return;
    }

    setToggling(true);
    try {
      const result = enable
        ? await enablePortalAccess(patientId, { termsAccepted: agreed })
        : await disablePortalAccess(patientId);

      if (result.success) {
        pushToast({
          id: generateId(),
          tone: "success",
          title: enable ? "Portal access turned on" : "Portal access turned off",
          body: savedWhere(enable, result.server),
        });
        await loadStatus();
        onStatusChange?.();
      } else {
        pushToast({
          id: generateId(),
          tone: "error",
          title: "Portal access not changed",
          body: result.error || "Try again.",
        });
      }
    } catch (error: unknown) {
      pushToast({
        id: generateId(),
        tone: "error",
        title: "Portal access not changed",
        body: getErrorMessage(error),
      });
    } finally {
      setToggling(false);
    }
  };

  const handleSwitch = () => {
    if (!status) return;
    if (status.enabled) {
      setConfirmDisable(true);
    } else {
      setPatientAgreed(false);
      setConfirmEnable(true);
    }
  };

  const handleSendInvitation = async () => {
    if (!canEdit) {
      pushToast({
        id: generateId(),
        tone: "error",
        title: "Not allowed",
        body: "Your role cannot send portal invitations.",
      });
      return;
    }
    setSending(true);
    try {
      const result = await sendPortalInvitation(patientId);

      if (result.success) {
        if (result.registrationUrl) {
          // Show the registration link: a warning if no email was sent
          setInviteLink({
            url: result.registrationUrl,
            delivered: !result.demoOTP,
            notSentReason: result.notSentReason,
          });
        } else {
          pushToast({
            id: generateId(),
            tone: "success",
            title: "Invitation sent",
            body: "Portal invitation sent.",
          });
        }
        await loadStatus();
        onStatusChange?.();
      } else {
        pushToast({
          id: generateId(),
          tone: "error",
          title: "Invitation not sent",
          body: result.error || "Try again.",
        });
      }
    } catch (error: unknown) {
      pushToast({
        id: generateId(),
        tone: "error",
        title: "Invitation not sent",
        body: getErrorMessage(error),
      });
    } finally {
      setSending(false);
    }
  };

  const handleCopyLink = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      pushToast({
        id: generateId(),
        tone: "warning",
        title: "Could not copy the link",
        body: "Select the link and copy it yourself.",
      });
    }
  };

  if (loading && !status) {
    return (
      <section className="panel" aria-labelledby={titleId}>
        <div className="panel-header">
          <h2 id={titleId} className="panel-title">
            Patient portal
          </h2>
        </div>
        <div className="panel-body space-y-3" aria-hidden>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-10 w-full" />
        </div>
        <span role="status" className="sr-only">
          Loading portal status
        </span>
      </section>
    );
  }

  if (!status) {
    return (
      <section className="panel" aria-labelledby={titleId}>
        <div className="panel-header">
          <h2 id={titleId} className="panel-title">
            Patient portal
          </h2>
        </div>
        <p className="panel-body text-body text-ink-muted">
          Portal status could not be read for this patient on this device.
        </p>
      </section>
    );
  }

  const statusBadge = !status.enabled ? (
    <StatusBadge tone="neutral" icon>
      Not enabled
    </StatusBadge>
  ) : status.verified ? (
    <StatusBadge tone="success" icon>
      Verified
    </StatusBadge>
  ) : (
    <StatusBadge tone="warning">Pending verification</StatusBadge>
  );

  const invite = status.inviteStatus ? INVITE_STATUS[status.inviteStatus] : null;
  const contactLabel =
    status.contactMethod === "email"
      ? "Email"
      : status.contactMethod === "phone"
        ? "Phone"
        : "None recorded";
  // Only an email invitation can be sent; otherwise the button makes a link.
  const canSendEmail = server.available && status.contactMethod === "email";
  // Registration always needs an email address, plus a password, or a
  // 6-digit PIN on a device with no server (PatientRegister).
  const noServer = server.state === "not-configured";
  const credential = noServer ? "a 6-digit PIN" : "a password";
  const signInWith = noServer ? "email and PIN" : "email and password";

  return (
    <section className="panel" aria-labelledby={titleId}>
      <div className="panel-header">
        <div>
          <h2 id={titleId} className="panel-title">
            Patient portal
          </h2>
          <p className="text-caption text-ink-muted">
            Online access to their medical records and appointments
          </p>
        </div>
        {statusBadge}
      </div>

      <div className="panel-body space-y-4">
        {/* Access switch */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p id={`${titleId}-access`} className="text-label text-ink">
              Portal access
            </p>
            <p className="text-caption text-ink-muted">
              {canEdit
                ? status.enabled
                  ? "The patient can register and sign in to the portal."
                  : "Turn on only after the patient agrees to use the portal."
                : "Your role cannot change portal access."}
            </p>
          </div>
          {canEdit ? (
            <button
              type="button"
              role="switch"
              aria-checked={status.enabled}
              aria-labelledby={`${titleId}-access`}
              onClick={handleSwitch}
              disabled={toggling}
              className="flex min-h-touch-target items-center gap-2 rounded-md px-2 text-label text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            >
              <span
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                  status.enabled ? "bg-primary" : "bg-line-strong"
                }`}
                aria-hidden
              >
                <span
                  className={`inline-block h-5 w-5 rounded-full bg-surface transition-transform ${
                    status.enabled ? "translate-x-[22px]" : "translate-x-0.5"
                  }`}
                />
              </span>
              <span className="w-8 text-left">{status.enabled ? "On" : "Off"}</span>
            </button>
          ) : (
            <span className="text-label text-ink">
              {status.enabled ? "On" : "Off"}
            </span>
          )}
        </div>

        {/* Facts */}
        <dl className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3">
          <div className="bg-surface-sunken px-3 py-2">
            <dt className="text-caption text-ink-muted">Contact method</dt>
            <dd className="text-label text-ink">{contactLabel}</dd>
          </div>
          <div className="bg-surface-sunken px-3 py-2">
            <dt className="text-caption text-ink-muted">Last portal sign-in</dt>
            <dd className="text-label text-ink tabular-nums">
              {status.lastLogin ? formatNigerianDate(status.lastLogin) : "Never"}
            </dd>
          </div>
          <div className="bg-surface-sunken px-3 py-2">
            <dt className="text-caption text-ink-muted">Invitations</dt>
            <dd className="text-label text-ink tabular-nums">
              {status.inviteCount || 0}
            </dd>
          </div>
        </dl>

        {/* Invitation Status */}
        {status.enabled && status.lastInviteSent && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <span className="text-label text-ink">Last invitation</span>
            <span className="text-body text-ink-secondary tabular-nums">
              {formatNigerianDate(status.lastInviteSent)}
            </span>
            {invite && (
              <StatusBadge tone={invite.tone} icon>
                {invite.label}
              </StatusBadge>
            )}
          </div>
        )}

        {/* Registration link panel — shown after sending invitation */}
        {inviteLink && (
          <div
            className={`space-y-3 rounded-md border px-4 py-3 ${
              inviteLink.delivered
                ? "border-success-line bg-success-soft"
                : "border-warning-line bg-warning-soft"
            }`}
            role="status"
          >
            <div className="flex items-start gap-2">
              {inviteLink.delivered ? (
                <EnvelopeIcon className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
              ) : (
                <LinkIcon className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
              )}
              <div
                className={`space-y-1 text-body ${
                  inviteLink.delivered ? "text-success-fg" : "text-warning-fg"
                }`}
              >
                <p className="font-medium">
                  {inviteLink.delivered
                    ? "Invitation sent by email"
                    : status.contactMethod === "email"
                      ? "No email was sent"
                      : "No message was sent"}
                </p>
                {!inviteLink.delivered && inviteLink.notSentReason && (
                  <p className="text-caption">
                    {notSentReasonText(inviteLink.notSentReason)}
                  </p>
                )}
                <p className="text-caption">
                  {inviteLink.delivered
                    ? "The patient will receive this registration link. You can also copy it and share it directly."
                    : "Share this link with the patient: read it out, show it on screen, or send it by WhatsApp or SMS."}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-1">
              <span className="min-w-0 flex-1 truncate font-mono text-caption text-ink-secondary">
                {inviteLink.url}
              </span>
              <button
                type="button"
                onClick={handleCopyLink}
                className="btn-ghost shrink-0"
                aria-label="Copy registration link"
              >
                {copied ? (
                  <>
                    <ClipboardDocumentCheckIcon className="h-4 w-4" aria-hidden />
                    Copied
                  </>
                ) : (
                  <>
                    <ClipboardDocumentIcon className="h-4 w-4" aria-hidden />
                    Copy
                  </>
                )}
              </button>
            </div>
            <p className="text-caption text-ink-secondary">
              {status.contactMethod === "email"
                ? `The patient's email is pre-filled. They also enter their name, date of birth and ${credential} to finish registering.`
                : `The patient's phone number is pre-filled. Registration also needs an email address, so they also enter an email, their name, the date of birth on their record and ${credential}.`}
            </p>
          </div>
        )}

        {/* Send/Resend Button */}
        {status.enabled && (
          <div className="space-y-3 border-t border-line pt-4">
            {status.contactMethod ? (
              canEdit && (
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={handleSendInvitation}
                    disabled={sending || countdown > 0}
                    className="btn-primary w-full sm:w-auto"
                  >
                    {canSendEmail ? (
                      <EnvelopeIcon className="h-5 w-5" aria-hidden />
                    ) : (
                      <LinkIcon className="h-5 w-5" aria-hidden />
                    )}
                    {sending
                      ? "Sending…"
                      : countdown > 0
                        ? `Resend available in ${formatCountdown(countdown)}`
                        : canSendEmail
                          ? `${(status.inviteCount || 0) > 0 ? "Resend" : "Send"} portal invitation`
                          : "Create registration link"}
                  </button>
                  {status.contactMethod === "phone" ? (
                    <p className="text-caption text-ink-muted">
                      {notSentReasonText("sms_not_available")} You'll get a
                      link to share with the patient.
                    </p>
                  ) : !server.available ? (
                    <p className="text-caption text-ink-muted">
                      {server.state === "offline"
                        ? "This device is offline, so no email can be sent. You'll get a link to share with the patient."
                        : "No server is connected, so no email can be sent. You'll get a link to share with the patient."}
                    </p>
                  ) : (
                    notSignedInOnline && (
                      <p className="text-caption text-ink-muted">
                        You are not signed in online, so the server will not
                        send email. You'll get a link to share with the
                        patient. To send it, sign in online.{" "}
                        {ONLINE_SIGN_IN_HINT}
                      </p>
                    )
                  )}
                </div>
              )
            ) : (
              <div className="banner banner-warning">
                Add an email or phone number to this patient's record before
                sending a portal invitation.
              </div>
            )}

            {/* Patient access instructions for staff */}
            {(status.inviteCount || 0) > 0 && !status.verified && (
              <div className="rounded-md border border-line bg-surface-sunken px-3 py-2">
                <p className="text-label text-ink">What to tell the patient</p>
                <p className="text-caption text-ink-secondary">
                  Go to <strong>{window.location.origin}/patient/login</strong>,
                  choose "Register here", and enter{" "}
                  {status.contactMethod === "email"
                    ? "the email address the clinic has for you, your date of birth"
                    : "an email address, the phone number and date of birth the clinic has for you,"}{" "}
                  and {credential}. Then sign in with your {signInWith}.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Enable Portal Prompt */}
        {!status.enabled && (
          <p className="text-body text-ink-secondary">
            Turning on portal access lets {firstName} use the patient portal
            to see their records, request appointments and message the
            clinic.
          </p>
        )}
      </div>

      <ConfirmDialog
        open={confirmEnable}
        title={`Turn on portal access for ${firstName}?`}
        confirmLabel="Turn on access"
        confirmDisabled={!patientAgreed}
        busy={toggling}
        busyLabel="Turning on…"
        onConfirm={() => setPortalAccess(true)}
        onCancel={closeEnableDialog}
      >
        <p>
          Portal access lets {firstName} use the patient portal to see their
          records, request appointments and message the clinic.
        </p>
        <p>
          {server.state === "available" && notSignedInOnline
            ? `You are not signed in online, so it is saved on this device only. The online portal is not changed. To send it to the server, sign in online. ${ONLINE_SIGN_IN_HINT}`
            : server.state === "available"
              ? "It is saved on this device and sent to the server, which the online portal checks. If the server does not take it, for example because the patient's record is not uploaded yet, only this device changes. You will see which."
              : server.state === "offline"
                ? "This device is offline, so it is saved on this device only. The online portal is not changed."
                : "No server is connected, so it is saved on this device only."}
        </p>
        <label className="flex items-start gap-3 rounded-md border border-line bg-surface-sunken p-3">
          <input
            type="checkbox"
            id={`${titleId}-agreed`}
            checked={patientAgreed}
            onChange={(e) => setPatientAgreed(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 rounded border-line-strong text-primary focus:ring-primary"
          />
          <span className="text-body text-ink">
            {firstName} has agreed to use the patient portal.
          </span>
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmDisable}
        title={`Turn off portal access for ${firstName}?`}
        confirmLabel="Turn off access"
        tone="danger"
        busy={toggling}
        busyLabel="Turning off…"
        onConfirm={() => setPortalAccess(false)}
        onCancel={() => setConfirmDisable(false)}
      >
        <p>
          {server.state === "available" && notSignedInOnline
            ? `You are not signed in online, so portal access will be turned off on this device only. It does not block ${firstName}'s online portal account if they have one. To send the change to the server, sign in online. ${ONLINE_SIGN_IN_HINT}`
            : server.state === "available"
              ? "Portal access will be turned off on this device and the change sent to the server, which the online portal checks. If the server does not take it, only this device changes. You will see which."
              : server.state === "offline"
                ? `This device is offline, so portal access will be turned off on this device only. It does not block ${firstName}'s online portal account if they have one.`
                : "Portal access will be turned off on this device. No server is connected, so there is nothing to upload."}{" "}
          Their records are not deleted.
        </p>
        <p>You can turn access back on later.</p>
      </ConfirmDialog>
    </section>
  );
}
