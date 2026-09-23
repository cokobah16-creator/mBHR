import React, { useEffect, useState, startTransition } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { PatientSearch } from "@/components/PatientSearch";
import { VitalsForm } from "@/components/VitalsForm";
import { db, Visit, Patient } from "@/db";
import { HeartIcon } from "@heroicons/react/24/outline";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { PatientDetailSkeleton } from "@/components/ui/Skeleton";
import { PatientContextHeader } from "@/components/patient/PatientContextHeader";
import { ensureTodaysVisit } from "@/services/visits";
import { useAuthStore } from "@/stores/auth";
import { can } from "@/auth/roles";

export function Vitals() {
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
      // Continue today's visit if there is one; otherwise start it.
      const newVisit: Visit = await ensureTodaysVisit(selectedPatient.id);

      setPatient(selectedPatient);
      setVisit(newVisit);
      setSelectedPatient(selectedPatient);
    } catch (error) {
      console.error("Error creating visit:", error);
    }
  };

  const handleSuccess = () => {
    // Navigate to consultation or back to queue
    startTransition(() => {
      if (visit && currentUser && can(currentUser.role, "consult")) {
        navigate(`/consult/${visit.id}`);
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
          breadcrumbs={[{ label: "Queue", to: "/queue" }, { label: "Vitals" }]}
          title="Record Vital Signs"
          description="Find the patient, then record their measurements. Patients sent from registration are waiting in the queue."
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
        <PageHeader title="Record Vital Signs" />
        <PatientDetailSkeleton />
      </div>
    );
  }

  if (!visit || !patient) {
    return (
      <div className="panel">
        <EmptyState
          icon={HeartIcon}
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
          { label: "Vitals" },
        ]}
        title="Record Vital Signs"
      />
      <PatientContextHeader
        patientId={patient.id}
        visitId={visit.id}
        patient={patient}
        linkToRecord
      />
      <VitalsForm
        patientId={patient.id}
        visitId={visit.id}
        onSuccess={handleSuccess}
        onCancel={handleCancel}
      />
    </div>
  );
}
