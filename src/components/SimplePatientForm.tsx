import React, { useRef, useState } from "react";
import { useT } from "@/hooks/useT";
import { StepperForm } from "@/components/StepperForm";
import { PatientDedupeModal } from "@/components/PatientDedupeModal";
import { VisualNumberInput } from "@/components/VisualNumberInput";
import { usePatientsStore } from "@/stores/patients";
import { useAuthStore } from "@/stores/auth";
import { can } from "@/auth/roles";
import { NIGERIAN_STATES, LGAS_BY_STATE, formatPhoneNG } from "@/utils/nigeria";
import { AGE_LIMITS, estimateDobFromAge, type AgeUnit } from "@/utils/ageEstimate";
import {
  UserIcon,
  CameraIcon,
  PhoneIcon,
  MapPinIcon,
  IdentificationIcon,
  CheckCircleIcon,
} from "@heroicons/react/24/outline";

interface SimplePatientFormProps {
  onSuccess?: (patientId: string, opts?: { existing?: boolean }) => void;
  onCancel?: () => void;
  className?: string;
}

export function SimplePatientForm({
  onSuccess,
  onCancel,
  className,
}: SimplePatientFormProps) {
  const { t } = useT();
  const { addPatient } = usePatientsStore();
  const role = useAuthStore((s) => s.currentUser?.role);
  const mayRegister = !!role && can(role, "register");
  const refuseRegistration = () =>
    alert("Your role cannot register patients. Ask a registration volunteer, nurse, doctor or administrator.");

  const [dedupeData, setDedupeData] = useState<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    patient: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    candidates: any[];
  } | null>(null);
  const [formData, setFormData] = useState({
    givenName: "",
    familyName: "",
    sex: "",
    age: 25,
    ageUnit: "years" as AgeUnit,
    phone: "",
    address: "",
    state: "",
    lga: "",
    photo: null as string | null,
  });

  // One registration at a time: a double tap on Complete (or on "register
  // new" in the duplicate check) must not create two patients and tickets.
  // Left set after a success, when the page replaces this form.
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const beginSave = () => {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    return true;
  };
  const endSave = () => {
    savingRef.current = false;
    setSaving(false);
  };

  const estimatedDob = estimateDobFromAge(formData.age, formData.ageUnit);

  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        // Create thumbnail
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          const maxSize = 200;

          let { width, height } = img;
          if (width > height) {
            if (width > maxSize) {
              height = (height * maxSize) / width;
              width = maxSize;
            }
          } else {
            if (height > maxSize) {
              width = (width * maxSize) / height;
              height = maxSize;
            }
          }

          canvas.width = width;
          canvas.height = height;
          ctx?.drawImage(img, 0, 0, width, height);

          const thumbnail = canvas.toDataURL("image/jpeg", 0.8);
          setFormData((prev) => ({ ...prev, photo: thumbnail }));
        };
        img.src = result;
      };
      reader.readAsDataURL(file);
    }
  };

  const handleComplete = async () => {
    if (!mayRegister) {
      refuseRegistration();
      return;
    }
    // The age step checks this too; never save a date the age cannot give.
    if (!estimatedDob) return;
    if (!beginSave()) return;
    let registered = false;
    try {
      const formattedPhone = formatPhoneNG(formData.phone);

      const patientId = await addPatient({
        givenName: formData.givenName,
        familyName: formData.familyName,
        sex: formData.sex as "male" | "female" | "other",
        // Worked out from the age given, so saved as an estimate.
        dob: estimatedDob,
        dobEstimated: 1,
        phone: formattedPhone,
        address: formData.address,
        state: formData.state,
        lga: formData.lga,
        photoUrl: formData.photo || undefined,
      });

      registered = true;
      onSuccess?.(patientId);
    } catch (error) {
      // A possible duplicate is not a failure: let staff decide.
      if (error instanceof Error && error.message.startsWith("DUPLICATES_FOUND:")) {
        setDedupeData(JSON.parse(error.message.replace("DUPLICATES_FOUND:", "")));
        return;
      }
      console.error("Error registering patient:", error instanceof Error ? error.name : "unknown");
      alert(t("error.registrationFailed"));
    } finally {
      if (!registered) endSave();
    }
  };

  const chooseAgeUnit = (ageUnit: AgeUnit) => {
    if (ageUnit === formData.ageUnit) return;
    // Start the other unit from its lowest value rather than carry a number
    // across (25 years is not 25 months).
    setFormData((prev) => ({ ...prev, ageUnit, age: AGE_LIMITS[ageUnit].min }));
  };

  const steps = [
    {
      id: "photo",
      title: t("patient.photo"),
      audioKey: "patient.photo",
      isValid: true,
      component: (
        <div className="text-center space-y-6">
          <div className="relative mx-auto w-32 h-32">
            {formData.photo ? (
              <img
                src={formData.photo}
                alt="Patient"
                className="w-32 h-32 rounded-full object-cover border-4 border-line"
              />
            ) : (
              <div className="w-32 h-32 rounded-full bg-surface-sunken flex items-center justify-center border-4 border-line">
                <UserIcon className="h-16 w-16 text-ink-disabled" aria-hidden />
              </div>
            )}
            <label className="absolute bottom-0 right-0 flex items-center justify-center bg-primary text-white rounded-full p-3 cursor-pointer hover:bg-primary-hover transition-colors touch-target-large focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2">
              <CameraIcon className="h-6 w-6" aria-hidden />
              <span className="sr-only">
                {formData.photo ? "Change photo" : "Take a photo"}
              </span>
              <input
                type="file"
                accept="image/*"
                capture="user"
                onChange={handlePhotoCapture}
                className="sr-only"
              />
            </label>
          </div>
          <p className="text-lg text-ink-secondary">
            {t("simple.tapCameraToAddPhoto")}
          </p>
        </div>
      ),
    },
    {
      id: "names",
      title: t("patient.names"),
      audioKey: "patient.names",
      isValid: !!(formData.givenName.trim() && formData.familyName.trim()),
      component: (
        <div className="space-y-6">
          <div>
            <label htmlFor="simple-givenName" className="text-lg font-medium text-ink-secondary mb-3 flex items-center space-x-2">
              <IdentificationIcon className="h-6 w-6 text-ink-muted" aria-hidden />
              <span>{t("patient.givenName")} *</span>
            </label>
            <input
              id="simple-givenName"
              type="text"
              value={formData.givenName}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, givenName: e.target.value }))
              }
              className="input-field text-xl"
              placeholder={t("simple.enterFirstName")}
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="simple-familyName" className="text-lg font-medium text-ink-secondary mb-3 flex items-center space-x-2">
              <IdentificationIcon className="h-6 w-6 text-ink-muted" aria-hidden />
              <span>{t("patient.familyName")} *</span>
            </label>
            <input
              id="simple-familyName"
              type="text"
              value={formData.familyName}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, familyName: e.target.value }))
              }
              className="input-field text-xl"
              placeholder={t("simple.enterLastName")}
            />
          </div>
        </div>
      ),
    },
    {
      id: "demographics",
      title: t("patient.demographics"),
      audioKey: "patient.demographics",
      isValid: !!(formData.sex && estimatedDob),
      component: (
        <div className="space-y-8">
          <fieldset>
            <legend className="block w-full text-lg font-medium text-ink-secondary mb-4 text-center">
              {t("patient.sex")} *
            </legend>
            <div className="grid grid-cols-3 gap-4">
              {[
                { value: "male", label: t("patient.male") },
                { value: "female", label: t("patient.female") },
                { value: "other", label: t("patient.other") },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={formData.sex === option.value}
                  onClick={() =>
                    setFormData((prev) => ({ ...prev, sex: option.value }))
                  }
                  className={`flex flex-col items-center justify-center gap-2 p-6 rounded-lg border-2 transition-colors touch-target-large ${
                    formData.sex === option.value
                      ? "border-primary bg-primary-soft text-primary-fg"
                      : "bg-surface border-line text-ink hover:bg-surface-hover"
                  }`}
                >
                  {formData.sex === option.value ? (
                    <CheckCircleIcon className="h-8 w-8" aria-hidden />
                  ) : (
                    <UserIcon className="h-8 w-8 text-ink-muted" aria-hidden />
                  )}
                  <span className="text-lg font-medium">{option.label}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="space-y-4">
            <div
              role="group"
              aria-label={t("patient.age")}
              className="grid grid-cols-2 gap-4"
            >
              {(["years", "months"] as const).map((unit) => (
                <button
                  key={unit}
                  type="button"
                  aria-pressed={formData.ageUnit === unit}
                  onClick={() => chooseAgeUnit(unit)}
                  className={`rounded-lg border-2 p-4 text-lg font-medium transition-colors touch-target-large ${
                    formData.ageUnit === unit
                      ? "border-primary bg-primary-soft text-primary-fg"
                      : "bg-surface border-line text-ink hover:bg-surface-hover"
                  }`}
                >
                  {unit === "years" ? t("common.years") : t("common.months")}
                </button>
              ))}
            </div>

            {/* An age typed outside the range arrives as NaN, so the step
                stays invalid and the hint shows as an error. */}
            <VisualNumberInput
              key={formData.ageUnit}
              value={formData.age}
              onChange={(age) => setFormData((prev) => ({ ...prev, age }))}
              min={AGE_LIMITS[formData.ageUnit].min}
              max={AGE_LIMITS[formData.ageUnit].max}
              label={t("patient.age")}
              unit={
                formData.ageUnit === "years"
                  ? t("common.years")
                  : t("common.months")
              }
              hint={t(
                formData.ageUnit === "years"
                  ? "simple.ageRangeYears"
                  : "simple.ageRangeMonths",
                AGE_LIMITS[formData.ageUnit],
              )}
              invalid={!estimatedDob}
              showDots={formData.age <= 10}
            />
            <p className="field-hint text-center">{t("simple.ageHint")}</p>
          </div>
        </div>
      ),
    },
    {
      id: "contact",
      title: t("patient.contact"),
      audioKey: "patient.contact",
      isValid: !!formData.phone.trim(),
      component: (
        <div className="space-y-6">
          <div>
            <label htmlFor="simple-phone" className="text-lg font-medium text-ink-secondary mb-3 flex items-center space-x-2">
              <PhoneIcon className="h-6 w-6 text-ink-muted" aria-hidden />
              <span>{t("patient.phone")} *</span>
            </label>
            <input
              id="simple-phone"
              type="tel"
              value={formData.phone}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, phone: e.target.value }))
              }
              className="input-field text-xl"
              placeholder="08012345678"
              aria-describedby="simple-phone-hint"
            />
            <p id="simple-phone-hint" className="field-hint">
              {t("simple.phoneExample")}
            </p>
          </div>

          <div>
            <label htmlFor="simple-address" className="text-lg font-medium text-ink-secondary mb-3 flex items-center space-x-2">
              <MapPinIcon className="h-6 w-6 text-ink-muted" aria-hidden />
              <span>{t("patient.address")}</span>
            </label>
            <textarea
              id="simple-address"
              value={formData.address}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, address: e.target.value }))
              }
              className="input-field text-lg"
              rows={3}
              placeholder={t("simple.enterAddress")}
            />
          </div>
        </div>
      ),
    },
    {
      id: "location",
      title: t("patient.location"),
      audioKey: "patient.location",
      isValid: !!(formData.state && formData.lga),
      component: (
        <div className="space-y-6">
          <div>
            <label htmlFor="simple-state" className="block text-lg font-medium text-ink-secondary mb-3">
              {t("patient.state")} *
            </label>
            <select
              id="simple-state"
              value={formData.state}
              onChange={(e) => {
                setFormData((prev) => ({
                  ...prev,
                  state: e.target.value,
                  lga: "",
                }));
              }}
              className="input-field text-xl"
            >
              <option value="">{t("simple.selectState")}</option>
              {NIGERIAN_STATES.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="simple-lga" className="block text-lg font-medium text-ink-secondary mb-3">
              {t("patient.lga")} *
            </label>
            <select
              id="simple-lga"
              value={formData.lga}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, lga: e.target.value }))
              }
              className={`input-field text-xl ${!formData.state ? "bg-surface-sunken cursor-not-allowed" : ""}`}
              disabled={
                !formData.state ||
                (LGAS_BY_STATE[formData.state] || []).length === 0
              }
            >
              <option value="">
                {!formData.state
                  ? t("simple.selectState") + " first"
                  : (LGAS_BY_STATE[formData.state] || []).length === 0
                    ? "No LGAs available"
                    : t("simple.selectLGA")}
              </option>
              {(LGAS_BY_STATE[formData.state] || []).map((lga) => (
                <option key={lga} value={lga}>
                  {lga}
                </option>
              ))}
            </select>
            {formData.state &&
              (LGAS_BY_STATE[formData.state] || []).length > 0 && (
                <p className="field-hint">
                  {(LGAS_BY_STATE[formData.state] || []).length} LGAs available
                </p>
              )}
          </div>
        </div>
      ),
    },
  ];

  const handleDedupeResolve = async (
    action: "merge" | "create_new",
    winnerId?: string,
  ) => {
    const pending = dedupeData;
    setDedupeData(null);
    if (action === "merge" && winnerId) {
      onSuccess?.(winnerId, { existing: true });
      return;
    }
    if (action === "create_new" && pending) {
      if (!mayRegister) {
        refuseRegistration();
        return;
      }
      if (!beginSave()) return;
      try {
        // The draft keeps its estimated date of birth (dobEstimated).
        const patientId = await addPatient(
          { ...pending.patient, photoUrl: formData.photo || undefined },
          { skipDuplicateCheck: true },
        );
        onSuccess?.(patientId);
      } catch {
        endSave();
        alert(t("error.registrationFailed"));
      }
    }
  };

  return (
    <>
      <StepperForm
        steps={steps}
        onComplete={handleComplete}
        onCancel={onCancel}
        busy={saving}
        className={className}
      />
      {dedupeData && (
        <PatientDedupeModal
          newPatient={dedupeData.patient}
          candidates={dedupeData.candidates}
          onResolve={handleDedupeResolve}
          onCancel={() => setDedupeData(null)}
        />
      )}
    </>
  );
}
