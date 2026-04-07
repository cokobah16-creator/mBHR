import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import * as logger from "@/lib/logger";
import { PencilIcon, CheckIcon, XMarkIcon } from "@heroicons/react/24/outline";

interface PHRField {
  label: string;
  key: string;
  value: string;
  editable: boolean;
  type: "text" | "textarea" | "date";
}

export function UpdatePHR() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editingField, setEditingField] = useState<string | null>(null);
  const [fields, setFields] = useState<PHRField[]>([]);
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  useEffect(() => {
    loadPHR();
  }, []);

  const loadPHR = async () => {
    setLoading(true);
    setError("");

    try {
      const portalUserStr = localStorage.getItem("patient_portal_user");
      if (!portalUserStr) {
        window.location.href = "/patient/login";
        return;
      }

      const portalUser = JSON.parse(portalUserStr);
      if (!portalUser.patientId) {
        window.location.href = "/patient/login";
        return;
      }

      const { data: patient, error: patientError } = await supabase
        .from("patients")
        .select("*")
        .eq("id", portalUser.patientId)
        .maybeSingle();

      if (patientError) throw patientError;
      if (!patient) {
        setError("Patient record not found");
        return;
      }

      const phrFields: PHRField[] = [
        {
          label: "Full Name",
          key: "name",
          value: patient.name || "",
          editable: true,
          type: "text",
        },
        {
          label: "Date of Birth",
          key: "dob",
          value: patient.dob || "",
          editable: false,
          type: "date",
        },
        {
          label: "Phone Number",
          key: "phone",
          value: patient.phone || "",
          editable: true,
          type: "text",
        },
        {
          label: "Email",
          key: "email",
          value: patient.email || "",
          editable: true,
          type: "text",
        },
        {
          label: "Address",
          key: "address",
          value: patient.address || "",
          editable: true,
          type: "textarea",
        },
        {
          label: "Emergency Contact",
          key: "emergency_contact",
          value: patient.emergency_contact || "",
          editable: true,
          type: "text",
        },
        {
          label: "Blood Type",
          key: "blood_type",
          value: patient.blood_type || "",
          editable: true,
          type: "text",
        },
        {
          label: "Medical Notes",
          key: "notes",
          value: patient.notes || "",
          editable: true,
          type: "textarea",
        },
      ];

      setFields(phrFields);
    } catch (err) {
      logger.error("Error loading PHR:", err);
      setError("Failed to load health record");
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (key: string, currentValue: string) => {
    setEditingField(key);
    setEditValues({ ...editValues, [key]: currentValue });
    setSuccess("");
    setError("");
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditValues({});
  };

  const saveField = async (key: string) => {
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const portalUserStr = localStorage.getItem("patient_portal_user");
      if (!portalUserStr) {
        window.location.href = "/patient/login";
        return;
      }

      const portalUser = JSON.parse(portalUserStr);

      const { error: updateError } = await supabase
        .from("patients")
        .update({ [key]: editValues[key] })
        .eq("id", portalUser.patientId);

      if (updateError) throw updateError;

      setSuccess("Updated successfully");
      setEditingField(null);
      await loadPHR();
    } catch (err) {
      logger.error("Error updating PHR:", err);
      setError("Failed to update field");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-8">
        <div className="max-w-3xl mx-auto">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading health record...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">
            Update Personal Health Record
          </h1>
          <p className="mt-2 text-gray-600">
            Keep your health information up to date. Changes are saved
            immediately.
          </p>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {success && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm text-green-800">{success}</p>
          </div>
        )}

        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          {fields.map((field, index) => (
            <div
              key={field.key}
              className={`p-4 ${index !== fields.length - 1 ? "border-b border-gray-200" : ""}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {field.label}
                  </label>

                  {editingField === field.key ? (
                    <div className="space-y-2">
                      {field.type === "textarea" ? (
                        <textarea
                          value={editValues[field.key] || ""}
                          onChange={(e) =>
                            setEditValues({
                              ...editValues,
                              [field.key]: e.target.value,
                            })
                          }
                          rows={3}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      ) : (
                        <input
                          type={field.type}
                          value={editValues[field.key] || ""}
                          onChange={(e) =>
                            setEditValues({
                              ...editValues,
                              [field.key]: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      )}

                      <div className="flex gap-2">
                        <button
                          onClick={() => saveField(field.key)}
                          disabled={saving}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 text-sm"
                        >
                          <CheckIcon className="h-4 w-4" />
                          Save
                        </button>
                        <button
                          onClick={cancelEdit}
                          disabled={saving}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-gray-500 text-white rounded-md hover:bg-gray-600 disabled:opacity-50 text-sm"
                        >
                          <XMarkIcon className="h-4 w-4" />
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-gray-900">
                      {field.value || "Not provided"}
                    </p>
                  )}
                </div>

                {field.editable && editingField !== field.key && (
                  <button
                    onClick={() => startEdit(field.key, field.value)}
                    className="ml-4 p-2 text-blue-600 hover:bg-blue-50 rounded-md"
                  >
                    <PencilIcon className="h-5 w-5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
          <p className="text-sm text-blue-800">
            <strong>Note:</strong> Some fields like Date of Birth cannot be
            changed here. Please contact clinic staff if you need to update
            protected information.
          </p>
        </div>
      </div>
    </div>
  );
}
