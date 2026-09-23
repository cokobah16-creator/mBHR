import { useRef, KeyboardEvent, ChangeEvent, ClipboardEvent } from "react";

/** Lets phones offer a code received by SMS in the first box. */
const ONE_TIME_CODE = "one-time-code";

interface OTPInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: boolean;
  /** Accessible name for the group of boxes. */
  label?: string;
  /** Id of an element describing the error, announced with the boxes. */
  errorId?: string;
}

/**
 * One-time code entry: one box per digit, paste fills every box, arrow keys
 * and Backspace move between boxes.
 */
export function OTPInput({
  length = 6,
  value,
  onChange,
  disabled = false,
  error = false,
  label = "Verification code",
  errorId,
}: OTPInputProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleChange = (index: number, e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;

    if (!/^\d*$/.test(val)) return;

    const newValue = value.split("");
    newValue[index] = val.slice(-1);
    const updatedValue = newValue.join("");
    onChange(updatedValue);

    if (val && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !value[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }

    if (e.key === "ArrowLeft" && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }

    if (e.key === "ArrowRight" && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData("text/plain").trim();

    if (!/^\d+$/.test(pastedData)) return;

    const pastedValue = pastedData.slice(0, length);
    onChange(pastedValue);

    const nextEmptyIndex =
      pastedValue.length < length ? pastedValue.length : length - 1;
    inputRefs.current[nextEmptyIndex]?.focus();
  };

  return (
    <div
      role="group"
      aria-label={label}
      aria-describedby={error && errorId ? errorId : undefined}
      className="flex justify-center gap-2"
    >
      {Array.from({ length }, (_, index) => (
        <input
          key={index}
          ref={(el) => (inputRefs.current[index] = el)}
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? ONE_TIME_CODE : "off"}
          maxLength={1}
          value={value[index] || ""}
          onChange={(e) => handleChange(index, e)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          className={`h-14 w-11 rounded-md border bg-surface text-center text-h1 tabular-nums text-ink transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-disabled sm:w-12 ${
            error ? "border-danger" : "border-line-strong"
          }`}
          aria-label={`Digit ${index + 1} of ${length}`}
        />
      ))}
    </div>
  );
}
