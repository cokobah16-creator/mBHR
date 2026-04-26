import { useEffect, useState } from "react";
import { formatNigerianDate } from "@/utils/dateFormat";
import {
  BellAlertIcon,
  ClockIcon,
  CheckCircleIcon,
  PlusCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import * as logger from "@/lib/logger";

interface Prescription {
  id: string;
  medicationName: string;
  dosage: string;
  frequency: string;
  prescribedBy: string;
  prescribedDate: Date;
  lastDispensedDate: Date;
  quantityDispensed: number;
  daysSupply: number;
  refillsRemaining: number;
  totalRefills: number;
  status: "active" | "refill_soon" | "refill_due" | "expired";
}

interface RefillRequest {
  id: string;
  prescriptionId: string;
  medicationName: string;
  requestedAt: Date;
  status: "pending" | "approved" | "ready" | "dispensed" | "declined";
  pharmacy: string;
  notes?: string;
  reviewedAt?: Date;
  reviewedBy?: string;
}

export function PrescriptionRefills() {
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [refillRequests, setRefillRequests] = useState<RefillRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPrescription, setSelectedPrescription] =
    useState<Prescription | null>(null);
  const [showRefillModal, setShowRefillModal] = useState(false);
  const [refillNotes, setRefillNotes] = useState("");
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    loadPrescriptions();
    loadRefillRequests();
  }, []);

  const loadPrescriptions = async () => {
    setLoading(true);
    try {
      const portalUser = JSON.parse(
        localStorage.getItem("patient_portal_user") || "{}",
      );
      if (!portalUser.patientId) {
        logger.error("No patient ID found");
        return;
      }

      // Mock data - replace with actual API calls
      const mockPrescriptions: Prescription[] = [
        {
          id: "rx-1",
          medicationName: "Lisinopril",
          dosage: "10mg",
          frequency: "Once daily",
          prescribedBy: "Dr. Adeyemi",
          prescribedDate: new Date("2025-09-01"),
          lastDispensedDate: new Date("2025-10-01"),
          quantityDispensed: 30,
          daysSupply: 30,
          refillsRemaining: 2,
          totalRefills: 3,
          status: "refill_soon",
        },
        {
          id: "rx-2",
          medicationName: "Metformin",
          dosage: "500mg",
          frequency: "Twice daily",
          prescribedBy: "Dr. Adeyemi",
          prescribedDate: new Date("2025-08-15"),
          lastDispensedDate: new Date("2025-09-28"),
          quantityDispensed: 60,
          daysSupply: 30,
          refillsRemaining: 5,
          totalRefills: 6,
          status: "refill_due",
        },
        {
          id: "rx-3",
          medicationName: "Atorvastatin",
          dosage: "20mg",
          frequency: "Once daily at bedtime",
          prescribedBy: "Dr. Okafor",
          prescribedDate: new Date("2025-10-10"),
          lastDispensedDate: new Date("2025-10-10"),
          quantityDispensed: 30,
          daysSupply: 30,
          refillsRemaining: 4,
          totalRefills: 5,
          status: "active",
        },
      ];

      setPrescriptions(mockPrescriptions);
    } catch (err) {
      logger.error("Error loading prescriptions:", err);
    } finally {
      setLoading(false);
    }
  };

  const loadRefillRequests = async () => {
    try {
      // Mock data - replace with actual API call
      const mockRequests: RefillRequest[] = [
        {
          id: "req-1",
          prescriptionId: "rx-1",
          medicationName: "Lisinopril 10mg",
          requestedAt: new Date("2025-10-23"),
          status: "ready",
          pharmacy: "Main Pharmacy",
          reviewedAt: new Date("2025-10-24"),
          reviewedBy: "Pharmacist Johnson",
        },
      ];

      setRefillRequests(mockRequests);
    } catch (err) {
      logger.error("Error loading refill requests:", err);
    }
  };

  const getStatusInfo = (status: Prescription["status"]) => {
    switch (status) {
      case "refill_due":
        return {
          color: "bg-red-100 text-red-800 border-red-200",
          icon: ExclamationTriangleIcon,
          label: "Refill Due Now",
          message: "Your prescription is running out soon",
        };
      case "refill_soon":
        return {
          color: "bg-yellow-100 text-yellow-800 border-yellow-200",
          icon: BellAlertIcon,
          label: "Refill Soon",
          message: "Consider requesting a refill",
        };
      case "active":
        return {
          color: "bg-green-100 text-green-800 border-green-200",
          icon: CheckCircleIcon,
          label: "Active",
          message: "Prescription is active",
        };
      case "expired":
        return {
          color: "bg-gray-100 text-gray-800 border-gray-200",
          icon: XCircleIcon,
          label: "Expired",
          message: "Contact your doctor for a new prescription",
        };
    }
  };

  const getRequestStatusColor = (status: RefillRequest["status"]) => {
    switch (status) {
      case "ready":
        return "bg-green-100 text-green-800";
      case "approved":
        return "bg-blue-100 text-blue-800";
      case "pending":
        return "bg-yellow-100 text-yellow-800";
      case "dispensed":
        return "bg-gray-100 text-gray-800";
      case "declined":
        return "bg-red-100 text-red-800";
    }
  };

  const handleRequestRefill = (prescription: Prescription) => {
    setSelectedPrescription(prescription);
    setRefillNotes("");
    setShowRefillModal(true);
  };

  const submitRefillRequest = async () => {
    if (!selectedPrescription) return;

    setRequesting(true);
    try {
      // Mock submission - replace with actual API call
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const newRequest: RefillRequest = {
        id: `req-${Date.now()}`,
        prescriptionId: selectedPrescription.id,
        medicationName: `${selectedPrescription.medicationName} ${selectedPrescription.dosage}`,
        requestedAt: new Date(),
        status: "pending",
        pharmacy: "Main Pharmacy",
        notes: refillNotes || undefined,
      };

      setRefillRequests([newRequest, ...refillRequests]);
      setShowRefillModal(false);
      setSelectedPrescription(null);
      setRefillNotes("");

      alert(
        "Refill request submitted successfully! We will notify you when it's ready.",
      );
    } catch (err) {
      logger.error("Refill request error:", err);
      alert("Failed to submit refill request. Please try again.");
    } finally {
      setRequesting(false);
    }
  };

  const getDaysUntilRefill = (prescription: Prescription) => {
    const lastDispensed = new Date(prescription.lastDispensedDate);
    const nextRefillDate = new Date(
      lastDispensed.getTime() + prescription.daysSupply * 24 * 60 * 60 * 1000,
    );
    const today = new Date();
    const daysRemaining = Math.ceil(
      (nextRefillDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
    );
    return daysRemaining;
  };

  const needsAttention = prescriptions.filter(
    (p) => p.status === "refill_due" || p.status === "refill_soon",
  );
  const activePrescriptions = prescriptions.filter(
    (p) => p.status === "active",
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h1 className="text-3xl font-bold text-gray-900">
          Prescription Refills
        </h1>
        <p className="text-gray-600 mt-2">
          Manage your prescriptions and request refills
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
              <BellAlertIcon className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Need Attention</p>
              <p className="text-2xl font-bold text-gray-900">
                {needsAttention.length}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
              <CheckCircleIcon className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Active</p>
              <p className="text-2xl font-bold text-gray-900">
                {activePrescriptions.length}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <ClockIcon className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Pending Requests</p>
              <p className="text-2xl font-bold text-gray-900">
                {
                  refillRequests.filter(
                    (r) => r.status === "pending" || r.status === "approved",
                  ).length
                }
              </p>
            </div>
          </div>
        </div>
      </div>

      {refillRequests.filter((r) => r.status !== "dispensed").length > 0 && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 bg-blue-50">
            <h2 className="text-xl font-bold text-gray-900">
              Recent Refill Requests
            </h2>
          </div>

          <div className="divide-y divide-gray-200">
            {refillRequests
              .filter((r) => r.status !== "dispensed")
              .map((request) => (
                <div
                  key={request.id}
                  className="p-6 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <h3 className="font-semibold text-gray-900">
                          {request.medicationName}
                        </h3>
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-medium ${getRequestStatusColor(request.status)}`}
                        >
                          {request.status.charAt(0).toUpperCase() +
                            request.status.slice(1).replace("_", " ")}
                        </span>
                      </div>
                      <p className="text-gray-600 mt-1">
                        Requested: {formatNigerianDate(request.requestedAt)}
                      </p>
                      <p className="text-gray-600">
                        Pharmacy: {request.pharmacy}
                      </p>
                      {request.status === "ready" && (
                        <p className="text-green-600 font-medium mt-2">
                          Ready for pickup!
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {needsAttention.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 bg-yellow-50">
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <BellAlertIcon className="w-6 h-6 text-yellow-600" />
              Needs Attention
            </h2>
          </div>

          <div className="divide-y divide-gray-200">
            {needsAttention.map((prescription) => {
              const statusInfo = getStatusInfo(prescription.status);
              const StatusIcon = statusInfo.icon;
              const daysUntilRefill = getDaysUntilRefill(prescription);

              return (
                <div
                  key={prescription.id}
                  className="p-6 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <StatusIcon className="w-6 h-6 text-yellow-600" />
                        <h3 className="font-semibold text-gray-900 text-lg">
                          {prescription.medicationName} {prescription.dosage}
                        </h3>
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-medium border ${statusInfo.color}`}
                        >
                          {statusInfo.label}
                        </span>
                      </div>

                      <p className="text-gray-600 mt-2">
                        {prescription.frequency}
                      </p>
                      <p className="text-gray-600">
                        Prescribed by: {prescription.prescribedBy}
                      </p>

                      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <p className="text-gray-500">Days until refill</p>
                          <p className="font-semibold text-gray-900">
                            {daysUntilRefill} days
                          </p>
                        </div>
                        <div>
                          <p className="text-gray-500">Last filled</p>
                          <p className="font-semibold text-gray-900">
                            {formatNigerianDate(prescription.lastDispensedDate)}
                          </p>
                        </div>
                        <div>
                          <p className="text-gray-500">Refills remaining</p>
                          <p className="font-semibold text-gray-900">
                            {prescription.refillsRemaining} of{" "}
                            {prescription.totalRefills}
                          </p>
                        </div>
                        <div>
                          <p className="text-gray-500">Days supply</p>
                          <p className="font-semibold text-gray-900">
                            {prescription.daysSupply} days
                          </p>
                        </div>
                      </div>

                      <div className="mt-4">
                        <button
                          onClick={() => handleRequestRefill(prescription)}
                          disabled={prescription.refillsRemaining === 0}
                          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <PlusCircleIcon className="w-5 h-5" />
                          Request Refill
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">
            All Active Prescriptions
          </h2>
        </div>

        <div className="divide-y divide-gray-200">
          {prescriptions.map((prescription) => {
            const statusInfo = getStatusInfo(prescription.status);
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const _StatusIcon = statusInfo.icon;
            const daysUntilRefill = getDaysUntilRefill(prescription);

            return (
              <div
                key={prescription.id}
                className="p-6 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className="font-semibold text-gray-900 text-lg">
                        {prescription.medicationName} {prescription.dosage}
                      </h3>
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-medium border ${statusInfo.color}`}
                      >
                        {statusInfo.label}
                      </span>
                    </div>

                    <p className="text-gray-600 mt-2">
                      {prescription.frequency}
                    </p>

                    <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <p className="text-gray-500">Prescribed by</p>
                        <p className="font-semibold text-gray-900">
                          {prescription.prescribedBy}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-500">Last filled</p>
                        <p className="font-semibold text-gray-900">
                          {formatNigerianDate(prescription.lastDispensedDate)}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-500">Refills remaining</p>
                        <p className="font-semibold text-gray-900">
                          {prescription.refillsRemaining} of{" "}
                          {prescription.totalRefills}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-500">Days until refill</p>
                        <p className="font-semibold text-gray-900">
                          {daysUntilRefill} days
                        </p>
                      </div>
                    </div>

                    {prescription.status !== "expired" &&
                      prescription.refillsRemaining > 0 && (
                        <div className="mt-4">
                          <button
                            onClick={() => handleRequestRefill(prescription)}
                            className="px-4 py-2 border border-blue-600 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors text-sm font-medium flex items-center gap-2"
                          >
                            <PlusCircleIcon className="w-4 h-4" />
                            Request Refill
                          </button>
                        </div>
                      )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showRefillModal && selectedPrescription && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-md w-full p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              Request Refill
            </h2>

            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <p className="font-semibold text-gray-900 text-lg">
                {selectedPrescription.medicationName}{" "}
                {selectedPrescription.dosage}
              </p>
              <p className="text-gray-600 mt-1">
                {selectedPrescription.frequency}
              </p>
              <p className="text-sm text-gray-600 mt-2">
                Refills remaining: {selectedPrescription.refillsRemaining} of{" "}
                {selectedPrescription.totalRefills}
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Additional Notes (Optional)
                </label>
                <textarea
                  value={refillNotes}
                  onChange={(e) => setRefillNotes(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Any special instructions or questions?"
                />
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-800">
                  Your refill request will be reviewed by our pharmacy team.
                  We'll notify you when it's ready for pickup.
                </p>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowRefillModal(false);
                    setSelectedPrescription(null);
                    setRefillNotes("");
                  }}
                  disabled={requesting}
                  className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={submitRefillRequest}
                  disabled={requesting}
                  className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {requesting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Requesting...
                    </>
                  ) : (
                    <>
                      <PlusCircleIcon className="w-5 h-5" />
                      Submit Request
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
