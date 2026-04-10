import React, { useState, useEffect } from "react";
import { useSyncStore } from "@/stores/syncStore";
import {
  WifiIcon,
  CloudArrowUpIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

export function OfflineBanner() {
  const { status, pendingCount, isOnline, errorMessage } = useSyncStore();
  const [dismissed, setDismissed] = useState(false);
  const [prevOnline, setPrevOnline] = useState(isOnline);

  useEffect(() => {
    if (prevOnline !== isOnline) {
      setDismissed(false);
      setPrevOnline(isOnline);
    }
  }, [isOnline, prevOnline]);

  useEffect(() => {
    if (status === "syncing" || status === "error") {
      setDismissed(false);
    }
  }, [status]);

  const shouldShow =
    !dismissed &&
    (!isOnline ||
      pendingCount > 0 ||
      status === "syncing" ||
      status === "error");

  if (!shouldShow) {
    return null;
  }

  const getBannerConfig = () => {
    if (!isOnline) {
      return {
        bg: "bg-gray-700",
        icon: WifiIcon,
        message: `You're offline`,
        detail:
          pendingCount > 0
            ? `${pendingCount} change${pendingCount === 1 ? "" : "s"} will sync when back online`
            : "Changes will be saved locally",
        canDismiss: pendingCount === 0,
      };
    }

    if (status === "syncing") {
      return {
        bg: "bg-blue-600",
        icon: CloudArrowUpIcon,
        message: "Syncing...",
        detail: `Uploading ${pendingCount} change${pendingCount === 1 ? "" : "s"}`,
        canDismiss: false,
      };
    }

    if (status === "error") {
      return {
        bg: "bg-amber-600",
        icon: ExclamationTriangleIcon,
        message: "Sync error",
        detail: errorMessage || "Will retry automatically",
        canDismiss: true,
      };
    }

    if (pendingCount > 0) {
      return {
        bg: "bg-amber-500",
        icon: CloudArrowUpIcon,
        message: "Changes pending",
        detail: `${pendingCount} change${pendingCount === 1 ? "" : "s"} waiting to sync`,
        canDismiss: false,
      };
    }

    return null;
  };

  const config = getBannerConfig();

  if (!config) {
    return null;
  }

  const { bg, icon: Icon, message, detail, canDismiss } = config;

  return (
    <div
      className={`${bg} text-white px-4 py-2 text-sm`}
      role="status"
      aria-live="polite"
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Icon
            className={`h-5 w-5 flex-shrink-0 ${status === "syncing" ? "animate-pulse" : ""}`}
            aria-hidden="true"
          />
          <div className="flex flex-wrap items-center gap-x-2">
            <span className="font-medium">{message}</span>
            <span className="opacity-90">{detail}</span>
          </div>
        </div>
        {canDismiss && (
          <button
            onClick={() => setDismissed(true)}
            className="p-1 rounded hover:bg-white/20 transition-colors"
            aria-label="Dismiss notification"
          >
            <XMarkIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
