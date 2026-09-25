import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { db } from "@/db";
import type { Patient, Visit, Vital, QueueItem } from "@/db";
import { useAuthStore } from "@/stores/auth";
import { can } from "@/auth/roles";
import { queueManagement } from "@/services/queueManagement";
import {
  classifyBloodPressure,
  classifyPulse,
  classifySpO2,
  classifyTemperature,
  isAbnormalVitalFlag,
} from "@/utils/vitals";
import { findTodaysOpenVisit, ensureTodaysVisit } from "@/services/visits";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge, type Tone } from "@/components/ui/StatusBadge";
import { QueueSkeleton } from "@/components/ui/Skeleton";
import { palaverRoom } from "@/services/palaverRoom";
import { PatientMessagesPanel } from "@/features/doctor/PatientMessagesPanel";
import { PalaverRoom } from "@/features/doctor/PalaverRoom";
import { supabase } from "@/lib/supabase";
import { getPendingTelevisitRequests } from "@/services/televisits";
import {
  ClockIcon,
  CheckCircleIcon,
  ChatBubbleLeftRightIcon,
  InboxIcon,
  VideoCameraIcon,
} from "@heroicons/react/24/outline";

interface PatientInQueue extends QueueItem {
  patient?: Patient;
  latestVitals?: Vital;
  openVisit?: Visit;
}

/** Latest vitals with abnormal readings as labelled badges. */
function VitalsLine({ v }: { v?: Vital }) {
  if (!v) return <span className="text-caption text-warning-fg">No vitals recorded</span>;
  const bp = classifyBloodPressure(v.systolic, v.diastolic);
  const temp = classifyTemperature(v.tempC);
  const pulse = classifyPulse(v.pulseBpm);
  const spo2 = classifySpO2(v.spo2);
  const parts: { key: string; text: string; tone?: Tone }[] = [];
  if (v.systolic && v.diastolic)
    parts.push({ key: "bp", text: `BP ${v.systolic}/${v.diastolic}`, tone: bp && bp.tone !== "success" ? bp.tone : undefined });
  if (v.tempC) parts.push({ key: "t", text: `${v.tempC} °C`, tone: temp && temp.tone !== "success" ? temp.tone : undefined });
  if (v.pulseBpm) parts.push({ key: "p", text: `${v.pulseBpm} bpm`, tone: pulse && pulse.tone !== "success" ? pulse.tone : undefined });
  if (v.spo2) parts.push({ key: "s", text: `SpO₂ ${v.spo2}%`, tone: spo2 && spo2.tone !== "success" ? spo2.tone : undefined });
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-caption tabular-nums text-ink-secondary">
      {parts.map((p) =>
        p.tone ? (
          <StatusBadge key={p.key} tone={p.tone}>
            {p.text}
          </StatusBadge>
        ) : (
          <span key={p.key}>{p.text}</span>
        ),
      )}
    </span>
  );
}

