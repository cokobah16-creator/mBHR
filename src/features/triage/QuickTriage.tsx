import { useState } from "react";
import { useT } from "@/hooks/useT";
import { useAuthStore } from "@/stores/auth";
import { can } from "@/auth/roles";
import { db, generateId } from "@/db";
import { StatusBadge, type Tone } from "@/components/ui/StatusBadge";
import {
  ExclamationTriangleIcon,
  ExclamationCircleIcon,
  CheckCircleIcon,
  ClockIcon,
  UserIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";

type Priority = "urgent" | "normal" | "low";

interface QuickTriageProps {
  patientId?: string;
  onComplete?: (
    priority: "urgent" | "normal" | "low",
    queueStage: string,
  ) => void;
  onCancel?: () => void;
}

const PRIORITY_TONE: Record<Priority, Tone> = {
  urgent: "danger",
  normal: "neutral",
  low: "neutral",
};

const NEXT_STAGE_LABEL: Record<string, string> = {
  vitals: "Vital signs",
  consult: "Consultation",
};

/**
 * Base64 of the case, as before. btoa() rejects characters outside Latin-1
 * (e.g. Yoruba or Hausa letters in the complaint), so fall back to UTF-8.
 */
function encodeCase(json: string): string {
  try {
    return btoa(json);
  } catch {
    const bytes = new TextEncoder().encode(json);
    let binary = "";
    bytes.forEach((b) => {
      binary += String.fromCharCode(b);
    });
    return btoa(binary);
  }
}

function SafetyIcon({ safe }: { safe: boolean }) {
  return safe ? (
    <CheckCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
  ) : (
    <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
  );
}

export default function QuickTriage({
  patientId,
  onComplete,
  onCancel,
}: QuickTriageProps) {
  const { t } = useT();
  const { currentUser } = useAuthStore();
  const [selectedPriority, setSelectedPriority] = useState<Priority | null>(
    null,
  );
  const [chiefComplaint, setChiefComplaint] = useState("");
  const [abcAssessment, setAbcAssessment] = useState({
    airway: "clear",
    breathing: "normal",
    circulation: "normal",
  });
  const [vitalSigns, setVitalSigns] = useState({
    conscious: true,
    responsive: true,
    skinColor: "normal",
    temperature: "normal",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<{
    priority: Priority;
    queueStage: string;
  } | null>(null);

  const priorityOptions: Array<{
    value: Priority;
    label: string;
    description: string;
    icon: typeof UserIcon;
    examples: string[];
  }> = [
    {
      value: "urgent",
      label: t("triage.priority.urgent"),
      description: "Immediate attention required",
      icon: ExclamationCircleIcon,
      examples: [
        "Chest pain",
        "Difficulty breathing",
        "Unconscious",
        "Severe bleeding",
      ],
    },
    {
      value: "normal",
      label: t("triage.priority.normal"),
      description: "Standard care pathway",
      icon: UserIcon,
      examples: ["Fever", "Cough", "Minor injuries", "Routine check-up"],
    },
    {
      value: "low",
      label: t("triage.priority.low"),
      description: "Can wait for routine care",
      icon: ClockIcon,
      examples: ["Minor cuts", "Prescription refills", "Health education"],
    },
  ];

  const abcOptions = {
    airway: [
      { value: "clear", label: "Clear", safe: true },
      { value: "partial", label: "Partially obstructed", safe: false },
      { value: "obstructed", label: "Obstructed", safe: false },
    ],
    breathing: [
      { value: "normal", label: "Normal", safe: true },
      { value: "labored", label: "Labored", safe: false },
      { value: "absent", label: "Absent/Minimal", safe: false },
    ],
    circulation: [
      { value: "normal", label: "Normal pulse", safe: true },
      { value: "weak", label: "Weak pulse", safe: false },
      { value: "absent", label: "No pulse", safe: false },
    ],
  };

  const calculateSuggestedPriority = (): "urgent" | "normal" | "low" => {
    // ABC assessment takes priority
    if (
      abcAssessment.airway !== "clear" ||
      abcAssessment.breathing !== "normal" ||
      abcAssessment.circulation !== "normal"
    ) {
      return "urgent";
    }

    // Consciousness check
    if (!vitalSigns.conscious || !vitalSigns.responsive) {
      return "urgent";
    }

    // Temperature check
    if (vitalSigns.temperature === "high") {
      return "normal";
    }

    // Skin color check
    if (vitalSigns.skinColor !== "normal") {
      return "urgent";
    }

    // Chief complaint keywords
    const urgentKeywords = [
      "chest pain",
      "difficulty breathing",
      "severe pain",
      "bleeding",
      "unconscious",
    ];
    const complaint = chiefComplaint.toLowerCase();
    if (urgentKeywords.some((keyword) => complaint.includes(keyword))) {
      return "urgent";
    }

    return "normal";
  };

  const suggestedPriority = calculateSuggestedPriority();
  const priorityLabel = (p: Priority) =>
    priorityOptions.find((o) => o.value === p)?.label ?? p;

  const resetForm = () => {
    setSelectedPriority(null);
    setChiefComplaint("");
    setAbcAssessment({ airway: "clear", breathing: "normal", circulation: "normal" });
    setVitalSigns({
      conscious: true,
      responsive: true,
      skinColor: "normal",
      temperature: "normal",
    });
    setError("");
    setSaved(null);
  };

  const handleSubmit = async () => {
    if (!selectedPriority) return;
    setError("");

    if (!currentUser) {
      setError("Sign in again to record triage.");
      return;
    }

    if (!can(currentUser.role, "vitals")) {
      setError("Your role cannot record triage. Ask a nurse or clinician.");
      return;
    }

    setLoading(true);
    try {
      // Store in triage samples for training data
      await db.triageSamples.add({
        id: generateId(),
        createdAt: new Date(),
        caseHash: encodeCase(
          JSON.stringify({ chiefComplaint, abcAssessment, vitalSigns }),
        ),
        goldPriority: selectedPriority,
        createdBy: currentUser.id,
      });

      // Determine next queue stage based on priority
      let queueStage = "vitals";
      if (selectedPriority === "urgent") {
        queueStage = "consult"; // Skip vitals for urgent cases
      }

      setSaved({ priority: selectedPriority, queueStage });
      onComplete?.(selectedPriority, queueStage);
    } catch (err) {
      console.error(
        "Error saving triage assessment:",
        err instanceof Error ? err.name : err,
      );
      setError("The triage was not saved. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const choiceClass = (selected: boolean, safe: boolean) =>
    `flex min-h-touch-target items-center gap-2 rounded-md border px-3 py-2 text-left text-body transition-colors ${
      selected
        ? safe
          ? "border-success-line bg-success-soft text-success-fg"
          : "border-danger-line bg-danger-soft text-danger-fg"
        : "border-line bg-surface text-ink hover:bg-surface-hover"
    }`;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <ExclamationTriangleIcon className="h-6 w-6 text-ink-muted" aria-hidden />
        <div>
          <h2 className="text-h2 text-ink">Quick triage</h2>
          <p className="text-body text-ink-muted">
            Rapid priority assessment for patient flow
            {!patientId && " · walk-in, not linked to a patient record"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Assessment Form */}
        <div className="space-y-4">
          {/* Chief Complaint */}
          <div className="panel">
            <div className="panel-body">
              <label htmlFor="qt-complaint" className="field-label">
                Chief complaint
              </label>
              <textarea
                id="qt-complaint"
                value={chiefComplaint}
                onChange={(e) => setChiefComplaint(e.target.value)}
                className="input-field"
                rows={3}
                placeholder="What is the main problem? (e.g. chest pain, fever, cough)"
              />
            </div>
          </div>

          {/* ABC Assessment */}
          <section className="panel" aria-labelledby="qt-abc-title">
            <div className="panel-header">
              <h3 id="qt-abc-title" className="panel-title">
                ABC assessment
              </h3>
            </div>
            <div className="panel-body space-y-4">
              {Object.entries(abcOptions).map(([category, options]) => (
                <fieldset key={category}>
                  <legend className="field-label capitalize">{category}</legend>
                  <div className="grid grid-cols-1 gap-2">
                    {options.map((option) => {
                      const selected =
                        abcAssessment[category as keyof typeof abcAssessment] ===
                        option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={selected}
                          onClick={() =>
                            setAbcAssessment((prev) => ({
                              ...prev,
                              [category]: option.value,
                            }))
                          }
                          className={choiceClass(selected, option.safe)}
                        >
                          <span className={selected ? "" : option.safe ? "text-success" : "text-danger"}>
                            <SafetyIcon safe={option.safe} />
                          </span>
                          <span className="font-medium">{option.label}</span>
                          {!option.safe && (
                            <span className="sr-only">(concerning)</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
            </div>
          </section>

          {/* Quick Vitals */}
          <section className="panel" aria-labelledby="qt-quick-title">
            <div className="panel-header">
              <h3 id="qt-quick-title" className="panel-title">
                Quick vital assessment
              </h3>
            </div>
            <div className="panel-body space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <fieldset>
                  <legend className="field-label">Conscious</legend>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      aria-pressed={vitalSigns.conscious}
                      onClick={() =>
                        setVitalSigns((prev) => ({ ...prev, conscious: true }))
                      }
                      className={`flex-1 justify-center ${choiceClass(vitalSigns.conscious, true)}`}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      aria-pressed={!vitalSigns.conscious}
                      onClick={() =>
                        setVitalSigns((prev) => ({ ...prev, conscious: false }))
                      }
                      className={`flex-1 justify-center ${choiceClass(!vitalSigns.conscious, false)}`}
                    >
                      {!vitalSigns.conscious && <SafetyIcon safe={false} />}
                      No
                    </button>
                  </div>
                </fieldset>

                <fieldset>
                  <legend className="field-label">Responsive</legend>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      aria-pressed={vitalSigns.responsive}
                      onClick={() =>
                        setVitalSigns((prev) => ({ ...prev, responsive: true }))
                      }
                      className={`flex-1 justify-center ${choiceClass(vitalSigns.responsive, true)}`}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      aria-pressed={!vitalSigns.responsive}
                      onClick={() =>
                        setVitalSigns((prev) => ({
                          ...prev,
                          responsive: false,
                        }))
                      }
                      className={`flex-1 justify-center ${choiceClass(!vitalSigns.responsive, false)}`}
                    >
                      {!vitalSigns.responsive && <SafetyIcon safe={false} />}
                      No
                    </button>
                  </div>
                </fieldset>
              </div>

              <fieldset>
                <legend className="field-label">Skin colour</legend>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: "normal", label: "Normal", safe: true },
                    { value: "pale", label: "Pale", safe: false },
                    { value: "cyanotic", label: "Blue/Grey", safe: false },
                  ].map((option) => {
                    const selected = vitalSigns.skinColor === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() =>
                          setVitalSigns((prev) => ({
                            ...prev,
                            skinColor: option.value,
                          }))
                        }
                        className={`justify-center ${choiceClass(selected, option.safe)}`}
                      >
                        {selected && !option.safe && <SafetyIcon safe={false} />}
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            </div>
          </section>
        </div>

        {/* Priority Selection */}
        <div className="space-y-4">
          {/* Rule-based suggestion */}
          <section className="panel" aria-labelledby="qt-suggest-title">
            <div className="panel-header">
              <h3 id="qt-suggest-title" className="panel-title">
                Suggested priority
              </h3>
              <span aria-live="polite">
                <StatusBadge tone={PRIORITY_TONE[suggestedPriority]} icon>
                  {priorityLabel(suggestedPriority)}
                </StatusBadge>
              </span>
            </div>
            <div className="panel-body flex items-start gap-2 text-caption text-ink-muted">
              <InformationCircleIcon className="h-4 w-4 shrink-0" aria-hidden />
              <p>
                Rule-based: airway, breathing, circulation, consciousness, skin
                colour and a few complaint keywords. It is a prompt, not a
                diagnosis — use your clinical judgement.
              </p>
            </div>
          </section>

          {/* Priority Selection */}
          <section className="panel" aria-labelledby="qt-assign-title">
            <div className="panel-header">
              <h3 id="qt-assign-title" className="panel-title">
                Assign priority
              </h3>
            </div>
            <div className="panel-body space-y-3" role="group" aria-labelledby="qt-assign-title">
              {priorityOptions.map((option) => {
                const selected = selectedPriority === option.value;
                const Icon = option.icon;
                const urgent = option.value === "urgent";
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setSelectedPriority(option.value)}
                    className={`w-full rounded-lg border-2 p-4 text-left transition-colors ${
                      selected
                        ? urgent
                          ? "border-danger bg-danger-soft text-danger-fg"
                          : "border-primary bg-primary-soft text-primary-fg"
                        : "border-line bg-surface text-ink hover:bg-surface-hover"
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <Icon
                        className={`h-7 w-7 shrink-0 ${
                          urgent ? "text-danger" : selected ? "" : "text-ink-muted"
                        }`}
                        aria-hidden
                      />
                      <div className="flex-1">
                        <div className="text-h3">{option.label}</div>
                        <div className="text-body">{option.description}</div>
                        <div className="mt-1 text-caption opacity-80">
                          Examples: {option.examples.slice(0, 2).join(", ")}
                        </div>
                      </div>
                      {selected && (
                        <CheckCircleIcon className="h-6 w-6 shrink-0" aria-hidden />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Priority Override Warning */}
          {selectedPriority && selectedPriority !== suggestedPriority && (
            <div className="banner banner-warning" role="status">
              <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
              <div>
                <p className="font-medium">Priority differs from the suggestion</p>
                <p>
                  You selected {priorityLabel(selectedPriority)} but the ABC
                  rules suggest {priorityLabel(suggestedPriority)}. Confirm your
                  clinical judgement.
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="banner banner-danger" role="alert">
              <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
              <span>{error}</span>
            </div>
          )}

          {saved && (
            <div className="banner banner-success" role="status">
              <CheckCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
              <span>
                Triage saved on this device: {priorityLabel(saved.priority)}.
                Suggested next stage:{" "}
                {NEXT_STAGE_LABEL[saved.queueStage] ?? saved.queueStage}.
                {!patientId &&
                  " This walk-in triage is not linked to a patient record or the queue — set the patient's priority when you add them to the queue."}
              </span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {onCancel && (
              <button type="button" onClick={onCancel} className="btn-secondary">
                Cancel
              </button>
            )}
            {saved ? (
              <button type="button" onClick={resetForm} className="btn-secondary flex-1">
                Start a new triage
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!selectedPriority || loading}
                className="btn-primary flex-1"
              >
                {loading
                  ? "Saving…"
                  : selectedPriority
                    ? `Complete triage as ${priorityLabel(selectedPriority)}`
                    : "Complete triage"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
