import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  CalendarIcon,
  ChevronRightIcon,
  FunnelIcon,
} from "@heroicons/react/24/outline";
import { getPatientMedicalHistory } from "@/services/patientPortalData";
import type { PatientMedicalRecord } from "@/types/patientPortal";
import * as logger from "@/lib/logger";

export function MedicalHistory() {
  const [records, setRecords] = useState<PatientMedicalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const pageSize = 10;

  useEffect(() => {
    loadRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const loadRecords = async () => {
    setLoading(true);
    setError("");

    try {
      const portalUserStr = localStorage.getItem("patient_portal_user");
      if (!portalUserStr) {
        setError("Session not found. Please log in again.");
        setLoading(false);
        return;
      }

      const portalUser = JSON.parse(portalUserStr);
      if (!portalUser.patientId || !portalUser.id) {
        setError("Session data incomplete. Please log in again.");
        setLoading(false);
        return;
      }

      const result = await getPatientMedicalHistory(
        portalUser.id,
        portalUser.patientId,
        pageSize,
        (page - 1) * pageSize,
      );
      if (result) {
        setRecords(result.records);
        setHasMore(result.total > page * pageSize);
      } else {
        setError("Failed to load medical history");
      }
    } catch (err) {
      logger.error("Error loading medical history:", err);
      setError("An error occurred loading your medical history");
    } finally {
      setLoading(false);
    }
  };

  if (loading && page === 1) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Medical History
            </h1>
            <p className="text-gray-600 mt-2">
              View your past visits and consultations
            </p>
          </div>
          <button className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            <FunnelIcon className="w-5 h-5 text-gray-600" />
            <span className="text-sm font-medium text-gray-700">Filter</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-6">
          <p className="text-red-800">{error}</p>
        </div>
      )}

      {records.length === 0 && !loading ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <CalendarIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            No Medical Records
          </h3>
          <p className="text-gray-600">
            Your visit history will appear here once you have appointments.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {records.map((record) => (
            <Link
              key={record.visitId}
              to={`/patient/visit/${record.visitId}`}
              className="block bg-white rounded-xl shadow-sm p-6 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                      <CalendarIcon className="w-6 h-6 text-blue-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">
                        {new Date(record.visitDate).toLocaleDateString(
                          "en-US",
                          {
                            weekday: "long",
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                          },
                        )}
                      </p>
                      {record.chiefComplaint && (
                        <p className="text-sm text-gray-600">
                          {record.chiefComplaint}
                        </p>
                      )}
                    </div>
                  </div>

                  {record.vitals && (
                    <div className="flex flex-wrap gap-4 mb-3 pl-15">
                      {record.vitals.systolic && record.vitals.diastolic && (
                        <div className="text-sm">
                          <span className="text-gray-600">BP:</span>{" "}
                          <span className="font-medium text-gray-900">
                            {record.vitals.systolic}/{record.vitals.diastolic}
                          </span>
                        </div>
                      )}
                      {record.vitals.pulseBpm && (
                        <div className="text-sm">
                          <span className="text-gray-600">HR:</span>{" "}
                          <span className="font-medium text-gray-900">
                            {record.vitals.pulseBpm} bpm
                          </span>
                        </div>
                      )}
                      {record.vitals.tempC && (
                        <div className="text-sm">
                          <span className="text-gray-600">Temp:</span>{" "}
                          <span className="font-medium text-gray-900">
                            {record.vitals.tempC}°C
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {record.consultation && (
                    <div className="pl-15">
                      {record.consultation.diagnoses.length > 0 && (
                        <div className="mb-2">
                          <span className="text-sm text-gray-600">
                            Diagnosis:{" "}
                          </span>
                          <span className="text-sm font-medium text-gray-900">
                            {record.consultation.diagnoses.join(", ")}
                          </span>
                        </div>
                      )}
                      {record.consultation.providerName && (
                        <div className="text-sm text-gray-600">
                          Provider: {record.consultation.providerName}
                        </div>
                      )}
                    </div>
                  )}

                  {record.prescriptions && record.prescriptions.length > 0 && (
                    <div className="mt-3 pl-15">
                      <p className="text-sm text-gray-600 mb-1">
                        Medications prescribed:
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {record.prescriptions.map((rx, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-medium"
                          >
                            {rx.medicationName}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <ChevronRightIcon className="w-5 h-5 text-gray-400 flex-shrink-0 ml-4" />
              </div>
            </Link>
          ))}
        </div>
      )}

      {hasMore && records.length > 0 && (
        <div className="mt-6 text-center">
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={loading}
            className="px-6 py-3 bg-white border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition-colors disabled:bg-gray-100 disabled:cursor-not-allowed"
          >
            {loading ? "Loading..." : "Load More"}
          </button>
        </div>
      )}
    </div>
  );
}
