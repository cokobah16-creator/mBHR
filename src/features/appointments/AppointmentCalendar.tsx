import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  CalendarIcon,
  ClockIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  createAppointment,
  getUpcomingAppointments,
  getTodayAppointments,
  checkAvailability,
  updateAppointmentStatus,
} from "@/services/appointments";
import { useToast } from "@/stores/toast";

interface Appointment {
  id: string;
  patient_id: string;
  provider_id: string;
  appointment_type: string;
  scheduled_at: string;
  duration_minutes: number;
  status: string;
  reason?: string;
  notes?: string;
}

const appointmentSchema = z.object({
  patientId: z.string().min(1, "Patient is required"),
  providerId: z.string().min(1, "Provider is required"),
  appointmentType: z.string().min(1, "Appointment type is required"),
  scheduledAt: z.string().min(1, "Date and time are required"),
  durationMinutes: z.number().min(15).max(240),
  reason: z.string().optional(),
});

type AppointmentFormData = z.infer<typeof appointmentSchema>;

interface AppointmentCalendarProps {
  providerId?: string;
  patientId?: string;
  createdBy: string;
}

const appointmentTypes = [
  "Initial Consultation",
  "Follow-up",
  "Vaccination",
  "Health Screening",
  "Lab Results Review",
  "Wound Care",
  "Chronic Disease Management",
  "Prenatal Care",
  "Postnatal Care",
  "Child Wellness Visit",
];

