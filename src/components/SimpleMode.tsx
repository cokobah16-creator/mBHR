import React from "react";
import { useT } from "@/hooks/useT";
import {
  UserPlusIcon,
  HeartIcon,
  DocumentTextIcon,
  BeakerIcon,
  QueueListIcon,
} from "@heroicons/react/24/outline";

interface SimpleModeProps {
  onActionSelect: (action: string) => void;
}

export function SimpleMode({ onActionSelect }: SimpleModeProps) {
  const { t, speak } = useT();

  // The icon tile carries the patient-flow stage colour as a small marker;
  // the cards themselves stay neutral.
  const actions = [
    {
      id: "register",
      icon: UserPlusIcon,
      marker: "bg-stage-registration-soft text-stage-registration",
      textKey: "action.register" as const,
      audioKey: "action.register" as const,
    },
    {
      id: "vitals",
      icon: HeartIcon,
      marker: "bg-stage-vitals-soft text-stage-vitals",
      textKey: "action.vitals" as const,
      audioKey: "action.vitals" as const,
    },
    {
      id: "consult",
      icon: DocumentTextIcon,
      marker: "bg-stage-consult-soft text-stage-consult",
      textKey: "action.consult" as const,
      audioKey: "action.consult" as const,
    },
    {
      id: "pharmacy",
      icon: BeakerIcon,
      marker: "bg-stage-pharmacy-soft text-stage-pharmacy",
      textKey: "action.pharmacy" as const,
      audioKey: "action.pharmacy" as const,
    },
    {
      id: "queue",
      icon: QueueListIcon,
      marker: "bg-surface-sunken text-ink-secondary",
      textKey: "action.queue" as const,
      audioKey: "action.queue" as const,
    },
  ];

  const handleActionClick = async (action: (typeof actions)[0]) => {
    // Play audio prompt
    try {
      await speak(action.audioKey);
    } catch (error) {
      console.warn(
        "Audio playback failed:",
        error instanceof Error ? error.name : error,
      );
    }

    onActionSelect(action.id);
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <div className="text-center mb-8">
        <h1 className="text-display text-ink mb-2">{t("app.title")}</h1>
        <p className="text-h2 font-normal text-ink-secondary">
          {t("simple.chooseAction")}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            onClick={() => handleActionClick(action)}
            className="card touch-target-large flex flex-col items-center gap-3 p-6 text-center transition-colors hover:border-line-strong hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span
              className={`flex h-16 w-16 items-center justify-center rounded-lg ${action.marker}`}
              aria-hidden
            >
              <action.icon className="h-10 w-10" />
            </span>
            <span className="text-h2 text-ink">{t(action.textKey)}</span>
            <span className="text-body text-ink-muted">
              {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                t(`${action.textKey}.description` as any)
              }
            </span>
          </button>
        ))}
      </div>

      <div className="mt-8 text-center">
        <p className="text-body text-ink-muted">{t("simple.tapToHear")}</p>
      </div>
    </div>
  );
}
