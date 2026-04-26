import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { db } from "@/db";
import type { Patient, Visit, Vital, QueueItem } from "@/db";
import { useAuthStore } from "@/stores/auth";
import { queueManagement } from "@/services/queueManagement";
import { getFlagColor } from "@/utils/vitals";
import { palaverRoom } from "@/services/palaverRoom";
import { PatientMessagesPanel } from "@/features/doctor/PatientMessagesPanel";
import { PalaverRoom } from "@/features/doctor/PalaverRoom";
import { supabase } from "@/lib/supabase";
import {
  UserIcon,
  ClockIcon,
  ChartBarIcon,
  CheckCircleIcon,
  HeartIcon,
  ChatBubbleLeftRightIcon,
  InboxIcon,
} from "@heroicons/react/24/outline";

interface PatientInQueue extends QueueItem {
  patient?: Patient;
  latestVitals?: Vital;
  openVisit?: Visit;
}

export function DoctorDashboard() {
  const { currentUser } = useAuthStore();
  const [queuePatients, setQueuePatients] = useState<PatientInQueue[]>([]);
  const [stats, setStats] = useState({
    waiting: 0,
    inProgress: 0,
    completed: 0,
  });
  const [loading, setLoading] = useState(true);
  const [showPalaverRoom, setShowPalaverRoom] = useState(false);
  const [showPatientMessages, setShowPatientMessages] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [unreadPatientMessages, setUnreadPatientMessages] = useState(0);
  const userId = currentUser?.id;

  const loadUnreadCount = useCallback(async () => {
    if (!userId) return;
    try {
      const count = await palaverRoom.getUnreadCount(userId);
      setUnreadMessages(count);
    } catch (err) {
      console.error("Failed to load unread Palaver Room count:", err);
    }
  }, [userId]);

  const loadUnreadPatientMessages = useCallback(async () => {
    if (!supabase) return;
    try {
      const { count } = await supabase
        .from("patient_secure_messages")
        .select("*", { count: "exact", head: true })
        .eq("from_patient", true)
        .eq("read", false);
      setUnreadPatientMessages(count || 0);
    } catch (err) {
      console.error("Failed to load unread patient message count:", err);
    }
  }, []);

  const loadDashboardData = useCallback(
    async (isInitial = false) => {
      if (!userId) return;

      try {
        if (isInitial) {
          setLoading(true);
        }

        const queue = await db.queue
          .where("stage")
          .equals("consult")
          .and((item) => item.status !== "done")
          .toArray();

        const allConsultItems = await db.queue
          .where("stage")
          .equals("consult")
          .toArray();

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const todayItems = allConsultItems.filter((item) => {
          const itemDate = new Date(item.updatedAt);
          itemDate.setHours(0, 0, 0, 0);
          return itemDate.getTime() === today.getTime();
        });

        setStats({
          waiting: queue.filter((i) => i.status === "waiting").length,
          inProgress: queue.filter((i) => i.status === "in_progress").length,
          completed: todayItems.filter((i) => i.status === "done").length,
        });

        const patientsWithData = await Promise.all(
          queue.map(async (item) => {
            const patient = await db.patients.get(item.patientId);

            const vitals = await db.vitals
              .where("patientId")
              .equals(item.patientId)
              .reverse()
              .first();

            const openVisit = await db.visits
              .where("patientId")
              .equals(item.patientId)
              .and((v) => v.status === "open")
              .first();

            return {
              ...item,
              patient,
              latestVitals: vitals,
              openVisit,
            };
          }),
        );

        patientsWithData.sort((a, b) => a.position - b.position);

        setQueuePatients(patientsWithData);
      } catch (error) {
        console.error("Error loading doctor dashboard:", error);
      } finally {
        if (isInitial) {
          setLoading(false);
        }
      }
    },
    [userId],
  );

  useEffect(() => {
    if (!userId) return;

    loadDashboardData(true);
    loadUnreadCount();
    loadUnreadPatientMessages();

    const interval = setInterval(() => loadDashboardData(false), 10000);
    const messageInterval = setInterval(loadUnreadCount, 30000);
    const patientMsgInterval = setInterval(loadUnreadPatientMessages, 30000);

    return () => {
      clearInterval(interval);
      clearInterval(messageInterval);
      clearInterval(patientMsgInterval);
    };
  }, [userId, loadDashboardData, loadUnreadCount, loadUnreadPatientMessages]);

  const handleStartConsultation = async (item: PatientInQueue) => {
    try {
      await queueManagement.startService(item.id);
      await loadDashboardData();
    } catch (error) {
      console.error("Error starting consultation:", error);
    }
  };

  const getWaitTime = (updatedAt: Date) => {
    const now = new Date();
    const diff = now.getTime() - new Date(updatedAt).getTime();
    const minutes = Math.floor(diff / 60000);

    if (minutes < 60) return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  };

  const getVitalsFlags = (vitals?: Vital) => {
    if (!vitals || !vitals.flags || vitals.flags.length === 0) {
      return null;
    }

    return (
      <div className="flex flex-wrap gap-1 mt-2">
        {vitals.flags.map((flag, idx) => (
          <span
            key={idx}
            className={`text-xs px-2 py-0.5 rounded-full ${getFlagColor(flag)}`}
          >
            {flag}
          </span>
        ))}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading consultation queue...</p>
        </div>
      </div>
    );
  }

  const waiting = queuePatients.filter((item) => item.status === "waiting");
  const inProgress = queuePatients.find(
    (item) => item.status === "in_progress",
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Doctor Consultation Station
          </h1>
          <p className="text-gray-600">
            {currentUser?.fullName || "Doctor"} - Consultation Queue
          </p>
        </div>
        <div className="flex items-center gap-4">
          {/* Patient Messages Button */}
          <button
            onClick={() => setShowPatientMessages(true)}
            className="relative flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
          >
            <InboxIcon className="h-5 w-5" />
            <span className="font-medium">Patient Messages</span>
            {unreadPatientMessages > 0 && (
              <span className="absolute -top-2 -right-2 px-2 py-0.5 bg-red-500 text-white text-xs font-bold rounded-full min-w-[20px] text-center">
                {unreadPatientMessages}
              </span>
            )}
          </button>

          {/* Palaver Room Button */}
          <button
            onClick={() => setShowPalaverRoom(true)}
            className="relative flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors shadow-sm"
          >
            <ChatBubbleLeftRightIcon className="h-5 w-5" />
            <span className="font-medium">Palaver Room</span>
            {unreadMessages > 0 && (
              <span className="absolute -top-2 -right-2 px-2 py-0.5 bg-red-500 text-white text-xs font-bold rounded-full min-w-[20px] text-center">
                {unreadMessages}
              </span>
            )}
          </button>

          {/* Stats */}
          <div className="flex items-center space-x-4 bg-white rounded-lg shadow-sm p-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {stats.waiting}
              </div>
              <div className="text-xs text-gray-600">Waiting</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-yellow-600">
                {stats.inProgress}
              </div>
              <div className="text-xs text-gray-600">In Progress</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {stats.completed}
              </div>
              <div className="text-xs text-gray-600">Completed Today</div>
            </div>
          </div>
        </div>
      </div>

      {/* Patient Messages Sliding Panel */}
      {showPatientMessages && (
        <>
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-40"
            onClick={() => setShowPatientMessages(false)}
          />
          <div className="fixed right-0 top-0 bottom-0 w-full max-w-md z-50 shadow-2xl">
            <PatientMessagesPanel
              onClose={() => {
                setShowPatientMessages(false);
                loadUnreadPatientMessages();
              }}
            />
          </div>
        </>
      )}

      {/* Palaver Room Sliding Panel */}
      {showPalaverRoom && (
        <>
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-40"
            onClick={() => setShowPalaverRoom(false)}
          />
          <div className="fixed right-0 top-0 bottom-0 w-full max-w-md z-50 shadow-2xl">
            <PalaverRoom
              onClose={() => {
                setShowPalaverRoom(false);
                loadUnreadCount();
              }}
              isPanel
            />
          </div>
        </>
      )}

      {/* Current Patient in Progress */}
      {inProgress && (
        <div className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-6">
          <h3 className="text-sm font-semibold text-yellow-800 mb-3 uppercase">
            Currently Consulting
          </h3>
          <div className="flex items-start justify-between">
            <div className="flex items-start space-x-4 flex-1">
              {inProgress.patient?.photoUrl ? (
                <img
                  src={inProgress.patient.photoUrl}
                  alt={`${inProgress.patient.givenName} ${inProgress.patient.familyName}`}
                  className="w-16 h-16 rounded-full object-cover"
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-yellow-200 flex items-center justify-center">
                  <UserIcon className="h-8 w-8 text-yellow-700" />
                </div>
              )}

              <div className="flex-1">
                <h3 className="text-xl font-semibold text-gray-900">
                  {inProgress.patient?.givenName}{" "}
                  {inProgress.patient?.familyName}
                </h3>
                <p className="text-gray-600 mt-1">
                  {inProgress.patient?.sex} • {inProgress.patient?.dob}
                </p>
                <p className="text-gray-600">{inProgress.patient?.phone}</p>

                {inProgress.latestVitals && (
                  <div className="mt-3 grid grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600">BP:</span>
                      <span className="ml-1 font-medium">
                        {inProgress.latestVitals.systolic}/
                        {inProgress.latestVitals.diastolic}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600">Temp:</span>
                      <span className="ml-1 font-medium">
                        {inProgress.latestVitals.tempC}°C
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600">Pulse:</span>
                      <span className="ml-1 font-medium">
                        {inProgress.latestVitals.pulseBpm} bpm
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600">SpO2:</span>
                      <span className="ml-1 font-medium">
                        {inProgress.latestVitals.spo2}%
                      </span>
                    </div>
                  </div>
                )}

                {getVitalsFlags(inProgress.latestVitals)}
              </div>
            </div>

            <div className="flex flex-col space-y-2">
              <Link
                to={`/consult`}
                state={{
                  patientId: inProgress.patientId,
                  visitId: inProgress.openVisit?.id,
                }}
                className="btn-primary text-sm"
              >
                Continue Consultation
              </Link>
              <Link
                to={`/patients/${inProgress.patientId}`}
                className="btn-secondary text-sm text-center"
              >
                View History
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Waiting Queue */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Waiting Queue ({waiting.length})
        </h3>

        {waiting.length === 0 && !inProgress ? (
          <div className="text-center py-12">
            <CheckCircleIcon className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              Queue Clear
            </h3>
            <p className="text-gray-600">
              No patients waiting for consultation at this time.
            </p>
          </div>
        ) : waiting.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No additional patients waiting. Current patient in progress.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {waiting.map((item) => {
              if (!item.patient) return null;

              const isNext = item.position === 1;

              return (
                <div
                  key={item.id}
                  className={`border-2 rounded-lg p-4 transition-all ${
                    isNext
                      ? "border-green-300 bg-green-50"
                      : "border-gray-200 bg-white hover:border-gray-300"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start space-x-4 flex-1">
                      <div
                        className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg ${
                          isNext ? "bg-green-600" : "bg-gray-500"
                        }`}
                      >
                        {item.position}
                      </div>

                      <div className="flex-1">
                        <div className="flex items-center space-x-3">
                          <h3 className="text-lg font-semibold text-gray-900">
                            {item.patient.givenName} {item.patient.familyName}
                          </h3>
                          <span className="text-sm text-gray-500">
                            {item.patient.sex} • {item.patient.dob}
                          </span>
                        </div>

                        <div className="mt-1 text-sm text-gray-600">
                          <p>{item.patient.phone}</p>
                        </div>

                        {item.latestVitals && (
                          <div className="mt-2 grid grid-cols-4 gap-3 text-sm">
                            <div>
                              <span className="text-gray-600">BP:</span>
                              <span className="ml-1 font-medium">
                                {item.latestVitals.systolic}/
                                {item.latestVitals.diastolic}
                              </span>
                            </div>
                            <div>
                              <span className="text-gray-600">Temp:</span>
                              <span className="ml-1 font-medium">
                                {item.latestVitals.tempC}°C
                              </span>
                            </div>
                            <div>
                              <span className="text-gray-600">Pulse:</span>
                              <span className="ml-1 font-medium">
                                {item.latestVitals.pulseBpm} bpm
                              </span>
                            </div>
                            <div>
                              <span className="text-gray-600">SpO2:</span>
                              <span className="ml-1 font-medium">
                                {item.latestVitals.spo2}%
                              </span>
                            </div>
                          </div>
                        )}

                        {getVitalsFlags(item.latestVitals)}
                      </div>
                    </div>

                    <div className="flex flex-col items-end space-y-2">
                      <div className="flex items-center text-sm text-gray-500">
                        <ClockIcon className="h-4 w-4 mr-1" />
                        {getWaitTime(item.updatedAt)}
                      </div>

                      {isNext && !inProgress && (
                        <button
                          onClick={() => handleStartConsultation(item)}
                          className="btn-primary text-sm"
                        >
                          Start Consultation
                        </button>
                      )}

                      <Link
                        to={`/patients/${item.patientId}`}
                        className="btn-secondary text-sm"
                      >
                        View History
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Quick Actions
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          <button
            onClick={() => setShowPatientMessages(true)}
            className="relative btn-secondary flex flex-col items-center justify-center p-4 h-24 bg-blue-50 border-blue-200 hover:bg-blue-100"
          >
            <InboxIcon className="h-6 w-6 mb-2 text-blue-600" />
            <span className="text-sm text-blue-800">Patient Messages</span>
            {unreadPatientMessages > 0 && (
              <span className="absolute top-2 right-2 px-1.5 py-0.5 bg-red-500 text-white text-xs font-bold rounded-full">
                {unreadPatientMessages}
              </span>
            )}
          </button>
          <button
            onClick={() => setShowPalaverRoom(true)}
            className="relative btn-secondary flex flex-col items-center justify-center p-4 h-24 bg-emerald-50 border-emerald-200 hover:bg-emerald-100"
          >
            <ChatBubbleLeftRightIcon className="h-6 w-6 mb-2 text-emerald-600" />
            <span className="text-sm text-emerald-800">Palaver Room</span>
            {unreadMessages > 0 && (
              <span className="absolute top-2 right-2 px-1.5 py-0.5 bg-red-500 text-white text-xs font-bold rounded-full">
                {unreadMessages}
              </span>
            )}
          </button>
          <Link
            to="/queue"
            className="btn-secondary flex flex-col items-center justify-center p-4 h-24"
          >
            <ChartBarIcon className="h-6 w-6 mb-2" />
            <span className="text-sm">View All Queues</span>
          </Link>
          <Link
            to="/patients"
            className="btn-secondary flex flex-col items-center justify-center p-4 h-24"
          >
            <UserIcon className="h-6 w-6 mb-2" />
            <span className="text-sm">All Patients</span>
          </Link>
          <Link
            to="/vitals"
            className="btn-secondary flex flex-col items-center justify-center p-4 h-24"
          >
            <HeartIcon className="h-6 w-6 mb-2" />
            <span className="text-sm">Record Vitals</span>
          </Link>
          <Link
            to="/pharmacy"
            className="btn-secondary flex flex-col items-center justify-center p-4 h-24"
          >
            <span className="text-lg mb-2">Rx</span>
            <span className="text-sm">Pharmacy</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
