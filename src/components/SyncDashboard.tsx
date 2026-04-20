import { useState, useEffect } from "react";
import { enhancedSync } from "@/services/enhancedSync";
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ClockIcon,
} from "@heroicons/react/24/outline";

interface SyncStats {
  pending: number;
  lastSync: Record<string, Date | null>;
  syncing: boolean;
}

export function SyncDashboard() {
  const [stats, setStats] = useState<SyncStats>({
    pending: 0,
    lastSync: {},
    syncing: false,
  });
  const [syncResult, setSyncResult] = useState<{
    pushed: number;
    pulled: number;
    conflicts: number;
  } | null>(null);

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const loadStats = async () => {
    if (!enhancedSync.isInitialized()) return;

    const pending = await enhancedSync.getPendingChangesCount();
    const syncing = enhancedSync.isSyncing();

    const tables = [
      "patients",
      "visits",
      "vitals",
      "consultations",
      "dispenses",
      "inventory",
      "queue",
      "gameSessions",
      "gamificationWallets",
      "stockBatches",
      "careTasks",
      "triageRecords",
      "patientAllergies",
      "patientPreferences",
      "vitalsRanges",
    ];

    const lastSync: Record<string, Date | null> = {};
    tables.forEach((table) => {
      lastSync[table] = enhancedSync.getLastSyncTime(table);
    });

    setStats({ pending, lastSync, syncing });
  };

  const handleSync = async () => {
    if (stats.syncing) return;

    setStats((prev) => ({ ...prev, syncing: true }));
    const result = await enhancedSync.syncAll();

    if (result.success) {
      setSyncResult({
        pushed: result.pushed,
        pulled: result.pulled,
        conflicts: result.conflicts,
      });
      setTimeout(() => setSyncResult(null), 5000);
    }

    await loadStats();
  };

  const formatLastSync = (date: Date | null) => {
    if (!date) return "Never";

    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

    if (seconds < 60) return "Just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    return `${Math.floor(seconds / 86400)} days ago`;
  };

  if (!enhancedSync.isInitialized()) {
    return (
      <div className="bg-gray-50 p-4 rounded-lg">
        <p className="text-sm text-gray-600">Sync not configured</p>
      </div>
    );
  }

  return (
    <div className="bg-white shadow rounded-lg p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-medium text-gray-900">Data Sync</h2>
        <button
          onClick={handleSync}
          disabled={stats.syncing}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ArrowPathIcon
            className={`-ml-1 mr-2 h-5 w-5 ${stats.syncing ? "animate-spin" : ""}`}
          />
          {stats.syncing ? "Syncing..." : "Sync Now"}
        </button>
      </div>

      {syncResult && (
        <div className="mb-6 bg-green-50 border border-green-200 rounded-md p-4">
          <div className="flex">
            <CheckCircleIcon className="h-5 w-5 text-green-400" />
            <div className="ml-3">
              <p className="text-sm font-medium text-green-800">
                Sync Completed
              </p>
              <p className="text-sm text-green-700 mt-1">
                Pushed: {syncResult.pushed} | Pulled: {syncResult.pulled}
                {syncResult.conflicts > 0 &&
                  ` | Conflicts: ${syncResult.conflicts}`}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6">
        <div className="bg-blue-50 overflow-hidden rounded-lg px-4 py-5">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <ClockIcon className="h-6 w-6 text-blue-600" />
            </div>
            <div className="ml-5 w-0 flex-1">
              <dl>
                <dt className="text-sm font-medium text-blue-900 truncate">
                  Pending Changes
                </dt>
                <dd className="text-3xl font-semibold text-blue-900">
                  {stats.pending}
                </dd>
              </dl>
            </div>
          </div>
        </div>

        <div className="bg-green-50 overflow-hidden rounded-lg px-4 py-5">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <CheckCircleIcon className="h-6 w-6 text-green-600" />
            </div>
            <div className="ml-5 w-0 flex-1">
              <dl>
                <dt className="text-sm font-medium text-green-900 truncate">
                  Status
                </dt>
                <dd className="text-sm font-semibold text-green-900">
                  {stats.syncing ? "Active" : "Idle"}
                </dd>
              </dl>
            </div>
          </div>
        </div>

        <div className="bg-gray-50 overflow-hidden rounded-lg px-4 py-5">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <ArrowPathIcon className="h-6 w-6 text-gray-600" />
            </div>
            <div className="ml-5 w-0 flex-1">
              <dl>
                <dt className="text-sm font-medium text-gray-900 truncate">
                  Last Full Sync
                </dt>
                <dd className="text-sm font-semibold text-gray-900">
                  {formatLastSync(stats.lastSync.patients)}
                </dd>
              </dl>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-gray-200 pt-4">
        <h3 className="text-sm font-medium text-gray-900 mb-3">Table Status</h3>
        <div className="space-y-2">
          {Object.entries(stats.lastSync).map(([table, date]) => (
            <div
              key={table}
              className="flex items-center justify-between text-sm"
            >
              <span className="text-gray-600 capitalize">{table}</span>
              <span className={`${date ? "text-gray-900" : "text-gray-400"}`}>
                {formatLastSync(date)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {stats.pending > 0 && (
        <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-md p-4">
          <div className="flex">
            <ExclamationTriangleIcon className="h-5 w-5 text-yellow-400" />
            <div className="ml-3">
              <p className="text-sm font-medium text-yellow-800">
                {stats.pending} changes waiting to sync
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
