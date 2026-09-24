import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { formatNigerianDate } from "@/utils/dateFormat";
import {
  ChevronRightIcon,
  DocumentCheckIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import * as logger from "@/lib/logger";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { errorName, readPortalUser } from "./account/portalSession";

const preVisitFormSchema = z.object({
  chiefComplaint: z.string().min(5, "Please describe your symptoms"),
  symptomDuration: z.string().min(1, "Required"),
  currentMedications: z.string(),
  allergies: z.string(),
  recentHospitalVisits: z.string(),
  smokingStatus: z.enum(["never", "former", "current"]),
  alcoholUse: z.enum(["never", "occasional", "regular"]),
  exerciseFrequency: z.string(),
  additionalNotes: z.string(),
});

type PreVisitFormData = z.infer<typeof preVisitFormSchema>;

interface PreVisitForm {
  id: string;
  appointmentId: string;
  appointmentDate: Date;
  appointmentType: string;
  status: "pending" | "completed";
  submittedAt?: Date;
  data?: PreVisitFormData;
}

const EMPTY_FORM: PreVisitFormData = {
  chiefComplaint: "",
  symptomDuration: "",
  currentMedications: "",
  allergies: "",
  recentHospitalVisits: "",
  smokingStatus: "never",
  alcoholUse: "never",
  exerciseFrequency: "",
  additionalNotes: "",
};

export function PreVisitForms() {
  const [forms, setForms] = useState<PreVisitForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedForm, setSelectedForm] = useState<PreVisitForm | null>(null);
  const [showFormModal, setShowFormModal] = useState(false);
  const [submitNotice, setSubmitNotice] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLTextAreaElement | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<PreVisitFormData>({
    resolver: zodResolver(preVisitFormSchema),
  });

  const loadForms = useCallback(async () => {
    setLoading(true);
    try {
      const portalUser = readPortalUser();
      if (!portalUser?.patientId) {
        logger.error("No patient ID found");
        return;
      }

      // No source for pre-visit forms is connected to the portal yet.
      setForms([]);
    } catch (err) {
      logger.error("[PreVisitForms] load failed:", errorName(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadForms();
  }, [loadForms]);

  useEffect(() => {
    if (!showFormModal) return;
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    firstFieldRef.current?.focus();
    return () => previous?.focus();
  }, [showFormModal]);

  const handleFillForm = (form: PreVisitForm) => {
    setSelectedForm(form);
    setSubmitNotice(null);
    reset(form.data ?? EMPTY_FORM);
    setShowFormModal(true);
  };

  const closeForm = () => {
    setShowFormModal(false);
    setSelectedForm(null);
    setSubmitNotice(null);
    reset();
  };

  const onSubmit = (_data: PreVisitFormData) => {
    if (!selectedForm) return;
    // There is no service to send pre-visit forms to yet. Say so plainly
    // rather than pretending the form was submitted.
    setSubmitNotice(
      "Forms cannot be sent from the portal yet, so nothing was sent. Please bring these answers to your visit.",
    );
  };

  const onDialogKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeForm();
    }
  };

  const pendingForms = forms.filter((f) => f.status === "pending");
  const completedForms = forms.filter((f) => f.status === "completed");

  const { ref: chiefComplaintRef, ...chiefComplaintField } =
    register("chiefComplaint");

  const header = (
    <PageHeader
      title="Forms before your visit"
      description="Answer questions about your health before an appointment."
    />
  );

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        {header}
        <span role="status" className="sr-only">
          Loading your forms
        </span>
        <div className="panel p-5" aria-hidden>
          <Skeleton className="mb-4 h-5 w-40" />
          <SkeletonText lines={3} />
        </div>
      </div>
    );
  }

  const fieldError = (id: string, message?: string) =>
    message ? (
      <p id={id} className="field-error" role="alert">
        {message}
      </p>
    ) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      {header}

      {forms.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={DocumentCheckIcon}
            title="No forms to fill in"
            description="You have no forms to complete before a visit. Clinic staff will ask you any questions they need at your visit."
          />
        </div>
      ) : (
        <>
          {pendingForms.length > 0 && (
            <section className="panel" aria-labelledby="forms-pending-title">
              <div className="panel-header">
                <h2 id="forms-pending-title" className="panel-title">
                  To fill in
                </h2>
                <span className="text-caption text-ink-muted tabular-nums">
                  {pendingForms.length}
                </span>
              </div>
              <ul className="divide-y divide-line">
                {pendingForms.map((form) => (
                  <li
                    key={form.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-body font-medium text-ink">
                        {form.appointmentType}
                      </p>
                      <p className="text-caption text-ink-muted">
                        Appointment: {formatNigerianDate(form.appointmentDate)}
                      </p>
                      <StatusBadge tone="warning" className="mt-1">
                        Please fill in before your visit
                      </StatusBadge>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleFillForm(form)}
                      className="btn-primary"
                    >
                      Fill in form
                      <ChevronRightIcon className="h-4 w-4" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {completedForms.length > 0 && (
            <section className="panel" aria-labelledby="forms-done-title">
              <div className="panel-header">
                <h2 id="forms-done-title" className="panel-title">
                  Completed
                </h2>
                <span className="text-caption text-ink-muted tabular-nums">
                  {completedForms.length}
                </span>
              </div>
              <ul className="divide-y divide-line">
                {completedForms.map((form) => (
                  <li
                    key={form.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-body font-medium text-ink">
                        {form.appointmentType}
                        <StatusBadge tone="success" icon>
                          Completed
                        </StatusBadge>
                      </p>
                      <p className="text-caption text-ink-muted">
                        Appointment: {formatNigerianDate(form.appointmentDate)}
                        {form.submittedAt
                          ? ` · Sent ${formatNigerianDate(form.submittedAt)}`
                          : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleFillForm(form)}
                      className="btn-secondary"
                    >
                      View form
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {showFormModal && selectedForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="previsit-title"
            onKeyDown={onDialogKeyDown}
            className="my-8 w-full max-w-2xl rounded-lg border border-line bg-surface p-6 shadow-2xl"
          >
            <h2 id="previsit-title" className="text-h2 text-ink">
              Before your visit
            </h2>
            <p className="mt-1 text-body text-ink-muted">
              {selectedForm.appointmentType} ·{" "}
              {formatNigerianDate(selectedForm.appointmentDate)}
            </p>

            <form
              onSubmit={handleSubmit(onSubmit)}
              className="mt-5 space-y-5"
              noValidate
            >
              <p className="text-caption text-ink-muted">
                Questions marked * need an answer.
              </p>

              <div>
                <label htmlFor="pv-complaint" className="field-label">
                  What brings you in? *
                </label>
                <textarea
                  {...chiefComplaintField}
                  ref={(el) => {
                    chiefComplaintRef(el);
                    firstFieldRef.current = el;
                  }}
                  id="pv-complaint"
                  rows={3}
                  className="input-field"
                  placeholder="Describe your symptoms or reason for visit"
                  aria-invalid={errors.chiefComplaint ? true : undefined}
                  aria-describedby={errors.chiefComplaint ? "pv-complaint-error" : undefined}
                />
                {fieldError("pv-complaint-error", errors.chiefComplaint?.message)}
              </div>

              <div>
                <label htmlFor="pv-duration" className="field-label">
                  How long have you had these symptoms? *
                </label>
                <input
                  {...register("symptomDuration")}
                  id="pv-duration"
                  type="text"
                  className="input-field"
                  placeholder="For example: 3 days, 2 weeks"
                  aria-invalid={errors.symptomDuration ? true : undefined}
                  aria-describedby={errors.symptomDuration ? "pv-duration-error" : undefined}
                />
                {fieldError("pv-duration-error", errors.symptomDuration?.message)}
              </div>

              <div>
                <label htmlFor="pv-meds" className="field-label">
                  Medicines you take now
                </label>
                <textarea
                  {...register("currentMedications")}
                  id="pv-meds"
                  rows={2}
                  className="input-field"
                  placeholder="List all medicines you are taking"
                />
              </div>

              <div>
                <label htmlFor="pv-allergies" className="field-label">
                  Known allergies
                </label>
                <textarea
                  {...register("allergies")}
                  id="pv-allergies"
                  rows={2}
                  className="input-field"
                  placeholder="Any medicine or food allergies"
                />
              </div>

              <div>
                <label htmlFor="pv-hospital" className="field-label">
                  Recent hospital visits
                </label>
                <textarea
                  {...register("recentHospitalVisits")}
                  id="pv-hospital"
                  rows={2}
                  className="input-field"
                  placeholder="Any recent hospital stays or emergency visits"
                />
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label htmlFor="pv-smoking" className="field-label">
                    Smoking
                  </label>
                  <select {...register("smokingStatus")} id="pv-smoking" className="input-field">
                    <option value="never">Never smoked</option>
                    <option value="former">Used to smoke</option>
                    <option value="current">Smoke now</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="pv-alcohol" className="field-label">
                    Alcohol
                  </label>
                  <select {...register("alcoholUse")} id="pv-alcohol" className="input-field">
                    <option value="never">Never</option>
                    <option value="occasional">Sometimes</option>
                    <option value="regular">Regularly</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="pv-exercise" className="field-label">
                  How often you exercise
                </label>
                <input
                  {...register("exerciseFrequency")}
                  id="pv-exercise"
                  type="text"
                  className="input-field"
                  placeholder="For example: 3 times a week"
                />
              </div>

              <div>
                <label htmlFor="pv-notes" className="field-label">
                  Anything else
                </label>
                <textarea
                  {...register("additionalNotes")}
                  id="pv-notes"
                  rows={3}
                  className="input-field"
                  placeholder="Anything else you would like the clinic to know"
                />
              </div>

              <div aria-live="polite">
                {submitNotice && (
                  <div className="banner banner-warning">
                    <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                    <p>{submitNotice}</p>
                  </div>
                )}
                {selectedForm.status === "completed" && (
                  <div className="banner banner-info">
                    <InformationCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                    <p>This form has already been sent.</p>
                  </div>
                )}
              </div>

              <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
                <button type="button" onClick={closeForm} className="btn-secondary">
                  Close
                </button>
                <button
                  type="submit"
                  disabled={selectedForm.status === "completed"}
                  className="btn-primary"
                >
                  <DocumentCheckIcon className="h-5 w-5" aria-hidden />
                  Send form
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
