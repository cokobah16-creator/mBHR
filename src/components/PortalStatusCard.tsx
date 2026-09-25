/**
 * Portal Status Card Component
 *
 * Displays patient portal enrollment status with:
 * - Enable/disable switch. Turning access on asks staff to tick that the
 *   patient has agreed to use the portal ("Turn on access" stays disabled
 *   until then); turning it off asks for confirmation. The tick is not
 *   stored on the server: the request carries only a reason code
 *   (staff_choice)
 * - Where the decision stands: waiting for the server, confirmed by the
 *   server, refused by the server, or kept on this device only
 * - Verification status
 * - Last login date
 * - Invitation history
 * - Send/resend invitation button with rate limiting, and an honest
 *   message when no email or SMS could be sent. Only roles with the
 *   portal_invite permission see it; others are told why
 * - For a patient under 18 the switch can only turn access off, and no
 *   invitation or registration link is offered: portal accounts are for
 *   adults (the services refuse too)
 *
 * Portal access belongs to the server. A change made here is saved on this
 * device, queued, and shown as waiting until the server answers; the card
 * follows the answer live. The queued change is sent only while the staff
 * member who made it is signed in online on this device (a PIN unlock is not
 * enough), so the card says so when they are not.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowPathIcon,
  CheckCircleIcon,
  EnvelopeIcon,
  ClipboardDocumentIcon,
  ClipboardDocumentCheckIcon,
  ExclamationTriangleIcon,
  LinkIcon,
} from "@heroicons/react/24/outline";
import {
  getPortalStatus,
  sendPortalInvitation,
  enablePortalAccess,
  disablePortalAccess,
  INVITE_NOT_SENT_REASONS,
  type PortalStatusInfo,
} from "@/services/portalEnrollment";
import { listPortalAccessCommands } from "@/services/portalAccess";
import { describePortalAccess } from "@/services/portalAccessRules";
import { formatNigerianDate } from "@/utils/dateFormat";
import { useToast } from "@/stores/toast";
import { useAuthStore } from "@/stores/auth";
import { can, portalInviteRefusal } from "@/auth/roles";
import { db, generateId } from "@/db";
import { getErrorMessage } from "@/utils/errors";
import { StatusBadge, type Tone } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import { ConfirmDialog } from "@/features/admin/ConfirmDialog";
import { useServerStatus } from "@/features/admin/useServerStatus";
import { ONLINE_SIGN_IN_HINT, useCloudSession } from "@/lib/cloudSession";
import { MINOR_PORTAL_ACCESS_MESSAGE } from "@/pages/legal/policyMeta";

interface PortalStatusCardProps {
  patientId: string;
  patientName: string;
  onStatusChange?: () => void;
}

const INVITE_STATUS: Record<
  NonNullable<PortalStatusInfo["inviteStatus"]>,
  { label: string; tone: Tone }
> = {
  queued: { label: "Queued", tone: "info" },
  sent: { label: "Sent", tone: "success" },
  delivered: { label: "Delivered", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

const NOT_SENT_LABEL: Record<string, string> = {
  [INVITE_NOT_SENT_REASONS.noServer]: "Not sent: link shared (no server connected)",
  [INVITE_NOT_SENT_REASONS.serviceFailed]: "Not sent: link shared (email/SMS service failed)",
  [INVITE_NOT_SENT_REASONS.demoMode]: "Not sent: link shared (email/SMS in demo mode)",
};

function inviteBadge(status: PortalStatusInfo): { label: string; tone: Tone } | null {
  if (!status.inviteStatus) return null;
  if (status.inviteStatus === "failed" && status.inviteFailureReason) {
    const label = NOT_SENT_LABEL[status.inviteFailureReason];
    if (label) return { label, tone: "warning" };
  }
  return INVITE_STATUS[status.inviteStatus];
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
  // Turning portal access on or off needs the portal_manage permission
  // (checked again where the change is saved).
  const canEdit = !!role && can(role, "portal_manage");
  // Sending an invitation is separate: portal_invite (checked again by the
  // service and by the server).
  const canInvite = !!role && can(role, "portal_invite");
  const server = useServerStatus();
  // A queued change goes to the server only under its author's own online
  // sign-in (services/portalAccess). After a PIN unlock there is none.
  const cloudSession = useCloudSession();
  const notSignedInOnline =
    server.state !== "not-configured" && cloudSession === "signed_out";
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
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const { push: pushToast } = useToast();

  // Live: the patient record and this patient's queued portal changes, so
  // the card follows the server's answer when it arrives.
  const patient = useLiveQuery(() => db.patients.get(patientId), [patientId]);
  const commands = useLiveQuery(
    () => listPortalAccessCommands(patientId),
    [patientId],
    [],
  );
  const access = useMemo(
    () => describePortalAccess(patient ?? {}, commands ?? []),
    [patient, commands],
  );

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

  // Reload whenever the patient record changes on this device (including
  // the server's answer to a queued change).
  useEffect(() => {
    loadStatus();
  }, [loadStatus, patient]);

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
          tone: result.deviceOnly ? "success" : "info",
          title: enable
            ? result.deviceOnly
              ? "Portal access turned on"
              : "Portal access on: waiting for the server"
            : result.deviceOnly
              ? "Portal access turned off"
              : "Portal access off: waiting for the server",
          body: result.deviceOnly
            ? "Saved on this device only: no server is connected."
            : notSignedInOnline
              ? `Saved on this device and queued. You are not signed in online, so it is sent to the server when you sign in online. ${ONLINE_SIGN_IN_HINT}`
              : server.available
                ? "Saved on this device and queued for the server. This card shows when the server answers."
                : "Saved on this device. It is sent to the server when this device is online and syncs.",
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
    if (access.enabled) {
      setConfirmDisable(true);
    } else if (status.minor) {
      // Do not ask staff to confirm agreement for a change that is refused.
      pushToast({
        id: generateId(),
        tone: "error",
        title: "Portal access not changed",
        body: MINOR_PORTAL_ACCESS_MESSAGE,
      });
    } else {
      setPatientAgreed(false);
      setConfirmEnable(true);
    }
  };

  const handleSendInvitation = async () => {
    if (!canInvite) {
      pushToast({
        id: generateId(),
        tone: "error",
        title: "Not allowed",
        body: portalInviteRefusal(),
      });
      return;
    }
    setSending(true);
    try {
      const result = await sendPortalInvitation(patientId);

      if (result.success) {
        if (result.registrationUrl) {
          // Show the registration link: a warning if no email/SMS was sent
          setInviteLink({
            url: result.registrationUrl,
            delivered: !result.demoOTP,
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

  const enabled = access.enabled;
  const pending = access.pending;
  const deviceOnly = server.state === "not-configured";
  // A child's record can still have access on from before portal accounts
  // were limited to adults. Staff can only turn it off.
  const minor = status.minor === true;

  const statusBadge = pending ? (
    <StatusBadge tone="warning" icon>
      Waiting for server
    </StatusBadge>
  ) : !enabled ? (
    <StatusBadge tone="neutral" icon>
      Not enabled
    </StatusBadge>
  ) : status.verified ? (
    <StatusBadge tone="success" icon>
      Verified
    </StatusBadge>
  ) : (
    <StatusBadge tone="info" icon>
      Contact not verified
    </StatusBadge>
  );

  const invite = inviteBadge(status);
  const contactLabel =
    status.contactMethod === "email"
      ? "Email"
      : status.contactMethod === "phone"
        ? "SMS"
        : "None recorded";

  // Registration (PatientRegister) always asks for an email address, a
  // name and the date of birth, plus a password, or a 6-digit PIN on a
  // device with no server. With a server, portal_link_patient_record links
  // the new account to a clinic record by that record's email address (once
  // confirmed) and date of birth; a phone number typed at registration is
  // not used to find the record.
  const credential = deviceOnly ? "a 6-digit PIN" : "a password";
  const signInWith = deviceOnly ? "email and PIN" : "email and password";
  const phoneOnlyLinkNote =
    "This record has no email address, and registration needs one. The server links a new portal account to a clinic record through the record's email address; a phone number typed at registration is not checked. Add the patient's email to their record before they register.";

  // Where the decision stands, in words (never colour alone).
  const decisionLine = (() => {
    if (deviceOnly) {
      return {
        tone: "neutral" as Tone,
        icon: null,
        text: "Kept on this device only: no server is connected.",
      };
    }
    if (pending) {
      return {
        tone: "warning" as Tone,
        icon: ArrowPathIcon,
        text: access.waitingPermission
          ? `Turning ${enabled ? "on" : "off"}: waiting for someone allowed to manage portal access to sync this device.`
          : !server.available
            ? `Turning ${enabled ? "on" : "off"}: saved on this device. It is sent to the server when this device is online and syncs.`
            : notSignedInOnline
              ? `Turning ${enabled ? "on" : "off"}: saved on this device and queued. It is sent to the server when the staff member who made the change signs in online on this device.`
              : access.lastErrorCode
              ? `Turning ${enabled ? "on" : "off"}: saved on this device. The server has not answered the last attempt (for example the record is not uploaded yet, or the connection failed); it is tried again at the next sync.`
              : `Turning ${enabled ? "on" : "off"}: saved on this device and waiting for the server's answer. It is sent again at each sync until the server answers.`,
      };
    }
    if (access.confirmedAt) {
      return {
        tone: "success" as Tone,
        icon: CheckCircleIcon,
        text: `Confirmed by the server on ${formatNigerianDate(access.confirmedAt)}.`,
      };
    }
    return {
      tone: "neutral" as Tone,
      icon: null,
      text: "The server has not recorded a decision for this patient yet.",
    };
  })();

  const DecisionIcon = decisionLine.icon;
  const decisionClass =
    decisionLine.tone === "warning"
      ? "text-warning-fg"
      : decisionLine.tone === "success"
        ? "text-success-fg"
        : "text-ink-muted";

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
              {minor
                ? enabled
                  ? `Portal accounts are for adults. This patient is under 18, so they cannot register or be linked to this record.${canEdit ? " Turn access off." : ""}`
                  : MINOR_PORTAL_ACCESS_MESSAGE
                : canEdit
                  ? enabled
                    ? "The patient can register and sign in to the portal once the server confirms access."
                    : "Turn on only after the patient agrees to use the portal."
                  : "Your role cannot change portal access."}
            </p>
          </div>
          {canEdit ? (
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-labelledby={`${titleId}-access`}
              aria-describedby={`${titleId}-decision`}
              onClick={handleSwitch}
              disabled={toggling}
              className="flex min-h-touch-target items-center gap-2 rounded-md px-2 text-label text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            >
              <span
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                  enabled ? "bg-primary" : "bg-line-strong"
                }`}
                aria-hidden
              >
                <span
                  className={`inline-block h-5 w-5 rounded-full bg-surface transition-transform ${
                    enabled ? "translate-x-[22px]" : "translate-x-0.5"
                  }`}
                />
              </span>
              <span className="w-8 text-left">{enabled ? "On" : "Off"}</span>
            </button>
          ) : (
            <span className="text-label text-ink">{enabled ? "On" : "Off"}</span>
          )}
        </div>

        {/* Where the decision stands */}
        <p
          id={`${titleId}-decision`}
          className={`flex items-start gap-2 text-caption ${decisionClass}`}
          role="status"
          aria-live="polite"
        >
          {DecisionIcon && <DecisionIcon className="mt-px h-4 w-4 shrink-0" aria-hidden />}
          <span>{decisionLine.text}</span>
        </p>

        {access.rejection && !pending && (
          <div className="banner banner-warning" role="alert">
            <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <div className="space-y-1">
              <p className="font-medium">The server refused the last change</p>
              <p className="text-label font-normal">
                {access.rejection.message} Portal access now shows the server&apos;s
                setting: {enabled ? "on" : "off"}.
              </p>
            </div>
          </div>
        )}

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
        {enabled && status.lastInviteSent && (
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
                    ? `Invitation sent by ${status.contactMethod === "email" ? "email" : "SMS"}`
                    : "No email or SMS was sent"}
                </p>
                <p className="text-caption">
                  {inviteLink.delivered
                    ? "The email or SMS service accepted the message. You can also copy the link and share it directly."
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
                : deviceOnly
                  ? "The patient's phone number is pre-filled. Registration also needs an email address, so they enter an email, their name, the date of birth on their record and a 6-digit PIN."
                  : phoneOnlyLinkNote}
            </p>
          </div>
        )}

        {/* Send/Resend Button (never for a child's record) */}
        {enabled && !minor && (
          <div className="space-y-3 border-t border-line pt-4">
            {status.contactMethod ? (
              canInvite ? (
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={handleSendInvitation}
                    disabled={sending || countdown > 0 || pending}
                    className="btn-primary w-full sm:w-auto"
                  >
                    {server.available ? (
                      <EnvelopeIcon className="h-5 w-5" aria-hidden />
                    ) : (
                      <LinkIcon className="h-5 w-5" aria-hidden />
                    )}
                    {sending
                      ? "Sending…"
                      : countdown > 0
                        ? `Resend available in ${formatCountdown(countdown)}`
                        : server.available
                          ? `${(status.inviteCount || 0) > 0 ? "Resend" : "Send"} portal invitation`
                          : "Create registration link"}
                  </button>
                  {pending ? (
                    <p className="text-caption text-ink-muted">
                      Invitations can be sent once the server confirms portal access.
                    </p>
                  ) : !server.available ? (
                    <p className="text-caption text-ink-muted">
                      {server.state === "offline"
                        ? "This device is offline, so no email or SMS can be sent. You'll get a link to share with the patient."
                        : "No server is connected, so no email or SMS can be sent. You'll get a link to share with the patient."}
                    </p>
                  ) : (
                    notSignedInOnline && (
                      <p className="text-caption text-ink-muted">
                        You are not signed in online, so the server will not
                        send an email or SMS. You'll get a link to share with
                        the patient. To send it, sign in online.{" "}
                        {ONLINE_SIGN_IN_HINT}
                      </p>
                    )
                  )}
                </div>
              ) : (
                <p className="text-caption text-ink-muted">{portalInviteRefusal()}</p>
              )
            ) : (
              <div className="banner banner-warning">
                <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                <p>
                  Add an email or phone number to this patient's record before
                  sending a portal invitation.
                </p>
              </div>
            )}

            {/* Patient access instructions for staff */}
            {(status.inviteCount || 0) > 0 && !status.verified && (
              <div className="rounded-md border border-line bg-surface-sunken px-3 py-2">
                <p className="text-label text-ink">What to tell the patient</p>
                {status.contactMethod === "email" || deviceOnly ? (
                  <p className="text-caption text-ink-secondary">
                    Go to <strong>{window.location.origin}/patient/login</strong>,
                    choose "Register here", and enter{" "}
                    {status.contactMethod === "email"
                      ? "the email address the clinic has for you, your name, your date of birth"
                      : "an email address, your name, and the phone number and date of birth the clinic has for you,"}{" "}
                    and {credential}. Then sign in with your {signInWith}.
                  </p>
                ) : (
                  <p className="text-caption text-ink-secondary">{phoneOnlyLinkNote}</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Enable Portal Prompt */}
        {!enabled && !minor && (
          <p className="text-body text-ink-secondary">
            Turning on portal access lets {firstName} view their medical
            records, request appointments and message the clinic online.
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
          {deviceOnly
            ? "No server is connected, so it is turned on for this device only."
            : notSignedInOnline
              ? `The change is saved on this device and queued. You are not signed in online, so it is sent to the server when you sign in online. The server decides; until it confirms, ${firstName} cannot use the online portal. ${ONLINE_SIGN_IN_HINT}`
              : `The change is saved on this device and queued for the clinic server, which decides. ${firstName} can use the online portal once the server confirms it.${
                  server.available ? "" : " It is sent when this device is online and syncs."
                }`}
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
          {deviceOnly
            ? "Portal access will be turned off on this device. No server is connected, so there is nothing to upload."
            : notSignedInOnline
              ? `The change is saved on this device and queued. You are not signed in online, so it is sent to the server when you sign in online. Once the server confirms it, ${firstName} can no longer sign in to the online portal. ${ONLINE_SIGN_IN_HINT}`
              : `The change is sent to the clinic server. Once the server confirms it, ${firstName} can no longer sign in to the online portal. Until this device syncs, the change waits here.`}{" "}
          Their records are not deleted.
        </p>
        <p>You can turn access back on later.</p>
      </ConfirmDialog>
    </section>
  );
}
