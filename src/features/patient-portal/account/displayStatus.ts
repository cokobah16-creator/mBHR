/**
 * Display-only mapping of stored statuses to a badge tone and a plain label.
 * These never change the stored value or any rule that sets it.
 */
import type { Tone } from "@/components/ui/StatusBadge";

export interface StatusDisplay {
  tone: Tone;
  label: string;
}

export function billStatusDisplay(status: string): StatusDisplay {
  switch (status) {
    case "paid":
      return { tone: "success", label: "Paid" };
    case "partial":
      return { tone: "warning", label: "Part paid" };
    case "overdue":
      return { tone: "danger", label: "Overdue" };
    case "pending":
      return { tone: "info", label: "Not paid yet" };
    default:
      return { tone: "neutral", label: status || "Unknown" };
  }
}

export function referralStatusDisplay(status: string): StatusDisplay {
  switch (status) {
    case "pending":
      return { tone: "warning", label: "Not booked yet" };
    case "scheduled":
      return { tone: "info", label: "Appointment booked" };
    case "completed":
      return { tone: "success", label: "Completed" };
    case "cancelled":
      return { tone: "neutral", label: "Cancelled" };
    default:
      return { tone: "neutral", label: status || "Unknown" };
  }
}

export function referralPriorityDisplay(priority: string): StatusDisplay {
  switch (priority) {
    case "emergency":
      return { tone: "danger", label: "Emergency" };
    case "urgent":
      return { tone: "warning", label: "Urgent" };
    case "routine":
      return { tone: "neutral", label: "Routine" };
    default:
      return { tone: "neutral", label: priority || "Routine" };
  }
}

const NAIRA = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** Amount in naira, e.g. "₦1,500". Non-numbers show as "₦0". */
export function formatNaira(amount: number): string {
  return NAIRA.format(Number.isFinite(amount) ? amount : 0);
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
