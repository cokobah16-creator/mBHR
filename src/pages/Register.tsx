import { startTransition } from "react";
import { useNavigate } from "react-router-dom";
import { PatientForm } from "@/components/PatientForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { RegistrationModeSwitch } from "@/components/RegistrationModeSwitch";
import { announceRegistration } from "@/services/registrationFeedback";

export function Register() {
  const navigate = useNavigate();

  const handleSuccess = async (
    patientId: string,
    opts?: { existing?: boolean },
  ) => {
    await announceRegistration(patientId, opts);
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
      <RegistrationModeSwitch mode="full" />
      <PatientForm onSuccess={handleSuccess} onCancel={handleCancel} />
    </div>
  );
}