export function AppointmentCalendar({
  providerId,
  patientId,
  createdBy,
}: AppointmentCalendarProps) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedDate] = useState<string>(
    new Date().toISOString().split("T")[0],
  );
  const [viewMode, setViewMode] = useState<"today" | "week" | "month">("today");
  const toast = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<AppointmentFormData>({
    resolver: zodResolver(appointmentSchema),
    defaultValues: {
      providerId: providerId || "",
      patientId: patientId || "",
      durationMinutes: 30,
    },
  });

  useEffect(() => {
    loadAppointments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, selectedDate]);

  const loadAppointments = async () => {
    try {
      setLoading(true);
      let data;

      if (viewMode === "today") {
        data = await getTodayAppointments();
      } else {
        data = await getUpcomingAppointments();
      }

      setAppointments(data);
    } catch (error) {
      console.error("Failed to load appointments:", error);
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async (data: AppointmentFormData) => {
    try {
      const isAvailable = await checkAvailability(
        data.providerId,
        new Date(data.scheduledAt),
        data.durationMinutes,
      );

      if (!isAvailable) {
        toast.push({
          id: Date.now().toString(),
          title: "Time slot not available",
          body: "Please choose a different time",
        });
        return;
      }

      await createAppointment({
        patientId: data.patientId,
        providerId: data.providerId,
        appointmentType: data.appointmentType,
        scheduledAt: new Date(data.scheduledAt),
        durationMinutes: data.durationMinutes,
        status: "scheduled",
        reason: data.reason,
        createdBy,
      });

      toast.push({
        id: Date.now().toString(),
        title: "Appointment scheduled successfully",
      });
      setShowForm(false);
      reset();
      await loadAppointments();
    } catch (error) {
      console.error("Failed to create appointment:", error);
      toast.push({
        id: Date.now().toString(),
        title: "Failed to schedule appointment",
      });
    }
  };

  const handleStatusChange = async (
    appointmentId: string,
    newStatus: string,
  ) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await updateAppointmentStatus(appointmentId, newStatus as any);
      toast.push({
        id: Date.now().toString(),
        title: `Appointment ${newStatus}`,
      });
      await loadAppointments();
    } catch (error) {
      console.error("Failed to update appointment:", error);
      toast.push({
        id: Date.now().toString(),
        title: "Failed to update appointment",
      });
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "scheduled":
        return "bg-blue-100 text-blue-800";
      case "confirmed":
        return "bg-green-100 text-green-800";
      case "arrived":
        return "bg-purple-100 text-purple-800";
      case "in-progress":
        return "bg-yellow-100 text-yellow-800";
      case "completed":
        return "bg-gray-100 text-gray-800";
      case "no-show":
        return "bg-red-100 text-red-800";
      case "cancelled":
        return "bg-orange-100 text-orange-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow">
        <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <CalendarIcon className="h-6 w-6 text-gray-400 mr-2" />
              <h3 className="text-lg font-medium text-gray-900">
                Appointment Schedule
              </h3>
            </div>
            <div className="flex items-center space-x-2">
              <div className="flex rounded-md shadow-sm">
                <button
                  onClick={() => setViewMode("today")}
                  className={`px-3 py-2 text-sm font-medium rounded-l-md ${
                    viewMode === "today"
                      ? "bg-indigo-600 text-white"
                      : "bg-white text-gray-700 hover:bg-gray-50 border border-gray-300"
                  }`}
                >
                  Today
                </button>
                <button
                  onClick={() => setViewMode("week")}
                  className={`px-3 py-2 text-sm font-medium ${
                    viewMode === "week"
                      ? "bg-indigo-600 text-white"
                      : "bg-white text-gray-700 hover:bg-gray-50 border-t border-b border-gray-300"
                  }`}
                >
                  Week
                </button>
                <button
                  onClick={() => setViewMode("month")}
                  className={`px-3 py-2 text-sm font-medium rounded-r-md ${
                    viewMode === "month"
                      ? "bg-indigo-600 text-white"
                      : "bg-white text-gray-700 hover:bg-gray-50 border border-gray-300"
                  }`}
                >
                  Month
                </button>
              </div>
              <button
                onClick={() => setShowForm(true)}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
              >
                Schedule Appointment
              </button>
            </div>
          </div>
        </div>

        <div className="p-4">
          {appointments.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No appointments scheduled
            </div>
          ) : (
            <div className="space-y-3">
              {appointments.map((appointment) => (
                <div
                  key={appointment.id}
                  className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(
                            appointment.status,
                          )}`}
                        >
                          {appointment.status}
                        </span>
                        <span className="ml-3 text-sm font-medium text-gray-900">
                          {appointment.appointment_type}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center text-sm text-gray-500">
                        <ClockIcon className="flex-shrink-0 mr-1.5 h-4 w-4" />
                        {formatTime(appointment.scheduled_at)} (
                        {appointment.duration_minutes} min)
                      </div>
                      {appointment.reason && (
                        <div className="mt-1 text-sm text-gray-600">
                          {appointment.reason}
                        </div>
                      )}
                    </div>
                    {appointment.status === "scheduled" && (
                      <div className="flex space-x-2 ml-4">
                        <button
                          onClick={() =>
                            handleStatusChange(appointment.id, "confirmed")
                          }
                          className="px-3 py-1 text-xs font-medium text-green-700 bg-green-100 rounded-md hover:bg-green-200"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() =>
                            handleStatusChange(appointment.id, "cancelled")
                          }
                          className="px-3 py-1 text-xs font-medium text-red-700 bg-red-100 rounded-md hover:bg-red-200"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                    {appointment.status === "confirmed" && (
                      <button
                        onClick={() =>
                          handleStatusChange(appointment.id, "arrived")
                        }
                        className="px-3 py-1 text-xs font-medium text-purple-700 bg-purple-100 rounded-md hover:bg-purple-200"
                      >
                        Mark Arrived
                      </button>
                    )}
                    {appointment.status === "arrived" && (
                      <button
                        onClick={() =>
                          handleStatusChange(appointment.id, "in-progress")
                        }
                        className="px-3 py-1 text-xs font-medium text-yellow-700 bg-yellow-100 rounded-md hover:bg-yellow-200"
                      >
                        Start
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-4 py-5 sm:px-6 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-medium text-gray-900">
                Schedule Appointment
              </h3>
              <button
                onClick={() => setShowForm(false)}
                className="text-gray-400 hover:text-gray-500"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>

            <form
              onSubmit={handleSubmit(onSubmit)}
              className="px-4 py-5 sm:p-6 space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Patient ID *
                </label>
                <input
                  {...register("patientId")}
                  type="text"
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  placeholder="Enter patient ID"
                />
                {errors.patientId && (
                  <p className="mt-1 text-sm text-red-600">
                    {errors.patientId.message}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Provider ID *
                </label>
                <input
                  {...register("providerId")}
                  type="text"
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  placeholder="Enter provider ID"
                />
                {errors.providerId && (
                  <p className="mt-1 text-sm text-red-600">
                    {errors.providerId.message}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Appointment Type *
                </label>
                <select
                  {...register("appointmentType")}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                >
                  <option value="">Select type...</option>
                  {appointmentTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
                {errors.appointmentType && (
                  <p className="mt-1 text-sm text-red-600">
                    {errors.appointmentType.message}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Date & Time *
                  </label>
                  <input
                    {...register("scheduledAt")}
                    type="datetime-local"
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  />
                  {errors.scheduledAt && (
                    <p className="mt-1 text-sm text-red-600">
                      {errors.scheduledAt.message}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Duration (minutes) *
                  </label>
                  <select
                    {...register("durationMinutes", { valueAsNumber: true })}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  >
                    <option value={15}>15 minutes</option>
                    <option value={30}>30 minutes</option>
                    <option value={45}>45 minutes</option>
                    <option value={60}>1 hour</option>
                    <option value={90}>1.5 hours</option>
                    <option value={120}>2 hours</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Reason for Visit
                </label>
                <textarea
                  {...register("reason")}
                  rows={3}
                  className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  placeholder="Brief description of the visit reason..."
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
                >
                  Schedule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
