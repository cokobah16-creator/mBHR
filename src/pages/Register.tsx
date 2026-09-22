import { startTransition } from "react";
import { useNavigate } from "react-router-dom";
import { PatientForm } from "@/components/PatientForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { db } from "@/db";
import { useToast } from "@/stores/toast";

export function Register() {
  const navigate = useNavigate();
  const { push: pushToast } = useToast();

  const handleSuccess = async (patientId: string) => {
    // Tell staff what happened and what comes next, then open the record.
    try {
      const [patient, queued] = await Promise.all([
        db.patients.get(patientId),
        db.queue
          .where("patientId")
          .equals(patientId)
          .and((q) => q.status !== "done")
          .first(),
      ]);
      const name = patient ? `${patient.givenName} ${patient.familyName}` : "Patient";
      pushToast({
        id: crypto.randomUUID(),
        title: `${name} registered`,
        body: queued?.ticketNumber
          ? `Ticket ${queued.ticketNumber} · added to the queue.`
          : "Added to the queue.",
      });
    } catch {
      pushToast({ id: crypto.randomUUID(), title: "Patient registered" });
    }
    startTransition(() => navigate(`/patients/${patientId}`));
  };

  const handleCancel = () => {
    startTransition(() => navigate("/dashboard"));
  };

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Patients", to: "/patients" }, { label: "Register" }]}
        title="Patient Registration"
        description="Check the patient is not already registered before adding them. Possible duplicates are shown before saving."
      />
      <PatientForm onSuccess={handleSuccess} onCancel={handleCancel} />
    </div>
  );
}
