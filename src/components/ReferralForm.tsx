import { useState } from "react";
import { doctorService } from "@/services/doctorService";
import { useAuthStore } from "@/stores/auth";
import type { Referral } from "@/types/multiTenant";
import {
  UserGroupIcon,
  BuildingOfficeIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";

interface ReferralFormProps {
  org_id: string;
  site_id: string;
  event_id?: string;
  patient_id: string;
  visit_id?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function ReferralForm({
  org_id,
  site_id,
  event_id,
  patient_id,
  visit_id,
  onSuccess,
  onCancel,
}: ReferralFormProps) {
  const { currentUser } = useAuthStore();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [formData, setFormData] = useState<Partial<Referral>>({
    org_id,
    site_id,
    event_id,
    patient_id,
    visit_id,
    referral_type: "specialist",
    urgency: "routine",
    reason: "",
    clinical_summary: "",
    diagnosis: "",
    facility_name: "",
    specialty: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!currentUser) {
      setError("User not authenticated");
      return;
    }

    if (!formData.reason || !formData.clinical_summary) {
      setError("Please provide reason and clinical summary");
      return;
    }

    setSubmitting(true);

    try {
      const referral = await doctorService.createReferral({
        ...formData,
        referring_doctor_id: currentUser.id,
        status: "pending",
      } as Omit<Referral, "id" | "created_at" | "updated_at">);

      if (referral) {
        onSuccess?.();
      } else {
        setError("Failed to create referral");
      }
    } catch (err) {
      console.error("Error creating referral:", err);
      setError("An error occurred while creating the referral");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm p-6">
      <div className="flex items-center space-x-3 mb-6">
        <UserGroupIcon className="h-6 w-6 text-blue-600" />
        <h2 className="text-xl font-semibold text-gray-900">Create Referral</h2>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-2">
          <ExclamationTriangleIcon className="h-5 w-5 text-red-600 mt-0.5" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Referral Type <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.referral_type}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  referral_type: e.target.value as Referral["referral_type"],
                })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              required
            >
              <option value="specialist">Specialist</option>
              <option value="hospital">Hospital</option>
              <option value="lab">Laboratory</option>
              <option value="imaging">Imaging</option>
              <option value="follow_up">Follow-up</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Urgency <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.urgency}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  urgency: e.target.value as Referral["urgency"],
                })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              required
            >
              <option value="routine">Routine</option>
              <option value="urgent">Urgent</option>
              <option value="emergency">Emergency</option>
            </select>
          </div>
        </div>

        {formData.referral_type === "specialist" && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Specialty
            </label>
            <input
              type="text"
              value={formData.specialty || ""}
              onChange={(e) =>
                setFormData({ ...formData, specialty: e.target.value })
              }
              placeholder="e.g., Cardiology, Orthopedics"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Facility Name
          </label>
          <input
            type="text"
            value={formData.facility_name || ""}
            onChange={(e) =>
              setFormData({ ...formData, facility_name: e.target.value })
            }
            placeholder="Name of hospital, clinic, or facility"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Reason for Referral <span className="text-red-500">*</span>
          </label>
          <textarea
            value={formData.reason || ""}
            onChange={(e) =>
              setFormData({ ...formData, reason: e.target.value })
            }
            placeholder="Brief reason for referring this patient"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            rows={2}
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Clinical Summary <span className="text-red-500">*</span>
          </label>
          <textarea
            value={formData.clinical_summary || ""}
            onChange={(e) =>
              setFormData({ ...formData, clinical_summary: e.target.value })
            }
            placeholder="Relevant patient history, symptoms, findings"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            rows={4}
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Working Diagnosis
          </label>
          <input
            type="text"
            value={formData.diagnosis || ""}
            onChange={(e) =>
              setFormData({ ...formData, diagnosis: e.target.value })
            }
            placeholder="Provisional or confirmed diagnosis"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Additional Notes
          </label>
          <textarea
            value={formData.notes || ""}
            onChange={(e) =>
              setFormData({ ...formData, notes: e.target.value })
            }
            placeholder="Any additional information for the receiving facility"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            rows={2}
          />
        </div>

        <div className="flex justify-end space-x-3 pt-4">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="btn-secondary"
              disabled={submitting}
            >
              Cancel
            </button>
          )}
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? "Creating Referral..." : "Create Referral"}
          </button>
        </div>
      </form>
    </div>
  );
}
