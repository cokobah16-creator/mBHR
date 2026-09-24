import { useState, useEffect, useId } from "react";
import { clinicalDecisionSupport } from "@/services/clinicalDecisionSupport";
import type { VitalsAnalysis } from "@/services/clinicalDecisionSupport";
import {
  ExclamationTriangleIcon,
  ExclamationCircleIcon,
  CheckCircleIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";

interface SmartVitalsInputProps {
  vitals: {
    heightCm?: number;
    weightKg?: number;
    tempC?: number;
    pulseBpm?: number;
    systolic?: number;
    diastolic?: number;
    spo2?: number;
    bmi?: number;
  };
  onChange: (field: string, value: number) => void;
}

const RISK_DISPLAY: Record<
  VitalsAnalysis["riskLevel"],
  { banner: string; label: string; icon: typeof InformationCircleIcon }
> = {
  critical: {
    banner: "banner-danger",
    label: "Critical",
    icon: ExclamationCircleIcon,
  },
  high: {
    banner: "banner-danger",
    label: "High",
    icon: ExclamationTriangleIcon,
  },
  moderate: {
    banner: "banner-warning",
    label: "Moderate",
    icon: ExclamationTriangleIcon,
  },
  low: { banner: "banner-success", label: "Low", icon: CheckCircleIcon },
};

const FIELDS: Array<{
  key: keyof SmartVitalsInputProps["vitals"];
  label: string;
  placeholder: string;
  step?: string;
}> = [
  { key: "heightCm", label: "Height (cm)", placeholder: "e.g. 170" },
  { key: "weightKg", label: "Weight (kg)", placeholder: "e.g. 70" },
  {
    key: "tempC",
    label: "Temperature (°C)",
    placeholder: "e.g. 37.0",
    step: "0.1",
  },
  { key: "pulseBpm", label: "Pulse (bpm)", placeholder: "e.g. 80" },
  {
    key: "systolic",
    label: "Blood pressure – systolic (mmHg)",
    placeholder: "e.g. 120",
  },
  {
    key: "diastolic",
    label: "Blood pressure – diastolic (mmHg)",
    placeholder: "e.g. 80",
  },
  { key: "spo2", label: "SpO₂ (%)", placeholder: "e.g. 98" },
];

export function SmartVitalsInput({ vitals, onChange }: SmartVitalsInputProps) {
  const [analysis, setAnalysis] = useState<VitalsAnalysis | null>(null);
  const idPrefix = useId();

  const hasAnyVitals = Object.values(vitals).some(
    (v) => v !== undefined && v > 0,
  );

  useEffect(() => {
    if (Object.values(vitals).some((v) => v !== undefined && v > 0)) {
      setAnalysis(clinicalDecisionSupport.analyzeVitals(vitals));
    }
  }, [vitals]);

  const risk = analysis ? RISK_DISPLAY[analysis.riskLevel] : null;
  const RiskIcon = risk?.icon ?? InformationCircleIcon;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {FIELDS.map((field) => {
          const id = `${idPrefix}-${field.key}`;
          return (
            <div key={field.key}>
              <label htmlFor={id} className="field-label">
                {field.label}
              </label>
              <input
                id={id}
                type="number"
                step={field.step}
                inputMode="decimal"
                value={vitals[field.key] || ""}
                onChange={(e) =>
                  onChange(field.key, parseFloat(e.target.value))
                }
                className="input-field tabular-nums"
                placeholder={field.placeholder}
              />
            </div>
          );
        })}

        {vitals.bmi && (
          <div>
            <p id={`${idPrefix}-bmi`} className="field-label">
              BMI (calculated)
            </p>
            <output
              aria-labelledby={`${idPrefix}-bmi`}
              className="flex min-h-control w-full items-center rounded-md border border-line bg-surface-sunken px-3 tabular-nums text-ink-secondary"
            >
              {vitals.bmi.toFixed(1)}
            </output>
          </div>
        )}
      </div>

      {analysis && risk && hasAnyVitals && (
        <div className={`banner ${risk.banner}`} role="status" aria-live="polite">
          <RiskIcon className="h-5 w-5 shrink-0" aria-hidden />
          <div className="flex-1 space-y-3">
            <p className="font-semibold">
              {risk.label} risk
              <span className="ml-2 text-caption font-normal">
                (rule-based score {analysis.score})
              </span>
            </p>

            {analysis.urgentFlags.length > 0 && (
              <div className="rounded-md border border-danger-line bg-surface p-3 text-danger-fg">
                <p className="flex items-center gap-1.5 font-semibold">
                  <ExclamationCircleIcon className="h-4 w-4" aria-hidden />
                  Urgent
                </p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {analysis.urgentFlags.map((flag, idx) => (
                    <li key={idx}>{flag}</li>
                  ))}
                </ul>
              </div>
            )}

            {analysis.concerns.length > 0 && (
              <div>
                <p className="font-medium">Concerns</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {analysis.concerns.map((concern, idx) => (
                    <li key={idx}>{concern}</li>
                  ))}
                </ul>
              </div>
            )}

            {analysis.recommendations.length > 0 && (
              <div>
                <p className="font-medium">Suggested actions</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {analysis.recommendations.map((rec, idx) => (
                    <li key={idx}>{rec}</li>
                  ))}
                </ul>
              </div>
            )}

            {analysis.concerns.length === 0 &&
              analysis.urgentFlags.length === 0 && (
                <p>All entered readings are within the built-in normal ranges.</p>
              )}
          </div>
        </div>
      )}
    </div>
  );
}
