/**
 * Which device outbox messages belong to the portal invitation worker.
 *
 * The device outbox (db/outbox) is shared: dispense and appointment
 * reminders queued by services/messaging live there too, and the
 * notification worker sends those. The portal worker must only ever touch
 * portal invitations, or it would mark other people's reminders as sent or
 * failed without sending them.
 *
 * Today no screen queues portal invitations in the outbox: invitations are
 * sent straight away by services/portalEnrollment through the server
 * functions. "portal.invitation" is the key reserved for them (the SMS
 * outbox tests use it for the same purpose).
 */

export const PORTAL_INVITATION_TEMPLATE_KEYS: readonly string[] = [
  "portal.invitation",
];

/**
 * Stored when the portal worker cannot send an invitation. The SMS outbox
 * turns this exact text into a plain-language reason for staff.
 */
export const PORTAL_PROVIDER_NOT_CONFIGURED_ERROR =
  "SMS/Email provider not configured";

export function isPortalInvitationMessage(msg: {
  templateKey?: string | null;
}): boolean {
  return (
    typeof msg.templateKey === "string" &&
    PORTAL_INVITATION_TEMPLATE_KEYS.includes(msg.templateKey)
  );
}
