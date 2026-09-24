import { useEffect, useRef, type KeyboardEvent } from "react";
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
  saving: boolean;
  /** Why the last save failed, shown inside the dialog. */
  error: string | null;
  onCancel: () => void;
  onSubmit: (values: LabResultFormValues) => void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal form for recording one lab result. Escape or Cancel closes it
 * (not while saving), Tab stays inside it, and focus returns to the button
 * that opened it.
 */
export function LabResultEntryDialog({
  testName,
  patientLabel,
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

  // Return focus to whatever opened the dialog when it closes.
  useEffect(() => {
    const opener =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => opener?.focus();
  }, []);

  useEffect(() => {
    setFocus("resultValue");
  }, [setFocus]);

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

  const trapTab = (e: KeyboardEvent<HTMLDivElement>) => {
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

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lab-result-title"
        aria-describedby="lab-result-subtitle"
        onKeyDown={trapTab}
        className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 id="lab-result-title" className="text-h2 text-ink">
              Enter result
            </h2>
            <p id="lab-result-subtitle" className="text-body text-ink-muted">
              {testName} · {patientLabel}
            </p>
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
                  "Abnormal and critical results are listed first for clinician review."}
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
              />
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
