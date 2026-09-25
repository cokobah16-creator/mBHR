import { useEffect, useRef, useState } from "react";
import { formatNigerianDate } from "@/utils/dateFormat";
import { generateId } from "@/db";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/stores/toast";
import { can } from "@/auth/roles";
import type { Patient } from "@/db";
import { chooseExistingForRegistration } from "@/services/patientMerge";
import { StatusBadge, type Tone } from "@/components/ui/StatusBadge";
import {
  ExclamationTriangleIcon,
  UserIcon,
  PhoneIcon,
  CalendarIcon,
  MapPinIcon,
  XMarkIcon,
  CheckIcon,
} from "@heroicons/react/24/outline";

interface PatientDedupeModalProps {
  newPatient: Partial<Patient>;
  candidates: Patient[];
  onResolve: (action: "merge" | "create_new", winnerId?: string) => void;
  onCancel: () => void;
}

function MatchMark({ matches }: { matches: boolean }) {
  if (!matches) return null;
  return (
    <>
      <CheckIcon className="h-4 w-4 shrink-0 text-success" aria-hidden />
      <span className="sr-only">(matches)</span>
    </>
  );
}

export function PatientDedupeModal({
  newPatient,
  candidates,
  onResolve,
  onCancel,
}: PatientDedupeModalProps) {
  const { currentUser } = useAuthStore();
  const { push } = useToast();
  const [selectedWinner, setSelectedWinner] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);

  // Move focus into the dialog so screen readers announce it and Escape works.
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const handleMerge = async () => {
    if (!selectedWinner || !currentUser) return;
    setError("");

    // Choosing an existing patient needs the same permission as registering.
    // If this registration was already saved as its own record, it is merged
    // into the chosen one, which needs merge_patients (checked in requestMerge).
    if (!can(currentUser.role, "register")) {
      setError("Your role cannot link registrations to existing patients.");
      return;
    }

    setLoading(true);
    try {
      const result = await chooseExistingForRegistration({
        draftId: newPatient.id,
        existingId: selectedWinner,
        actor: { id: currentUser.id, role: currentUser.role },
      });
      if (result.kind === "refused") {
        setError(result.message);
        return;
      }
      if (result.kind === "merged") {
        push({
          id: generateId(),
          tone: result.willSync ? "info" : "warning",
          title: "Records merged on this device",
          body: result.willSync
            ? "The merge is waiting to sync. The server then moves the history to the chosen patient, and other devices update at their next sync."
            : "Cloud sync is not set up on this device, so other devices do not get this merge.",
        });
      }
      onResolve("merge", result.patientId);
    } catch (err) {
      console.error(
        "Choosing the existing patient failed:",
        err instanceof Error ? err.name : "unknown",
      );
      setError(
        "The records were not linked. Nothing was changed. Try again, or register as a new patient.",
      );
    } finally {
      setLoading(false);
    }
  };

  const getMatchScore = (candidate: Patient): number => {
    let score = 0;

    if (
      candidate.phone &&
      newPatient.phone &&
      candidate.phone.replace(/\D/g, "") === newPatient.phone.replace(/\D/g, "")
    ) {
      score += 50;
    }

    if (
      candidate.givenName?.toLowerCase() === newPatient.givenName?.toLowerCase()
    ) {
      score += 20;
    }

    if (
      candidate.familyName?.toLowerCase() ===
      newPatient.familyName?.toLowerCase()
    ) {
      score += 20;
    }

    if (candidate.dob === newPatient.dob) {
      score += 30;
    }

    if (candidate.sex === newPatient.sex) {
      score += 10;
    }

    return score;
  };

  const getMatchLabel = (score: number): { label: string; tone: Tone } => {
    if (score >= 70) return { label: "Likely the same person", tone: "warning" };
    if (score >= 40) return { label: "Possible match", tone: "info" };
    return { label: "Weak match", tone: "neutral" };
  };

  const formatField = (value: unknown): string => {
    if (!value) return "—";
    if (value instanceof Date) return formatNigerianDate(value);
    return String(value);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dedupe-title"
        aria-describedby="dedupe-desc"
        className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg border border-line bg-surface shadow-xl focus:outline-none"
        onKeyDown={(e) => {
          if (e.key === "Escape" && !loading) onCancel();
        }}
      >
        <div className="p-6">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <ExclamationTriangleIcon
                className="mt-0.5 h-6 w-6 shrink-0 text-warning"
                aria-hidden
              />
              <div>
                <h2 id="dedupe-title" className="text-h2 text-ink">
                  This patient may already be registered
                </h2>
                <p id="dedupe-desc" className="text-body text-ink-muted">
                  Compare the details below. Choose the existing record if it is
                  the same person, or register a new patient if not.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="btn-ghost px-2"
              aria-label="Close and go back to the form"
            >
              <XMarkIcon className="h-6 w-6" aria-hidden />
            </button>
          </div>

          <section className="mb-6" aria-labelledby="dedupe-new-title">
            <h3 id="dedupe-new-title" className="section-label mb-2">
              Being registered now
            </h3>
            <dl className="grid grid-cols-2 gap-4 rounded-md border border-line bg-surface-sunken p-4 text-body md:grid-cols-4">
              <div>
                <dt className="text-caption text-ink-muted">Name</dt>
                <dd className="text-ink">
                  {newPatient.givenName} {newPatient.familyName}
                </dd>
              </div>
              <div>
                <dt className="text-caption text-ink-muted">Phone</dt>
                <dd className="text-ink">{formatField(newPatient.phone)}</dd>
              </div>
              <div>
                <dt className="text-caption text-ink-muted">Date of birth</dt>
                <dd className="text-ink">
                  {newPatient.dob
                    ? formatNigerianDate(newPatient.dob)
                    : formatField(newPatient.dob)}
                </dd>
              </div>
              <div>
                <dt className="text-caption text-ink-muted">Sex</dt>
                <dd className="capitalize text-ink">
                  {formatField(newPatient.sex)}
                </dd>
              </div>
            </dl>
          </section>

          <fieldset className="mb-6">
            <legend className="section-label mb-2">
              Existing patients ({candidates.length} found)
            </legend>
            <div className="space-y-3">
              {candidates.map((candidate) => {
                const matchScore = getMatchScore(candidate);
                const matchInfo = getMatchLabel(matchScore);
                const isSelected = selectedWinner === candidate.id;
                const phoneMatches = candidate.phone === newPatient.phone;
                const dobMatches = candidate.dob === newPatient.dob;
                const sexMatches = candidate.sex === newPatient.sex;

                return (
                  <label
                    key={candidate.id}
                    className={`block cursor-pointer rounded-lg border p-4 transition-colors focus-within:ring-2 focus-within:ring-primary ${
                      isSelected
                        ? "border-primary bg-primary-soft"
                        : "border-line hover:bg-surface-hover"
                    }`}
                  >
                    <input
                      type="radio"
                      name="dedupe-candidate"
                      value={candidate.id}
                      checked={isSelected}
                      onChange={() => setSelectedWinner(candidate.id)}
                      className="sr-only"
                    />
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <div
                          className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface-sunken"
                          aria-hidden
                        >
                          {isSelected ? (
                            <CheckIcon className="h-5 w-5 text-primary" />
                          ) : (
                            <UserIcon className="h-5 w-5 text-ink-muted" />
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-ink">
                            {candidate.givenName} {candidate.familyName}
                            {isSelected && (
                              <span className="sr-only"> (selected)</span>
                            )}
                          </p>
                          <p className="font-mono text-caption text-ink-muted">
                            ID {candidate.id.slice(-8).toUpperCase()}
                          </p>
                        </div>
                      </div>
                      <StatusBadge tone={matchInfo.tone}>
                        {matchInfo.label}
                      </StatusBadge>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-body md:grid-cols-4">
                      <div className="flex items-center gap-2">
                        <PhoneIcon className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
                        <span className={phoneMatches ? "font-medium text-ink" : "text-ink-secondary"}>
                          {formatField(candidate.phone)}
                        </span>
                        <MatchMark matches={phoneMatches} />
                      </div>
                      <div className="flex items-center gap-2">
                        <CalendarIcon className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
                        <span className={dobMatches ? "font-medium text-ink" : "text-ink-secondary"}>
                          {candidate.dob
                            ? formatNigerianDate(candidate.dob)
                            : formatField(candidate.dob)}
                        </span>
                        <MatchMark matches={dobMatches} />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-ink-muted">Sex:</span>
                        <span
                          className={`capitalize ${sexMatches ? "font-medium text-ink" : "text-ink-secondary"}`}
                        >
                          {formatField(candidate.sex)}
                        </span>
                        <MatchMark matches={sexMatches} />
                      </div>
                      <div className="flex items-center gap-2">
                        <MapPinIcon className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
                        <span className="text-ink-secondary">{candidate.state}</span>
                      </div>
                    </div>

                    <div className="mt-2 text-caption text-ink-muted">
                      Registered {formatNigerianDate(candidate.createdAt)}
                    </div>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {error && (
            <div className="banner banner-danger mb-4" role="alert">
              <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
              <span>{error}</span>
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => onResolve("create_new")}
              disabled={loading}
              className="btn-secondary flex-1"
            >
              Not the same person — register new
            </button>
            <button
              type="button"
              onClick={handleMerge}
              disabled={!selectedWinner || loading}
              className="btn-primary flex-1"
            >
              {loading ? "Linking…" : "Use selected patient"}
            </button>
          </div>

          <p className="mt-4 text-center text-caption text-ink-muted">
            Choosing an existing patient continues with their record. The
            details typed here are not kept as a separate patient.
          </p>
        </div>
      </div>
    </div>
  );
}
