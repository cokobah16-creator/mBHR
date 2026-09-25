import React, { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { usePatientsStore } from "@/stores/patients";
import { useAuthStore } from "@/stores/auth";
import { can } from "@/auth/roles";
import { PatientDedupeModal } from "@/components/PatientDedupeModal";
import { AudioButton } from "@/components/AudioButton";
import { PhotoCapture } from "@/components/PhotoCapture";
import { NIGERIAN_STATES, LGAS_BY_STATE } from "@/utils/nigeria";
import { normalizePhone } from "@/utils/phone";
import { isMinor } from "@/utils/patient";
import { MINOR_PORTAL_ACCESS_MESSAGE } from "@/pages/legal/policyMeta";
import { patientSchema, PatientFormData } from "@/validation/schemas";
import { CameraIcon, UserIcon } from "@heroicons/react/24/outline";
import { enrollPatientInPortal } from "@/services/unifiedPortalEnrollment";
import { useToast } from "@/stores/toast";

interface PatientFormProps {
  /** `existing` is true when staff chose an already-registered patient. */
  onSuccess?: (patientId: string, opts?: { existing?: boolean }) => void;
  onCancel?: () => void;
}

export function PatientForm({ onSuccess, onCancel }: PatientFormProps) {
  // Sending an invitation is a separate permission from enabling access.
  const canSendInvite = can(useAuthStore((st) => st.currentUser?.role), "portal_invite");
  const { t } = useTranslation();
  const { addPatient } = usePatientsStore();
  const [loading, setLoading] = useState(false);
  // One registration at a time: a double tap must not create two patients
  // and tickets. Left set after a success, when the page moves on.
  const savingRef = useRef(false);
  const [submitError, setSubmitError] = useState("");
  const { push: pushToast } = useToast();
  const [photo, setPhoto] = useState<string | null>(null);
  const [showPhotoCapture, setShowPhotoCapture] = useState(false);
  const [showDedupeModal, setShowDedupeModal] = useState(false);
  const [dedupeData, setDedupeData] = useState<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    patient: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    candidates: any[];
  } | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<PatientFormData>({
    resolver: zodResolver(patientSchema),
  });

  const watchedState = watch("state");
  const availableLGAs = LGAS_BY_STATE[watchedState] || [];

  // Portal access starts unticked. Staff tick it only when the patient
  // agrees; typing a phone or email does not tick it.
  const portalEnabledField = register("portalEnabled");

  // Portal accounts are for adults. For a child the box is unticked and
  // cannot be ticked.
  const dobIsMinor = isMinor(watch("dob")) === true;
  useEffect(() => {
    if (dobIsMinor) setValue("portalEnabled", false);
  }, [dobIsMinor, setValue]);

  const handlePhotoCapture = (photoDataUrl: string) => {
    setPhoto(photoDataUrl);
    setShowPhotoCapture(false);
  };

  const handleRemovePhoto = () => {
    setPhoto(null);
  };

  const onSubmit = async (data: PatientFormData) => {
    setSubmitError("");
    // Enforced here as well as on the route: registration writes a record.
    const role = useAuthStore.getState().currentUser?.role;
    if (!role || !can(role, "register")) {
      setSubmitError("Your role cannot register patients. Ask a registration volunteer, nurse, doctor or administrator.");
      return;
    }
    if (savingRef.current) return;
    savingRef.current = true;
    setLoading(true);
    let patientId: string | null = null;
    try {
      const normalizedPhone = data.phone ? normalizePhone(data.phone) : null;

      const patientData = {
        givenName: data.givenName || "",
        familyName: data.familyName || "",
        sex: data.sex || "other",
        dob: data.dob || "",
        phone: normalizedPhone || undefined,
        email: data.email || undefined,
        address: data.address || "",
        state: data.state || "",
        lga: data.lga || "",
        familyId: data.familyId || "",
        photoUrl: photo || "",
      };

      patientId = await addPatient(patientData);


      // Ask for portal access only when staff ticked the box, and never for
      // a child (enrollPatientInPortal refuses one too).
      if (
        (normalizedPhone || data.email) &&
        data.portalEnabled === true &&
        isMinor(data.dob) !== true
      ) {
        const portalResult = await enrollPatientInPortal({
          patientId,
          givenName: data.givenName || "",
          familyName: data.familyName || "",
          dob: data.dob || "",
          phone: normalizedPhone || undefined,
          email: data.email || undefined,
          sex: data.sex,
        });

        if (!portalResult.success) {
          // The error text can echo the contact details, so it is not logged.
          console.warn("Portal enrollment failed");
          pushToast({
            id: crypto.randomUUID(),
            title: "Portal access not set up",
            tone: "warning",
            body: `The patient is registered, but portal enrolment failed (${portalResult.error}). You can enable it later from their record.`,
          });
        } else if (portalResult.deviceOnly) {
          // No server on this device: nothing was confirmed anywhere else.
          pushToast({
            id: crypto.randomUUID(),
            title: "Portal access on this device only",
            tone: "info",
            body: "Portal access is on for this device only: no server is connected.",
          });
        } else if (portalResult.pending) {
          // Queued for the server, which decides at the next sync.
          pushToast({
            id: crypto.randomUUID(),
            title: "Portal access requested",
            tone: "info",
            body:
              portalResult.message ??
              "Saved on this device. The patient can sign in once the clinic server confirms it.",
          });
        } else {
          console.log("Portal account created");
          pushToast({
            id: crypto.randomUUID(),
            title: "Portal access enabled",
            tone: "success",
            body: "Portal access is on. No message was sent to the patient.",
          });
        }
      }

      onSuccess?.(patientId);
    } catch (error) {
      if (patientId) {
        // The patient is saved; only portal enrolment failed. Saying "not
        // registered" here would invite a second registration.
        console.warn("Portal enrollment failed");
        pushToast({
          id: crypto.randomUUID(),
          title: "Portal access not set up",
          tone: "warning",
          body: "The patient is registered, but portal enrolment failed. You can enable it later from their record.",
        });
        onSuccess?.(patientId);
        return;
      }
      // Check if it's a duplicate error
      if (error.message.startsWith("DUPLICATES_FOUND:")) {
        const duplicateData = JSON.parse(
          error.message.replace("DUPLICATES_FOUND:", ""),
        );
        setDedupeData(duplicateData);
        setShowDedupeModal(true);
      } else {
        setSubmitError(
          "The patient was not registered — the record could not be saved. Check the form and try again.",
        );
      }
    } finally {
      if (!patientId) savingRef.current = false;
      setLoading(false);
    }
  };

  const handleDedupeResolve = async (
    action: "merge" | "create_new",
    winnerId?: string,
  ) => {
    setShowDedupeModal(false);

    if (action === "create_new" && dedupeData) {
      const role = useAuthStore.getState().currentUser?.role;
      if (!role || !can(role, "register")) {
        setSubmitError("Your role cannot register patients. Ask a registration volunteer, nurse, doctor or administrator.");
        setDedupeData(null);
        return;
      }
      if (savingRef.current) return;
      savingRef.current = true;
      setLoading(true);
      // Force create new patient (bypass duplicate check)
      try {
        // Staff confirmed this is a different person: keep their real name
        // and skip the duplicate check rather than altering the record.
        const patientId = await addPatient(
          {
            ...dedupeData.patient,
            photoUrl: photo || undefined,
          },
          { skipDuplicateCheck: true },
        );
        onSuccess?.(patientId);
      } catch (error) {
        savingRef.current = false;
        console.error(
          "Error creating new patient:",
          error instanceof Error ? error.name : error,
        );
        setSubmitError(
          "The patient was not registered — the record could not be saved. Try again.",
        );
      } finally {
        setLoading(false);
      }
    } else if (action === "merge" && winnerId) {
      // Use existing patient
      onSuccess?.(winnerId, { existing: true });
    }

    setDedupeData(null);
  };
  return (
    <>
      <div className="max-w-2xl mx-auto">
        <div className="card">
          <div className="mb-5 flex items-center gap-2">
            <UserIcon className="h-5 w-5 text-ink-muted" aria-hidden />
            <h2 className="text-h2 text-ink">{t("patient.register")}</h2>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {submitError && (
              <div className="banner banner-danger" role="alert">
                {submitError}
              </div>
            )}
            <h3 className="section-label border-b border-line pb-1.5">Identity</h3>
            {/* Photo Section */}
            <div className="flex flex-col items-center space-y-4">
              <div className="relative">
                {photo ? (
                  <img
                    src={photo}
                    alt="Patient"
                    className="w-32 h-32 rounded-full object-cover border-4 border-line"
                  />
                ) : (
                  <div className="w-32 h-32 rounded-full bg-surface-sunken flex items-center justify-center border-4 border-line">
                    <UserIcon className="h-16 w-16 text-ink-disabled" aria-hidden />
                  </div>
                )}
                {photo && (
                  <button
                    type="button"
                    onClick={handleRemovePhoto}
                    aria-label="Remove photo"
                    className="absolute top-0 right-0 m-1 flex h-11 w-11 items-center justify-center rounded-full bg-danger text-white hover:bg-danger-fg"
                  >
                    <span aria-hidden>×</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowPhotoCapture(true)}
                  aria-label={photo ? "Change photo" : "Take a photo"}
                  className="absolute bottom-0 right-0 bg-primary text-white rounded-full p-2 cursor-pointer hover:bg-primary-hover transition-colors touch-target"
                >
                  <CameraIcon className="h-5 w-5" aria-hidden />
                </button>
              </div>
              <p className="text-body text-ink-muted">
                Tap camera to {photo ? "change" : "add"} photo
              </p>
            </div>

            {/* Name Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="givenName"
                  className="field-label"
                >
                  {t("patient.givenName")} *
                </label>
                <input
                  {...register("givenName")}
                  id="givenName"
                  className="input-field"
                  placeholder="Enter given name"
                  aria-required="true"
                  aria-invalid={errors.givenName ? "true" : "false"}
                  aria-describedby={
                    errors.givenName ? "givenName-error" : undefined
                  }
                />
                {errors.givenName && (
                  <p
                    id="givenName-error"
                    role="alert"
                    className="field-error"
                  >
                    {errors.givenName.message}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="familyName"
                  className="field-label"
                >
                  {t("patient.familyName")} *
                </label>
                <input
                  {...register("familyName")}
                  id="familyName"
                  className="input-field"
                  placeholder="Enter family name"
                  aria-required="true"
                  aria-invalid={errors.familyName ? "true" : "false"}
                  aria-describedby={
                    errors.familyName ? "familyName-error" : undefined
                  }
                />
                {errors.familyName && (
                  <p
                    id="familyName-error"
                    role="alert"
                    className="field-error"
                  >
                    {errors.familyName.message}
                  </p>
                )}
              </div>
            </div>

            {/* Sex and DOB */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="sex"
                  className="field-label"
                >
                  Sex *
                </label>
                <select
                  {...register("sex")}
                  id="sex"
                  className="input-field"
                  aria-required="true"
                  aria-invalid={errors.sex ? "true" : "false"}
                  aria-describedby={errors.sex ? "sex-error" : undefined}
                >
                  <option value="">Select sex</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
                {errors.sex && (
                  <p
                    id="sex-error"
                    role="alert"
                    className="field-error"
                  >
                    {errors.sex.message}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="dob"
                  className="field-label"
                >
                  Date of Birth *
                </label>
                <input
                  {...register("dob")}
                  id="dob"
                  type="date"
                  className="input-field"
                  max={new Date().toISOString().split("T")[0]}
                  aria-required="true"
                  aria-invalid={errors.dob ? "true" : "false"}
                  aria-describedby={errors.dob ? "dob-error" : undefined}
                />
                {errors.dob && (
                  <p
                    id="dob-error"
                    role="alert"
                    className="field-error"
                  >
                    {errors.dob.message}
                  </p>
                )}
              </div>
            </div>

            <h3 className="section-label border-b border-line pb-1.5">Contact</h3>
            {/* Phone and Email */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="phone"
                  className="field-label"
                >
                  {t("patient.phone")} (at least one contact required)
                </label>
                <input
                  {...register("phone")}
                  id="phone"
                  type="tel"
                  className="input-field"
                  placeholder="08012345678 or +2348012345678"
                  aria-invalid={errors.phone ? "true" : "false"}
                  aria-describedby={errors.phone ? "phone-error" : undefined}
                />
                {errors.phone && (
                  <p
                    id="phone-error"
                    role="alert"
                    className="field-error"
                  >
                    {errors.phone.message}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="email"
                  className="field-label"
                >
                  Email (at least one contact required)
                </label>
                <input
                  {...register("email")}
                  id="email"
                  type="email"
                  className="input-field"
                  placeholder="patient@example.com"
                  aria-invalid={errors.email ? "true" : "false"}
                  aria-describedby={errors.email ? "email-error" : undefined}
                />
                {errors.email && (
                  <p
                    id="email-error"
                    role="alert"
                    className="field-error"
                  >
                    {errors.email.message}
                  </p>
                )}
              </div>
            </div>

            {/* Address */}
            <div>
              <label
                htmlFor="address"
                className="field-label"
              >
                {t("patient.address")} *
              </label>
              <textarea
                {...register("address")}
                id="address"
                className="input-field"
                rows={3}
                placeholder="Enter full address"
                aria-required="true"
                aria-invalid={errors.address ? "true" : "false"}
                aria-describedby={errors.address ? "address-error" : undefined}
              />
              {errors.address && (
                <p
                  id="address-error"
                  role="alert"
                  className="field-error"
                >
                  {errors.address.message}
                </p>
              )}
            </div>

            <h3 className="section-label border-b border-line pb-1.5">Location</h3>
            {/* State and LGA */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="state"
                  className="field-label"
                >
                  {t("patient.state")} *
                </label>
                <select
                  {...register("state", {
                    onChange: () => {
                      setValue("lga", "");
                    },
                  })}
                  id="state"
                  className="input-field"
                  aria-required="true"
                  aria-invalid={errors.state ? "true" : "false"}
                  aria-describedby={errors.state ? "state-error" : undefined}
                >
                  <option value="">Select state</option>
                  {NIGERIAN_STATES.map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </select>
                {errors.state && (
                  <p
                    id="state-error"
                    role="alert"
                    className="field-error"
                  >
                    {errors.state.message}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="lga"
                  className="field-label"
                >
                  {t("patient.lga")} *
                </label>
                <select
                  {...register("lga")}
                  id="lga"
                  className={`input-field ${!watchedState ? "bg-surface-sunken cursor-not-allowed" : ""}`}
                  disabled={!watchedState || availableLGAs.length === 0}
                  aria-required="true"
                  aria-invalid={errors.lga ? "true" : "false"}
                  aria-describedby={
                    errors.lga
                      ? "lga-error"
                      : watchedState && availableLGAs.length > 0
                        ? "lga-hint"
                        : undefined
                  }
                >
                  <option value="">
                    {!watchedState
                      ? "Select state first"
                      : availableLGAs.length === 0
                        ? "No LGAs available for this state"
                        : "Select LGA"}
                  </option>
                  {availableLGAs.map((lga) => (
                    <option key={lga} value={lga}>
                      {lga}
                    </option>
                  ))}
                </select>
                {errors.lga && (
                  <p
                    id="lga-error"
                    role="alert"
                    className="field-error"
                  >
                    {errors.lga.message}
                  </p>
                )}
                {watchedState && availableLGAs.length > 0 && (
                  <p id="lga-hint" className="field-hint">
                    {availableLGAs.length} LGAs available
                  </p>
                )}
              </div>
            </div>

            <h3 className="section-label border-b border-line pb-1.5">Additional information</h3>
            {/* Family ID (Optional) */}
            <div>
              <label
                htmlFor="familyId"
                className="field-label"
              >
                Family ID (Optional)
              </label>
              <input
                {...register("familyId")}
                id="familyId"
                className="input-field"
                placeholder="Link to existing family member"
              />
            </div>

            {/* Portal Access Section */}
            <div className="border-t border-line pt-6 mt-6">
              <div className="rounded-md border border-info-line bg-info-soft p-4 mb-4 text-info-fg">
                <h3 className="text-label font-semibold mb-2">
                  Patient Portal Access
                </h3>
                <p className="text-body">
                  Enable secure online access to medical records, appointments,
                  and test results. Patients can view their health information
                  anytime via phone or email.
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex items-start">
                  <input
                    {...portalEnabledField}
                    type="checkbox"
                    id="portalEnabled"
                    disabled={dobIsMinor}
                    className="mt-1 h-5 w-5 text-primary border-line-strong rounded focus:ring-primary disabled:opacity-50"
                    onChange={(e) => {
                      // Portal access needs a phone or email for the login
                      // details. Without one, the box stays unticked.
                      const hasContact = watch("email") || watch("phone");
                      if (!hasContact && e.target.checked) {
                        alert(
                          "Please provide at least an email or phone number for portal access",
                        );
                        e.target.checked = false;
                        return;
                      }
                      // Pass the change on so the form records the tick.
                      void portalEnabledField.onChange(e);
                    }}
                  />
                  <label
                    htmlFor="portalEnabled"
                    className="ml-2 text-body text-ink"
                  >
                    <span className="font-medium">
                      Enable patient portal access
                    </span>
                    <span className="text-ink-muted block mt-1">
                      {dobIsMinor
                        ? MINOR_PORTAL_ACCESS_MESSAGE
                        : "When you save, mBHR asks for portal access and the clinic server decides. Online, it first tries to make a portal account on the server. This can fail, and then access is not asked for; turn it on later from Patient portal on the patient's record. Tick only if the patient agrees to use the portal."}
                    </span>
                  </label>
                </div>

                {watch("portalEnabled") && (
                  <>
                    <div className="flex items-start ml-6">
                      <input
                        {...register("termsAccepted")}
                        type="checkbox"
                        id="termsAccepted"
                        className="mt-1 h-5 w-5 text-primary border-line-strong rounded focus:ring-primary"
                      />
                      <label
                        htmlFor="termsAccepted"
                        className="ml-2 text-body text-ink"
                      >
                        I have explained portal access terms to the patient and
                        they agree
                      </label>
                    </div>
                    {errors.termsAccepted && (
                      <p className="field-error ml-6" role="alert">
                        {errors.termsAccepted.message}
                      </p>
                    )}

                    {/* Registering never sends an invitation: the invitation
                        is sent from the patient's record. */}
                    <p className="field-hint ml-6">
                      {canSendInvite
                        ? "Registering does not send a portal invitation. Send it from the patient's record once portal access is confirmed."
                        : "A registration lead, lead clinician or administrator sends the portal invitation from the patient's record."}
                    </p>
                  </>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row-reverse">
              <AudioButton
                audioKey="action.register"
                fallbackText="Register and issue ticket"
                type="submit"
                disabled={loading}
                className="btn-primary sm:flex-1"
              >
                {loading ? "Registering…" : "Register & issue ticket"}
              </AudioButton>
              {onCancel && (
                <AudioButton
                  audioKey="action.cancel"
                  fallbackText="Cancel"
                  type="button"
                  onClick={onCancel}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </AudioButton>
              )}
            </div>
          </form>
        </div>
      </div>

      {/* Dedupe Modal */}
      {showDedupeModal && dedupeData && (
        <PatientDedupeModal
          newPatient={dedupeData.patient}
          candidates={dedupeData.candidates}
          onResolve={handleDedupeResolve}
          onCancel={() => {
            setShowDedupeModal(false);
            setDedupeData(null);
            setLoading(false);
          }}
        />
      )}

      {/* Photo Capture Modal */}
      {showPhotoCapture && (
        <PhotoCapture
          onCapture={handlePhotoCapture}
          onCancel={() => setShowPhotoCapture(false)}
          currentPhoto={photo || undefined}
        />
      )}
    </>
  );
}
