import { useState, useEffect } from "react";
import { doctorService } from "@/services/doctorService";
import { useAuthStore } from "@/stores/auth";
import type { PatientFlag } from "@/types/multiTenant";
import {
  FlagIcon,
  CheckCircleIcon,
  XMarkIcon,
  ClockIcon,
  UserIcon,
} from "@heroicons/react/24/outline";

interface PatientFlagsPanelProps {
  org_id: string;
  site_id?: string;
  event_id?: string;
  station: "consult" | "pharmacy" | "vitals" | "lab" | "registration";
}

export function PatientFlagsPanel({
  org_id,
  site_id,
  event_id,
  station,
}: PatientFlagsPanelProps) {
  const { currentUser } = useAuthStore();
  const [flags, setFlags] = useState<PatientFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFlag, setSelectedFlag] = useState<PatientFlag | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");

  useEffect(() => {
    loadFlags();
    const interval = setInterval(loadFlags, 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org_id, site_id, event_id, station]);

  const loadFlags = async () => {
    try {
      const openFlags = await doctorService.getPatientFlags({
        org_id,
        site_id,
        event_id,
        to_station: station,
        status: "open",
      });

      openFlags.sort((a, b) => {
        const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });

      setFlags(openFlags);
    } catch (error) {
      console.error("Error loading patient flags:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleResolveFlag = async (flag: PatientFlag) => {
    if (!currentUser) return;

    const success = await doctorService.resolvePatientFlag(
      flag.id,
      currentUser.id,
      resolutionNote || undefined,
    );

    if (success) {
      setFlags(flags.filter((f) => f.id !== flag.id));
      setSelectedFlag(null);
      setResolutionNote("");
    }
  };

  const handleAcknowledgeFlag = async (flag: PatientFlag) => {
    if (!currentUser) return;

    const success = await doctorService.resolvePatientFlag(
      flag.id,
      currentUser.id,
      "Acknowledged - will handle",
    );

    if (success) {
      setFlags(flags.filter((f) => f.id !== flag.id));
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "urgent":
        return "bg-red-100 border-red-300 text-red-900";
      case "high":
        return "bg-orange-100 border-orange-300 text-orange-900";
      case "normal":
        return "bg-blue-100 border-blue-300 text-blue-900";
      case "low":
        return "bg-gray-100 border-gray-300 text-gray-900";
      default:
        return "bg-gray-100 border-gray-300 text-gray-900";
    }
  };

  const getTimeAgo = (timestamp: string) => {
    const now = new Date();
    const flagTime = new Date(timestamp);
    const diffMs = now.getTime() - flagTime.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    return `${Math.floor(diffMins / 60)}h ${diffMins % 60}m ago`;
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-4">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-200 rounded w-1/4"></div>
          <div className="h-20 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (flags.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-4">
        <div className="flex items-center space-x-2 mb-3">
          <FlagIcon className="h-5 w-5 text-gray-400" />
          <h3 className="font-semibold text-gray-900">Station Alerts</h3>
        </div>
        <p className="text-sm text-gray-500">
          No pending flags for your station
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <FlagIcon className="h-5 w-5 text-orange-600" />
          <h3 className="font-semibold text-gray-900">Station Alerts</h3>
          <span className="bg-orange-100 text-orange-800 text-xs font-medium px-2 py-0.5 rounded-full">
            {flags.length}
          </span>
        </div>
      </div>

      <div className="space-y-3">
        {flags.map((flag) => (
          <div
            key={flag.id}
            className={`border-2 rounded-lg p-3 ${getPriorityColor(flag.priority)}`}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center space-x-2 mb-1">
                  <span className="text-xs font-semibold uppercase tracking-wide">
                    {flag.flag_type.replace(/_/g, " ")}
                  </span>
                  {flag.priority === "urgent" && (
                    <span className="text-xs bg-red-600 text-white px-2 py-0.5 rounded-full">
                      URGENT
                    </span>
                  )}
                </div>

                <p className="text-sm font-medium mb-2">{flag.message}</p>

                <div className="flex items-center space-x-4 text-xs">
                  <div className="flex items-center space-x-1">
                    <UserIcon className="h-3 w-3" />
                    <span>From: {flag.from_station}</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <ClockIcon className="h-3 w-3" />
                    <span>{getTimeAgo(flag.created_at)}</span>
                  </div>
                </div>

                {flag.context && Object.keys(flag.context).length > 0 && (
                  <div className="mt-2 text-xs">
                    <details className="cursor-pointer">
                      <summary className="font-medium">
                        Additional Context
                      </summary>
                      <pre className="mt-1 bg-white bg-opacity-50 p-2 rounded text-xs overflow-auto">
                        {JSON.stringify(flag.context, null, 2)}
                      </pre>
                    </details>
                  </div>
                )}
              </div>

              <div className="flex space-x-2 ml-4">
                <button
                  onClick={() => handleAcknowledgeFlag(flag)}
                  className="p-1 hover:bg-white hover:bg-opacity-50 rounded"
                  title="Acknowledge"
                >
                  <CheckCircleIcon className="h-5 w-5" />
                </button>
                <button
                  onClick={() => setSelectedFlag(flag)}
                  className="p-1 hover:bg-white hover:bg-opacity-50 rounded"
                  title="Resolve with note"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {selectedFlag && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Resolve Flag</h3>

            <div className="mb-4">
              <p className="text-sm text-gray-600 mb-2">
                <strong>Flag:</strong>{" "}
                {selectedFlag.flag_type.replace(/_/g, " ")}
              </p>
              <p className="text-sm text-gray-600">
                <strong>Message:</strong> {selectedFlag.message}
              </p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Resolution Note (Optional)
              </label>
              <textarea
                value={resolutionNote}
                onChange={(e) => setResolutionNote(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                rows={3}
                placeholder="Add any notes about how this was resolved..."
              />
            </div>

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  setSelectedFlag(null);
                  setResolutionNote("");
                }}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={() => handleResolveFlag(selectedFlag)}
                className="btn-primary"
              >
                Resolve
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
