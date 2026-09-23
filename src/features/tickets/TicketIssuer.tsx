import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, generateId } from "@/db";
import type { Patient, QueueItem } from "@/db";
import { queueManagement } from "@/services/queueManagement";
import { PatientSearch } from "@/components/PatientSearch";
import {
  ExclamationTriangleIcon,
  InformationCircleIcon,
  PrinterIcon,
  QueueListIcon,
  UserIcon,
} from "@heroicons/react/24/outline";
import { useAuthStore } from "@/stores/auth";
import { usePatientsStore } from "@/stores/patients";
import { useToast } from "@/stores/toast";
import { isSupabaseEnabled } from "@/lib/supabaseClient";
import { useActiveSite } from "@/hooks/useActiveSite";
import { DEFAULT_SITE_NAME } from "@/services/activeSite";
import {
  FLOW_STAGES,
  FLOW_STAGE_LABELS,
  type FlowStage,
} from "@/services/patientFlow";
import { formatNigerianDate } from "@/utils/dateFormat";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  canManageQueue,
  countByStage,
  isFlowStage,
  isTicketPriority,
  issueErrorMessage,
  savedNote,
  ticketLabel,
  type TicketPriority,
} from "./queueBoardModel";
import { STAGE_CHIP_CLASS, STAGE_MARKER_CLASS } from "./stageStyles";
import { printTicket } from "./ticketPrint";

const STAGE_OPTION_LABEL: Record<FlowStage, string> = {
  registration: "Registration",
  vitals: "Vitals (recommended)",
  consult: "Consultation",
  pharmacy: "Pharmacy",
};

// Urgent tickets are not always placed first (see queueManagement
// calculatePosition), so the hint must not promise the front of the line.
const PRIORITY_HINT: Record<TicketPriority, string> = {
  urgent:
    "The ticket is flagged urgent. It is not always placed first: to call the patient next, use Move to front on the queue page.",
  normal: "The patient is added to the end of the queue.",
  low: "For non-critical cases. The patient is added to the end of the queue.",
};

const STAGE_NEXT: Record<FlowStage, string> = {
  registration:
    "The patient joins the registration queue and waits to be registered.",
  vitals:
    "The patient joins the vitals queue. After vitals are recorded they move to consultation automatically.",
  consult:
    "The patient joins the consultation queue and appears in the Doctor Station straight away.",
  pharmacy:
    "The patient joins the pharmacy queue and waits for their medicines.",
};

interface IssuedTicket {
  queueItemId: string;
  ticketNumber: string;
  stage: FlowStage;
  priority: TicketPriority;
  position: number;
  patientName: string;
  issuedAt: Date;
}

