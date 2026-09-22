import React, { useEffect, useState, startTransition } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { PatientSearch } from "@/components/PatientSearch";
import { DispenseForm } from "@/components/DispenseForm";
import { db, Visit, Patient, Consultation, generateId } from "@/db";
import { BeakerIcon } from "@heroicons/react/24/outline";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { PharmacySkeleton } from "@/components/ui/Skeleton";
import { PatientContextHeader } from "@/components/patient/PatientContextHeader";
import { getActiveSiteName } from "@/services/activeSite";

export function Pharmacy() {
  const { visitId } = useParams<{ visitId: string }>();
  const navigate = useNavigate();
  const [visit, setVisit] = useState<Visit | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [consultation, setConsultation] = useState<Consultation | null>(null);
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
        const [patientData, consultationData] = await Promise.all([
          db.patients.get(visitData.patientId),
          db.consultations.where("visitId").equals(id).first(),
        ]);
        setPatient(patientData || null);
        setConsultation(consultationData || null);
      }
    } catch (error) {
      console.error("Error loading visit data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handlePatientSelect = async (selectedPatient: Patient) => {
    try {
      // Create a new visit for this patient
      const newVisit: Visit = {
        id: generateId(),
        patientId: selectedPatient.id,
        startedAt: new Date(),
        siteName: await getActiveSiteName(),
        status: "open",
      };

      await db.visits.add(newVisit);

      // Load consultation for this patient (most recent)
      const consultationData = await db.consultations
        .where("patientId")
        .equals(selectedPatient.id)
        .reverse()
        .first();

      setPatient(selectedPatient);
      setVisit(newVisit);
      setConsultation(consultationData || null);
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
              From the consultation
            </h2>
          </div>
          {consultation ? (
            <dl className="panel-body space-y-3 text-body">
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
