import React, { useEffect, useState, startTransition } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { PatientSearch } from "@/components/PatientSearch";
import { DispenseForm } from "@/components/DispenseForm";
import { db, Visit, Patient, Consultation } from "@/db";
import { BeakerIcon } from "@heroicons/react/24/outline";
import { ExclamationTriangleIcon } from "@heroicons/react/20/solid";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { PharmacySkeleton } from "@/components/ui/Skeleton";
import { PatientContextHeader } from "@/components/patient/PatientContextHeader";
import { ensureTodaysVisit } from "@/services/visits";
import { activePatientFor } from "@/services/activePatient";
import { formatNigerianDateTime } from "@/utils/dateFormat";
import { pharmacyConsultation, type PharmacyConsultation } from "@/features/pharmacy/visitConsultation";

export function Pharmacy() {
  const { visitId } = useParams<{ visitId: string }>();
  const navigate = useNavigate();
  const [visit, setVisit] = useState<Visit | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [consult, setConsult] = useState<PharmacyConsultation<Consultation>>({ kind: "none" });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (visitId) {
      loadVisitData(visitId);
    } else {
      setLoading(false);
    }
  }, [visitId]);

  const loadVisitData = async (id: string) => {
    try {
      const visitData = await db.visits.get(id);
      if (visitData) {
        setVisit(visitData);
        const [patientData, forVisit, forPatient] = await Promise.all([
          db.patients.get(visitData.patientId),
          db.consultations.where("visitId").equals(id).toArray(),
          db.consultations.where("patientId").equals(visitData.patientId).toArray(),
        ]);
        setPatient(patientData || null);
        setConsult(pharmacyConsultation([...forVisit, ...forPatient], id));
      }
    } catch (error) {
      console.error("Error loading visit data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handlePatientSelect = async (chosen: Patient) => {
    try {
      // A record merged into another is served on the kept record, where
      // its allergies and history now live.
      const selectedPatient = await activePatientFor(chosen);
      // Continue today's visit if there is one; otherwise start it.
      const newVisit: Visit = await ensureTodaysVisit(selectedPatient.id);

      // Only today's consultation for this visit is the current plan; an
      // older one is shown dated.
      const consultations = await db.consultations.where("patientId").equals(selectedPatient.id).toArray();

      setPatient(selectedPatient);
      setVisit(newVisit);
      setConsult(pharmacyConsultation(consultations, newVisit.id));
      setSelectedPatient(selectedPatient);
    } catch (error) {
      console.error("Error creating visit:", error);
    }
  };

  const handleSuccess = () => {
    // Complete the visit and return to queue
    startTransition(() => {
      navigate("/queue", {
        state: {
          message: "Medication dispensed successfully!",
        },
      });
    });
  };

  const handleCancel = () => {
    startTransition(() => {
      navigate("/queue");
    });
  };

  // If no visitId provided, show patient search
  if (!visitId && !selectedPatient) {
    return (
      <div>
        <PageHeader
          breadcrumbs={[{ label: "Queue", to: "/queue" }, { label: "Pharmacy" }]}
          title="Pharmacy"
          description="Find the patient to dispense their medicines. Patients who have seen a clinician are waiting in the queue."
        />
        <div className="panel max-w-2xl p-5">
          <h2 className="text-h3 text-ink mb-3">Select Patient</h2>
          <PatientSearch
            onPatientSelect={handlePatientSelect}
            placeholder="Search by name or phone number"
            className="w-full"
          />
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Pharmacy" />
        <PharmacySkeleton />
      </div>
    );
  }

  if (!visit || !patient) {
    return (
      <div className="panel">
        <EmptyState
          icon={BeakerIcon}
          title="Visit not found on this device"
          description="It may have been closed, or not synced to this device yet."
          action={
            <button onClick={() => navigate("/queue")} className="btn-primary">
              Back to queue
            </button>
          }
        />
      </div>
    );
  }

  const consultation = consult.consultation;

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: "Queue", to: "/queue" },
          { label: `${patient.givenName} ${patient.familyName}`, to: `/patients/${patient.id}` },
          { label: "Pharmacy" },
        ]}
        title="Pharmacy"
      />
      <PatientContextHeader
        patientId={patient.id}
        visitId={visit.id}
        patient={patient}
        linkToRecord
      />

      <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start">
        <section className="panel" aria-labelledby="rx-summary-title">
          <div className="panel-header">
            <h2 id="rx-summary-title" className="panel-title">
              {consult.kind === "current"
                ? "From today's consultation"
                : consult.kind === "earlier"
                  ? "Earlier consultation"
                  : "From the consultation"}
            </h2>
          </div>
          {consultation ? (
            <div className="panel-body space-y-3 text-body">
              {consult.kind === "earlier" && (
                <div className="banner banner-warning" role="status">
                  <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
                  <span>
                    Not from today's visit: this plan is from an earlier consultation. Confirm the prescription
                    with a clinician before dispensing.
                  </span>
                </div>
              )}
              <dl className="space-y-3">
                <div>
                  <dt className="section-label">Recorded</dt>
                  <dd className="text-ink">{formatNigerianDateTime(consultation.createdAt) || "Date not recorded"}</dd>
                </div>
                <div>
                  <dt className="section-label">Clinician</dt>
                  <dd className="text-ink">{consultation.providerName}</dd>
                </div>
                {consultation.provisionalDx.length > 0 && (
                  <div>
                    <dt className="section-label">Diagnoses</dt>
                    <dd>
                      <ul className="list-disc pl-5 text-ink">
                        {consultation.provisionalDx.map((dx, index) => (
                          <li key={index}>{dx}</li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="section-label">Plan</dt>
                  <dd className="whitespace-pre-line text-ink">
                    {consultation.soapPlan || "No plan recorded."}
                  </dd>
                </div>
              </dl>
            </div>
          ) : (
            <p className="panel-body text-body text-warning-fg">
              No consultation recorded for this patient. Confirm the
              prescription with a clinician before dispensing.
            </p>
          )}
        </section>

        <DispenseForm
          patientId={patient.id}
          visitId={visit.id}
          onSuccess={handleSuccess}
          onCancel={handleCancel}
        />
      </div>
    </div>
  );
}
