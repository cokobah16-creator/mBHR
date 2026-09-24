// Pure helpers for the televisit screen: session-state labels, the join
// window, and plain-language reasons for failed SMS sends. Unit-tested in
// televisitModel.test.ts.
import type { Tone } from "@/components/ui/StatusBadge";
import type { TelevisitStatus } from "@/services/televisits";
import { formatTime } from "@/utils/dateFormat";

export const TELEVISIT_STATUS_META: Record<
  TelevisitStatus,
  { label: string; tone: Tone }
> = {
  scheduled: { label: "Scheduled", tone: "neutral" },
  confirmed: { label: "Confirmed", tone: "info" },
  arrived: { label: "Patient waiting", tone: "info" },
  "in-progress": { label: "In progress", tone: "info" },
  completed: { label: "Ended", tone: "success" },
  "no-show": { label: "No-show", tone: "warning" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export function televisitStatusMeta(status: string): {
  label: string;
  tone: Tone;
} {
  return (
    TELEVISIT_STATUS_META[status as TelevisitStatus] ?? {
      label: status,
      tone: "neutral",
    }
  );
}

// Mirrors the statuses canJoinTelevisit() in services/televisits accepts.
const OPEN_SESSION_STATUSES: TelevisitStatus[] = [
  "scheduled",
  "confirmed",
  "in-progress",
];

export type JoinWindow = "open" | "not-yet" | "closed" | "none";

/**
 * Where a visit stands relative to its join window. `canJoin` and `opensAt`
 * come from the service (canJoinTelevisit / televisitJoinOpensAt) so the
 * window rule lives in one place.
 */
export function joinWindowOf(
  status: TelevisitStatus,
  canJoin: boolean,
  opensAt: Date,
  now: Date,
): JoinWindow {
  if (canJoin) return "open";
  if (!OPEN_SESSION_STATUSES.includes(status)) return "none";
  return now.getTime() < opensAt.getTime() ? "not-yet" : "closed";
}

export function joinWindowLabel(
  state: JoinWindow,
  opensAt: Date,
): { label: string; tone: Tone } | null {
  switch (state) {
    case "open":
      return { label: "Join window open", tone: "success" };
    case "not-yet":
      return { label: `Join opens ${formatTime(opensAt)}`, tone: "neutral" };
    case "closed":
      return { label: "Join window closed", tone: "warning" };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Meeting-link SMS
// ---------------------------------------------------------------------------

export interface SmsFailure {
  reason: string;
  /** True when trying again could succeed without changing anything else. */
  retryable: boolean;
}

/**
 * Turns the `error` returned by notifyPatientTelevisitScheduled into a
 * reason staff can act on. The patterns match the strings that service and
 * the send-sms-reminder edge function return. Raw provider text is never
 * shown: it can contain the phone number.
 */
export function describeSmsFailure(error: string | undefined): SmsFailure {
  const text = (error ?? "").trim();
  if (/no phone/i.test(text)) {
    return {
      reason:
        "The patient has no phone number on record. Share the link another way.",
      retryable: false,
    };
  }
  if (/invalid phone/i.test(text)) {
    return {
      reason:
        "The patient's phone number is not a valid mobile number. Correct it in the patient record, or share the link another way.",
      retryable: false,
    };
  }
  if (/demo mode/i.test(text)) {
    return {
      reason:
        "SMS demo mode is on, so the message was only logged and not sent. Share the link another way.",
      retryable: false,
    };
  }
  if (/not.configured|no sms provider/i.test(text)) {
    return {
      reason:
        "SMS sending is not set up for this clinic. Share the link another way.",
      retryable: false,
    };
  }
  if (/offline/i.test(text)) {
    return {
      reason:
        "This device is offline. Connect to the internet, then send again.",
      retryable: true,
    };
  }
  if (/429|rate.?limit|too many/i.test(text)) {
    return {
      reason:
        "Too many messages were sent in the last minute. Wait a minute, then send again.",
      retryable: true,
    };
  }
  if (
    /failed to fetch|networkerror|network error|network request failed|load failed|timed? ?out|abort/i.test(
      text,
    )
  ) {
    return {
      reason:
        "Could not reach the SMS service. Check the internet connection, then send again.",
      retryable: true,
    };
  }
  return {
    reason:
      "The SMS service did not accept the message. Send again, or share the link another way.",
    retryable: true,
  };
}

export type LinkDelivery =
  | { state: "sending" }
  /** `to` is the patient's name, for the confirmation line. */
  | { state: "sent"; at: Date; to: string }
  | { state: "failed"; at: Date; reason: string; retryable: boolean };

/** Builds the delivery record from a send attempt (or a missing contact). */
export function linkDeliveryFrom(
  outcome:
    | { kind: "no-contact" }
    | { kind: "result"; sent: boolean; error?: string; to: string },
  at: Date,
): LinkDelivery {
  if (outcome.kind === "no-contact") {
    return {
      state: "failed",
      at,
      reason:
        "The patient's contact details were not found. Share the link another way.",
      retryable: false,
    };
  }
  if (outcome.sent) return { state: "sent", at, to: outcome.to };
  const failure = describeSmsFailure(outcome.error);
  return { state: "failed", at, ...failure };
}

/** The button label for sending the link, given what is known so far. */
export function sendLinkLabel(delivery: LinkDelivery | undefined): string {
  if (!delivery) return "Send link by SMS";
  if (delivery.state === "sending") return "Sending SMS…";
  if (delivery.state === "sent") return "Send SMS again";
  return delivery.retryable ? "Retry SMS" : "Send link by SMS";
}
