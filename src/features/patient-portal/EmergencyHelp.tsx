import { useState } from "react";
import {
  ExclamationTriangleIcon,
  PhoneIcon,
  BellAlertIcon,
  XMarkIcon,
  CheckCircleIcon,
} from "@heroicons/react/24/outline";

interface EmergencyHelpProps {
  onClose: () => void;
}

export function EmergencyHelp({ onClose }: EmergencyHelpProps) {
  const [alerted, setAlerted] = useState(false);

  const portalUserStr = localStorage.getItem("patient_portal_user");
  const portalUser = portalUserStr ? JSON.parse(portalUserStr) : null;
  const patientId = portalUser?.patientId || "Unknown";

  const alertHealthWorker = () => {
    const alerts: object[] = JSON.parse(
      localStorage.getItem("patient_emergency_alerts") || "[]",
    );
    alerts.push({
      patientId,
      timestamp: new Date().toISOString(),
      type: "emergency",
      message: "Patient requested emergency help via portal",
    });
    localStorage.setItem("patient_emergency_alerts", JSON.stringify(alerts));
    setAlerted(true);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Emergency Help"
    >
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-red-600 px-6 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ExclamationTriangleIcon className="w-8 h-8 text-white" />
              <h2 className="text-2xl font-bold text-white tracking-wide">
                EMERGENCY HELP
              </h2>
            </div>
            <button
              onClick={onClose}
              className="text-white/80 hover:text-white p-1 rounded-lg"
              aria-label="Close"
            >
              <XMarkIcon className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Patient ID */}
        <div className="bg-red-50 border-b border-red-200 px-6 py-4">
          <p className="text-xs text-red-600 font-medium uppercase tracking-wider">
            Your Patient ID (share with emergency services)
          </p>
          <p className="text-xl font-mono font-bold text-red-800 mt-1 break-all">
            {patientId}
          </p>
        </div>

        {/* Actions */}
        <div className="px-6 py-6 space-y-4">
          <a
            href="tel:0800123HELP"
            className="flex items-center justify-center gap-3 w-full bg-red-600 hover:bg-red-700 text-white text-lg font-bold py-4 px-6 rounded-xl transition-colors min-h-[60px]"
          >
            <PhoneIcon className="w-6 h-6" />
            Call Emergency Line
          </a>

          {alerted ? (
            <div className="flex items-center gap-3 w-full bg-green-50 border border-green-200 text-green-800 py-4 px-6 rounded-xl">
              <CheckCircleIcon className="w-6 h-6 text-green-600 flex-shrink-0" />
              <p className="font-medium">
                Your health worker will be notified when connected.
              </p>
            </div>
          ) : (
            <button
              onClick={alertHealthWorker}
              className="flex items-center justify-center gap-3 w-full bg-orange-500 hover:bg-orange-600 text-white text-lg font-bold py-4 px-6 rounded-xl transition-colors min-h-[60px]"
            >
              <BellAlertIcon className="w-6 h-6" />
              Alert My Health Worker
            </button>
          )}

          <button
            onClick={onClose}
            className="w-full border-2 border-gray-300 text-gray-700 font-semibold py-3 px-6 rounded-xl hover:bg-gray-50 transition-colors min-h-[52px]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
