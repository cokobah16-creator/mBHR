import React, { useEffect, useState, startTransition } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { PatientSearch } from "@/components/PatientSearch";
import { SoapForm } from "@/components/SoapForm";
import { db, Visit, Patient, generateId } from "@/db";
import { DocumentTextIcon } from "@heroicons/react/24/outline";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConsultationSkeleton } from "@/components/ui/Skeleton";
import { PatientContextHeader } from "@/components/patient/PatientContextHeader";
import { ClinicalSummaryPanel } from "@/components/patient/ClinicalSummaryPanel";
import { getActiveSiteName } from "@/services/activeSite";
import { useAuthStore } from "@/stores/auth";
import { can } from "@/auth/roles";

export function Consult() {
  const { visitId } = useParams<{ visitId: string }>();
  const navigate = useNavigate();
  const currentUser = useAuthStore((s) => s.currentUser);
  const [visit, setVisit] = useState<Visit | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
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
        const patientData = await db.patients.get(visitData.patientId);
        setPatient(patientData || null);
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

      setPatient(selectedPatient);
      setVisit(newVisit);
      setSelectedPatient(selectedPatient);
    } catch (error) {
      console.error("Error creating visit:", error);
    }
  };

  const handleSuccess = () => {
    // Navigate to pharmacy or back to queue
    startTransition(() => {
      if (visit && currentUser && can(currentUser.role, "dispense")) {
        navigate(`/pharmacy/${visit.id}`);
      } else {
        navigate("/queue");
      }
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
          breadcrumbs={[{ label: "Queue", to: "/queue" }, { label: "Consultation" }]}
          title="Consultation"
          description="Find the patient to document their consultation. Patients who have had vitals taken are waiting in the queue."
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
        <PageHeader title="Consultation" />
        <ConsultationSkeleton />
      </div>
    );
  }

  if (!visit || !patient) {
    return (
      <div className="panel">
        <EmptyState
          icon={DocumentTextIcon}
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
          { label: "Consultation" },
        ]}
        title="Consultation"
      />
      <PatientContextHeader
        patientId={patient.id}
        visitId={visit.id}
        patient={patient}
        linkToRecord
      />

      <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start">
        <div className="lg:sticky lg:top-20">
          <ClinicalSummaryPanel patientId={patient.id} visitId={visit.id} />
        </div>
        <div className="min-w-0">
          <SoapForm
            patientId={patient.id}
            visitId={visit.id}
            onSuccess={handleSuccess}
            onCancel={handleCancel}
          />
        </div>
      </div>
    </div>
  );
}
