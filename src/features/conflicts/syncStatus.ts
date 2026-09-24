// One honest headline for the sync dashboard. It reports what the counts
// show and never claims "all synced": at best, nothing is waiting here.

import type { Tone } from "@/components/ui/StatusBadge";

export interface SyncHeadlineInput {
  configured: boolean;
  online: boolean;
  syncing: boolean;
  /** Changes on this device not yet uploaded; null while counting. */
  waiting: number | null;
  failed: number;
  errorMessage: string | null;
  /** Open conflicts on the server; null when unknown. */
  conflicts: number | null;
  /** Formatted time of the last successful sync, or null if none. */
  lastSuccessText: string | null;
}

export interface SyncHeadline {
  tone: Tone;
  title: string;
  detail: string;
}

function changes(n: number): string {
  return `${n} change${n === 1 ? "" : "s"}`;
}

export function deriveSyncHeadline(i: SyncHeadlineInput): SyncHeadline {
  const last = i.lastSuccessText
    ? `Last successful sync ${i.lastSuccessText}.`
    : "No successful sync recorded on this device yet.";

  if (!i.configured) {
    return {
      tone: "neutral",
      title: "Cloud sync is not set up",
      detail: "Records are saved on this device only.",
    };
  }
  if (!i.online) {
    return {
      tone: "neutral",
      title: "Offline",
      detail:
        i.waiting && i.waiting > 0
          ? `${changes(i.waiting)} saved on this device, waiting to upload when the connection returns.`
          : "Records you save stay on this device and upload when the connection returns.",
    };
  }
  if (i.syncing) {
    return { tone: "info", title: "Syncing…", detail: "Uploading and downloading changes." };
  }
  if (i.failed > 0 || i.errorMessage) {
    return {
      tone: "danger",
      title: i.failed > 0 ? `${changes(i.failed)} failed to upload` : "The last sync failed",
      detail: `${i.errorMessage ? `${i.errorMessage.trim().replace(/\.$/, "")}. ` : ""}Failed changes stay on this device. Try Sync now; if it keeps failing, tell your supervisor.`,
    };
  }
  if (i.waiting === null) {
    return { tone: "neutral", title: "Checking this device…", detail: last };
  }
  if (i.waiting > 0) {
    return { tone: "warning", title: `${changes(i.waiting)} waiting to upload`, detail: last };
  }
  if (i.conflicts !== null && i.conflicts > 0) {
    return {
      tone: "warning",
      title: `${i.conflicts} conflict${i.conflicts === 1 ? "" : "s"} to review`,
      detail: `Nothing is waiting to upload from this device. ${last}`,
    };
  }
  if (i.conflicts === null) {
    return {
      tone: "neutral",
      title: "Nothing waiting to upload",
      detail: `Open conflicts could not be checked. ${last}`,
    };
  }
  if (!i.lastSuccessText) {
    return { tone: "neutral", title: "Nothing waiting to upload", detail: last };
  }
  return {
    tone: "success",
    title: "Nothing waiting to upload",
    detail: `${last} No open conflicts.`,
  };
}
