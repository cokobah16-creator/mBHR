import type { ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router-dom";
import { db, type Patient } from "@/db";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PatientFlowStepper } from "@/components/patient/PatientFlowStepper";
import { derivePatientFlow, FLOW_STAGE_LABELS, currentFlowStage } from "@/services/patientFlow";
import { formatPatientId, patientAge } from "@/utils/patient";
import { adultVitalRangesApply, classifyBloodPressure, classifySpO2, classifyTemperature } from "@/utils/vitals";
import { isAllergyActive } from "@/utils/allergyActive";

const SEX_LABEL: Record<string, string> = {
  male: "Male",
  female: "Female",
  other: "Other",
};

interface PatientContextHeaderProps {
  patientId: string;
  /** Visit in progress; enables the flow stepper and visit-scoped vitals. */
  visitId?: string;
  /** Show the registration → pharmacy stepper. */
  showFlow?: boolean;
  /** Link the name to the patient record. */
  linkToRecord?: boolean;
  actions?: ReactNode;
  /** Pre-loaded patient, to avoid a second read when the page has it. */
  patient?: Patient | null;
}

/**
 * Persistent patient identity + critical clinical context. Shown at the top
 * of every screen that acts on a single patient so staff always know who
 * they are documenting for, what they are allergic to, and what is abnormal.
 */
export function PatientContextHeader({
  patientId,
  visitId,
  showFlow = true,
  linkToRecord = false,
  actions,
  patient: providedPatient,
}: PatientContextHeaderProps) {
  const data = useLiveQuery(async () => {
    const [patient, allergies, vitals, visit, consultations, dispenses, queue] =
      await Promise.all([
        providedPatient ? Promise.resolve(providedPatient) : db.patients.get(patientId),
        db.patientAllergies
          .where("patientId")
          .equals(patientId)
          .filter((a) => isAllergyActive(a))
          .toArray()
          .catch(() => []),
        db.vitals.where("patientId").equals(patientId).toArray(),
        visitId
          ? db.visits.get(visitId)
          : db.visits
              .where("patientId")
              .equals(patientId)
              .toArray()
              .then((vs) =>
                vs
                  // Only today's visit counts as "in progress"; an old visit
                  // left open is finished care, not the current stage.
                  .filter(
                    (v) =>
                      v.status === "open" &&
                      new Date(v.startedAt).toDateString() === new Date().toDateString(),
                  )
                  .sort(
                    (a, b) =>
                      new Date(b.startedAt).getTime() -
                      new Date(a.startedAt).getTime(),
                  )[0],
              ),
        db.consultations.where("patientId").equals(patientId).toArray(),
        db.dispenses.where("patientId").equals(patientId).toArray(),
        db.queue.where("patientId").equals(patientId).toArray(),
      ]);
    const latestVital = [...vitals].sort(
      (a, b) => new Date(b.takenAt).getTime() - new Date(a.takenAt).getTime(),
    )[0];
    const activeQueue = [...queue]
      .filter((q) => q.status !== "done")
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )[0] ?? null;
    return {
      patient,
      allergies,
      latestVital,
      steps: derivePatientFlow({
        visit: visit ?? null,
        vitals,
        consultations,
        dispenses,
        queueItem: activeQueue,
      }),
      ticket: activeQueue?.ticketNumber,
    };
  }, [patientId, visitId, providedPatient]);

  if (!data) {
    return (
      <div className="panel p-4 mb-4" aria-busy="true">
        <div className="skeleton h-5 w-56 mb-2" />
        <div className="skeleton h-4 w-72 max-w-full" />
      </div>
    );
  }

  const { patient, allergies, latestVital, steps, ticket } = data;
  if (!patient) {
    return (
      <div className="banner banner-warning mb-4" role="alert">
        Patient record not found on this device.
      </div>
    );
  }

  const name = `${patient.givenName} ${patient.familyName}`.trim();
  const age = patientAge(patient.dob);
  const stage = currentFlowStage(steps);
  // Adult categories are not valid for a reading taken under 18 (or at an
  // unknown age): that reading gets a paediatric-chart prompt instead.
  const adultVitals =
    !latestVital || adultVitalRangesApply(patient.dob, latestVital.takenAt);
  const bp = adultVitals
    ? classifyBloodPressure(latestVital?.systolic, latestVital?.diastolic)
    : null;
  const temp = adultVitals ? classifyTemperature(latestVital?.tempC) : null;
  const spo2 = adultVitals ? classifySpO2(latestVital?.spo2) : null;
  const location = [patient.lga, patient.state].filter(Boolean).join(", ");

  return (
    <section
      aria-label="Patient"
      className="panel mb-4 overflow-hidden"
    >
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-h2 text-ink truncate">
              {linkToRecord ? (
                <Link to={`/patients/${patient.id}`} className="hover:underline">
                  {name}
                </Link>
              ) : (
                name
              )}
            </h2>
            <span className="text-caption font-mono text-ink-muted">
              {formatPatientId(patient.id)}
            </span>
            {ticket && (
              <span className="text-caption font-mono text-ink-secondary">
                Ticket {ticket}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-body text-ink-secondary">
            {[SEX_LABEL[patient.sex] ?? patient.sex, age !== null ? `${age} years` : null, location]
              .filter(Boolean)
              .join(" · ")}
          </p>

          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Clinical alerts">
            {patient.mergeInto && (
              <li>
                {/* Its allergies and history were moved to the kept record,
                    so an empty list here does not mean no allergies. */}
                <Link to={`/patients/${patient.mergeInto}`} className="hover:underline">
                  <StatusBadge tone="danger">
                    Merged record: check allergies on the kept record
                  </StatusBadge>
                </Link>
              </li>
            )}
            {allergies.length === 0 ? (
              !patient.mergeInto && (
                <li>
                  <StatusBadge tone="neutral">No known allergies recorded</StatusBadge>
                </li>
              )
            ) : (
              allergies.map((a) => (
                <li key={a.id}>
                  <StatusBadge
                    tone={
                      a.severity === "severe" || a.severity === "life-threatening"
                        ? "critical"
                        : "danger"
                    }
                  >
                    Allergy: {a.allergen}
                  </StatusBadge>
                </li>
              ))
            )}
            {bp && bp.tone !== "success" && (
              <li>
                <StatusBadge tone={bp.tone}>
                  BP {latestVital?.systolic}/{latestVital?.diastolic} · {bp.label}
                </StatusBadge>
              </li>
            )}
            {temp && temp.tone !== "success" && (
              <li>
                <StatusBadge tone={temp.tone}>
                  Temp {latestVital?.tempC}°C · {temp.label}
                </StatusBadge>
              </li>
            )}
            {spo2 && spo2.tone !== "success" && (
              <li>
                <StatusBadge tone={spo2.tone}>
                  SpO₂ {latestVital?.spo2}% · {spo2.label}
                </StatusBadge>
              </li>
            )}
            {!adultVitals && (
              <li>
                <StatusBadge tone="warning">
                  Vitals: check paediatric chart
                </StatusBadge>
              </li>
            )}
          </ul>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end shrink-0">
          {stage && (
            <span className="text-caption text-ink-muted">
              Current stage:{" "}
              <span className="font-semibold text-ink">
                {FLOW_STAGE_LABELS[stage]}
              </span>
            </span>
          )}
          {actions}
        </div>
      </div>
      {showFlow && (
        <div className="border-t border-line bg-surface px-4 py-3">
          <PatientFlowStepper steps={steps} />
        </div>
      )}
    </section>
  );
}
