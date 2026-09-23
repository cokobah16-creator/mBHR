import React, { useState, useEffect } from "react";
import { useT } from "@/hooks/useT";
import { useAuthStore } from "@/stores/auth";
import { db, generateId } from "@/db";
import { can } from "@/auth/roles";
import { recordStageEvent } from "@/services/stageEvents";
import { VisualNumberInput } from "@/components/VisualNumberInput";
import { assessVitals, getFlagTone, getFlagLabel } from "@/utils/vitals";
import { StatusBadge, type Tone } from "@/components/ui/StatusBadge";
import {
  HeartIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";

interface VitalsRange {
  metric: string;
  min: number;
  max: number;
  unit: string;
}

interface EnhancedVitalsFormProps {
  patientId: string;
  visitId: string;
  patientAge: number;
  patientSex: "M" | "F" | "U";
  onSuccess?: () => void;
  onCancel?: () => void;
}

export default function EnhancedVitalsForm({
  patientId,
  visitId,
  patientAge,
  patientSex,
  onSuccess,
  onCancel,
}: EnhancedVitalsFormProps) {
  const { t } = useT();
  const { currentUser } = useAuthStore();
  const [vitals, setVitals] = useState({
    heightCm: 0,
    weightKg: 0,
    tempC: 36.5,
    pulseBpm: 72,
    systolic: 120,
    diastolic: 80,
    spo2: 98,
  });
  const [ranges, setRanges] = useState<Record<string, VitalsRange>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [bmi, setBmi] = useState<number | null>(null);
  const [flags, setFlags] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadVitalsRanges();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientAge, patientSex]);

  useEffect(() => {
    validateVitals();
    calculateBMIAndFlags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vitals, ranges]);

  const loadVitalsRanges = async () => {
    try {
      // Load age/sex-specific ranges from database
      const vitalsRanges = await db.vitalsRanges
        .where("sex")
        .equals(patientSex)
        .and(
          (range) => patientAge >= range.ageMin && patientAge <= range.ageMax,
        )
        .toArray();

      const rangeMap: Record<string, VitalsRange> = {};
      vitalsRanges.forEach((range) => {
        rangeMap[range.metric] = {
          metric: range.metric,
          min: range.min,
          max: range.max,
          unit: getMetricUnit(range.metric),
        };
      });

      // Fallback to adult ranges if no specific ranges found
      if (Object.keys(rangeMap).length === 0) {
        rangeMap.hr = { metric: "hr", min: 60, max: 100, unit: "bpm" };
        rangeMap.temp = { metric: "temp", min: 36.1, max: 37.2, unit: "°C" };
        rangeMap.sbp = { metric: "sbp", min: 90, max: 140, unit: "mmHg" };
        rangeMap.dbp = { metric: "dbp", min: 60, max: 90, unit: "mmHg" };
        rangeMap.rr = { metric: "rr", min: 12, max: 20, unit: "/min" };
        rangeMap.spo2 = { metric: "spo2", min: 95, max: 100, unit: "%" };
      }

      setRanges(rangeMap);
    } catch (error) {
      console.error(
        "Error loading vitals ranges:",
        error instanceof Error ? error.name : error,
      );
    }
  };

  const getMetricUnit = (metric: string): string => {
    const units = {
      hr: "bpm",
      temp: "°C",
      sbp: "mmHg",
      dbp: "mmHg",
      rr: "/min",
      spo2: "%",
    };
    return units[metric as keyof typeof units] || "";
  };

  const validateVitals = () => {
    const newWarnings: string[] = [];

    // Check each vital against normal ranges
    Object.entries(vitals).forEach(([key, value]) => {
      if (value <= 0) return;

      let metric = key;
      if (key === "pulseBpm") metric = "hr";
      if (key === "tempC") metric = "temp";

      const range = ranges[metric];
      if (range && (value < range.min || value > range.max)) {
        const status = value < range.min ? "low" : "high";
        newWarnings.push(
          `${range.metric.toUpperCase()} ${status}: ${value} (normal: ${range.min}-${range.max})`,
        );
      }
    });

    // Special validations
    if (
      vitals.systolic > 0 &&
      vitals.diastolic > 0 &&
      vitals.systolic <= vitals.diastolic
    ) {
      newWarnings.push("Systolic pressure should be higher than diastolic");
    }

    if (vitals.heightCm > 0 && vitals.heightCm < 50) {
      newWarnings.push("Height seems unusually low - please verify");
    }

    if (vitals.weightKg > 0 && vitals.weightKg < 2) {
      newWarnings.push("Weight seems unusually low - please verify");
    }

    setWarnings(newWarnings);
  };

  const calculateBMIAndFlags = () => {
    const assessment = assessVitals(vitals);
    setBmi(assessment.bmi);
    setFlags(assessment.flags);
  };

  const handleSubmit = async () => {
    // Permission is checked at the point of writing, not only by the route.
    if (!currentUser || !can(currentUser.role, "vitals")) {
      alert("Your role cannot record vital signs. Nothing was saved.");
      return;
    }

    if (warnings.length > 0) {
      const proceed = confirm(
        `There are ${warnings.length} warnings about these vitals. Do you want to proceed?\n\n${warnings.join("\n")}`,
      );
      if (!proceed) return;
    }

    setLoading(true);
    try {
      const vital = {
        id: generateId(),
        patientId,
        visitId,
        heightCm: vitals.heightCm || undefined,
        weightKg: vitals.weightKg || undefined,
        tempC: vitals.tempC || undefined,
        pulseBpm: vitals.pulseBpm || undefined,
        systolic: vitals.systolic || undefined,
        diastolic: vitals.diastolic || undefined,
        spo2: vitals.spo2 || undefined,
        bmi: bmi || undefined,
        flags,
        takenAt: new Date(),
        _dirty: 1,
      };

      await db.vitals.add(vital);

      // Create audit log
      await db.auditLogs.add({
        id: generateId(),
        actorRole: currentUser?.role || "unknown",
        action: "create",
        entity: "vital",
        entityId: vital.id,
        at: new Date(),
      });

      await recordStageEvent({
        stage: "vitals",
        kind: "finish",
        visitId,
        patientId,
        actorId: currentUser?.id,
      });

      onSuccess?.();
    } catch (error) {
      console.error(
        "Error saving vitals:",
        error instanceof Error ? error.name : error,
      );
      alert("Failed to save vitals");
    } finally {
      setLoading(false);
    }
  };

  const getVitalStatus = (key: string, value: number) => {
    if (value <= 0) return null;

    let metric = key;
    if (key === "pulseBpm") metric = "hr";
    if (key === "tempC") metric = "temp";

    const range = ranges[metric];
    if (!range) return null;

    if (value < range.min) return "low";
    if (value > range.max) return "high";
    return "normal";
  };

  const getStatusTone = (status: string | null): Tone => {
    switch (status) {
      case "low":
      case "high":
        return "warning";
      case "normal":
        return "success";
      default:
        return "neutral";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <HeartIcon className="h-6 w-6 text-ink-muted" aria-hidden />
        <div>
          <h2 className="text-h2 text-ink">
            Enhanced Vitals Recording
          </h2>
          <p className="text-body text-ink-muted">
            Age: {patientAge} years • Sex:{" "}
            {patientSex === "M"
              ? "Male"
              : patientSex === "F"
                ? "Female"
                : "Unknown"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Vitals Input */}
        <div className="space-y-6">
          {/* Height and Weight */}
          <div className="card">
            <h3 className="text-h3 text-ink mb-4">
              Anthropometric
            </h3>
            <div className="space-y-6">
              <VisualNumberInput
                value={vitals.heightCm}
                onChange={(value) =>
                  setVitals((prev) => ({ ...prev, heightCm: value }))
                }
                min={50}
                max={250}
                label={t("vitals.height")}
                unit="cm"
                showDots={false}
              />

              <VisualNumberInput
                value={vitals.weightKg}
                onChange={(value) =>
                  setVitals((prev) => ({ ...prev, weightKg: value }))
                }
                min={2}
                max={200}
                label={t("vitals.weight")}
                unit="kg"
                showDots={false}
              />
            </div>
          </div>

          {/* Vital Signs */}
          <div className="card">
            <h3 className="text-h3 text-ink mb-4">
              Vital Signs
            </h3>
            <div className="space-y-6">
              <VisualNumberInput
                value={vitals.tempC}
                onChange={(value) =>
                  setVitals((prev) => ({ ...prev, tempC: value }))
                }
                min={30}
                max={45}
                step={0.1}
                label={t("vitals.temperature")}
                unit="°C"
                showDots={false}
              />

              <VisualNumberInput
                value={vitals.pulseBpm}
                onChange={(value) =>
                  setVitals((prev) => ({ ...prev, pulseBpm: value }))
                }
                min={30}
                max={200}
                label={t("vitals.pulse")}
                unit="bpm"
                showDots={false}
              />

              <div>
                <p className="block text-h3 text-ink-secondary mb-4 text-center">
                  {t("vitals.bloodPressure")}
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <VisualNumberInput
                    value={vitals.systolic}
                    onChange={(value) =>
                      setVitals((prev) => ({ ...prev, systolic: value }))
                    }
                    min={60}
                    max={250}
                    label="Systolic"
                    unit="mmHg"
                    showDots={false}
                  />
                  <VisualNumberInput
                    value={vitals.diastolic}
                    onChange={(value) =>
                      setVitals((prev) => ({ ...prev, diastolic: value }))
                    }
                    min={30}
                    max={150}
                    label="Diastolic"
                    unit="mmHg"
                    showDots={false}
                  />
                </div>
              </div>

              <VisualNumberInput
                value={vitals.spo2}
                onChange={(value) =>
                  setVitals((prev) => ({ ...prev, spo2: value }))
                }
                min={70}
                max={100}
                label="SpO2"
                unit="%"
                showDots={false}
              />
            </div>
          </div>
        </div>

        {/* Validation and Results */}
        <div className="space-y-6">
          {/* BMI Display */}
          {bmi && (
            <div className="card">
              <div className="text-center">
                <h3 className="text-h3 text-ink mb-2">
                  Body Mass Index
                </h3>
                <div className="text-display tabular-nums text-ink">{bmi}</div>
                <div className="text-body text-ink-secondary mt-2">
                  {bmi < 18.5
                    ? "Underweight"
                    : bmi < 25
                      ? "Normal"
                      : bmi < 30
                        ? "Overweight"
                        : "Obese"}
                </div>
              </div>
            </div>
          )}

          {/* Vital Status Indicators */}
          <div className="card">
            <h3 className="text-h3 text-ink mb-4">
              Range Validation
            </h3>
            <div className="space-y-3">
              {Object.entries(vitals).map(([key, value]) => {
                if (value <= 0) return null;

                const status = getVitalStatus(key, value);
                const range =
                  ranges[
                    key === "pulseBpm" ? "hr" : key === "tempC" ? "temp" : key
                  ];

                return (
                  <div
                    key={key}
                    className="flex items-center justify-between p-3 rounded-md border border-line"
                  >
                    <div>
                      <span className="font-medium text-ink">
                        {key === "heightCm"
                          ? "Height"
                          : key === "weightKg"
                            ? "Weight"
                            : key === "tempC"
                              ? "Temperature"
                              : key === "pulseBpm"
                                ? "Pulse"
                                : key === "systolic"
                                  ? "Systolic"
                                  : key === "diastolic"
                                    ? "Diastolic"
                                    : key === "spo2"
                                      ? "SpO2"
                                      : key}
                      </span>
                      <div className="text-body text-ink-secondary">
                        {value} {getMetricUnit(key)}
                        {range && ` (normal: ${range.min}-${range.max})`}
                      </div>
                    </div>
                    {status && (
                      <StatusBadge tone={getStatusTone(status)} icon>
                        {status}
                      </StatusBadge>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Warnings */}
          {warnings.length > 0 && (
            <div className="rounded-lg border border-warning-line bg-warning-soft p-4 text-warning-fg">
              <div className="flex items-center space-x-2 mb-3">
                <ExclamationTriangleIcon className="h-5 w-5 text-warning" aria-hidden />
                <h3 className="text-h3">
                  Validation Warnings
                </h3>
              </div>
              <ul className="text-body space-y-1">
                {warnings.map((warning, index) => (
                  <li key={index}>• {warning}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Clinical Flags */}
          {flags.length > 0 && (
            <div className="rounded-lg border border-danger-line bg-danger-soft p-4 text-danger-fg">
              <div className="flex items-center space-x-2 mb-3">
                <ExclamationTriangleIcon className="h-5 w-5 text-danger" aria-hidden />
                <h3 className="text-h3">Clinical Alerts</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {flags.map((flag) => (
                  <StatusBadge key={flag} tone={getFlagTone(flag)}>
                    {getFlagLabel(flag)}
                  </StatusBadge>
                ))}
              </div>
            </div>
          )}

          {/* Normal Ranges Reference */}
          <div className="card bg-surface-sunken">
            <h3 className="text-h3 text-ink mb-4">
              Normal Ranges
            </h3>
            <div className="text-body text-ink-secondary space-y-2">
              <p>
                <strong>Age Group:</strong>{" "}
                {patientAge < 18 ? "Pediatric" : "Adult"}
              </p>
              <p>
                <strong>Sex:</strong>{" "}
                {patientSex === "M"
                  ? "Male"
                  : patientSex === "F"
                    ? "Female"
                    : "Unknown"}
              </p>
              {Object.values(ranges).map((range) => (
                <p key={range.metric}>
                  <strong>{range.metric.toUpperCase()}:</strong> {range.min}-
                  {range.max} {range.unit}
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex space-x-4">
        <button
          onClick={handleSubmit}
          disabled={loading || Object.values(vitals).every((v) => v <= 0)}
          className="btn-primary flex-1"
        >
          {loading ? "Saving…" : "Save Enhanced Vitals"}
        </button>
        {onCancel && (
          <button onClick={onCancel} className="btn-secondary">
            {t("action.cancel")}
          </button>
        )}
      </div>
    </div>
  );
}
