import React, { useState } from "react";
import { useSyncStore, getRetryDelay } from "@/stores/syncStore";
import {
  CloudIcon,
  CloudArrowUpIcon,
  ExclamationCircleIcon,
  CheckCircleIcon,
  WifiIcon,
  SignalSlashIcon,
} from "@heroicons/react/24/outline";
import { useTranslation } from "react-i18next";

export function SyncIndicator() {
  const { t } = useTranslation();
  const [showPanel, setShowPanel] = useState(false);
  const {
    status,
    pendingCount,
    lastSuccessAt,
    retries,
    errorMessage,
    isOnline,
  } = useSyncStore();

  const getStatusIcon = () => {
    if (!isOnline) {
      return <SignalSlashIcon className="h-5 w-5 text-gray-500" />;
    }

    switch (status) {
      case "syncing":
        return (
          <CloudArrowUpIcon className="h-5 w-5 text-blue-500 animate-pulse" />
        );
      case "error":
        return <ExclamationCircleIcon className="h-5 w-5 text-red-500" />;
      case "ok":
        return <CheckCircleIcon className="h-5 w-5 text-green-500" />;
      default:
        return <CloudIcon className="h-5 w-5 text-gray-400" />;
    }
  };

  const getStatusColor = () => {
    if (!isOnline) return "bg-gray-100 border-gray-300";
    switch (status) {
      case "syncing":
        return "bg-blue-50 border-blue-300";
      case "error":
        return "bg-red-50 border-red-300";
      case "ok":
        return "bg-green-50 border-green-300";
      default:
        return "bg-gray-50 border-gray-300";
    }
  };

  const formatTimestamp = (timestamp: number) => {
    if (!timestamp) return t("messaging.neverSynced") || "Never";

    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return `${seconds}s ago`;
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  const nextRetryDelay = retries > 0 ? getRetryDelay(retries) / 1000 : 0;

  return (
    <>
      {/* Compact Badge */}
      <button
        onClick={() => setShowPanel(!showPanel)}
        className={`
          flex items-center gap-2 px-3 py-1.5 rounded-full border
          ${getStatusColor()}
          transition-all hover:shadow-md
          focus:outline-none focus:ring-2 focus:ring-primary
        `}
        title={isOnline ? t("status.online") : t("status.offline")}
      >
        {getStatusIcon()}

        {!isOnline && (
          <span className="text-xs font-medium text-gray-600">
            {t("status.offline")}
          </span>
        )}

        {isOnline && status === "syncing" && (
          <span className="text-xs font-medium text-blue-600">
            {t("status.syncing")}
          </span>
        )}

        {pendingCount > 0 && (
          <span className="flex items-center justify-center h-5 min-w-[20px] px-1.5 text-xs font-bold text-white bg-orange-500 rounded-full">
            {pendingCount}
          </span>
        )}
      </button>

      {/* Expandable Panel */}
      {showPanel && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black bg-opacity-25 z-40"
            onClick={() => setShowPanel(false)}
          />

          {/* Panel */}
          <div className="absolute top-full right-0 mt-2 w-80 bg-white rounded-lg shadow-xl border z-50 overflow-hidden">
            <div className="p-4 bg-gray-50 border-b">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">Sync Status</h3>
                <button
                  onClick={() => setShowPanel(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="p-4 space-y-3">
              {/* Online Status */}
              <div className="flex items-center gap-2">
                {isOnline ? (
                  <WifiIcon className="h-5 w-5 text-green-500" />
                ) : (
                  <SignalSlashIcon className="h-5 w-5 text-gray-500" />
                )}
                <span className="text-sm">
                  {isOnline ? t("status.online") : t("status.offline")}
                </span>
              </div>

              {/* Sync Status */}
              <div className="flex items-center gap-2">
                {getStatusIcon()}
                <span className="text-sm capitalize">{status}</span>
              </div>

              {/* Pending Count */}
              {pendingCount > 0 && (
                <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                  <p className="text-sm text-orange-900">
                    <strong>{pendingCount}</strong>{" "}
                    {pendingCount === 1 ? "operation" : "operations"} pending
                  </p>
                  {!isOnline && (
                    <p className="text-xs text-orange-700 mt-1">
                      Will sync automatically when online
                    </p>
                  )}
                </div>
              )}

              {/* Last Success */}
              {lastSuccessAt > 0 && (
                <div className="text-sm text-gray-600">
                  <span className="font-medium">Last sync:</span>{" "}
                  {formatTimestamp(lastSuccessAt)}
                </div>
              )}

              {/* Error Info */}
              {status === "error" && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm font-medium text-red-900">Sync Error</p>
                  {errorMessage && (
                    <p className="text-xs text-red-700 mt-1">{errorMessage}</p>
                  )}
                  {retries > 0 && (
                    <p className="text-xs text-red-600 mt-2">
                      Retrying in {nextRetryDelay}s... (attempt {retries})
                    </p>
                  )}
                </div>
              )}

              {/* Success State */}
              {status === "ok" && pendingCount === 0 && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-sm text-green-900">
                    ✓ All data synchronized
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
