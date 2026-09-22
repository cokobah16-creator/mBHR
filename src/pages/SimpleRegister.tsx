import { startTransition, useState } from "react";
import { announceRegistration } from "@/services/registrationFeedback";
import { useNavigate } from "react-router-dom";
import { useT } from "@/hooks/useT";
import { SimplePatientForm } from "@/components/SimplePatientForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { RegistrationModeSwitch } from "@/components/RegistrationModeSwitch";

export function SimpleRegister() {
  const { t } = useT();
  const navigate = useNavigate();

  // Quick registration is for throughput: confirm the ticket and reset the
  // form for the next person instead of leaving the page.
  const [formKey, setFormKey] = useState(0);
  const handleSuccess = async (
    patientId: string,
    opts?: { existing?: boolean },
  ) => {
    await announceRegistration(patientId, opts);
    setFormKey((k) => k + 1);
  };

  const handleCancel = () => {
    startTransition(() => {
      navigate("/dashboard");
    });
  };

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Patients", to: "/patients" }, { label: "Quick registration" }]}
        title={t("patient.register")}
        description={t("simple.registerDescription")}
      />
      <RegistrationModeSwitch mode="quick" />
      <SimplePatientForm key={formKey} onSuccess={handleSuccess} onCancel={handleCancel} />
    </div>
  );
}
