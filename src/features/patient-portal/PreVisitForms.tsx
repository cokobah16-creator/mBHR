import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { formatNigerianDate } from "@/utils/dateFormat";
import {
  DocumentCheckIcon,
  CheckCircleIcon,
  ClockIcon,
  ChevronRightIcon,
} from "@heroicons/react/24/outline";
import * as logger from "@/lib/logger";

const preVisitFormSchema = z.object({
  chiefComplaint: z.string().min(5, "Please describe your symptoms"),
  symptomDuration: z.string().min(1, "Required"),
  currentMedications: z.string(),
  allergies: z.string(),
  recentHospitalVisits: z.string(),
  smokingStatus: z.enum(["never", "former", "current"]),
  alcoholUse: z.enum(["never", "occasional", "regular"]),
  exerciseFrequency: z.string(),
  additionalNotes: z.string(),
});

type PreVisitFormData = z.infer<typeof preVisitFormSchema>;

interface PreVisitForm {
  id: string;
  appointmentId: string;
  appointmentDate: Date;
  appointmentType: string;
  status: "pending" | "completed";
  submittedAt?: Date;
  data?: PreVisitFormData;
}

export function PreVisitForms() {
  const [forms, setForms] = useState<PreVisitForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedForm, setSelectedForm] = useState<PreVisitForm | null>(null);
  const [showFormModal, setShowFormModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<PreVisitFormData>({
    resolver: zodResolver(preVisitFormSchema),
  });

  useEffect(() => {
    loadForms();
  }, []);

  const loadForms = async () => {
    setLoading(true);
    try {
      const portalUser = JSON.parse(
        localStorage.getItem("patient_portal_user") || "{}",
      );
      if (!portalUser.patientId) {
        logger.error("No patient ID found");
        return;
      }

      setForms([]);
    } catch (err) {
      logger.error("Error loading forms:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleFillForm = (form: PreVisitForm) => {
    setSelectedForm(form);
    if (form.data) {
      reset(form.data);
    } else {
      reset({
        chiefComplaint: "",
        symptomDuration: "",
        currentMedications: "",
        allergies: "",
        recentHospitalVisits: "",
        smokingStatus: "never",
        alcoholUse: "never",
        exerciseFrequency: "",
        additionalNotes: "",
      });
    }
    setShowFormModal(true);
  };

  const onSubmit = async (data: PreVisitFormData) => {
    if (!selectedForm) return;

    setSubmitting(true);
    try {
      // Mock submission - replace with actual API call
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const updatedForms = forms.map((form) => {
        if (form.id === selectedForm.id) {
          return {
            ...form,
            status: "completed" as const,
            submittedAt: new Date(),
            data,
          };
        }
        return form;
      });

      setForms(updatedForms);
      setShowFormModal(false);
      setSelectedForm(null);
      reset();

      alert("Form submitted successfully!");
    } catch (err) {
      logger.error("Form submission error:", err);
      alert("Failed to submit form. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const pendingForms = forms.filter((f) => f.status === "pending");
  const completedForms = forms.filter((f) => f.status === "completed");

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
        <h1 className="text-3xl font-bold text-gray-900">Pre-Visit Forms</h1>
        <p className="text-gray-600 mt-2">
          Complete forms before your appointment to save time
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
              <ClockIcon className="w-6 h-6 text-yellow-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Pending Forms</p>
              <p className="text-2xl font-bold text-gray-900">
                {pendingForms.length}
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
              <p className="text-sm text-gray-600">Completed Forms</p>
              <p className="text-2xl font-bold text-gray-900">
                {completedForms.length}
              </p>
            </div>
          </div>
        </div>
      </div>

      {pendingForms.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 bg-yellow-50">
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <ClockIcon className="w-6 h-6 text-yellow-600" />
              Pending Forms
            </h2>
          </div>

          <div className="divide-y divide-gray-200">
            {pendingForms.map((form) => (
              <div
                key={form.id}
                className="p-6 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900 text-lg">
                      {form.appointmentType}
                    </h3>
                    <p className="text-gray-600 mt-1">
                      Appointment: {formatNigerianDate(form.appointmentDate)}
                    </p>
                    <p className="text-sm text-yellow-600 mt-2">
                      Please complete before your visit
                    </p>
                  </div>
                  <button
                    onClick={() => handleFillForm(form)}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center gap-2"
                  >
                    <DocumentCheckIcon className="w-5 h-5" />
                    Fill Form
                    <ChevronRightIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {completedForms.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <CheckCircleIcon className="w-6 h-6 text-green-600" />
              Completed Forms
            </h2>
          </div>

          <div className="divide-y divide-gray-200">
            {completedForms.map((form) => (
              <div
                key={form.id}
                className="p-6 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className="font-semibold text-gray-900 text-lg">
                        {form.appointmentType}
                      </h3>
                      <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium">
                        Completed
                      </span>
                    </div>
                    <p className="text-gray-600 mt-1">
                      Appointment: {formatNigerianDate(form.appointmentDate)}
                    </p>
                    {form.submittedAt && (
                      <p className="text-sm text-gray-500 mt-1">
                        Submitted: {formatNigerianDate(form.submittedAt)}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => handleFillForm(form)}
                    className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
                  >
                    View Form
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showFormModal && selectedForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-xl max-w-3xl w-full p-6 my-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              Pre-Visit Medical Form
            </h2>
            <p className="text-gray-600 mb-6">
              {selectedForm.appointmentType} -{" "}
              {formatNigerianDate(selectedForm.appointmentDate)}
            </p>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  What brings you in today? (Chief Complaint) *
                </label>
                <textarea
                  {...register("chiefComplaint")}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Describe your symptoms or reason for visit"
                />
                {errors.chiefComplaint && (
                  <p className="text-red-600 text-sm mt-1">
                    {errors.chiefComplaint.message}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  How long have you had these symptoms? *
                </label>
                <input
                  {...register("symptomDuration")}
                  type="text"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="e.g., 3 days, 2 weeks"
                />
                {errors.symptomDuration && (
                  <p className="text-red-600 text-sm mt-1">
                    {errors.symptomDuration.message}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Current Medications
                </label>
                <textarea
                  {...register("currentMedications")}
                  rows={2}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="List all medications you're currently taking"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Known Allergies
                </label>
                <textarea
                  {...register("allergies")}
                  rows={2}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="List any drug or food allergies"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Recent Hospital Visits
                </label>
                <textarea
                  {...register("recentHospitalVisits")}
                  rows={2}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Any recent hospitalizations or ER visits"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Smoking Status
                  </label>
                  <select
                    {...register("smokingStatus")}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="never">Never smoked</option>
                    <option value="former">Former smoker</option>
                    <option value="current">Current smoker</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Alcohol Use
                  </label>
                  <select
                    {...register("alcoholUse")}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="never">Never</option>
                    <option value="occasional">Occasionally</option>
                    <option value="regular">Regularly</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Exercise Frequency
                </label>
                <input
                  {...register("exerciseFrequency")}
                  type="text"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="e.g., 3 times per week"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Additional Notes
                </label>
                <textarea
                  {...register("additionalNotes")}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Any other information you'd like to share"
                />
              </div>

              <div className="flex gap-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => {
                    setShowFormModal(false);
                    setSelectedForm(null);
                    reset();
                  }}
                  disabled={submitting}
                  className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || selectedForm.status === "completed"}
                  className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Submitting...
                    </>
                  ) : selectedForm.status === "completed" ? (
                    <>
                      <CheckCircleIcon className="w-5 h-5" />
                      Submitted
                    </>
                  ) : (
                    <>
                      <DocumentCheckIcon className="w-5 h-5" />
                      Submit Form
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
