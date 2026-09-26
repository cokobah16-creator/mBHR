import { useState, useEffect, useCallback, useRef } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import * as logger from "@/lib/logger";
import {
  ArrowPathIcon,
  HeartIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PortalListSkeleton, PortalNotice, PortalPage } from "./PortalPage";
import { conditionStatusInfo, formatPortalDate } from "./portalStatus";
import { readPortalUser } from "./portalSession";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useT } from "@/hooks/useT";

interface MedicalCondition {
  id: string;
  condition_name: string;
  diagnosed_date?: string;
  status: "active" | "resolved" | "managed";
  notes?: string;
  created_at: string;
}

type ConditionStatus = MedicalCondition["status"];

// Labels are translation keys.
const STATUS_OPTIONS: { value: ConditionStatus; label: string }[] = [
  { value: "active", label: "portal.conditions.optionActive" },
  { value: "managed", label: "portal.conditions.optionManaged" },
  { value: "resolved", label: "portal.conditions.optionResolved" },
];

// The badge label for a stored status, by translation key.
const STATUS_BADGE_KEY: Record<string, string> = {
  active: "portal.conditions.statusActive",
  managed: "portal.conditions.statusManaged",
  resolved: "portal.conditions.statusResolved",
};

function isConditionStatus(value: string): value is ConditionStatus {
  return value === "active" || value === "managed" || value === "resolved";
}

const EMPTY_FORM = {
  condition_name: "",
  diagnosed_date: "",
  status: "active" as ConditionStatus,
  notes: "",
};