export function DoctorDashboard() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const [queuePatients, setQueuePatients] = useState<PatientInQueue[]>([]);
  const [stats, setStats] = useState({
    waiting: 0,
    inProgress: 0,
    completed: 0,
  });
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [showPalaverRoom, setShowPalaverRoom] = useState(false);
  const [showPatientMessages, setShowPatientMessages] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [unreadPatientMessages, setUnreadPatientMessages] = useState(0);
  const [pendingTelevisits, setPendingTelevisits] = useState(0);
  const userId = currentUser?.id;
  const navigate = useNavigate();
  const [actionError, setActionError] = useState("");

  const loadUnreadCount = useCallback(async () => {
    if (!userId) return;
    try {
      const count = await palaverRoom.getUnreadCount(userId);
      setUnreadMessages(count);
    } catch (err) {
      console.error(
        "Failed to load unread Palaver Room count:",
        err instanceof Error ? err.name : err,
      );
    }
  }, [userId]);

  const loadUnreadPatientMessages = useCallback(async () => {
    if (!supabase) return;
    try {
      // Same rule as the Patient messages panel: unread messages from
      // patients, not archived.
      const { count, error } = await supabase
        .from("patient_secure_messages")
        .select("*", { count: "exact", head: true })
        .eq("from_patient", true)
        .eq("read", false)
        .eq("is_archived", false);
      if (error) {
        // Keep the last known count rather than showing 0 when the check
        // fails. Log the error code only: server messages can echo data.
        console.error(
          "Failed to load unread patient message count:",
          error.code || "query error",
        );
        return;
      }
      setUnreadPatientMessages(count || 0);
    } catch (err) {
      console.error(
        "Failed to load unread patient message count:",
        err instanceof Error ? err.name : err,
      );
    }
  }, []);

  const loadPendingTelevisits = useCallback(async () => {
    if (!supabase) return;
    try {
      const requests = await getPendingTelevisitRequests();
      setPendingTelevisits(requests.length);
    } catch (err) {
      console.error(
        "Failed to load pending televisit count:",
        err instanceof Error ? err.name : err,
      );
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

            // Latest by time taken (primary-key order is not time order).
            const vitals = (
              await db.vitals.where("patientId").equals(item.patientId).toArray()
            ).sort(
              (a, b) => new Date(b.takenAt).getTime() - new Date(a.takenAt).getTime(),
            )[0];

            const openVisit = await findTodaysOpenVisit(item.patientId);

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
        setLoadFailed(false);
      } catch (error) {
        setLoadFailed(true);
        console.error(
          "Error loading doctor dashboard:",
          error instanceof Error ? error.name : error,
        );
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
    loadPendingTelevisits();

    const interval = setInterval(() => loadDashboardData(false), 10000);
    const messageInterval = setInterval(loadUnreadCount, 30000);
    const patientMsgInterval = setInterval(loadUnreadPatientMessages, 30000);
    const televisitInterval = setInterval(loadPendingTelevisits, 30000);

    return () => {
      clearInterval(interval);
      clearInterval(messageInterval);
      clearInterval(patientMsgInterval);
      clearInterval(televisitInterval);
    };
  }, [
    userId,
    loadDashboardData,
    loadUnreadCount,
    loadUnreadPatientMessages,
    loadPendingTelevisits,
  ]);

  // Starting or opening a consultation writes to this device (queue status,
  // today's visit), so the role is checked here as well as by the route.
  const mayConsult = () => {
    if (currentUser && can(currentUser.role, "consult")) return true;
    setActionError("Your role cannot start or open a consultation. Ask a doctor to see this patient.");
    return false;
  };

  const handleStartConsultation = async (item: PatientInQueue) => {
    if (!mayConsult()) return;
    try {
      await queueManagement.startService(
        item.id,
        currentUser ? { id: currentUser.id, name: currentUser.fullName } : undefined,
      );
      await loadDashboardData();
    } catch (error) {
      console.error(
        "Error starting consultation:",
        error instanceof Error ? error.name : error,
      );
    }
  };

  const getWaitTime = (updatedAt: Date) => {
    const now = new Date();
    const diff = now.getTime() - new Date(updatedAt).getTime();
    const minutes = Math.floor(diff / 60000);

    if (minutes < 60) return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  };

  const openConsultation = async (item: PatientInQueue) => {
    if (!mayConsult()) return;
    setActionError("");
    try {
      const visit = await ensureTodaysVisit(item.patientId);
      navigate(`/consult/${visit.id}`);
    } catch (error) {
      console.error("Could not open consultation:", error instanceof Error ? error.name : error);
      setActionError("Could not open the consultation on this device. Try again.");
    }
  };

  // Closing a drawer (Close button, Escape or the backdrop) re-checks the
  // header badge so it matches what was read or archived in the drawer.
  const closePatientMessages = () => {
    setShowPatientMessages(false);
    void loadUnreadPatientMessages();
  };

  const closePalaverRoom = () => {
    setShowPalaverRoom(false);
    void loadUnreadCount();
  };

  const startAndOpen = async (item: PatientInQueue) => {
    await handleStartConsultation(item);
    await openConsultation(item);
  };

  // The paediatric-chart prompt alone does not make a reading abnormal.
  const isAbnormal = (v?: Vital) =>
    !!v && Array.isArray(v.flags) && v.flags.some(isAbnormalVitalFlag);

  if (loading) {
    return (
      <div>
        <PageHeader title="Doctor station" />
        <QueueSkeleton />
      </div>
    );
  }

  const inProgress = queuePatients.filter((p) => p.status === "in_progress");
  const waiting = queuePatients.filter((p) => p.status === "waiting");
  const abnormalWaiting = waiting.filter((p) => isAbnormal(p.latestVitals)).length;
  const name = (p: PatientInQueue) =>
    p.patient ? `${p.patient.givenName} ${p.patient.familyName}` : "Unknown patient";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Doctor station"
        description="Patients waiting for consultation, and messages that need a reply."
        actions={
          <>
            <button type="button" onClick={() => setShowPatientMessages(true)} className="btn-secondary">
              <InboxIcon className="h-5 w-5" aria-hidden />
              Patient messages
              {unreadPatientMessages > 0 && (
                <span className="badge badge-danger">
                  {unreadPatientMessages}
                  <span className="sr-only"> unread</span>
                </span>
              )}
            </button>
            <button type="button" onClick={() => setShowPalaverRoom(true)} className="btn-secondary">
              <ChatBubbleLeftRightIcon className="h-5 w-5" aria-hidden />
              Palaver Room
              {unreadMessages > 0 && (
                <span className="badge badge-danger">
                  {unreadMessages}
                  <span className="sr-only"> unread</span>
                </span>
              )}
            </button>
            <Link to="/televisits" className="btn-secondary">
              <VideoCameraIcon className="h-5 w-5" aria-hidden />
              Televisits
              {pendingTelevisits > 0 && <span className="badge badge-warning">{pendingTelevisits} to schedule</span>}
            </Link>
          </>
        }
      />

      {actionError && (
        <div className="banner banner-danger" role="alert">
          {actionError}
        </div>
      )}

      {loadFailed && (
        <div className="banner banner-warning" role="status">
          Could not read the consultation queue on this device. The list below may be out of date; it will try again in a few seconds.
        </div>
      )}

      <dl className="panel grid grid-cols-2 divide-line sm:grid-cols-4 sm:divide-x">
        {[
          { label: "Waiting", value: stats.waiting },
          { label: "With a clinician", value: stats.inProgress },
          { label: "Waiting with abnormal vitals", value: abnormalWaiting, warn: abnormalWaiting > 0 },
          { label: "Completed today", value: stats.completed },
        ].map((m) => (
          <div key={m.label} className="px-4 py-3">
            <dt className="text-caption text-ink-muted">{m.label}</dt>
            <dd className={`mt-0.5 text-stat tabular-nums ${m.warn ? "text-warning-fg" : "text-ink"}`}>{m.value}</dd>
          </div>
        ))}
      </dl>

      {inProgress.length > 0 && (
        <section className="panel" aria-labelledby="with-you">
          <div className="panel-header">
            <h2 id="with-you" className="panel-title">
              In consultation
            </h2>
          </div>
          <ul className="divide-y divide-line">
            {inProgress.map((item) => (
              <li key={item.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                <span className="w-16 shrink-0 font-mono text-h3 tabular-nums">{item.ticketNumber ?? `#${item.position}`}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-ink">{name(item)}</span>
                  <span className="block text-caption text-ink-muted">
                    {item.assignedName ? `With ${item.assignedName} · ` : ""}for {getWaitTime(item.updatedAt)}
                  </span>
                  <VitalsLine v={item.latestVitals} />
                </span>
                <span className="flex gap-2">
                  <button type="button" onClick={() => openConsultation(item)} className="btn-primary">
                    Continue consultation
                  </button>
                  <Link to={`/patients/${item.patientId}`} className="btn-secondary">
                    Record
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel" aria-labelledby="waiting-consult">
        <div className="panel-header">
          <h2 id="waiting-consult" className="panel-title">
            Waiting for consultation ({waiting.length})
          </h2>
        </div>
        {waiting.length === 0 && loadFailed ? (
          <p className="px-4 py-6 text-body text-ink-muted">The queue could not be read on this device yet.</p>
        ) : waiting.length === 0 ? (
          <EmptyState
            icon={CheckCircleIcon}
            title="No patients waiting for consultation"
            description="Patients appear here after their vitals are recorded."
          />
        ) : (
          <ul className="divide-y divide-line">
            {waiting.map((item, idx) => (
              <li key={item.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                <span className="w-16 shrink-0 font-mono text-label tabular-nums text-ink">{item.ticketNumber ?? `#${item.position}`}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{name(item)}</span>
                    {item.priority === "urgent" && <StatusBadge tone="danger">Urgent</StatusBadge>}
                  </span>
                  <VitalsLine v={item.latestVitals} />
                </span>
                <span className="flex items-center gap-3">
                  <span className="flex items-center gap-1 text-caption tabular-nums text-ink-muted">
                    <ClockIcon className="h-4 w-4" aria-hidden />
                    {getWaitTime(item.queuedAt ?? item.updatedAt)}
                  </span>
                  {idx === 0 && inProgress.length === 0 ? (
                    <button type="button" onClick={() => startAndOpen(item)} className="btn-primary">
                      Start consultation
                    </button>
                  ) : (
                    <Link to={`/patients/${item.patientId}`} className="btn-ghost">
                      Record
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {showPatientMessages && (
        <>
          <div className="fixed inset-0 z-40 bg-ink/40" onClick={closePatientMessages} aria-hidden />
          <div className="fixed bottom-0 right-0 top-0 z-50 w-full max-w-md shadow-2xl">
            <PatientMessagesPanel
              onClose={closePatientMessages}
              onUnreadChange={setUnreadPatientMessages}
            />
          </div>
        </>
      )}

      {showPalaverRoom && (
        <>
          <div className="fixed inset-0 z-40 bg-ink/40" onClick={closePalaverRoom} aria-hidden />
          <div className="fixed bottom-0 right-0 top-0 z-50 w-full max-w-md shadow-2xl">
            <PalaverRoom
              onClose={closePalaverRoom}
              isPanel
              onUnreadChange={setUnreadMessages}
            />
          </div>
        </>
      )}
    </div>
  );
}
