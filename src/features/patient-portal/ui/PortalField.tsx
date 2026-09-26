import { useId, type ReactNode } from "react";
import { ExclamationCircleIcon } from "@heroicons/react/20/solid";
import { useT } from "@/hooks/useT";

/** Props to spread onto the field's input, select or textarea. */
export interface PortalControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
  required?: boolean;
  disabled?: boolean;
  className: string;
}

/**
 * One portal form field: a visible label (never placeholder-only), an
 * optional hint, and an error that is linked to the control and announced.
 * The control itself is the caller's, so native inputs, selects and
 * textareas keep their own keyboard behaviour:
 *
 *   <PortalField label="Reason for appointment" required error={errors.reason}>
 *     {(props) => <textarea {...props} {...register("reason")} />}
 *   </PortalField>
 */
export function PortalField({
  label,
  hint,
  error,
  required = false,
  optional = false,
  disabled = false,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  /** Plain-language message saying how to fix the entry. */
  error?: ReactNode;
  required?: boolean;
  /** Show "(optional)" after the label when most fields are required. */
  optional?: boolean;
  disabled?: boolean;
  children: (props: PortalControlProps) => ReactNode;
}) {
  const { t } = useT();
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") ||
    undefined;

  const controlProps: PortalControlProps = {
    id,
    "aria-describedby": describedBy,
    className: "input-field text-body",
    required,
    disabled,
  };
  if (error) controlProps["aria-invalid"] = true;
  if (required) controlProps["aria-required"] = true;

  return (
    <div>
      <label htmlFor={id} className="field-label text-body">
        {label}
        {required && (
          <span className="ml-1 text-danger-fg">
            <span aria-hidden>*</span>
            <span className="sr-only"> {t("portal.field.required")}</span>
          </span>
        )}
        {!required && optional && (
          <span className="ml-1 font-normal text-ink-muted">
            {t("portal.field.optional")}
          </span>
        )}
      </label>
      {children(controlProps)}
      {hint && (
        <p id={hintId} className="field-hint text-body">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="field-error flex items-start gap-1 text-body">
          <ExclamationCircleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