export function MedicalConditions() {
  const { t } = useT();
  const pageTitle = t("portal.conditions.title");
  const pageDescription = t("portal.conditions.description");
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const [conditions, setConditions] = useState<MedicalCondition[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [nameError, setNameError] = useState("");
  const [success, setSuccess] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newCondition, setNewCondition] = useState(EMPTY_FORM);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  const loadConditions = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");

    try {
      const portalUser = readPortalUser();
      if (!portalUser || !portalUser.patientId) {
        navigate("/patient/login", { replace: true });
        return;
      }

      const { data, error: conditionsError } = await supabase
        .from("patient_medical_conditions")
        .select("*")
        .eq("patient_id", portalUser.patientId)
        .order("created_at", { ascending: false });

      if (conditionsError) throw conditionsError;

      setConditions(data || []);
      setLoaded(true);
    } catch (err) {
      logger.error(
        "Error loading conditions:",
        err instanceof Error ? err.name : "unknown",
      );
      // Offline, the "You are offline" notice already explains it.
      setError(navigator.onLine ? "portal.conditions.loadFailed" : "");
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  // Try once even when offline (this phone may have kept a copy from the last
  // time it was online), then reload when the connection comes back.
  const attempted = useRef(false);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    if (!online && attempted.current) return;
    attempted.current = true;
    loadConditions();
  }, [online, loadConditions]);

  useEffect(() => {
    if (showAdd) nameInputRef.current?.focus();
  }, [showAdd]);

  const openForm = () => {
    setSuccess("");
    setFormError("");
    setNameError("");
    setShowAdd(true);
  };

  const closeForm = () => {
    setShowAdd(false);
    setFormError("");
    setNameError("");
    setNewCondition(EMPTY_FORM);
    // Wait for the button to be enabled again before focusing it.
    setTimeout(() => addButtonRef.current?.focus(), 0);
  };

  const addCondition = async (e?: FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    if (!newCondition.condition_name.trim()) {
      setNameError("portal.conditions.nameRequired");
      nameInputRef.current?.focus();
      return;
    }
    if (!supabase) return;
    if (!navigator.onLine) {
      setFormError("portal.conditions.offlineNotSaved");
      return;
    }

    setSaving(true);
    setFormError("");
    setNameError("");
    setSuccess("");

    try {
      const portalUser = readPortalUser();
      if (!portalUser || !portalUser.patientId) {
        navigate("/patient/login", { replace: true });
        return;
      }

      const { error: insertError } = await supabase
        .from("patient_medical_conditions")
        .insert({
          patient_id: portalUser.patientId,
          condition_name: newCondition.condition_name,
          diagnosed_date: newCondition.diagnosed_date || null,
          status: newCondition.status,
          notes: newCondition.notes || null,
        });

      if (insertError) throw insertError;

      setSuccess(
        t("portal.conditions.saved", { name: newCondition.condition_name.trim() }),
      );
      setNewCondition(EMPTY_FORM);
      setShowAdd(false);
      await loadConditions();
    } catch (err) {
      logger.error(
        "Error adding condition:",
        err instanceof Error ? err.name : "unknown",
      );
      setFormError("portal.conditions.notSaved");
    } finally {
      setSaving(false);
    }
  };

  const nameDescribedBy = `condition-name-${nameError ? "error" : "hint"}`;

  if (!supabase) {
    return (
      <PortalPage title={pageTitle} description={pageDescription}>
        <PortalNotice tone="info" title={t("portal.conditions.notConnectedTitle")}>
          {t("portal.conditions.notConnected")}
        </PortalNotice>
      </PortalPage>
    );
  }

  if (loading && !loaded) {
    return <PortalListSkeleton label={t("portal.conditions.loading")} />;
  }

  return (
    <PortalPage
      title={pageTitle}
      description={pageDescription}
      actions={
        !showAdd && (
          <button
            ref={addButtonRef}
            type="button"
            onClick={openForm}
            disabled={!online}
            className="btn-primary"
          >
            <PlusIcon className="h-5 w-5" aria-hidden />
            {t("portal.conditions.add")}
          </button>
        )
      }
    >
      {!online && (
        <PortalNotice tone="offline" title={t("portal.visits.offlineTitle")}>
          {loaded
            ? t("portal.conditions.offlineStale")
            : t("portal.conditions.offlineEmpty")}
        </PortalNotice>
      )}

      {error && (
        <PortalNotice
          tone="danger"
          action={
            online ? (
              <button
                type="button"
                onClick={loadConditions}
                className="btn-secondary"
              >
                <ArrowPathIcon className="h-5 w-5" aria-hidden />
                {t("portal.error.retry")}
              </button>
            ) : undefined
          }
        >
          {t(error)}
        </PortalNotice>
      )}

      {success && <PortalNotice tone="success">{success}</PortalNotice>}

      {showAdd && (
        <form
          onSubmit={addCondition}
          className="panel"
          aria-labelledby="add-condition-title"
          noValidate
        >
          <div className="panel-header">
            <h2 id="add-condition-title" className="panel-title">
              {t("portal.conditions.add")}
            </h2>
          </div>
          <div className="panel-body space-y-4">
            <div>
              <label htmlFor="condition-name" className="field-label">
                {t("portal.conditions.nameLabel")}
              </label>
              <input
                ref={nameInputRef}
                id="condition-name"
                type="text"
                value={newCondition.condition_name}
                onChange={(e) => {
                  setNameError("");
                  setNewCondition({
                    ...newCondition,
                    condition_name: e.target.value,
                  });
                }}
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameDescribedBy}
                disabled={saving}
                className="input-field"
              />
              {nameError ? (
                <p id="condition-name-error" className="field-error">
                  {t(nameError)}
                </p>
              ) : (
                <p id="condition-name-hint" className="field-hint">
                  {t("portal.conditions.nameHint")}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="condition-date" className="field-label">
                {t("portal.conditions.dateLabel")}
              </label>
              <input
                id="condition-date"
                type="date"
                value={newCondition.diagnosed_date}
                onChange={(e) =>
                  setNewCondition({
                    ...newCondition,
                    diagnosed_date: e.target.value,
                  })
                }
                disabled={saving}
                className="input-field"
              />
            </div>

            <div>
              <label htmlFor="condition-status" className="field-label">
                {t("portal.conditions.statusLabel")}
              </label>
              <select
                id="condition-status"
                value={newCondition.status}
                onChange={(e) => {
                  const value = e.target.value;
                  if (isConditionStatus(value)) {
                    setNewCondition({ ...newCondition, status: value });
                  }
                }}
                disabled={saving}
                className="input-field"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {t(opt.label)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="condition-notes" className="field-label">
                {t("portal.conditions.notesLabel")}
              </label>
              <textarea
                id="condition-notes"
                value={newCondition.notes}
                onChange={(e) =>
                  setNewCondition({ ...newCondition, notes: e.target.value })
                }
                rows={3}
                disabled={saving}
                aria-describedby="condition-notes-hint"
                className="input-field"
              />
              <p id="condition-notes-hint" className="field-hint">
                {t("portal.conditions.notesHint")}
              </p>
            </div>

            {formError && (
              <PortalNotice tone="danger">{t(formError)}</PortalNotice>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={saving || !online}
                className="btn-primary"
              >
                {saving ? t("portal.conditions.saving") : t("portal.conditions.save")}
              </button>
              <button
                type="button"
                onClick={closeForm}
                disabled={saving}
                className="btn-secondary"
              >
                {t("portal.conditions.cancel")}
              </button>
            </div>
          </div>
        </form>
      )}

      {loaded && conditions.length === 0 && !showAdd && (
        <div className="panel">
          <EmptyState
            icon={HeartIcon}
            title={t("portal.conditions.emptyTitle")}
            description={t("portal.conditions.emptyBody")}
          />
        </div>
      )}

      {conditions.length > 0 && (
        <ul className="panel divide-y divide-line" aria-label={t("portal.conditions.title")}>
          {conditions.map((condition) => {
            const status = conditionStatusInfo(condition.status);
            return (
              <li key={condition.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="text-body font-medium text-ink">
                    {condition.condition_name}
                  </h3>
                  <StatusBadge tone={status.tone} icon>
                    {t(STATUS_BADGE_KEY[condition.status] ?? "portal.conditions.statusUnknown", status.label)}
                  </StatusBadge>
                </div>
                {condition.diagnosed_date && (
                  <p className="mt-1 text-body text-ink-secondary">
                    {t("portal.conditions.diagnosedOn", { date: formatPortalDate(condition.diagnosed_date) })}
                  </p>
                )}
                {condition.notes && (
                  <p className="mt-1 whitespace-pre-wrap text-body text-ink-secondary">
                    {condition.notes}
                  </p>
                )}
                {condition.created_at && (
                  <p className="mt-1 text-caption text-ink-muted">
                    {t("portal.conditions.addedOn", { date: formatPortalDate(condition.created_at) })}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <PortalNotice tone="info">
        {t("portal.conditions.notAClinicRecord")}
      </PortalNotice>
    </PortalPage>
  );
}
