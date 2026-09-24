import { useCallback, useEffect, useState } from "react";
import {
  ArrowPathIcon,
  BellIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { supabase, isSupabaseEnabled } from "@/lib/supabaseClient";
import * as logger from "@/lib/logger";
import { formatNigerianDateTime } from "@/utils/dateFormat";
import {
  choiceLabel,
  diffSharing,
  NOTIFY_OPTION,
  purposeLabel,
  SHARING_OPTIONS,
  type SharingFlag,
  type SharingFlags,
} from "./account/sharingChanges";
import { ConfirmDialog } from "./account/ConfirmDialog";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { errorName } from "./account/portalSession";

interface DataSharingPreferences {
  id?: string;
  patient_id: string;
  allow_ias_access: boolean;
  allow_treatment_access: boolean;
  allow_payment_access: boolean;
  allow_operations_access: boolean;
  blocked_organizations: string[];
  require_notification: boolean;
}

interface AccessLogEntry {
  id: string;
  requesting_organization: string;
  exchange_purpose: string;
  resources_requested: string[];
  resources_returned: number;
  created_at: string;
  success: boolean;
}

interface Props {
  patientId: string;
}

type LoadState = "loading" | "ready" | "error";

// Starting settings before a patient saves any choices. Sharing with other
// treating providers starts off: the patient has to turn it on.
function defaultsFor(patientId: string): DataSharingPreferences {
  return {
    patient_id: patientId,
    allow_ias_access: true,
    allow_treatment_access: false,
    allow_payment_access: false,
    allow_operations_access: false,
    blocked_organizations: [],
    require_notification: true,
  };
}

function flagsOf(p: DataSharingPreferences): SharingFlags {
  return {
    allow_ias_access: !!p.allow_ias_access,
    allow_treatment_access: !!p.allow_treatment_access,
    allow_payment_access: !!p.allow_payment_access,
    allow_operations_access: !!p.allow_operations_access,
    require_notification: !!p.require_notification,
  };
}

export function DataSharingPreferences({ patientId }: Props) {
  const isOnline = useOnlineStatus();
  /** What is stored in the account (or the defaults if nothing is stored yet). */
  const [saved, setSaved] = useState<DataSharingPreferences>(() =>
    defaultsFor(patientId),
  );
  const [hasStoredRow, setHasStoredRow] = useState(false);
  /** What the person has ticked on screen. */
  const [preferences, setPreferences] = useState<DataSharingPreferences>(() =>
    defaultsFor(patientId),
  );
  const [accessLogs, setAccessLogs] = useState<AccessLogEntry[]>([]);
  const [logsFailed, setLogsFailed] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canUseOnline = isSupabaseEnabled && !!patientId;

  const loadPreferences = useCallback(async () => {
    if (!supabase || !patientId) return;
    const { data, error: loadError } = await supabase
      .from("patient_data_sharing_preferences")
      .select("*")
      .eq("patient_id", patientId)
      .maybeSingle();

    if (loadError) throw loadError;

    const next = data
      ? ({ ...defaultsFor(patientId), ...data } as DataSharingPreferences)
      : defaultsFor(patientId);
    setSaved(next);
    setPreferences(next);
    setHasStoredRow(!!data);
  }, [patientId]);

  const loadAccessLogs = useCallback(async () => {
    if (!supabase || !patientId) return;
    const { data, error: logsError } = await supabase
      .from("tefca_access_logs")
      .select("*")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false })
      .limit(10);

    if (logsError) {
      logger.warn("[DataSharing] access history failed:", errorName(logsError));
      setLogsFailed(true);
      return;
    }
    setLogsFailed(false);
    setAccessLogs((data as AccessLogEntry[] | null) ?? []);
  }, [patientId]);

  const loadAll = useCallback(async () => {
    if (!canUseOnline) {
      setLoadState("ready");
      return;
    }
    setLoadState("loading");
    try {
      await loadPreferences();
      await loadAccessLogs();
      setLoadState("ready");
    } catch (err) {
      logger.error("[DataSharing] load failed:", errorName(err));
      setLoadState("error");
    }
  }, [canUseOnline, loadPreferences, loadAccessLogs]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const changes = diffSharing(flagsOf(saved), flagsOf(preferences));

  const setFlag = (key: SharingFlag, value: boolean) => {
    setSavedAt(null);
    setPreferences((p) => ({ ...p, [key]: value }));
  };

  const savePreferences = async () => {
    if (!supabase) return;
    setSaving(true);
    setError(null);

    try {
      if (preferences.id) {
        const { data: updatedRows, error: updateError } = await supabase
          .from("patient_data_sharing_preferences")
          .update({
            allow_ias_access: preferences.allow_ias_access,
            allow_treatment_access: preferences.allow_treatment_access,
            allow_payment_access: preferences.allow_payment_access,
            allow_operations_access: preferences.allow_operations_access,
            blocked_organizations: preferences.blocked_organizations,
            require_notification: preferences.require_notification,
          })
          .eq("id", preferences.id)
          .select("id");

        if (updateError) throw updateError;
        // The online account can refuse a change without an error (it then
        // updates nothing). Never report that as saved.
        if (!updatedRows || updatedRows.length === 0) {
          throw new Error("No sharing choices were updated");
        }
        setSaved(preferences);
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from("patient_data_sharing_preferences")
          .insert(preferences)
          .select("id")
          .maybeSingle();

        if (insertError) throw insertError;
        const next = { ...preferences, id: inserted?.id ?? preferences.id };
        setPreferences(next);
        setSaved(next);
        setHasStoredRow(true);
      }

      setSavedAt(new Date());
      setConfirmOpen(false);
    } catch (err) {
      logger.error("[DataSharing] save failed:", errorName(err));
      setError(
        "Your changes were not saved. Check your internet connection and try again. If it keeps happening, ask clinic staff for help.",
      );
    } finally {
      setSaving(false);
    }
  };

  const cancelChanges = () => {
    setPreferences(saved);
    setError(null);
  };

  const header = (
    <PageHeader
      title="Sharing your health records"
      description="Choose which other organisations may ask for a copy of your health records."
    />
  );

  const explainer = (
    <section className="panel" aria-labelledby="sharing-explainer-title">
      <div className="panel-header">
        <h2 id="sharing-explainer-title" className="panel-title">
          How sharing works
        </h2>
      </div>
      <dl className="panel-body grid gap-4 text-body sm:grid-cols-2">
        <div>
          <dt className="font-medium text-ink">Who can always see your record</dt>
          <dd className="mt-1 text-ink-secondary">
            The mBHR clinic team that treats you. These choices do not change
            that, and they do not change the care you receive.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-ink">What these choices cover</dt>
          <dd className="mt-1 text-ink-secondary">
            Requests from other organisations for a copy of your records, such
            as another hospital, an insurer or a health app you use.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-ink">For how long</dt>
          <dd className="mt-1 text-ink-secondary">
            Each choice stays as you set it until you change it here.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-ink">How to stop sharing</dt>
          <dd className="mt-1 text-ink-secondary">
            Untick the choice and save, and tell clinic staff at your next
            visit. Your choices are saved as a record of your wishes: requests
            are not yet checked against them automatically. Copies already
            sent to an organisation cannot be taken back from here.
          </dd>
        </div>
      </dl>
    </section>
  );

  if (!isSupabaseEnabled) {
    return (
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        {header}
        <div className="banner banner-info">
          <InformationCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p>
            Sharing choices are kept in your online account. This device is not
            connected to an online account, so they cannot be shown or changed
            here.
          </p>
        </div>
        {explainer}
      </div>
    );
  }

  if (!patientId) {
    return (
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        {header}
        <div className="banner banner-danger" role="alert">
          <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p>
            We could not find your patient record. Log out, log in again, then
            try once more.
          </p>
        </div>
      </div>
    );
  }

  if (loadState === "loading") {
    return (
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        {header}
        <span role="status" className="sr-only">
          Loading your sharing choices
        </span>
        <div className="panel p-5" aria-hidden>
          <Skeleton className="mb-4 h-5 w-48" />
          <SkeletonText lines={6} />
        </div>
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        {header}
        <div className="banner banner-danger" role="alert">
          <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div className="space-y-3">
            <p>
              {isOnline
                ? "We could not load your sharing choices. Nothing has been changed."
                : "You are offline. Connect to the internet to see or change your sharing choices."}
            </p>
            <button type="button" onClick={() => void loadAll()} className="btn-secondary">
              <ArrowPathIcon className="h-5 w-5" aria-hidden />
              Try again
            </button>
          </div>
        </div>
        {explainer}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      {header}
      {explainer}

      {!isOnline && (
        <div className="banner banner-warning" role="status">
          <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p>You are offline. You can look at your choices, but saving needs an internet connection.</p>
        </div>
      )}

      <section className="panel" aria-labelledby="sharing-choices-title">
        <div className="panel-header">
          <h2 id="sharing-choices-title" className="panel-title">
            Your sharing choices
          </h2>
          {!hasStoredRow && (
            <StatusBadge tone="neutral" icon>
              Not saved yet
            </StatusBadge>
          )}
        </div>
        <div className="panel-body space-y-5">
          {!hasStoredRow && (
            <p className="text-body text-ink-secondary">
              You have not saved any choices yet. The ticks below are the
              starting settings. Press Save changes to keep them as your own.
            </p>
          )}

          <fieldset>
            <legend className="field-label">Who may ask for a copy of your records</legend>
            <div className="space-y-2">
              {SHARING_OPTIONS.map((o) => {
                const id = `sharing-${o.key}`;
                const on = preferences[o.key];
                return (
                  <label
                    key={o.key}
                    htmlFor={id}
                    className="flex min-h-touch-target cursor-pointer items-start gap-3 rounded-md border border-line p-3 transition-colors hover:bg-surface-hover"
                  >
                    <input
                      id={id}
                      type="checkbox"
                      checked={on}
                      onChange={(e) => setFlag(o.key, e.target.checked)}
                      disabled={saving}
                      className="mt-0.5 h-5 w-5 shrink-0 rounded border-line-strong text-primary focus:ring-primary"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-body font-medium text-ink">{o.title}</span>
                        <StatusBadge tone={on ? "info" : "neutral"} icon>
                          {choiceLabel(o.key, on)}
                        </StatusBadge>
                      </span>
                      <span className="mt-0.5 block text-caption text-ink-muted">
                        {o.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <label
            htmlFor="sharing-notify"
            className="flex min-h-touch-target cursor-pointer items-start gap-3 rounded-md border border-line p-3 transition-colors hover:bg-surface-hover"
          >
            <input
              id="sharing-notify"
              type="checkbox"
              checked={preferences.require_notification}
              onChange={(e) => setFlag(NOTIFY_OPTION.key, e.target.checked)}
              disabled={saving}
              className="mt-0.5 h-5 w-5 shrink-0 rounded border-line-strong text-primary focus:ring-primary"
            />
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-body font-medium text-ink">
                <BellIcon className="h-5 w-5 text-ink-muted" aria-hidden />
                {NOTIFY_OPTION.title}
              </span>
              <span className="mt-0.5 block text-caption text-ink-muted">
                {NOTIFY_OPTION.description}
              </span>
            </span>
          </label>

          <div aria-live="polite">
            {savedAt && changes.length === 0 && (
              <div className="banner banner-success">
                <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                <p>
                  Saved to your online account at{" "}
                  {formatNigerianDateTime(savedAt)}.
                </p>
              </div>
            )}
            {changes.length > 0 && (
              <p className="text-body text-ink-secondary">
                You have {changes.length} unsaved{" "}
                {changes.length === 1 ? "change" : "changes"}.
              </p>
            )}
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {changes.length > 0 && (
              <button
                type="button"
                onClick={cancelChanges}
                disabled={saving}
                className="btn-secondary"
              >
                Undo my changes
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setError(null);
                setConfirmOpen(true);
              }}
              disabled={
                saving || !isOnline || (hasStoredRow && changes.length === 0)
              }
              className="btn-primary"
            >
              <ShieldCheckIcon className="h-5 w-5" aria-hidden />
              Save changes
            </button>
          </div>
        </div>
      </section>

      <section className="panel" aria-labelledby="sharing-history-title">
        <div className="panel-header">
          <h2 id="sharing-history-title" className="panel-title">
            Recent requests for your records
          </h2>
        </div>
        {logsFailed ? (
          <div className="panel-body">
            <p className="text-body text-ink-secondary">
              We could not load the list of requests. Try again later.
            </p>
          </div>
        ) : accessLogs.length === 0 ? (
          <EmptyState
            icon={ShieldCheckIcon}
            title="No requests recorded"
            description="No other organisation has requested your records through this service."
          />
        ) : (
          <ul className="divide-y divide-line">
            {accessLogs.map((log) => (
              <li key={log.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-body font-medium text-ink">
                    {log.requesting_organization}
                  </p>
                  <p className="text-caption text-ink-muted">
                    Reason: {purposeLabel(log.exchange_purpose)} ·{" "}
                    {formatNigerianDateTime(log.created_at)}
                  </p>
                  {log.success && (
                    <p className="text-caption text-ink-secondary tabular-nums">
                      {log.resources_returned}{" "}
                      {log.resources_returned === 1 ? "record" : "records"} shared
                    </p>
                  )}
                </div>
                <StatusBadge tone={log.success ? "info" : "neutral"} icon>
                  {log.success ? "Shared" : "Not shared"}
                </StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={confirmOpen}
        title="Save these sharing choices?"
        confirmLabel="Save changes"
        cancelLabel="Go back"
        busyLabel="Saving…"
        busy={saving}
        error={error}
        onConfirm={() => void savePreferences()}
        onCancel={() => setConfirmOpen(false)}
      >
        {changes.length > 0 ? (
          <>
            <p>After you save:</p>
            <ul className="space-y-1.5">
              {changes.map((c) => (
                <li key={c.key} className="rounded-md border border-line px-3 py-2">
                  <span className="block font-medium text-ink">{c.title}</span>
                  <span className="block">
                    {choiceLabel(c.key, c.from)} → <strong>{choiceLabel(c.key, c.to)}</strong>
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>Your current choices will be saved to your online account as shown.</p>
        )}
        <p>
          Your choices are saved as a record of your wishes. Requests are not
          yet checked against them automatically, so tell clinic staff too if
          you want sharing stopped. You can change your choices again at any
          time. Copies already sent to an organisation cannot be taken back.
        </p>
      </ConfirmDialog>
    </div>
  );
}
