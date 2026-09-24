import { useState, useEffect, useId } from "react";
import { clinicalDecisionSupport } from "@/services/clinicalDecisionSupport";
import type { SOAPSuggestion } from "@/services/clinicalDecisionSupport";
import { LightBulbIcon, PlusIcon } from "@heroicons/react/24/outline";

interface SmartSOAPInputProps {
  section: "subjective" | "objective" | "assessment" | "plan";
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  patientAge?: number;
  patientSex?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vitalSigns?: any;
}

export function SmartSOAPInput({
  section,
  value,
  onChange,
  label,
  placeholder,
  patientAge,
  patientSex,
  vitalSigns,
}: SmartSOAPInputProps) {
  const [suggestions, setSuggestions] = useState<SOAPSuggestion | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const inputId = useId();
  const panelId = `${inputId}-suggestions`;

  useEffect(() => {
    if (value.length <= 10) return;
    try {
      setIsGenerating(true);
      const result = clinicalDecisionSupport.generateSOAPSuggestions({
        section,
        partialText: value,
        patientAge,
        patientSex,
        vitalSigns,
      });
      setSuggestions(result);
    } catch (error) {
      console.error(
        "Failed to generate suggestions:",
        error instanceof Error ? error.name : error,
      );
    } finally {
      setIsGenerating(false);
    }
  }, [value, section, patientAge, patientSex, vitalSigns]);

  const applySuggestion = (suggestion: string) => {
    const currentValue = value.trim();
    const newValue = currentValue
      ? `${currentValue}\n${suggestion}`
      : suggestion;
    onChange(newValue);
    setShowSuggestions(false);
  };

  const hasRelevantSuggestions =
    suggestions && suggestions.suggestions.length > 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={inputId} className="field-label mb-0">
          {label}
        </label>
        {hasRelevantSuggestions && (
          <button
            type="button"
            onClick={() => setShowSuggestions(!showSuggestions)}
            aria-expanded={showSuggestions}
            aria-controls={panelId}
            className="btn-ghost text-label"
          >
            <LightBulbIcon className="h-4 w-4" aria-hidden />
            {showSuggestions ? "Hide" : "Show"} suggestions (
            {suggestions.suggestions.length})
          </button>
        )}
      </div>

      <textarea
        id={inputId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={6}
        className="input-field"
      />

      {showSuggestions && hasRelevantSuggestions && (
        <div
          id={panelId}
          className="space-y-3 rounded-md border border-line bg-surface-sunken p-4"
        >
          <div className="flex items-center gap-2 text-label text-ink">
            <LightBulbIcon className="h-5 w-5 text-ink-muted" aria-hidden />
            Rule-based suggestions from your note and recorded vitals
          </div>
          <p className="text-caption text-ink-muted">
            Matched on keywords only. Check each one before adding it to the
            record.
          </p>

          <ul className="space-y-2">
            {suggestions.suggestions.map((suggestion, idx) => (
              <li key={idx}>
                <button
                  type="button"
                  onClick={() => applySuggestion(suggestion)}
                  className="flex min-h-touch-target w-full items-start gap-2 rounded-md border border-line bg-surface p-3 text-left text-body text-ink transition-colors hover:border-line-strong hover:bg-surface-hover"
                >
                  <PlusIcon
                    className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted"
                    aria-hidden
                  />
                  <span>
                    <span className="sr-only">Add to note: </span>
                    {suggestion}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {suggestions.keywords.length > 0 && (
            <p className="text-caption text-ink-muted">
              Based on: {suggestions.keywords.join(", ")}
            </p>
          )}
        </div>
      )}

      {isGenerating && (
        <p className="text-caption text-ink-muted" role="status">
          Checking for suggestions…
        </p>
      )}
    </div>
  );
}
