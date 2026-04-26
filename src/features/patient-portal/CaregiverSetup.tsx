import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  UserGroupIcon,
  CheckCircleIcon,
  ArrowRightIcon,
} from "@heroicons/react/24/outline";
import { addManagedPatient } from "@/services/patientPortalAuth";

const schema = z.object({
  givenName: z.string().min(1, "First name is required"),
  familyName: z.string().min(1, "Last name is required"),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Please enter a valid date"),
  relationship: z.enum(["child", "parent", "spouse", "sibling", "other"], {
    errorMap: () => ({ message: "Please select a relationship" }),
  }),
});

type SetupForm = z.infer<typeof schema>;

const RELATIONSHIP_LABELS: Record<string, string> = {
  child: "My Child",
  parent: "My Parent",
  spouse: "My Spouse / Partner",
  sibling: "My Sibling",
  other: "Other",
};

export function CaregiverSetup() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const form = useForm<SetupForm>({
    resolver: zodResolver(schema),
    defaultValues: { givenName: "", familyName: "", dob: "", relationship: "child" },
  });

  const handleSubmit = async (data: SetupForm) => {
    const portalUserStr = localStorage.getItem("patient_portal_user");
    if (!portalUserStr) {
      navigate("/patient/login");
      return;
    }

    const portalUser = JSON.parse(portalUserStr);
    setLoading(true);
    setError("");

    try {
      const result = await addManagedPatient(portalUser.id, {
        givenName: data.givenName,
        familyName: data.familyName,
        dob: data.dob,
        relationship: data.relationship,
      });

      if (result.success) {
        setDone(true);
        setTimeout(() => navigate("/patient/dashboard"), 1500);
      } else {
        setError(result.error || "Could not add patient. Please try again.");
      }
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-10">
      <div className="bg-white rounded-2xl shadow-xl p-8">
        {done ? (
          <div className="text-center py-8">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-full mb-6">
              <CheckCircleIcon className="w-12 h-12 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Patient Added!</h2>
            <p className="text-gray-600">
              You can now switch to this patient's profile from the top of the portal.
            </p>
          </div>
        ) : (
          <>
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
                <UserGroupIcon className="w-8 h-8 text-blue-600" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                Add a Patient You Care For
              </h1>
              <p className="text-gray-600">
                Register a family member or dependent so you can view and manage their health information.
              </p>
            </div>

            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    First Name *
                  </label>
                  <input
                    {...form.register("givenName")}
                    type="text"
                    placeholder="First name"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    disabled={loading}
                  />
                  {form.formState.errors.givenName && (
                    <p className="mt-1 text-xs text-red-600">
                      {form.formState.errors.givenName.message}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Last Name *
                  </label>
                  <input
                    {...form.register("familyName")}
                    type="text"
                    placeholder="Last name"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    disabled={loading}
                  />
                  {form.formState.errors.familyName && (
                    <p className="mt-1 text-xs text-red-600">
                      {form.formState.errors.familyName.message}
                    </p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Date of Birth *
                </label>
                <input
                  {...form.register("dob")}
                  type="date"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled={loading}
                />
                {form.formState.errors.dob && (
                  <p className="mt-1 text-xs text-red-600">
                    {form.formState.errors.dob.message}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Relationship *
                </label>
                <select
                  {...form.register("relationship")}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                  disabled={loading}
                >
                  {Object.entries(RELATIONSHIP_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>
                      {label}
                    </option>
                  ))}
                </select>
                {form.formState.errors.relationship && (
                  <p className="mt-1 text-xs text-red-600">
                    {form.formState.errors.relationship.message}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Adding...
                  </>
                ) : (
                  <>
                    Add Patient
                    <ArrowRightIcon className="w-5 h-5" />
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => navigate("/patient/dashboard")}
                className="w-full text-sm text-gray-500 hover:text-gray-700 py-2"
              >
                Cancel
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
