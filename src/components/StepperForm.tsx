import React, { useState } from "react";
import { useT } from "@/hooks/useT";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CheckIcon,
  SpeakerWaveIcon,
} from "@heroicons/react/24/outline";

interface StepperFormProps {
  steps: Array<{
    id: string;
    title: string;
    component: React.ReactNode;
    isValid?: boolean;
    audioKey?: string;
  }>;
  onComplete: () => void;
  onCancel?: () => void;
  /** Saving in progress: Back and Complete wait until it has finished. */
  busy?: boolean;
  className?: string;
}

export function StepperForm({
  steps,
  onComplete,
  onCancel,
  busy = false,
  className = "",
}: StepperFormProps) {
  const { t, speak } = useT();
  const [currentStep, setCurrentStep] = useState(0);

  const canGoPrev = currentStep > 0;
  const isLastStep = currentStep === steps.length - 1;
  const currentStepData = steps[currentStep];

  const handleNext = async () => {
    if (busy) return;
    if (isLastStep) {
      onComplete();
    } else {
      setCurrentStep(currentStep + 1);

      // Play audio for next step
      const nextStep = steps[currentStep + 1];
      if (nextStep.audioKey) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await speak(nextStep.audioKey as any);
        } catch (error) {
          console.warn(
            "Audio playback failed:",
            error instanceof Error ? error.name : error,
          );
        }
      }
    }
  };

  const handlePrev = () => {
    if (canGoPrev && !busy) {
      setCurrentStep(currentStep - 1);
    }
  };

  const playStepAudio = async () => {
    if (currentStepData.audioKey) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await speak(currentStepData.audioKey as any);
      } catch (error) {
        console.warn(
          "Audio playback failed:",
          error instanceof Error ? error.name : error,
        );
      }
    }
  };

  return (
    <div className={`max-w-2xl mx-auto ${className}`}>
      {/* Progress Indicator */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <span className="text-label text-ink-secondary">
            {t("stepper.step")} {currentStep + 1} {t("common.of")}{" "}
            {steps.length}
          </span>
          <span className="text-caption tabular-nums text-ink-muted">
            {Math.round(((currentStep + 1) / steps.length) * 100)}%
          </span>
        </div>

        <div
          className="w-full bg-surface-sunken border border-line rounded-full h-3"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-valuenow={currentStep + 1}
          aria-valuetext={`${t("stepper.step")} ${currentStep + 1} ${t("common.of")} ${steps.length}: ${currentStepData.title}`}
        >
          <div
            className="bg-primary h-full rounded-full transition-[width] duration-150"
            style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
          />
        </div>

        <ol className="flex justify-between mt-2">
          {steps.map((step, index) => (
            <li
              key={step.id}
              aria-current={index === currentStep ? "step" : undefined}
              className={`w-8 h-8 rounded-full flex items-center justify-center text-label transition-colors ${
                index < currentStep
                  ? "bg-success text-white"
                  : index === currentStep
                    ? "bg-primary text-white"
                    : "bg-surface-sunken border border-line-strong text-ink-muted"
              }`}
            >
              {index < currentStep ? (
                <CheckIcon className="h-4 w-4" aria-hidden />
              ) : (
                <span aria-hidden>{index + 1}</span>
              )}
              <span className="sr-only">
                {step.title}
                {index < currentStep
                  ? " (done)"
                  : index === currentStep
                    ? " (current)"
                    : ""}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/* Step Header */}
      <div className="text-center mb-6">
        <div className="flex items-center justify-center space-x-3 mb-2">
          <h2 className="text-h1 text-ink">
            {currentStepData.title}
          </h2>
          {currentStepData.audioKey && (
            <button
              type="button"
              onClick={playStepAudio}
              className="btn-ghost px-2"
              title={t("accessibility.playAudio")}
              aria-label={t("accessibility.playAudio")}
            >
              <SpeakerWaveIcon className="h-5 w-5" aria-hidden />
            </button>
          )}
        </div>
      </div>

      {/* Step Content */}
      <div className="card mb-8">{currentStepData.component}</div>

      {/* Navigation */}
      <div className="flex justify-between items-center">
        <button
          type="button"
          onClick={handlePrev}
          disabled={!canGoPrev || busy}
          className="btn-secondary"
        >
          <ChevronLeftIcon className="h-5 w-5" aria-hidden />
          <span>{t("action.back")}</span>
        </button>

        <div className="flex space-x-4">
          {onCancel && (
            <button type="button" onClick={onCancel} className="btn-secondary">
              {t("action.cancel")}
            </button>
          )}

          <button
            type="button"
            onClick={handleNext}
            disabled={currentStepData.isValid === false || busy}
            className="btn-primary"
          >
            <span>
              {busy
                ? t("status.saving")
                : isLastStep
                  ? t("action.complete")
                  : t("action.next")}
            </span>
            {!isLastStep && <ChevronRightIcon className="h-5 w-5" aria-hidden />}
          </button>
        </div>
      </div>
    </div>
  );
}
