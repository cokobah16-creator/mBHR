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
import { useOnlineStatus } from "./account/useOnlineStatus";

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

export function Referrals() {
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
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
        .select("*")
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
      title="Referrals"
      description="Specialists and services your care team has referred you to."
    />
  );

  const helpNote = (
    <div className="banner banner-info">
      <InformationCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <p>
        Questions about a referral, or need help booking? Contact the clinic
        that referred you.
      </p>
    </div>
  );

  if (!isSupabaseEnabled) {
    return (
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        {header}
        <div className="banner banner-info">
          <InformationCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p>
            Referrals are kept in the clinic&apos;s online system. This device is
            not connected to it, so referrals cannot be shown here. Ask clinic
            staff about any referral you were given.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        {header}
        <span role="status" className="sr-only">
          Loading your referrals
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
          All referrals
        </button>

        <PageHeader
          title={selectedReferral.specialty}
          description={
            selectedReferral.specialist_name
              ? `Dr. ${selectedReferral.specialist_name}`
              : undefined
          }
        />

        {selectedReferral.priority === "emergency" && (
          <div className="banner banner-danger" role="alert">
            <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <p>
              <strong>Emergency referral.</strong> Please seek immediate
              attention.
            </p>
          </div>
        )}

        {selectedReferral.status === "pending" && (
          <div className="banner banner-warning">
            <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <p>
              <strong>Action needed:</strong> contact the specialist&apos;s office
              to book your appointment.
            </p>
          </div>
        )}

        <section className="panel" aria-labelledby="referral-detail-title">
          <div className="panel-header">
            <h2 id="referral-detail-title" className="panel-title">
              Referral details
            </h2>
          </div>
          <dl className="panel-body grid gap-4 text-body sm:grid-cols-2">
            <div>
              <dt className="text-label text-ink-muted">Status</dt>
              <dd className="mt-1">
                <StatusBadge tone={status.tone} icon>
                  {status.label}
                </StatusBadge>
              </dd>
            </div>
            <div>
              <dt className="text-label text-ink-muted">Priority</dt>
              <dd className="mt-1">
                <StatusBadge tone={priority.tone}>{priority.label}</StatusBadge>
              </dd>
            </div>
            <div>
              <dt className="text-label text-ink-muted">Referred by</dt>
              <dd className="mt-1 text-ink">{selectedReferral.referring_provider}</dd>
            </div>
            <div>
              <dt className="text-label text-ink-muted">Referral date</dt>
              <dd className="mt-1 text-ink tabular-nums">
                {formatNigerianDate(selectedReferral.referral_date)}
              </dd>
            </div>
            {selectedReferral.appointment_date && (
              <div>
                <dt className="text-label text-ink-muted">Appointment date</dt>
                <dd className="mt-1 text-ink tabular-nums">
                  {formatNigerianDate(selectedReferral.appointment_date)}
                </dd>
              </div>
            )}
            <div className="sm:col-span-2">
              <dt className="text-label text-ink-muted">Reason for referral</dt>
              <dd className="mt-1 whitespace-pre-line text-ink">
                {selectedReferral.reason}
              </dd>
            </div>
            {selectedReferral.notes && (
              <div className="sm:col-span-2">
                <dt className="text-label text-ink-muted">Additional notes</dt>
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
                ? "We could not load your referrals. Please try again."
                : "You are offline. Connect to the internet to see your referrals."}
            </p>
            <button
              type="button"
              onClick={() => void loadReferrals()}
              className="btn-secondary"
            >
              <ArrowPathIcon className="h-5 w-5" aria-hidden />
              Try again
            </button>
          </div>
        </div>
      ) : (
        <section className="panel" aria-labelledby="referral-list-title">
          <div className="panel-header">
            <h2 id="referral-list-title" className="panel-title">
              Your referrals
            </h2>
            <span className="text-caption text-ink-muted tabular-nums">
              {referrals.length}
            </span>
          </div>
          {referrals.length === 0 ? (
            <EmptyState
              icon={UserGroupIcon}
              title="No referrals"
              description="If your care team refers you to a specialist, it will be listed here."
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
                            <StatusBadge tone={priority.tone}>{priority.label}</StatusBadge>
                          )}
                        </span>
                        {referral.specialist_name && (
                          <span className="block text-caption text-ink-secondary">
                            Dr. {referral.specialist_name}
                          </span>
                        )}
                        <span className="block text-caption text-ink-muted">
                          Referred by {referral.referring_provider} on{" "}
                          {formatNigerianDate(referral.referral_date)}
                        </span>
                        {referral.appointment_date && (
                          <span className="block text-caption text-ink-secondary">
                            Appointment: {formatNigerianDate(referral.appointment_date)}
                          </span>
                        )}
                        <span className="mt-1 block">
                          <StatusBadge tone={status.tone} icon>
                            {status.label}
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
