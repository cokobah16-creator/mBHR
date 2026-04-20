import { useState, useEffect } from "react";
import { clinicalDecisionSupport } from "@/services/clinicalDecisionSupport";
import type { SOAPSuggestion } from "@/services/clinicalDecisionSupport";
import { LightBulbIcon, SparklesIcon } from "@heroicons/react/24/outline";

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

  useEffect(() => {
    if (value.length > 10) {
      generateSuggestions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const generateSuggestions = async () => {
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
      console.error("Failed to generate suggestions:", error);
    } finally {
      setIsGenerating(false);
    }
  };

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
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-700">
          {label}
        </label>
        {hasRelevantSuggestions && (
          <button
            type="button"
            onClick={() => setShowSuggestions(!showSuggestions)}
            className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
          >
            <SparklesIcon className="h-4 w-4" />
            {showSuggestions ? "Hide" : "Show"} AI Suggestions
          </button>
        )}
      </div>

      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={6}
        className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
      />

      {showSuggestions && hasRelevantSuggestions && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-blue-900">
            <LightBulbIcon className="h-5 w-5" />
            AI-Powered Suggestions
            {suggestions.confidence && (
              <span className="text-xs text-blue-600">
                ({Math.round(suggestions.confidence * 100)}% confidence)
              </span>
            )}
          </div>

          <div className="space-y-2">
            {suggestions.suggestions.map((suggestion, idx) => (
              <div
                key={idx}
                className="bg-white rounded-md p-3 border border-blue-200 hover:border-blue-400 transition-colors cursor-pointer"
                onClick={() => applySuggestion(suggestion)}
              >
                <p className="text-sm text-gray-700">{suggestion}</p>
              </div>
            ))}
          </div>

          {suggestions.keywords.length > 0 && (
            <div className="text-xs text-blue-700">
              Based on: {suggestions.keywords.join(", ")}
            </div>
          )}

          <p className="text-xs text-blue-600">
            Click any suggestion to add it to your note
          </p>
        </div>
      )}

      {isGenerating && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
          Analyzing and generating suggestions...
        </div>
      )}
    </div>
  );
}
