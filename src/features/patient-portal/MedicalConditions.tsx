import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import * as logger from "@/lib/logger";
import { formatNigerianDate } from "@/utils/dateFormat";
import { PlusIcon, HeartIcon } from "@heroicons/react/24/outline";

interface MedicalCondition {
  id: string;
  condition_name: string;
  diagnosed_date?: string;
  status: "active" | "resolved" | "managed";
  notes?: string;
  created_at: string;
}

export function MedicalConditions() {
  const [conditions, setConditions] = useState<MedicalCondition[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newCondition, setNewCondition] = useState({
    condition_name: "",
    diagnosed_date: "",
    status: "active" as "active" | "resolved" | "managed",
    notes: "",
  });

  useEffect(() => {
    loadConditions();
  }, []);

  const loadConditions = async () => {
    setLoading(true);
    setError("");

    try {
      const portalUserStr = localStorage.getItem("patient_portal_user");
      if (!portalUserStr) {
        window.location.href = "/patient/login";
        return;
      }

      const portalUser = JSON.parse(portalUserStr);

      const { data, error: conditionsError } = await supabase
        .from("patient_medical_conditions")
        .select("*")
        .eq("patient_id", portalUser.patientId)
        .order("created_at", { ascending: false });

      if (conditionsError) throw conditionsError;

      setConditions(data || []);
    } catch (err) {
      logger.error("Error loading conditions:", err);
      setError("Failed to load medical conditions");
    } finally {
      setLoading(false);
    }
  };

  const addCondition = async () => {
    if (!newCondition.condition_name.trim()) {
      setError("Condition name is required");
      return;
    }

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

      const { error: insertError } = await supabase
        .from("patient_medical_conditions")
        .insert({
          patient_id: portalUser.patientId,
          condition_name: newCondition.condition_name,
          diagnosed_date: newCondition.diagnosed_date || null,
          status: newCondition.status,
          notes: newCondition.notes || null,
        });

      if (insertError) throw insertError;

      setSuccess("Medical condition added successfully");
      setNewCondition({
        condition_name: "",
        diagnosed_date: "",
        status: "active",
        notes: "",
      });
      setShowAdd(false);
      await loadConditions();
    } catch (err) {
      logger.error("Error adding condition:", err);
      setError("Failed to add medical condition");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading medical conditions...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Medical Conditions
            </h1>
            <p className="mt-2 text-gray-600">
              Manage your health conditions and history
            </p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            <PlusIcon className="h-5 w-5" />
            Add Condition
          </button>
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

        {showAdd && (
          <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold mb-4">Add New Condition</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Condition Name *
                </label>
                <input
                  type="text"
                  value={newCondition.condition_name}
                  onChange={(e) =>
                    setNewCondition({
                      ...newCondition,
                      condition_name: e.target.value,
                    })
                  }
                  placeholder="e.g., Hypertension, Diabetes"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Diagnosed Date
                </label>
                <input
                  type="date"
                  value={newCondition.diagnosed_date}
                  onChange={(e) =>
                    setNewCondition({
                      ...newCondition,
                      diagnosed_date: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Status
                </label>
                <select
                  value={newCondition.status}
                  onChange={(e) =>
                    setNewCondition({
                      ...newCondition,
                      status: e.target.value as
                        | "active"
                        | "resolved"
                        | "managed",
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="active">Active</option>
                  <option value="managed">Managed</option>
                  <option value="resolved">Resolved</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes
                </label>
                <textarea
                  value={newCondition.notes}
                  onChange={(e) =>
                    setNewCondition({ ...newCondition, notes: e.target.value })
                  }
                  placeholder="Additional information about this condition"
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={addCondition}
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? "Adding..." : "Add Condition"}
                </button>
                <button
                  onClick={() => setShowAdd(false)}
                  disabled={saving}
                  className="px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          {conditions.length === 0 ? (
            <div className="p-12 text-center">
              <HeartIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                No conditions recorded
              </h3>
              <p className="text-gray-600">
                Add your medical conditions to keep your record updated
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {conditions.map((condition) => (
                <div key={condition.id} className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="font-medium text-gray-900">
                        {condition.condition_name}
                      </h3>
                      {condition.diagnosed_date && (
                        <p className="text-sm text-gray-600 mt-1">
                          Diagnosed:{" "}
                          {formatNigerianDate(condition.diagnosed_date)}
                        </p>
                      )}
                      {condition.notes && (
                        <p className="text-sm text-gray-600 mt-1">
                          {condition.notes}
                        </p>
                      )}
                    </div>
                    <span
                      className={`px-2 py-1 text-xs font-medium rounded ${
                        condition.status === "active"
                          ? "bg-red-100 text-red-800"
                          : condition.status === "managed"
                            ? "bg-yellow-100 text-yellow-800"
                            : "bg-green-100 text-green-800"
                      }`}
                    >
                      {condition.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
          <p className="text-sm text-blue-800">
            <strong>Note:</strong> This information will be reviewed by your
            healthcare provider and may be used to update your official medical
            record.
          </p>
        </div>
      </div>
    </div>
  );
}