export default function TicketIssuer() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const canIssue = canManageQueue(currentUser?.role);
  const loadPatients = usePatientsStore((s) => s.loadPatients);
  const { push } = useToast();
  const { site } = useActiveSite();
  const siteName = site?.name ?? DEFAULT_SITE_NAME;

  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [stage, setStage] = useState<FlowStage>("vitals");
  const [priority, setPriority] = useState<TicketPriority>("normal");
  const [saving, setSaving] = useState(false);
  // A second click can land before React re-renders the disabled button;
  // this ref makes sure only one ticket is created.
  const savingRef = useRef(false);
  const [error, setError] = useState("");
  const [lastIssued, setLastIssued] = useState<IssuedTicket | null>(null);
  const [printError, setPrintError] = useState("");

  useEffect(() => {
    loadPatients().catch((err: unknown) => {
      console.error(
        "Failed to load patients:",
        err instanceof Error ? err.name : err,
      );
      setError("The patient list could not be loaded. Reload the page and try again.");
    });
  }, [loadPatients]);

  const selectedId = selectedPatient?.id;
  // Warn before issuing a second ticket for someone already queued.
  const activeTicket: QueueItem | undefined = useLiveQuery(
    () =>
      selectedId
        ? db.queue
            .where("patientId")
            .equals(selectedId)
            .and((q: QueueItem) => q.status !== "done")
            .first()
        : undefined,
    [selectedId],
  );

  // Real sync state of the last ticket: the row stays dirty until the sync
  // adapter has uploaded it.
  const issuedId = lastIssued?.queueItemId;
  const issuedRow: QueueItem | undefined = useLiveQuery(
    () => (issuedId ? db.queue.get(issuedId) : undefined),
    [issuedId],
  );
  // useLiveQuery keeps the previous result until the new query answers, so
  // only trust a row that belongs to the ticket on screen.
  const issuedSyncText =
    !isSupabaseEnabled || !issuedRow || issuedRow.id !== issuedId
      ? ""
      : issuedRow._dirty
        ? " Waiting to sync."
        : " Queue entry synced.";

  // The Issue button disappears when the form resets; move focus to the
  // result so keyboard and screen-reader users are not dropped at the top
  // of the page.
  const issuedHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (issuedId) issuedHeadingRef.current?.focus();
  }, [issuedId]);

  const choosePatient = (patient: Patient | null) => {
    setSelectedPatient(patient);
    setError("");
  };

  async function handleIssue() {
    if (savingRef.current) return;
    if (!selectedPatient) {
      setError("Choose a patient first.");
      return;
    }
    if (!currentUser) {
      setError("Your session has ended. Sign in again to issue tickets.");
      return;
    }
    if (!canManageQueue(currentUser.role)) {
      setError("Your role cannot issue tickets. Ask a registration volunteer, nurse or doctor.");
      return;
    }

    const patient = selectedPatient;
    const chosenStage = stage;
    const chosenPriority = priority;
    savingRef.current = true;
    setSaving(true);
    setError("");
    setPrintError("");

    try {
      const item = await queueManagement.addToQueue(
        patient.id,
        chosenStage,
        chosenPriority,
        currentUser.id,
      );
      const issued: IssuedTicket = {
        queueItemId: item.id,
        ticketNumber: ticketLabel(item),
        stage: chosenStage,
        priority: chosenPriority,
        position: item.position,
        patientName: `${patient.givenName} ${patient.familyName}`,
        issuedAt: new Date(),
      };
      setLastIssued(issued);
      push({
        id: generateId(),
        tone: "success",
        title: `Ticket ${issued.ticketNumber} issued`,
        body: `Added to the ${FLOW_STAGE_LABELS[chosenStage].toLowerCase()} queue at position ${item.position}. ${savedNote(isSupabaseEnabled)}`,
      });
      // Ready for the next patient straight away.
      setSelectedPatient(null);
      setStage("vitals");
      setPriority("normal");
    } catch (err) {
      console.error(
        "Could not issue ticket:",
        err instanceof Error ? err.name : err,
      );
      setError(issueErrorMessage(err));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const handlePrint = () => {
    if (!lastIssued) return;
    setPrintError("");
    try {
      printTicket({
        ticketNumber: lastIssued.ticketNumber,
        destination: FLOW_STAGE_LABELS[lastIssued.stage],
        siteName,
        issuedAt: lastIssued.issuedAt,
      });
    } catch (err) {
      console.error(
        "Could not open the print dialog:",
        err instanceof Error ? err.name : err,
      );
      setPrintError("This browser could not open printing. Write the ticket number down for the patient instead.");
    }
  };

  // While saving, the new row can appear in the live query before the form
  // resets; do not flash "already in the queue" for the ticket being issued.
  // Also ignore a result left over from the previously selected patient.
  const alreadyQueued =
    !saving &&
    !!selectedPatient &&
    !!activeTicket &&
    activeTicket.patientId === selectedPatient.id;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Issue ticket"
        description="Find the patient, choose where they go first, and give them the ticket number."
        actions={
          <Link to="/queue" className="btn-secondary">
            <QueueListIcon className="h-4 w-4" aria-hidden />
            View queue
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {/* Not a <form>: choosing a PatientSearch result must never submit
            (and issue) a ticket, whatever type its buttons have. */}
        <section className="panel self-start" aria-labelledby="ticket-form-title">
          <div className="panel-header">
            <h2 id="ticket-form-title" className="panel-title">
              New ticket
            </h2>
          </div>
          <div className="panel-body space-y-5">
            {!canIssue && (
              <div className="banner banner-warning" role="status">
                <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
                <span>
                  Your role can view this page but cannot issue tickets.
                </span>
              </div>
            )}

            {error && (
              <div className="banner banner-danger" role="alert">
                <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
                <span>{error}</span>
              </div>
            )}

            {/* Patient */}
            <div role="group" aria-labelledby="ticket-patient-label">
              <p id="ticket-patient-label" className="field-label">
                Patient
              </p>
              {selectedPatient ? (
                <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-sunken p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    {selectedPatient.photoUrl ? (
                      <img
                        src={selectedPatient.photoUrl}
                        alt=""
                        className="h-12 w-12 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface-hover">
                        <UserIcon className="h-6 w-6 text-ink-muted" aria-hidden />
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-h3 text-ink">
                        {selectedPatient.givenName} {selectedPatient.familyName}
                      </p>
                      <p className="text-caption text-ink-muted">
                        <span className="capitalize">{selectedPatient.sex}</span>
                        {selectedPatient.dob
                          ? ` · Born ${formatNigerianDate(selectedPatient.dob)}`
                          : ""}
                        {selectedPatient.phone ? ` · ${selectedPatient.phone}` : ""}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => choosePatient(null)}
                    className="btn-secondary"
                    aria-label={`Change patient (currently ${selectedPatient.givenName} ${selectedPatient.familyName})`}
                  >
                    Change patient
                  </button>
                </div>
              ) : (
                <>
                  <PatientSearch
                    onPatientSelect={(patient) => choosePatient(patient)}
                    placeholder="Search by name or phone"
                    labelledBy="ticket-patient-label"
                  />
                  <p className="field-hint">
                    Start typing to search patients on this device. Not
                    registered yet?{" "}
                    <Link to="/register" className="font-medium text-primary-fg hover:underline">
                      Register the patient
                    </Link>
                    .
                  </p>
                </>
              )}
            </div>

            {alreadyQueued && activeTicket && (
              <div className="banner banner-warning" role="status">
                <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
                <span>
                  Already in the queue: ticket{" "}
                  <strong className="font-semibold">{ticketLabel(activeTicket)}</strong>{" "}
                  at {FLOW_STAGE_LABELS[activeTicket.stage].toLowerCase()} (
                  {activeTicket.status === "in_progress" ? "being served" : "waiting"}
                  ). A second ticket cannot be issued.{" "}
                  <Link to="/queue" className="font-medium underline">
                    Open the queue
                  </Link>
                </span>
              </div>
            )}

            {selectedPatient && !alreadyQueued && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="ticket-stage" className="field-label">
                      First stop
                    </label>
                    <select
                      id="ticket-stage"
                      value={stage}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (isFlowStage(v)) setStage(v);
                      }}
                      className="input-field"
                    >
                      {FLOW_STAGES.map((s) => (
                        <option key={s} value={s}>
                          {STAGE_OPTION_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="ticket-priority" className="field-label">
                      Priority
                    </label>
                    <select
                      id="ticket-priority"
                      value={priority}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (isTicketPriority(v)) setPriority(v);
                      }}
                      aria-describedby="ticket-priority-hint"
                      className="input-field"
                    >
                      <option value="normal">Normal</option>
                      <option value="urgent">Urgent</option>
                      <option value="low">Low priority</option>
                    </select>
                    <p id="ticket-priority-hint" className="field-hint">
                      {PRIORITY_HINT[priority]}
                    </p>
                  </div>
                </div>

                <div className="banner banner-info">
                  <InformationCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
                  <div>
                    <p className="font-medium">What happens next</p>
                    <p>{STAGE_NEXT[stage]}</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => void handleIssue()}
                  disabled={saving || !canIssue}
                  className="btn-primary w-full"
                >
                  {saving
                    ? "Issuing ticket…"
                    : `Issue ticket for ${FLOW_STAGE_LABELS[stage]}`}
                </button>
              </>
            )}
          </div>
        </section>

        {/* Result + queue status */}
        <div className="space-y-4">
          {lastIssued && (
            <section className="panel" aria-labelledby="ticket-issued-title">
              <div className="panel-header">
                <h2
                  id="ticket-issued-title"
                  ref={issuedHeadingRef}
                  tabIndex={-1}
                  className="panel-title"
                >
                  Last ticket issued
                </h2>
                <StatusBadge tone="success" icon>
                  Saved on this device
                </StatusBadge>
              </div>
              <div className="panel-body text-center">
                <p className="section-label">Ticket number</p>
                <p className="mt-1 text-6xl font-bold tabular-nums tracking-tight text-ink">
                  {lastIssued.ticketNumber}
                </p>
                <p className="mt-3">
                  <span
                    className={`inline-flex items-center gap-2 rounded-md border px-3 py-1 text-label ${STAGE_CHIP_CLASS[lastIssued.stage]}`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${STAGE_MARKER_CLASS[lastIssued.stage]}`}
                      aria-hidden
                    />
                    Go to {FLOW_STAGE_LABELS[lastIssued.stage]}
                  </span>
                </p>
                <p className="mt-3 text-body text-ink-secondary">
                  {lastIssued.patientName} · position {lastIssued.position} when issued
                </p>
                {lastIssued.priority === "urgent" && (
                  <p className="mt-2">
                    <StatusBadge tone="danger">Marked urgent</StatusBadge>
                  </p>
                )}
                <p className="field-hint">
                  Issued at{" "}
                  {lastIssued.issuedAt.toLocaleTimeString("en-NG", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  .{issuedSyncText}
                </p>
                <button
                  type="button"
                  onClick={handlePrint}
                  className="btn-secondary mt-4"
                >
                  <PrinterIcon className="h-5 w-5" aria-hidden />
                  Print ticket {lastIssued.ticketNumber}
                </button>
                <p className="field-hint">
                  The printed slip shows the ticket number, destination and
                  site only.
                </p>
                {printError && (
                  <p className="field-error" role="alert">
                    {printError}
                  </p>
                )}
              </div>
            </section>
          )}

          <QueueStats />
        </div>
      </div>
    </div>
  );
}

function QueueStats() {
  // A failed read shows a message here instead of taking the whole issuing
  // page down with it.
  const result: { items: QueueItem[]; failed: boolean } | undefined =
    useLiveQuery(async () => {
      try {
        const items = await db.queue
          .where("status")
          .anyOf(["waiting", "in_progress"])
          .toArray();
        return { items, failed: false };
      } catch (err) {
        console.error(
          "Queue counts could not be read:",
          err instanceof Error ? err.name : err,
        );
        return { items: [], failed: true };
      }
    }, []);
  const counts = useMemo(
    () =>
      result && !result.failed ? countByStage(result.items, Date.now()) : null,
    [result],
  );

  return (
    <section className="panel" aria-labelledby="ticket-queue-status-title">
      <div className="panel-header">
        <h2 id="ticket-queue-status-title" className="panel-title">
          Queue now
        </h2>
      </div>
      {result?.failed ? (
        <p className="panel-body text-body text-ink-muted" role="status">
          Queue counts could not be read on this device. Reload the page to
          try again.
        </p>
      ) : !counts ? (
        <div className="grid grid-cols-2 gap-3 p-4" aria-busy="true">
          <span role="status" className="sr-only">
            Loading queue counts
          </span>
          {FLOW_STAGES.map((s) => (
            <Skeleton key={s} className="h-16" />
          ))}
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-b-lg bg-line">
          {FLOW_STAGES.map((s) => (
            <li key={s} className="bg-surface px-4 py-3">
              <span className="flex items-center gap-2 text-label text-ink">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${STAGE_MARKER_CLASS[s]}`}
                  aria-hidden
                />
                {FLOW_STAGE_LABELS[s]}
              </span>
              <span className="mt-1 flex items-baseline gap-1.5">
                <span className="text-stat text-ink">{counts[s].waiting}</span>
                <span className="text-caption text-ink-muted">waiting</span>
              </span>
              <span className="block text-caption text-ink-muted">
                {counts[s].inService} being served
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
