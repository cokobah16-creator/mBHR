import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "@/db";
import type { Patient } from "@/db";
import { queueManagement } from "@/services/queueManagement";
import type { QueueStage, QueuePriority } from "@/services/queueManagement";
import { PatientSearch } from "@/components/PatientSearch";
import {
  TicketIcon,
  UserIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { useAuthStore } from "@/stores/auth";
import { usePatientsStore } from "@/stores/patients";

const stages: QueueStage[] = ["registration", "vitals", "consult", "pharmacy"];

export default function TicketIssuer() {
  const navigate = useNavigate();
  const { currentUser } = useAuthStore();
  const { loadPatients } = usePatientsStore();
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [stage, setStage] = useState<QueueStage>("vitals");
  const [priority, setPriority] = useState<QueuePriority>("normal");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [queuePosition, setQueuePosition] = useState<number | null>(null);

  useEffect(() => {
    loadPatients().catch((err) => {
      console.error("Failed to load patients:", err);
      setError("Failed to load patient data. Please refresh the page.");
    });
  }, [loadPatients]);

  async function handleAddToQueue() {
    if (!selectedPatient) {
      setError("Please select a patient");
      return;
    }

    if (!currentUser) {
      setError("User session expired. Please log in again.");
      return;
    }

    setLoading(true);
    setSuccess(false);
    setError("");
    setQueuePosition(null);

    try {
      const queueItem = await queueManagement.addToQueue(
        selectedPatient.id,
        stage,
        priority,
        currentUser.id,
      );

      setQueuePosition(queueItem.position);
      setSuccess(true);

      setTimeout(() => {
        setSuccess(false);
        setSelectedPatient(null);
        setError("");
        setQueuePosition(null);
        setPriority("normal");
        setStage("vitals");
      }, 3000);
    } catch (err) {
      console.error("Error adding to queue:", err);
      const errorMessage =
        err instanceof Error
          ? err.message
          : "Failed to add patient to queue. Please try again.";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-4 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <TicketIcon className="h-8 w-8 text-blue-600" />
          <h2 className="text-2xl font-bold text-gray-900">
            Add Patient to Queue
          </h2>
        </div>
        <button
          onClick={() => navigate("/queue")}
          className="btn-secondary text-sm"
        >
          View Queue
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800 text-sm">{error}</p>
        </div>
      )}

      {success ? (
        <div className="bg-white rounded-lg shadow-sm p-8 text-center">
          <CheckCircleIcon className="h-16 w-16 text-green-500 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-900 mb-2">
            Patient Added to Queue
          </h3>
          <p className="text-gray-600 mb-2">
            {selectedPatient?.givenName} {selectedPatient?.familyName} has been
            added to the {stage} queue
          </p>
          {queuePosition !== null && (
            <p className="text-lg font-semibold text-blue-600">
              Queue Position: #{queuePosition}
            </p>
          )}
          {priority === "urgent" && (
            <div className="mt-3 inline-flex items-center gap-2 px-3 py-1 bg-red-100 text-red-800 rounded-full text-sm font-medium">
              <ExclamationTriangleIcon className="h-4 w-4" />
              Marked as Urgent
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="space-y-6">
            {/* Patient Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Patient *
              </label>
              {selectedPatient ? (
                <div className="flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-center space-x-3">
                    {selectedPatient.photoUrl ? (
                      <img
                        src={selectedPatient.photoUrl}
                        alt={`${selectedPatient.givenName} ${selectedPatient.familyName}`}
                        className="w-12 h-12 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-green-200 flex items-center justify-center">
                        <UserIcon className="h-6 w-6 text-green-700" />
                      </div>
                    )}
                    <div>
                      <div className="font-semibold text-gray-900">
                        {selectedPatient.givenName} {selectedPatient.familyName}
                      </div>
                      <div className="text-sm text-gray-600">
                        {selectedPatient.sex} • {selectedPatient.dob}
                      </div>
                      <div className="text-sm text-gray-600">
                        {selectedPatient.phone}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedPatient(null);
                      setError("");
                    }}
                    className="btn-secondary text-sm"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div>
                  <PatientSearch
                    onPatientSelect={(patient) => {
                      setSelectedPatient(patient);
                      setError("");
                    }}
                    placeholder="Search by name or phone..."
                  />
                  <p className="text-sm text-gray-500 mt-1">
                    Start typing to search for a patient
                  </p>
                </div>
              )}
            </div>

            {/* Stage Selection */}
            {selectedPatient && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Add to Stage *
                  </label>
                  <select
                    value={stage}
                    onChange={(e) => setStage(e.target.value as QueueStage)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="registration">Registration</option>
                    <option value="vitals">Vitals (Recommended)</option>
                    <option value="consult">Consultation</option>
                    <option value="pharmacy">Pharmacy</option>
                  </select>
                  <p className="text-sm text-gray-500 mt-1">
                    Select which stage to add the patient to
                  </p>
                </div>

                {/* Priority Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Priority Level *
                  </label>
                  <select
                    value={priority}
                    onChange={(e) =>
                      setPriority(e.target.value as QueuePriority)
                    }
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="normal">Normal</option>
                    <option value="urgent">Urgent</option>
                    <option value="low">Low Priority</option>
                  </select>
                  <p className="text-sm text-gray-500 mt-1">
                    {priority === "urgent" &&
                      "Urgent patients will be moved to the front of the queue"}
                    {priority === "normal" &&
                      "Normal priority - patient will be added to the end of the queue"}
                    {priority === "low" &&
                      "Low priority - for non-critical cases"}
                  </p>
                </div>

                {/* Stage Info */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h4 className="font-medium text-blue-900 mb-2">
                    What happens next?
                  </h4>
                  <p className="text-sm text-blue-800">
                    {stage === "registration" &&
                      "Patient will be added to registration queue and wait to be registered."}
                    {stage === "vitals" &&
                      "Patient will be added to vitals queue and wait for vital signs to be recorded. After vitals are recorded, they will automatically move to consultation."}
                    {stage === "consult" &&
                      "Patient will be added to consultation queue and appear in the Doctor Station immediately."}
                    {stage === "pharmacy" &&
                      "Patient will be added to pharmacy queue and wait for medication dispensing."}
                  </p>
                </div>

                {/* Submit Button */}
                <button
                  onClick={handleAddToQueue}
                  disabled={loading}
                  className={`w-full py-3 px-4 rounded-lg font-medium text-white transition-colors ${
                    loading
                      ? "bg-gray-400 cursor-not-allowed"
                      : "bg-blue-600 hover:bg-blue-700"
                  }`}
                >
                  {loading ? (
                    <span className="flex items-center justify-center">
                      <svg
                        className="animate-spin h-5 w-5 mr-2"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                          fill="none"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      Adding to Queue...
                    </span>
                  ) : (
                    `Add to ${stage.charAt(0).toUpperCase() + stage.slice(1)} Queue`
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Quick Stats */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Current Queue Status
        </h3>
        <QueueStats />
      </div>
    </div>
  );
}

function QueueStats() {
  const [stats, setStats] = useState<Record<QueueStage, number>>({
    registration: 0,
    vitals: 0,
    consult: 0,
    pharmacy: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 5000);
    return () => clearInterval(interval);
  }, []);

  async function loadStats() {
    try {
      const counts: Record<QueueStage, number> = {
        registration: 0,
        vitals: 0,
        consult: 0,
        pharmacy: 0,
      };

      for (const stage of stages) {
        const items = await db.queue
          .where("stage")
          .equals(stage)
          .and((item) => item.status !== "done")
          .toArray();
        counts[stage] = items.length;
      }

      setStats(counts);
    } catch (err) {
      console.error("Error loading queue stats:", err);
    } finally {
      setLoading(false);
    }
  }

  const stageColors: Record<QueueStage, string> = {
    registration: "bg-blue-100 text-blue-800 border-blue-200",
    vitals: "bg-green-100 text-green-800 border-green-200",
    consult: "bg-purple-100 text-purple-800 border-purple-200",
    pharmacy: "bg-orange-100 text-orange-800 border-orange-200",
  };

  if (loading) {
    return (
      <div className="text-center py-8 text-gray-500">
        Loading queue statistics...
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {stages.map((stage) => (
        <div key={stage} className="text-center">
          <div
            className={`text-3xl font-bold ${stageColors[stage]} border-2 rounded-lg py-6`}
          >
            {stats[stage]}
          </div>
          <div className="text-sm text-gray-700 mt-2 font-medium capitalize">
            {stage}
          </div>
        </div>
      ))}
    </div>
  );
}
