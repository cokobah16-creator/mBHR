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
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useT } from "@/hooks/useT";

// Blood type and medical notes are clinical details: patients see them but
// only clinic staff change them.
interface PHRField {
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
  const { t } = useT();
  const isOnline = useOnlineStatus();
  const fieldLabel = (key: string) => t(`portal.phr.field.${key}`);
  const [loading, setLoading] = useState(isSupabaseEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Load errors are kept as a translation key: loadPHR does not depend on t.
  const [loadErrorKey, setLoadErrorKey] = useState("");
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
    setLoadErrorKey("");
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
        setLoadErrorKey("portal.phr.err.noRecord");
        setLoadFailed(true);
        return;
      }

      const fullName =
        patient.name ||
        [patient.given_name, patient.family_name].filter(Boolean).join(" ") ||
        "";

      const phrFields: PHRField[] = [
        {
          key: "name",
          value: fullName,
          editable: true,
          type: "text",
        },
        {
          key: "dob",
          value: patient.dob || "",
          editable: false,
          type: "date",
        },
        {
          key: "phone",
          value: patient.phone || "",
          editable: true,
          type: "text",
        },
        {
          key: "email",
          value: patient.email || "",
          editable: true,
          type: "text",
        },
        {
          key: "address",
          value: patient.address || "",
          editable: true,
          type: "textarea",
        },
        {
          key: "emergency_contact",
          value: patient.emergency_contact || "",
          editable: true,
          type: "text",
        },
        {
          key: "blood_type",
          value: patient.blood_type || "",
          editable: false,
          type: "text",
        },
        {
          key: "notes",
          value: patient.notes || "",
          editable: false,
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
      setLoadErrorKey("portal.phr.err.loadFailed");
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
          t("portal.phr.err.refused", {
            field: fieldLabel(key),
          }),
        );
        return;
      }

      setSuccess(t("portal.phr.saved", { field: fieldLabel(key) }));
      setEditingField(null);
      await loadPHR();
    } catch (err) {
      logger.error("[UpdatePHR] save failed:", errorName(err));
      setError(
        t("portal.phr.err.saveFailed", {
          field: fieldLabel(key),
        }),
      );
    } finally {
      setSaving(false);
    }
  };

  const heading = embedded ? (
    <div className="mb-4">
      <h2 className="text-h2 text-ink">{t("portal.phr.title")}</h2>
      <p className="mt-1 text-body text-ink-muted">
        {t("portal.phr.intro")}
      </p>
    </div>
  ) : (
    <PageHeader
      title={t("portal.phr.title")}
      description={t("portal.phr.introPage")}
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
            {t("portal.phr.notConnected")}
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
          {t("portal.phr.loading")}
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
        {(error || loadErrorKey) && (
          <div className="banner banner-danger mb-4" role="alert">
            <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <div className="space-y-3">
              <p>{loadErrorKey ? t(loadErrorKey) : error}</p>
              {loadFailed && (
                <button type="button" onClick={() => void loadPHR()} className="btn-secondary">
                  <ArrowPathIcon className="h-5 w-5" aria-hidden />
                  {t("portal.error.retry")}
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
          <p>{t("portal.phr.offline")}</p>
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
                          {fieldLabel(field.key)}
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
                            {saving ? t("portal.phr.saving") : t("portal.phr.save")}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            disabled={saving}
                            className="btn-secondary"
                          >
                            <XMarkIcon className="h-5 w-5" aria-hidden />
                            {t("action.cancel")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-label text-ink-muted">{fieldLabel(field.key)}</p>
                        <p
                          className={`mt-0.5 whitespace-pre-line text-body ${field.value ? "text-ink" : "text-ink-muted"}`}
                        >
                          {field.value
                            ? field.type === "date"
                              ? formatNigerianDate(field.value) || field.value
                              : field.value
                            : t("portal.phr.notProvided")}
                        </p>
                        {!field.editable && (
                          <p className="field-hint">{t("portal.phr.staffOnly")}</p>
                        )}
                      </>
                    )}
                  </div>

                  {field.editable && !isEditing && (
                    <button
                      type="button"
                      onClick={() => startEdit(field.key, field.value)}
                      disabled={!isOnline || saving}
                      aria-label={t("portal.phr.edit", { field: fieldLabel(field.key) })}
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
          {t("portal.phr.staffOnlyNote")}
        </p>
      </div>
    </>,
  );
}
