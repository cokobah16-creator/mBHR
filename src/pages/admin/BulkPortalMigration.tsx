import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { bulkEnrollPatients } from "@/services/unifiedPortalEnrollment";
import {
  UserPlusIcon,
  CheckCircleIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";

export function BulkPortalMigration() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [patients, setPatients] = useState<any[]>([]);
  const [selectedPatients, setSelectedPatients] = useState<Set<string>>(
    new Set(),
  );
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<{
    success: number;
    failed: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    errors: any[];
  } | null>(null);

  useEffect(() => {
    loadEligiblePatients();
  }, []);

  const loadEligiblePatients = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("patients")
        .select(
          "id, given_name, family_name, dob, email, phone, portal_enabled",
        )
        .or("email.not.is.null,phone.not.is.null")
        .eq("portal_enabled", false)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;
      setPatients(data || []);
    } catch (error) {
      console.error("Error loading patients:", error);
      alert("Failed to load patients");
    } finally {
      setLoading(false);
    }
  };

  const togglePatient = (patientId: string) => {
    const newSelected = new Set(selectedPatients);
    if (newSelected.has(patientId)) {
      newSelected.delete(patientId);
    } else {
      newSelected.add(patientId);
    }
    setSelectedPatients(newSelected);
  };

  const selectAll = () => {
    setSelectedPatients(new Set(patients.map((p) => p.id)));
  };

  const deselectAll = () => {
    setSelectedPatients(new Set());
  };

  const handleBulkEnroll = async () => {
    if (selectedPatients.size === 0) {
      alert("Please select at least one patient");
      return;
    }

    if (!confirm(`Enroll ${selectedPatients.size} patients in the portal?`)) {
      return;
    }

    setProcessing(true);
    try {
      const result = await bulkEnrollPatients(Array.from(selectedPatients));
      setResults(result);

      if (result.success > 0) {
        alert(`Successfully enrolled ${result.success} patients!`);
        loadEligiblePatients();
        setSelectedPatients(new Set());
      }

      if (result.failed > 0) {
        console.error("Enrollment errors:", result.errors);
      }
    } catch (error) {
      console.error("Bulk enrollment error:", error);
      alert("Bulk enrollment failed");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Bulk Portal Migration
        </h1>
        <p className="text-gray-600">
          Enroll existing patients in the patient portal. Patients must have
          email or phone number.
        </p>
      </div>

      {results && (
        <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-semibold text-blue-900 mb-2">
            Enrollment Results
          </h3>
          <div className="space-y-1 text-sm">
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircleIcon className="w-5 h-5" />
              <span>{results.success} patients successfully enrolled</span>
            </div>
            {results.failed > 0 && (
              <div className="flex items-center gap-2 text-red-700">
                <XCircleIcon className="w-5 h-5" />
                <span>{results.failed} patients failed</span>
              </div>
            )}
          </div>
          {results.errors.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium text-blue-900">
                View errors
              </summary>
              <ul className="mt-2 space-y-1 text-xs">
                {results.errors.map((err, idx) => (
                  <li key={idx} className="text-red-700">
                    {err.patientId}: {err.error}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600">
              {selectedPatients.size} of {patients.length} patients selected
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={selectAll}
              className="px-3 py-1 text-sm text-blue-600 hover:text-blue-700 font-medium"
              disabled={loading || processing}
            >
              Select All
            </button>
            <button
              onClick={deselectAll}
              className="px-3 py-1 text-sm text-gray-600 hover:text-gray-700 font-medium"
              disabled={loading || processing}
            >
              Deselect All
            </button>
            <button
              onClick={handleBulkEnroll}
              disabled={selectedPatients.size === 0 || processing}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              <UserPlusIcon className="w-5 h-5" />
              {processing
                ? "Enrolling..."
                : `Enroll ${selectedPatients.size} Patients`}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <div className="inline-block w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <p className="mt-4 text-gray-600">Loading eligible patients...</p>
          </div>
        ) : patients.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No eligible patients found. All patients with contact information
            are already enrolled.
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {patients.map((patient) => (
              <div
                key={patient.id}
                className="p-4 hover:bg-gray-50 cursor-pointer"
                onClick={() => togglePatient(patient.id)}
              >
                <div className="flex items-center gap-4">
                  <input
                    type="checkbox"
                    checked={selectedPatients.has(patient.id)}
                    onChange={() => togglePatient(patient.id)}
                    className="w-5 h-5 text-green-600 rounded focus:ring-green-500"
                  />
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">
                      {patient.given_name} {patient.family_name}
                    </div>
                    <div className="text-sm text-gray-600">
                      DOB: {patient.dob}
                    </div>
                    <div className="text-sm text-gray-500 mt-1">
                      {patient.email && (
                        <span className="mr-4">📧 {patient.email}</span>
                      )}
                      {patient.phone && <span>📱 {patient.phone}</span>}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <h3 className="font-semibold text-yellow-900 mb-2">How it works</h3>
        <ul className="text-sm text-yellow-800 space-y-1 list-disc list-inside">
          <li>Select patients who should have portal access</li>
          <li>Portal accounts will be created automatically</li>
          <li>
            Patients can login using their email/phone and OTP verification
          </li>
          <li>Only patients with email or phone number can be enrolled</li>
          <li>Duplicate email/phone numbers will be skipped</li>
        </ul>
      </div>
    </div>
  );
}
