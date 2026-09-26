import { StatusBadge } from "@/components/ui/StatusBadge";
import { rowStatusLabel, STAFF_COPY, type StaffRow } from "./staffAccountView";

interface StaffStatusBadgeProps {
  row: StaffRow;
  /** Leave out the small line under the badge ("Never signed in"). */
  hideCaption?: boolean;
  /** Leave out the note about this device's record ("Off on this device"). */
  hideDeviceNote?: boolean;
}

/**
 * A staff row's account status on the Users screen: the badge, its caption
 * and, for a server account, the note about its record on this device.
 */
export default function StaffStatusBadge({
  row,
  hideCaption = false,
  hideDeviceNote = false,
}: StaffStatusBadgeProps) {
  const status = rowStatusLabel(row);
  const note = hideDeviceNote ? null : row.deviceNote;
  return (
    <span className="flex flex-col items-start gap-1">
      <StatusBadge tone={status.tone} icon>
        {status.label}
      </StatusBadge>
      {!hideCaption && status.caption && (
        <span className="text-caption text-ink-muted">{status.caption}</span>
      )}
      {note === "off_on_device" && (
        <StatusBadge tone="neutral">{STAFF_COPY.deviceNote.off_on_device}</StatusBadge>
      )}
      {note === "needs_review" && (
        <>
          <StatusBadge tone="warning" icon>
            {STAFF_COPY.deviceNote.needs_review}
          </StatusBadge>
          <span className="text-caption text-ink-muted">
            {STAFF_COPY.deviceNote.needs_review_detail}
          </span>
        </>
      )}
    </span>
  );
}
