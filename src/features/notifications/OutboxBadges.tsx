import { StatusBadge, type Tone } from "@/components/ui/StatusBadge";
import {
  isStuckSending,
  stateLabel,
  stateTone,
  type OutboxItem,
  type SendingBlocker,
} from "@/features/notifications/smsOutbox";

/** Delivery state of one message, always with text and an icon. */
export function DeliveryStateBadge({
  item,
  now,
  blocker,
}: {
  item: OutboxItem;
  now: Date;
  blocker: SendingBlocker | null;
}) {
  const label = isStuckSending(item, now) ? "Sending, no result" : stateLabel(item);
  return (
    <StatusBadge tone={stateTone(item, now, blocker)} icon>
      {label}
    </StatusBadge>
  );
}

const READINESS: Record<
  "not_configured" | "offline" | "auto" | "manual",
  { tone: Tone; label: string; text: string }
> = {
  not_configured: {
    tone: "warning",
    label: "Sending not set up",
    text: "This device is not connected to the mBHR server, so it cannot send SMS. Reminders are saved on this device and stay queued. Nothing is sent until the server connection is set up.",
  },
  offline: {
    tone: "warning",
    label: "Offline",
    text: "This device is offline. Queued reminders are kept here and tried when the device is back online and sending runs.",
  },
  auto: {
    tone: "info",
    label: "Automatic sending on",
    text: "Due reminders are sent through the mBHR server every 30 seconds while the app stays open on this device. It stops when the app is closed or reloaded, and nothing is sent while the app is closed.",
  },
  manual: {
    tone: "neutral",
    label: "Automatic sending off",
    text: "Due reminders are sent only when someone presses Send due messages now, or turns automatic sending on in SMS reminders.",
  },
};

/** Whether this device can send SMS now, and when queued messages are tried. */
export function SendingReadiness({
  blocker,
  autoSending,
}: {
  blocker: SendingBlocker | null;
  autoSending: boolean;
}) {
  const r = READINESS[blocker ?? (autoSending ? "auto" : "manual")];
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
      <StatusBadge tone={r.tone} icon className="self-start">
        {r.label}
      </StatusBadge>
      <p className="text-body text-ink-secondary">{r.text}</p>
    </div>
  );
}
