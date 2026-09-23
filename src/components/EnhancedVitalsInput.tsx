import React, { useState, useEffect } from "react";
import { useFormContext } from "react-hook-form";
import { db, VitalsRange } from "@/db";
import {
  ExclamationTriangleIcon,
  CheckCircleIcon,
} from "@heroicons/react/24/outline";

interface EnhancedVitalsInputProps {
  name: string;
  label: string;
  unit: string;
  metric: "hr" | "temp" | "sbp" | "dbp" | "rr" | "spo2";
  patientAge: number;
  patientSex: "M" | "F" | "U";
  placeholder?: string;
  step?: number;
}

export function EnhancedVitalsInput({
  name,
  label,
  unit,
  metric,
  patientAge,
  patientSex,
  placeholder,
  step = 1,
}: EnhancedVitalsInputProps) {
  const {
    register,
    watch,
    formState: { errors },
  } = useFormContext();
  const [range, setRange] = useState<VitalsRange | null>(null);
  const [status, setStatus] = useState<
    "normal" | "low" | "high" | "critical" | null
  >(null);
  const [loading, setLoading] = useState(true);

  const value = Number(watch(name)) || 0;

  useEffect(() => {
    loadVitalRange();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric, patientAge, patientSex]);

  useEffect(() => {
    if (range && value > 0) {
      calculateStatus();
    } else {
      setStatus(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, range]);

  const loadVitalRange = async () => {
    try {
      const vitalsRange = await db.vitalsRanges
        .where("metric")
        .equals(metric)
        .and((r) => r.sex === patientSex || r.sex === "U")
        .and((r) => patientAge >= r.ageMin && patientAge <= r.ageMax)
        .first();

      setRange(vitalsRange || null);
    } catch (error) {
      console.error(
        "Error loading vital range:",
        error instanceof Error ? error.name : error,
      );
    } finally {
      setLoading(false);
    }
  };

  const calculateStatus = () => {
    if (!range || value <= 0) {
      setStatus(null);
      return;
    }

    const { min, max } = range;
    const criticalLow = min * 0.7; // 30% below normal
    const criticalHigh = max * 1.3; // 30% above normal

    if (value < criticalLow || value > criticalHigh) {
      setStatus("critical");
    } else if (value < min) {
      setStatus("low");
    } else if (value > max) {
      setStatus("high");
    } else {
      setStatus("normal");
    }
  };

  const getStatusDisplay = () => {
    switch (status) {
      case "critical":
        return {
          icon: ExclamationTriangleIcon,
          color: "banner-danger",
          message: "Critical value - immediate attention required",
          priority: "high",
        };
      case "high":
        return {
          icon: ExclamationTriangleIcon,
          color: "banner-warning",
          message: "Above normal - consider recheck",
          priority: "medium",
        };
      case "low":
        return {
          icon: ExclamationTriangleIcon,
          color: "banner-warning",
          message: "Below normal - verify reading",
          priority: "medium",
        };
      case "normal":
        return {
          icon: CheckCircleIcon,
          color: "banner-success",
          message: "Within normal range",
          priority: "low",
        };
      default:
        return null;
    }
  };

  const statusDisplay = getStatusDisplay();

  const inputId = `vitals-${name}`;
  const errorId = `${name}-error`;
  const statusId = `${name}-status`;
  const rangeId = `${name}-range`;
  const hasError = !!errors[name];

  return (
    <div className="space-y-2">
      <label
        htmlFor={inputId}
        className="field-label"
      >
        {label}
        {range && !loading && (
          <span className="ml-2 text-caption font-normal text-ink-muted">
            (Normal: {range.min}-{range.max} {unit})
          </span>
        )}
      </label>

      <div className="relative">
        <input
          {...register(name, {
            valueAsNumber: true,
            required: `${label} is required`,
          })}
          id={inputId}
          type="number"
          step={step}
          className={`input-field pr-10 tabular-nums ${
            statusDisplay?.priority === "high"
              ? "border-danger"
              : statusDisplay?.priority === "medium"
                ? "border-warning"
                : status === "normal"
                  ? "border-success"
                  : ""
          }`}
          placeholder={placeholder}
          aria-invalid={hasError ? "true" : "false"}
          aria-describedby={
            [
              hasError ? errorId : null,
              statusDisplay ? statusId : null,
              range ? rangeId : null,
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
        />

        {statusDisplay && (
          <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
            <statusDisplay.icon
              className={`h-5 w-5 ${
                statusDisplay.priority === "high"
                  ? "text-danger"
                  : statusDisplay.priority === "medium"
                    ? "text-warning"
                    : "text-success"
              }`}
              aria-hidden="true"
            />
          </div>
        )}
      </div>

      {/* Status Message */}
      {statusDisplay && (
        <div
          id={statusId}
          className={`banner px-3 py-2 text-label ${statusDisplay.color}`}
          role={statusDisplay.priority === "high" ? "alert" : "status"}
          aria-live={statusDisplay.priority === "high" ? "assertive" : "polite"}
        >
          <statusDisplay.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{statusDisplay.message}</span>
        </div>
      )}

      {/* Range Info */}
      {range && !loading && (
        <p id={rangeId} className="text-caption text-ink-muted">
          Age {patientAge},{" "}
          {patientSex === "M"
            ? "Male"
            : patientSex === "F"
              ? "Female"
              : "Unknown"}{" "}
          • Source: {range.source}
        </p>
      )}

      {/* Validation Error */}
      {hasError && (
        <p id={errorId} className="field-error" role="alert">
          {String(errors[name]?.message || "")}
        </p>
      )}
    </div>
  );
}
