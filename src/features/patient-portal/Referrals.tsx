import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, isSupabaseEnabled } from "@/lib/supabaseClient";
import * as logger from "@/lib/logger";
import { formatNigerianDate } from "@/utils/dateFormat";
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import {
  referralPriorityDisplay,
  referralStatusDisplay,
} from "./account/displayStatus";
import { errorName, readPortalUser } from "./account/portalSession";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useT } from "@/hooks/useT";

interface Referral {
  id: string;
  referring_provider: string;
  specialist_name?: string;
  specialty: string;
  reason: string;
  referral_date: string;
  appointment_date?: string;
  status: "pending" | "scheduled" | "completed" | "cancelled";
  notes?: string;
  priority: "routine" | "urgent" | "emergency";
}

// Only what this screen shows.
const REFERRAL_COLUMNS =
  "id, referring_provider, specialist_name, specialty, reason, referral_date, appointment_date, status, notes, priority";

const STATUSES = ["pending", "scheduled", "completed", "cancelled"];
const PRIORITIES = ["routine", "urgent", "emergency"];

export function Referrals() {
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  const { t } = useT();
  // Stored values the screen does not know keep the helper's label.
  const statusLabel = (value: string, fallback: string) =>
    STATUSES.includes(value) ? t(`portal.ref.status.${value}`) : fallback;
  const priorityLabel = (value: string, fallback: string) =>
    PRIORITIES.includes(value) ? t(`portal.ref.priority.${value}`) : fallback;
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [loading, setLoading] = useState(isSupabaseEnabled);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedReferral, setSelectedReferral] = useState<Referral | null>(
    null,
  );

  const loadReferrals = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadFailed(false);

    try {
      const portalUser = readPortalUser();
      if (!portalUser) {
        navigate("/patient/login", { replace: true });
        return;
      }

      const { data, error: referralsError } = await supabase
        .from("patient_referrals")
        .select(REFERRAL_COLUMNS)
        .eq("patient_id", portalUser.patientId)
        .order("referral_date", { ascending: false });

      if (referralsError) throw referralsError;

      setReferrals(data || []);
    } catch (err) {
      logger.error("[Referrals] load failed:", errorName(err));
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    void loadReferrals();
  }, [loadReferrals]);

  const header = (
    <PageHeader
      title={t("portal.ref.title")}
      description={t("portal.ref.description")}
    />
  );

  const helpNote = (
    <div className="banner banner-info">
      <InformationCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <p>{t("portal.ref.help")}</p>
    </div>
  );

  if (!isSupabaseEnabled) {
    return (
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        {header}
        <div className="banner banner-info">
          <InformationCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p>{t("portal.ref.notConnected")}</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        {header}
        <span role="status" className="sr-only">
          {t("portal.ref.loading")}
        </span>
        <div className="panel p-5" aria-hidden>
          <Skeleton className="mb-4 h-5 w-40" />
          <SkeletonText lines={4} />
        </div>
      </div>
    );
  }

  if (selectedReferral) {
    const status = referralStatusDisplay(selectedReferral.status);
    const priority = referralPriorityDisplay(selectedReferral.priority);
    return (
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        <button
          type="button"
          onClick={() => setSelectedReferral(null)}
          className="btn-ghost -ml-3"
        >
          <ArrowLeftIcon className="h-5 w-5" aria-hidden />
          {t("portal.ref.back")}
        </button>

        <PageHeader
          title={selectedReferral.specialty}
          description={
            selectedReferral.specialist_name
              ? t("portal.ref.doctor", { name: selectedReferral.specialist_name })
              : undefined
          }
        />

        {selectedReferral.priority === "emergency" && (
          <div className="banner banner-danger" role="alert">
            <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <p>
              <strong>{t("portal.ref.emergencyTitle")}</strong>{" "}
              {t("portal.ref.emergencyBody")}
            </p>
          </div>
        )}

        {selectedReferral.status === "pending" && (
          <div className="banner banner-warning">
            <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <p>
              <strong>{t("portal.ref.actionTitle")}</strong>{" "}
              {t("portal.ref.actionBody")}
            </p>
          </div>
        )}

        <section className="panel" aria-labelledby="referral-detail-title">
          <div className="panel-header">
            <h2 id="referral-detail-title" className="panel-title">
              {t("portal.ref.detailsTitle")}
            </h2>
          </div>
          <dl className="panel-body grid gap-4 text-body sm:grid-cols-2">
            <div>
              <dt className="text-label text-ink-muted">{t("portal.ref.label.status")}</dt>
              <dd className="mt-1">
                <StatusBadge tone={status.tone} icon>
                  {statusLabel(selectedReferral.status, status.label)}
                </StatusBadge>
              </dd>
            </div>
            <div>
              <dt className="text-label text-ink-muted">{t("portal.ref.label.priority")}</dt>
              <dd className="mt-1">
                <StatusBadge tone={priority.tone}>
                  {priorityLabel(selectedReferral.priority, priority.label)}
                </StatusBadge>
              </dd>
            </div>
            <div>
              <dt className="text-label text-ink-muted">{t("portal.ref.label.referredBy")}</dt>
              <dd className="mt-1 text-ink">{selectedReferral.referring_provider}</dd>
            </div>
            <div>
              <dt className="text-label text-ink-muted">{t("portal.ref.label.referralDate")}</dt>
              <dd className="mt-1 text-ink tabular-nums">
                {formatNigerianDate(selectedReferral.referral_date)}
              </dd>
            </div>
            {selectedReferral.appointment_date && (
              <div>
                <dt className="text-label text-ink-muted">{t("portal.ref.label.appointmentDate")}</dt>
                <dd className="mt-1 text-ink tabular-nums">
                  {formatNigerianDate(selectedReferral.appointment_date)}
                </dd>
              </div>
            )}
            <div className="sm:col-span-2">
              <dt className="text-label text-ink-muted">{t("portal.ref.label.reason")}</dt>
              <dd className="mt-1 whitespace-pre-line text-ink">
                {selectedReferral.reason}
              </dd>
            </div>
            {selectedReferral.notes && (
              <div className="sm:col-span-2">
                <dt className="text-label text-ink-muted">{t("portal.ref.label.notes")}</dt>
                <dd className="mt-1 whitespace-pre-line text-ink">
                  {selectedReferral.notes}
                </dd>
              </div>
            )}
          </dl>
        </section>

        {helpNote}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      {header}

      {loadFailed ? (
        <div className="banner banner-danger" role="alert">
          <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div className="space-y-3">
            <p>
              {isOnline
                ? t("portal.ref.loadFailed")
                : t("portal.ref.offline")}
            </p>
            <button
              type="button"
              onClick={() => void loadReferrals()}
              className="btn-secondary"
            >
              <ArrowPathIcon className="h-5 w-5" aria-hidden />
              {t("portal.error.retry")}
            </button>
          </div>
        </div>
      ) : (
        <section className="panel" aria-labelledby="referral-list-title">
          <div className="panel-header">
            <h2 id="referral-list-title" className="panel-title">
              {t("portal.ref.listTitle")}
            </h2>
            <span className="text-caption text-ink-muted tabular-nums">
              {referrals.length}
            </span>
          </div>
          {referrals.length === 0 ? (
            <EmptyState
              icon={UserGroupIcon}
              title={t("portal.ref.emptyTitle")}
              description={t("portal.ref.emptyBody")}
            />
          ) : (
            <ul className="divide-y divide-line">
              {referrals.map((referral) => {
                const status = referralStatusDisplay(referral.status);
                const priority = referralPriorityDisplay(referral.priority);
                return (
                  <li key={referral.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedReferral(referral)}
                      className="flex w-full min-h-touch-target items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-body font-medium text-ink">
                            {referral.specialty}
                          </span>
                          {referral.priority !== "routine" && (
                            <StatusBadge tone={priority.tone}>
                              {priorityLabel(referral.priority, priority.label)}
                            </StatusBadge>
                          )}
                        </span>
                        {referral.specialist_name && (
                          <span className="block text-caption text-ink-secondary">
                            {t("portal.ref.doctor", { name: referral.specialist_name })}
                          </span>
                        )}
                        <span className="block text-caption text-ink-muted">
                          {t("portal.ref.referredByOn", {
                            provider: referral.referring_provider,
                            date: formatNigerianDate(referral.referral_date),
                          })}
                        </span>
                        {referral.appointment_date && (
                          <span className="block text-caption text-ink-secondary">
                            {t("portal.ref.appointment", {
                              date: formatNigerianDate(referral.appointment_date),
                            })}
                          </span>
                        )}
                        <span className="mt-1 block">
                          <StatusBadge tone={status.tone} icon>
                            {statusLabel(referral.status, status.label)}
                          </StatusBadge>
                        </span>
                      </span>
                      <ChevronRightIcon className="mt-1 h-5 w-5 shrink-0 text-ink-muted" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {helpNote}
    </div>
  );
}
