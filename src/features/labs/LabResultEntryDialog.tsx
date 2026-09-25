import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ExclamationTriangleIcon, XMarkIcon } from "@heroicons/react/24/outline";

const resultSchema = z.object({
  resultValue: z.string().trim().min(1, "Enter the result"),
  resultUnit: z.string().optional(),
  referenceRange: z.string().optional(),
  interpretation: z.enum(["normal", "abnormal", "critical"], {
    errorMap: () => ({ message: "Choose how this result reads" }),
  }),
  notes: z.string().optional(),
});

export type LabResultFormValues = z.infer<typeof resultSchema>;

interface LabResultEntryDialogProps {
  testName: string;
  patientLabel: string;
  /** MBHR ID, sex and age, so patients who share a name are told apart. */
  patientIdentity?: string;
  saving: boolean;
  /** Why the last save failed, shown inside the dialog. */
  error: string | null;
  onCancel: () => void;
  onSubmit: (values: LabResultFormValues) => void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared dialog behaviour: focus returns to the opener on close, Escape
 * cancels (not while saving) and Tab stays inside the dialog.
 */
function useDialogBehaviour(
  dialogRef: RefObject<HTMLDivElement>,
  saving: boolean,
  onCancel: () => void,
) {
  // Return focus to whatever opened the dialog when it closes.
  useEffect(() => {
    const opener =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => opener?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !saving) {
        e.stopPropagation();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [saving, onCancel]);

  return (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !dialogRef.current) return;
    const items = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
    );
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
}

/**
 * Modal form for recording one lab result. Escape or Cancel closes it
 * (not while saving), Tab stays inside it, and focus returns to the button
 * that opened it.
 */
export function LabResultEntryDialog({
  testName,
  patientLabel,
  patientIdentity,
  saving,
  error,
  onCancel,
  onSubmit,
}: LabResultEntryDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors },
  } = useForm<LabResultFormValues>({
    resolver: zodResolver(resultSchema),
    defaultValues: {
      resultValue: "",
      resultUnit: "",
      referenceRange: "",
      notes: "",
    },
  });

  const trapTab = useDialogBehaviour(dialogRef, saving, onCancel);

  useEffect(() => {
    setFocus("resultValue");
  }, [setFocus]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lab-result-title"
        aria-describedby={
          patientIdentity ? "lab-result-subtitle lab-result-identity" : "lab-result-subtitle"
        }
        onKeyDown={trapTab}
        className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 id="lab-result-title" className="text-h2 text-ink">
              Enter result
            </h2>
            <p id="lab-result-subtitle" className="text-body text-ink-muted">
              {testName} · {patientLabel}
            </p>
            {patientIdentity && (
              <p id="lab-result-identity" className="text-caption text-ink-secondary">
                {patientIdentity}. Check that the specimen is this patient's before
                you save.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="btn-ghost min-w-touch-target px-2"
            aria-label="Close without saving"
          >
            <XMarkIcon className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex min-h-0 flex-1 flex-col"
          noValidate
          aria-busy={saving}
        >
          <div className="space-y-4 overflow-y-auto px-4 py-4">
            {error && (
              <div className="banner banner-danger" role="alert">
                <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
                <span>{error}</span>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="lab-result-value" className="field-label">
                  Result
                </label>
                <input
                  id="lab-result-value"
                  {...register("resultValue")}
                  type="text"
                  autoComplete="off"
                  className="input-field"
                  placeholder="e.g. 12.5 or Positive"
                  aria-invalid={errors.resultValue ? true : undefined}
                  aria-describedby={errors.resultValue ? "lab-result-value-error" : undefined}
                />
                {errors.resultValue && (
                  <p id="lab-result-value-error" className="field-error" role="alert">
                    {errors.resultValue.message}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="lab-result-unit" className="field-label">
                  Unit <span className="font-normal text-ink-muted">(optional)</span>
                </label>
                <input
                  id="lab-result-unit"
                  {...register("resultUnit")}
                  type="text"
                  autoComplete="off"
                  className="input-field"
                  placeholder="e.g. g/dL, mmol/L"
                />
              </div>
            </div>

            <div>
              <label htmlFor="lab-result-range" className="field-label">
                Reference range <span className="font-normal text-ink-muted">(optional)</span>
              </label>
              <input
                id="lab-result-range"
                {...register("referenceRange")}
                type="text"
                autoComplete="off"
                className="input-field"
                placeholder="e.g. 12–16 g/dL"
                aria-describedby="lab-result-range-hint"
              />
              <p id="lab-result-range-hint" className="field-hint">
                As printed on the test kit or lab form.
              </p>
            </div>

            <div>
              <label htmlFor="lab-result-interpretation" className="field-label">
                Interpretation
              </label>
              <select
                id="lab-result-interpretation"
                {...register("interpretation")}
                className="input-field"
                aria-invalid={errors.interpretation ? true : undefined}
                aria-describedby="lab-result-interpretation-msg"
              >
                <option value="">Choose…</option>
                <option value="normal">Normal</option>
                <option value="abnormal">Abnormal</option>
                <option value="critical">Critical</option>
              </select>
              <p
                id="lab-result-interpretation-msg"
                className={errors.interpretation ? "field-error" : "field-hint"}
                role={errors.interpretation ? "alert" : undefined}
              >
                {errors.interpretation?.message ??
                  "You choose this: the app does not work it out from the value or range. Abnormal and critical results are listed first for clinician review."}
              </p>
            </div>

            <div>
              <label htmlFor="lab-result-notes" className="field-label">
                Notes <span className="font-normal text-ink-muted">(optional)</span>
              </label>
              <textarea
                id="lab-result-notes"
                {...register("notes")}
                rows={3}
                className="input-field"
                placeholder="Anything the clinician should know about this result"
                aria-describedby="lab-result-notes-hint"
              />
              <p id="lab-result-notes-hint" className="field-hint">
                For staff. Never shown to the patient.
              </p>
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-line px-4 py-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? "Saving…" : "Save result"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export type LabReleaseMode = "release" | "withhold";

interface LabReleaseDialogProps {
  mode: LabReleaseMode;
  testName: string;
  patientLabel: string;
  /** MBHR ID, sex and age, so patients who share a name are told apart. */
  patientIdentity?: string;
  /** How many results the action applies to. */
  resultCount: number;
  /**
   * Release only: how many of those results were withheld from the
   * patient before. The dialog says so, so a withheld result is never
   * released without the person seeing that.
   */
  withheldCount?: number;
  saving: boolean;
  /** Why the last attempt failed, shown inside the dialog. */
  error: string | null;
  onCancel: () => void;
  /** Release: the optional note for the patient. Withhold: the reason. */
  onSubmit: (text: string) => void;
}

const PATIENT_NOTE_MAX = 1000;
const WITHHOLD_REASON_MAX = 500;

/**
 * Confirms releasing reviewed results to the patient portal (with an
 * optional note for the patient) or withholding them (with a required,
 * staff-only reason). Same keyboard behaviour as the result form.
 */
export function LabReleaseDialog({
  mode,
  testName,
  patientLabel,
  patientIdentity,
  resultCount,
  withheldCount = 0,
  saving,
  error,
  onCancel,
  onSubmit,
}: LabReleaseDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const trapTab = useDialogBehaviour(dialogRef, saving, onCancel);
  const release = mode === "release";
  const max = release ? PATIENT_NOTE_MAX : WITHHOLD_REASON_MAX;
  const plural = resultCount === 1 ? "result" : `${resultCount} results`;

  useEffect(() => {
    textRef.current?.focus();
  }, []);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!release && !trimmed) {
      setFieldError("Give a reason for withholding the result.");
      textRef.current?.focus();
      return;
    }
    if (trimmed.length > max) {
      setFieldError(`Use ${max.toLocaleString("en-NG")} characters or fewer.`);
      textRef.current?.focus();
      return;
    }
    setFieldError(null);
    onSubmit(trimmed);
  };

  const fieldId = "lab-release-text";
  const hintId = "lab-release-text-hint";
  const errorId = "lab-release-text-error";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lab-release-title"
        aria-describedby="lab-release-subtitle"
        onKeyDown={trapTab}
        className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 id="lab-release-title" className="text-h2 text-ink">
              {release ? `Release ${plural} to patient` : `Withhold ${plural} from patient`}
            </h2>
            <p id="lab-release-subtitle" className="text-body text-ink-muted">
              {testName} · {patientLabel}
            </p>
            {patientIdentity && (
              <p className="text-caption text-ink-secondary">{patientIdentity}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="btn-ghost min-w-touch-target px-2"
            aria-label="Close without changing anything"
          >
            <XMarkIcon className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <form
          onSubmit={submit}
          className="flex min-h-0 flex-1 flex-col"
          noValidate
          aria-busy={saving}
        >
          <div className="space-y-4 overflow-y-auto px-4 py-4">
            {error && (
              <div className="banner banner-danger" role="alert">
                <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
                <span>{error}</span>
              </div>
            )}

            {release && withheldCount > 0 && (
              <div className="banner banner-warning">
                <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
                <span>
                  {withheldCount === resultCount
                    ? resultCount === 1
                      ? "This result was withheld from the patient. Releasing it shows it in their portal."
                      : "These results were withheld from the patient. Releasing them shows them in their portal."
                    : `${withheldCount} of these results were withheld from the patient. Releasing them shows them in their portal.`}{" "}
                  Check the reason in the list before you continue.
                </span>
              </div>
            )}

            <p className="text-body text-ink-secondary">
              {release
                ? "The patient will see the test name, result, unit, usual range and interpretation in their portal. Staff notes are not shown. They see it only if their portal access is on and they sign in online."
                : "The result stays in the clinical record but is not shown in the patient portal. If it was released, it is taken off the portal."}
            </p>

            <div>
              <label htmlFor={fieldId} className="field-label">
                {release ? (
                  <>
                    Note for the patient{" "}
                    <span className="font-normal text-ink-muted">(optional)</span>
                  </>
                ) : (
                  "Reason for withholding"
                )}
              </label>
              <textarea
                id={fieldId}
                ref={textRef}
                rows={3}
                className="input-field"
                value={text}
                maxLength={max}
                onChange={(e) => {
                  setText(e.target.value);
                  if (fieldError) setFieldError(null);
                }}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={fieldError ? `${errorId} ${hintId}` : hintId}
                placeholder={
                  release
                    ? "e.g. Your result is in the usual range. No action needed."
                    : "e.g. To be discussed with the patient in person"
                }
              />
              {fieldError && (
                <p id={errorId} className="field-error" role="alert">
                  {fieldError}
                </p>
              )}
              <p id={hintId} className="field-hint">
                {release
                  ? "Shown to the patient with the result. Use plain language."
                  : "For staff. Never shown to the patient."}{" "}
                {text.trim().length}/{max.toLocaleString("en-NG")}
              </p>
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-line px-4 py-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="btn-primary"
            >
              {saving
                ? "Saving…"
                : release
                  ? "Release to patient"
                  : "Withhold from patient"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
