import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowPathIcon,
  CheckCircleIcon,
  CheckIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  PencilIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { PageHeader } from "@/components/ui/PageHeader";
import { SkeletonText, Skeleton } from "@/components/ui/Skeleton";
import { supabase, isSupabaseEnabled } from "@/lib/supabaseClient";
import * as logger from "@/lib/logger";
import { formatNigerianDate } from "@/utils/dateFormat";
import { errorName, readPortalUser } from "./account/portalSession";
import { useOnlineStatus } from "./account/useOnlineStatus";

interface PHRField {
  label: string;
  key: string;
  value: string;
  editable: boolean;
  type: "text" | "textarea" | "date";
}

interface UpdatePHRProps {
  /** Render inside another page (e.g. Manage account) without page chrome. */
  embedded?: boolean;
}

export function UpdatePHR({ embedded = false }: UpdatePHRProps = {}) {
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  const [loading, setLoading] = useState(isSupabaseEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [success, setSuccess] = useState("");
  const [editingField, setEditingField] = useState<string | null>(null);
  const [fields, setFields] = useState<PHRField[]>([]);
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  const loadPHR = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    setLoadFailed(false);

    try {
      const portalUser = readPortalUser();
      if (!portalUser || !portalUser.patientId) {
        navigate("/patient/login", { replace: true });
        return;
      }

      const { data: patient, error: patientError } = await supabase
        .from("patients")
        .select("*")
        .eq("id", portalUser.patientId)
        .maybeSingle();

      if (patientError) throw patientError;
      if (!patient) {
        setError(
          "We could not find your patient record. Ask clinic staff to link your record to your account.",
        );
        setLoadFailed(true);
        return;
      }

      const fullName =
        patient.name ||
        [patient.given_name, patient.family_name].filter(Boolean).join(" ") ||
        "";

      const phrFields: PHRField[] = [
        {
          label: "Full name",
          key: "name",
          value: fullName,
          editable: true,
          type: "text",
        },
        {
          label: "Date of birth",
          key: "dob",
          value: patient.dob || "",
          editable: false,
          type: "date",
        },
        {
          label: "Phone number",
          key: "phone",
          value: patient.phone || "",
          editable: true,
          type: "text",
        },
        {
          label: "Email",
          key: "email",
          value: patient.email || "",
          editable: true,
          type: "text",
        },
        {
          label: "Address",
          key: "address",
          value: patient.address || "",
          editable: true,
          type: "textarea",
        },
        {
          label: "Emergency contact",
          key: "emergency_contact",
          value: patient.emergency_contact || "",
          editable: true,
          type: "text",
        },
        {
          label: "Blood type",
          key: "blood_type",
          value: patient.blood_type || "",
          editable: true,
          type: "text",
        },
        {
          label: "Medical notes",
          key: "notes",
          value: patient.notes || "",
          editable: true,
          type: "textarea",
        },
      ];

      // Only offer editing where this record has somewhere to save the
      // value, and leave out details the record does not hold at all.
      // Otherwise every save of that detail would fail.
      const row = patient as Record<string, unknown>;
      const hasColumn = (key: string) =>
        Object.prototype.hasOwnProperty.call(row, key);
      setFields(
        phrFields
          .filter((f) => f.key === "name" || hasColumn(f.key))
          .map((f) => ({ ...f, editable: f.editable && hasColumn(f.key) })),
      );
    } catch (err) {
      logger.error("[UpdatePHR] load failed:", errorName(err));
      setError(
        "We could not load your details. Check your internet connection and try again.",
      );
      setLoadFailed(true);
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
  }, [navigate]);

  useEffect(() => {
    void loadPHR();
  }, [loadPHR]);

  const startEdit = (key: string, currentValue: string) => {
    setEditingField(key);
    setEditValues({ ...editValues, [key]: currentValue });
    setSuccess("");
    setError("");
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditValues({});
  };

  const saveField = async (field: PHRField) => {
    if (!supabase) return;
    const key = field.key;
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const portalUser = readPortalUser();
      if (!portalUser || !portalUser.patientId) {
        navigate("/patient/login", { replace: true });
        return;
      }

      const { data: updated, error: updateError } = await supabase
        .from("patients")
        .update({ [key]: editValues[key] })
        .eq("id", portalUser.patientId)
        .select("id");

      if (updateError) throw updateError;

      // The online record can refuse a change without an error (it then
      // updates nothing). Only say "saved" when a record was really changed.
      if (!updated || updated.length === 0) {
        setError(
          `${field.label} was not saved. Your account cannot change this detail online. Ask clinic staff to update it at your next visit.`,
        );
        return;
      }

      setSuccess(`${field.label} saved to your online record.`);
      setEditingField(null);
      await loadPHR();
    } catch (err) {
      logger.error("[UpdatePHR] save failed:", errorName(err));
      setError(
        `${field.label} was not saved. Check your internet connection and try again. If it keeps happening, ask clinic staff to update it.`,
      );
    } finally {
      setSaving(false);
    }
  };

  const heading = embedded ? (
    <div className="mb-4">
      <h2 className="text-h2 text-ink">Your details</h2>
      <p className="mt-1 text-body text-ink-muted">
        Keep your contact details up to date so the clinic can reach you.
      </p>
    </div>
  ) : (
    <PageHeader
      title="Your details"
      description="Keep your contact details up to date so the clinic can reach you. Each change is saved to your online record when you press Save."
    />
  );

  const wrap = (children: ReactNode) =>
    embedded ? (
      <div>{children}</div>
    ) : (
      <div className="mx-auto max-w-3xl px-4 py-6">{children}</div>
    );

  if (!isSupabaseEnabled) {
    return wrap(
      <>
        {heading}
        <div className="banner banner-info">
          <InformationCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p>
            Seeing and changing your details here needs an online account, and
            this device is not connected to one. Ask clinic staff to check or
            update your details at your next visit.
          </p>
        </div>
      </>,
    );
  }

  if (loading && !hasLoaded) {
    return wrap(
      <>
        {heading}
        <span role="status" className="sr-only">
          Loading your details
        </span>
        <div className="panel p-5" aria-hidden>
          <Skeleton className="mb-4 h-4 w-32" />
          <SkeletonText lines={6} />
        </div>
      </>,
    );
  }

  return wrap(
    <>
      {heading}

      <div aria-live="polite" className="space-y-3">
        {error && (
          <div className="banner banner-danger mb-4" role="alert">
            <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <div className="space-y-3">
              <p>{error}</p>
              {loadFailed && (
                <button type="button" onClick={() => void loadPHR()} className="btn-secondary">
                  <ArrowPathIcon className="h-5 w-5" aria-hidden />
                  Try again
                </button>
              )}
            </div>
          </div>
        )}

        {success && (
          <div className="banner banner-success mb-4">
            <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <p>{success}</p>
          </div>
        )}
      </div>

      {!isOnline && (
        <div className="banner banner-warning mb-4" role="status">
          <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p>You are offline. Connect to the internet to change your details.</p>
        </div>
      )}

      {fields.length > 0 && (
        <ul className="panel divide-y divide-line">
          {fields.map((field) => {
            const inputId = `phr-${field.key}`;
            const isEditing = editingField === field.key;
            return (
              <li key={field.key} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <div className="space-y-2">
                        <label htmlFor={inputId} className="field-label">
                          {field.label}
                        </label>
                        {field.type === "textarea" ? (
                          <textarea
                            id={inputId}
                            value={editValues[field.key] || ""}
                            onChange={(e) =>
                              setEditValues({
                                ...editValues,
                                [field.key]: e.target.value,
                              })
                            }
                            rows={3}
                            disabled={saving}
                            className="input-field"
                          />
                        ) : (
                          <input
                            id={inputId}
                            type={field.type}
                            value={editValues[field.key] || ""}
                            onChange={(e) =>
                              setEditValues({
                                ...editValues,
                                [field.key]: e.target.value,
                              })
                            }
                            disabled={saving}
                            className="input-field"
                          />
                        )}

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void saveField(field)}
                            disabled={saving || !isOnline}
                            className="btn-primary"
                          >
                            <CheckIcon className="h-5 w-5" aria-hidden />
                            {saving ? "Saving…" : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            disabled={saving}
                            className="btn-secondary"
                          >
                            <XMarkIcon className="h-5 w-5" aria-hidden />
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-label text-ink-muted">{field.label}</p>
                        <p
                          className={`mt-0.5 whitespace-pre-line text-body ${field.value ? "text-ink" : "text-ink-muted"}`}
                        >
                          {field.value
                            ? field.type === "date"
                              ? formatNigerianDate(field.value) || field.value
                              : field.value
                            : "Not provided"}
                        </p>
                        {!field.editable && (
                          <p className="field-hint">Only clinic staff can change this.</p>
                        )}
                      </>
                    )}
                  </div>

                  {field.editable && !isEditing && (
                    <button
                      type="button"
                      onClick={() => startEdit(field.key, field.value)}
                      disabled={!isOnline || saving}
                      aria-label={`Edit ${field.label.toLowerCase()}`}
                      className="btn-ghost min-w-touch-target"
                    >
                      <PencilIcon className="h-5 w-5" aria-hidden />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="banner banner-info mt-4">
        <InformationCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <p>
          Some details, like your date of birth, can only be changed by clinic
          staff. Ask them at your next visit.
        </p>
      </div>
    </>,
  );
}
