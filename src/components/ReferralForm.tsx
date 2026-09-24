import { useEffect, useId, useState, type FormEvent } from "react";
import { doctorService } from "@/services/doctorService";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/stores/toast";
import { can } from "@/auth/roles";
import { generateId } from "@/db";
import { isSupabaseEnabled } from "@/lib/supabaseClient";
import type { Referral } from "@/types/multiTenant";
import {
  UserGroupIcon,
  ExclamationTriangleIcon,
  SignalSlashIcon,
} from "@heroicons/react/24/outline";

interface ReferralFormProps {
  org_id: string;
  site_id: string;
  event_id?: string;
  patient_id: string;
  visit_id?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function ReferralForm({
  org_id,
  site_id,
  event_id,
  patient_id,
  visit_id,
  onSuccess,
  onCancel,
}: ReferralFormProps) {
  const { currentUser } = useAuthStore();
  const { push: pushToast } = useToast();
  const idPrefix = useId();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  const [formData, setFormData] = useState<Partial<Referral>>({
    org_id,
    site_id,
    event_id,
    patient_id,
    visit_id,
    referral_type: "specialist",
    urgency: "routine",
    reason: "",
    clinical_summary: "",
    diagnosis: "",
    facility_name: "",
    specialty: "",
  });

  const available = isSupabaseEnabled && online;
  const fieldId = (name: string) => `${idPrefix}-${name}`;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (!currentUser) {
      setError("Sign in again to create a referral.");
      return;
    }

    if (!can(currentUser.role, "consult")) {
      setError("Only clinicians can create referrals.");
      return;
    }

    if (!formData.reason || !formData.clinical_summary) {
      setError("Enter the reason for referral and a clinical summary.");
      return;
    }

    if (!isSupabaseEnabled) {
      setError(
        "Referrals are kept in the online record, which is not set up on this installation. Nothing was saved.",
      );
      return;
    }

    if (!navigator.onLine) {
      setError(
        "You are offline. Referrals are saved straight to the online record, so nothing was saved. Try again when connected.",
      );
      return;
    }

    setSubmitting(true);

    try {
      const referral = await doctorService.createReferral({
        ...formData,
        referring_doctor_id: currentUser.id,
        status: "pending",
      } as Omit<Referral, "id" | "created_at" | "updated_at">);

      if (referral) {
        pushToast({
          id: generateId(),
          tone: "success",
          title: "Referral created",
          body: "Saved to the online record.",
        });
        onSuccess?.();
      } else {
        setError(
          "The referral was not saved. The online record could not be updated — try again.",
        );
      }
    } catch (err) {
      console.error(
        "Error creating referral:",
        err instanceof Error ? err.name : err,
      );
      setError(
        "The referral was not saved. Check the connection and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="panel" aria-labelledby={fieldId("title")}>
      <div className="panel-header">
        <h2
          id={fieldId("title")}
          className="panel-title flex items-center gap-2"
        >
          <UserGroupIcon className="h-5 w-5 text-ink-muted" aria-hidden />
          Create referral
        </h2>
      </div>

      <div className="panel-body space-y-4">
        {!isSupabaseEnabled && (
          <div className="banner banner-warning" role="status">
            <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
            <span>
              Referrals are kept in the online record, which is not set up on
              this installation. Write the referral on paper for now.
            </span>
          </div>
        )}
        {isSupabaseEnabled && !online && (
          <div className="banner banner-warning" role="status">
            <SignalSlashIcon className="h-5 w-5 shrink-0" aria-hidden />
            <span>
              You are offline. Referrals save straight to the online record, so
              they can be created only with a connection.
            </span>
          </div>
        )}

        {error && (
          <div className="banner banner-danger" role="alert">
            <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label htmlFor={fieldId("type")} className="field-label">
                Referral type *
              </label>
              <select
                id={fieldId("type")}
                value={formData.referral_type}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    referral_type: e.target.value as Referral["referral_type"],
                  })
                }
                className="input-field"
                required
              >
                <option value="specialist">Specialist</option>
                <option value="hospital">Hospital</option>
                <option value="lab">Laboratory</option>
                <option value="imaging">Imaging</option>
                <option value="follow_up">Follow-up</option>
              </select>
            </div>

            <div>
              <label htmlFor={fieldId("urgency")} className="field-label">
                Urgency *
              </label>
              <select
                id={fieldId("urgency")}
                value={formData.urgency}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    urgency: e.target.value as Referral["urgency"],
                  })
                }
                className="input-field"
                required
              >
                <option value="routine">Routine</option>
                <option value="urgent">Urgent</option>
                <option value="emergency">Emergency</option>
              </select>
            </div>
          </div>

          {formData.referral_type === "specialist" && (
            <div>
              <label htmlFor={fieldId("specialty")} className="field-label">
                Specialty
              </label>
              <input
                id={fieldId("specialty")}
                type="text"
                value={formData.specialty || ""}
                onChange={(e) =>
                  setFormData({ ...formData, specialty: e.target.value })
                }
                placeholder="e.g. Cardiology, Orthopaedics"
                className="input-field"
              />
            </div>
          )}

          <div>
            <label htmlFor={fieldId("facility")} className="field-label">
              Facility name
            </label>
            <input
              id={fieldId("facility")}
              type="text"
              value={formData.facility_name || ""}
              onChange={(e) =>
                setFormData({ ...formData, facility_name: e.target.value })
              }
              placeholder="Hospital, clinic or facility"
              className="input-field"
            />
          </div>

          <div>
            <label htmlFor={fieldId("reason")} className="field-label">
              Reason for referral *
            </label>
            <textarea
              id={fieldId("reason")}
              value={formData.reason || ""}
              onChange={(e) =>
                setFormData({ ...formData, reason: e.target.value })
              }
              placeholder="Brief reason for referring this patient"
              className="input-field"
              rows={2}
              required
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor={fieldId("summary")} className="field-label">
              Clinical summary *
            </label>
            <textarea
              id={fieldId("summary")}
              value={formData.clinical_summary || ""}
              onChange={(e) =>
                setFormData({ ...formData, clinical_summary: e.target.value })
              }
              placeholder="Relevant history, symptoms and findings"
              className="input-field"
              rows={4}
              required
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor={fieldId("diagnosis")} className="field-label">
              Working diagnosis
            </label>
            <input
              id={fieldId("diagnosis")}
              type="text"
              value={formData.diagnosis || ""}
              onChange={(e) =>
                setFormData({ ...formData, diagnosis: e.target.value })
              }
              placeholder="Provisional or confirmed diagnosis"
              className="input-field"
            />
          </div>

          <div>
            <label htmlFor={fieldId("notes")} className="field-label">
              Additional notes
            </label>
            <textarea
              id={fieldId("notes")}
              value={formData.notes || ""}
              onChange={(e) =>
                setFormData({ ...formData, notes: e.target.value })
              }
              placeholder="Anything else the receiving facility should know"
              className="input-field"
              rows={2}
            />
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="btn-secondary"
                disabled={submitting}
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              className="btn-primary"
              disabled={submitting || !available}
            >
              {submitting ? "Saving referral…" : "Create referral"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
