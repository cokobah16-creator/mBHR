import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowPathIcon,
  ChevronRightIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  SignalSlashIcon,
} from "@heroicons/react/24/outline";
import { useAuth } from "@/hooks/useAuth";
import { PortalHome, type NextAppointment } from "./PortalHome";
import { PortalSkeleton } from "@/components/ui/Skeleton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getPatientAppointments } from "@/services/appointments";
import { useT } from "@/hooks/useT";
import {
  getPatientProfile,
  getPatientProfileByEmail,
  getVitals,
  getMedications,
  getVisits,
} from "@/services/patientService";
import type {
  PatientProfile,
  Vital,
  Medication,
  Visit,
} from "@/services/patientService";
import { isSupabaseEnabled } from "@/lib/supabaseClient";
// Legacy offline dashboard
import { getPatientDashboard } from "@/services/patientPortalData";
import type { PatientDashboardData } from "@/types/patientPortal";
import * as logger from "@/lib/logger";
import {
  formatPortalDate,
  pickNextAppointment,
  vitalStatusTone,
} from "./portalStatus";
import {
  clearPortalSession,
  readActiveProfile,
  readPortalUser,
  resolveActivePatientId,
} from "./portalSession";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

// ─── Types ────────────────────────────────────────────────────────────────────

type VitalStatus = "normal" | "monitor" | "attention";

function bpStatus(systolic: number): VitalStatus {
  if (systolic < 120) return "normal";
  if (systolic < 140) return "monitor";
  return "attention";
}

function tempStatus(temp: number): VitalStatus {
  if (temp >= 36.1 && temp <= 37.2) return "normal";
  if (temp <= 38.0) return "monitor";
  return "attention";
}

const statusLabelKey: Record<VitalStatus, string> = {
  normal: "portal.vital.status.normal",
  monitor: "portal.vital.status.monitor",
  attention: "portal.vital.status.attention",
};

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : "unknown";
}

function VitalCard({
  label,
  value,
  unit,
  status,
}: {
  label: string;
  value: string;
  unit?: string;
  /** Omitted for readings the portal does not assess (e.g. weight). */
  status?: VitalStatus;
}) {
  const { t } = useT();
  return (
    <div className="rounded-lg border border-line bg-surface-sunken p-4">
      <p className="text-label text-ink-secondary">{label}</p>
      <p className="mt-1 text-h2 tabular-nums text-ink">
        {value}
        {unit && (
          <span className="ml-1 text-caption font-normal text-ink-muted">
            {unit}
          </span>
        )}
      </p>
      {status && (
        <StatusBadge tone={vitalStatusTone(status)} icon className="mt-2">
          {t(statusLabelKey[status])}
        </StatusBadge>
      )}
    </div>
  );
}

interface VitalsView {
  takenAt: Date | string;
  systolic?: number | null;
  diastolic?: number | null;
  weightKg?: number | null;
  tempC?: number | null;
}

function VitalsPanel({ vitals }: { vitals: VitalsView }) {
  const { t } = useT();
  const hasBp = !!vitals.systolic && !!vitals.diastolic;
  const hasTemp = vitals.tempC != null && vitals.tempC !== 0;
  const hasWeight = vitals.weightKg != null;
  if (!hasBp && !hasTemp && !hasWeight) return null;

  const bp = hasBp ? bpStatus(vitals.systolic as number) : null;
  const temp = hasTemp ? tempStatus(vitals.tempC as number) : null;
  const anyFlag = (bp && bp !== "normal") || (temp && temp !== "normal");

  return (
    <section className="panel" aria-labelledby="home-vitals">
      <div className="panel-header">
        <h2 id="home-vitals" className="panel-title">
          {t("portal.section.latestVitals")}
        </h2>
        <Link to="/patient/medical-history" className="btn-ghost text-label">
          {t("portal.viewHistory")}
          <ChevronRightIcon className="h-4 w-4" aria-hidden />
        </Link>
      </div>
      <div className="panel-body">
        <p className="mb-3 text-caption text-ink-muted">
          {t("portal.vital.recordedOn", {
            date: formatPortalDate(vitals.takenAt),
          })}
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {hasBp && bp && (
            <VitalCard
              label={t("portal.vital.bloodPressure")}
              value={`${vitals.systolic}/${vitals.diastolic}`}
              unit={t("portal.vital.unit.mmHg")}
              status={bp}
            />
          )}
          {hasWeight && (
            <VitalCard
              label={t("portal.vital.weight")}
              value={`${vitals.weightKg}`}
              unit={t("portal.vital.unit.kg")}
            />
          )}
          {hasTemp && temp && (
            <VitalCard
              label={t("portal.vital.temperature")}
              value={`${vitals.tempC}°C`}
              status={temp}
            />
          )}
        </div>
        {anyFlag && (
          <p className="mt-3 flex items-start gap-2 text-caption text-ink-secondary">
            <InformationCircleIcon
              className="h-4 w-4 shrink-0 text-ink-muted"
              aria-hidden
            />
            {t("portal.vital.flagHint")}
          </p>
        )}
      </div>
    </section>
  );
}

interface MedicineView {
  key: string;
  name: string;
  dosage?: string | null;
  directions?: string | null;
  givenAt: Date | string;
}

function MedicinesPanel({ medicines }: { medicines: MedicineView[] }) {
  const { t } = useT();
  return (
    <section className="panel" aria-labelledby="home-medicines">
      <div className="panel-header">
        <h2 id="home-medicines" className="panel-title">
          {t("portal.section.recentMedicines")}
        </h2>
        {medicines.length > 0 && (
          <Link to="/patient/prescriptions" className="btn-ghost text-label">
            {t("portal.viewAll")}
            <ChevronRightIcon className="h-4 w-4" aria-hidden />
          </Link>
        )}
      </div>
      {medicines.length > 0 ? (
        <ul className="divide-y divide-line">
          {medicines.slice(0, 3).map((med) => (
            <li key={med.key} className="px-4 py-3">
              <p className="text-body font-medium text-ink">{med.name}</p>
              {med.dosage && (
                <p className="text-body text-ink-secondary">{med.dosage}</p>
              )}
              {med.directions && (
                <p className="text-body text-ink-secondary">
                  {med.directions}
                </p>
              )}
              <p className="mt-0.5 text-caption text-ink-muted">
                {t("portal.medicines.givenOn", {
                  date: formatPortalDate(med.givenAt),
                })}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <div className="panel-body">
          <p className="text-body text-ink">{t("portal.noMedications")}</p>
          <p className="mt-1 text-caption text-ink-muted">
            {t("portal.noMedicationsHint")}
          </p>
        </div>
      )}
    </section>
  );
}

// ─── Online (Supabase) dashboard ──────────────────────────────────────────────

interface SupabaseDashboardState {
  profile: PatientProfile | null;
  vitals: Vital[];
  medications: Medication[];
  visits: Visit[];
  /** True when one of the record lists failed to load. */
  partial: boolean;
}

function SupabaseDashboard() {
  const { user, loading: authLoading } = useAuth();
  const { t } = useT();
  const online = useOnlineStatus();
  const [state, setState] = useState<SupabaseDashboardState>({
    profile: null,
    vitals: [],
    medications: [],
    visits: [],
    partial: false,
  });
  const [nextAppointment, setNextAppointment] = useState<
    NextAppointment | null | undefined
  >(undefined);
  const [loading, setLoading] = useState(true);
  // Stored as a translation key so the loader does not depend on `t`.
  const [errorKey, setErrorKey] = useState("");

  const userId = user?.id;
  const userEmail = user?.email;

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setErrorKey("");
    try {
      // Load profile first so we have the patientId for subsequent queries
      let profileRes = await getPatientProfile(userId);
      // Fallback: look up by email and auto-link auth_uid when lookup by uid fails
      if ((profileRes.error || !profileRes.data) && userEmail) {
        profileRes = await getPatientProfileByEmail(userId, userEmail);
      }
      if (profileRes.error || !profileRes.data) {
        setErrorKey(
          navigator.onLine ? "portal.error.loadProfile" : "portal.error.offline",
        );
        return;
      }

      const patientId = profileRes.data.id;
      const [vitalsResult, medsResult, visitsResult] = await Promise.all([
        getVitals(patientId),
        getMedications(patientId),
        getVisits(patientId),
      ]);

      // Best effort: the home screen still works if appointments fail to load.
      getPatientAppointments(patientId)
        .then((appts) => {
          const next = pickNextAppointment(appts);
          setNextAppointment(
            next
              ? {
                  scheduledAt: new Date(next.scheduledAt),
                  type: next.appointmentType,
                  televisit: next.visitMode === "televisit",
                  meetingLink: next.meetingLink,
                }
              : null,
          );
        })
        .catch(() => setNextAppointment(undefined));

      setState({
        profile: profileRes.data,
        vitals: vitalsResult.data ?? [],
        medications: medsResult.data ?? [],
        visits: visitsResult.data ?? [],
        partial: !!(
          vitalsResult.error ||
          medsResult.error ||
          visitsResult.error
        ),
      });
    } catch (err) {
      logger.error("[PatientDashboard] load error:", errorName(err));
      setErrorKey(
        navigator.onLine ? "portal.error.loadInfo" : "portal.error.offline",
      );
    } finally {
      setLoading(false);
    }
  }, [userId, userEmail]);

  useEffect(() => {
    load();
  }, [load]);

  if (authLoading || (loading && !!userId)) return <PortalSkeleton />;
  if (!userId) return <ErrorCard message={t("portal.error.loadProfile")} />;
  if (errorKey) {
    return (
      <ErrorCard
        message={t(errorKey)}
        offline={errorKey === "portal.error.offline"}
        onRetry={load}
        retryLabel={t("portal.error.retry")}
      />
    );
  }

  const { profile, vitals, medications, visits, partial } = state;
  if (!profile) return null;

  const latest = vitals[0] ?? null;

  return (
    <PortalHome name={profile.givenName} nextAppointment={nextAppointment}>
      {!online && (
        <div className="banner banner-warning" role="status">
          <SignalSlashIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p>{t("portal.offline.stale")}</p>
        </div>
      )}
      {partial && (
        <div className="banner banner-warning" role="status">
          <ExclamationTriangleIcon
            className="mt-0.5 h-5 w-5 shrink-0"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p>{t("portal.error.partial")}</p>
            <button
              type="button"
              onClick={load}
              className="btn-secondary mt-2"
            >
              <ArrowPathIcon className="h-5 w-5" aria-hidden />
              {t("portal.error.retry")}
            </button>
          </div>
        </div>
      )}

      {latest && <VitalsPanel vitals={latest} />}

      <MedicinesPanel
        medicines={medications.map((m) => ({
          key: m.id,
          name: m.itemName,
          dosage: m.dosage,
          directions: m.directions,
          givenAt: m.dispensedAt,
        }))}
      />

      {visits.length > 0 && (
        <section className="panel" aria-labelledby="home-visits">
          <div className="panel-header">
            <h2 id="home-visits" className="panel-title">
              {t("portal.section.recentVisits")}
            </h2>
            <Link to="/patient/medical-history" className="btn-ghost text-label">
              {t("portal.viewAll")}
              <ChevronRightIcon className="h-4 w-4" aria-hidden />
            </Link>
          </div>
          <ul className="divide-y divide-line">
            {visits.slice(0, 3).map((v) => (
              <li key={v.id}>
                <Link
                  to={`/patient/visit/${v.id}`}
                  className="flex min-h-touch-target items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-body font-medium text-ink">
                      {formatPortalDate(v.startedAt)}
                      {v.siteName && (
                        <span className="font-normal text-ink-muted">
                          {" "}
                          · {v.siteName}
                        </span>
                      )}
                    </span>
                    {v.diagnosis && (
                      <span className="mt-0.5 block text-body text-ink-secondary line-clamp-2">
                        <span className="text-ink-muted">
                          {t("portal.visit.assessment")}:
                        </span>{" "}
                        {v.diagnosis}
                      </span>
                    )}
                    {v.notes && (
                      <span className="mt-0.5 block text-caption text-ink-muted line-clamp-2">
                        {t("portal.visit.yourConcern")}: {v.notes}
                      </span>
                    )}
                  </span>
                  <ChevronRightIcon
                    className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PortalHome>
  );
}

// ─── Offline (legacy) dashboard ───────────────────────────────────────────────

function OfflineDashboard() {
  const navigate = useNavigate();
  const { t } = useT();
  const online = useOnlineStatus();
  const [data, setData] = useState<PatientDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorKey, setErrorKey] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErrorKey("");
    try {
      const portalUser = readPortalUser();
      if (!portalUser) {
        navigate("/patient/login", { replace: true });
        return;
      }
      if (!portalUser.patientId || !portalUser.id) {
        clearPortalSession();
        navigate("/patient/login", { replace: true });
        return;
      }

      // Validate that the requested patient is owned by this portal user (IDOR guard)
      const activePatientId = resolveActivePatientId(
        portalUser,
        readActiveProfile(),
      );

      const dashboardData = await getPatientDashboard(
        portalUser.id,
        activePatientId,
      );
      if (dashboardData) {
        setData(dashboardData);
      } else {
        setErrorKey(
          isSupabaseEnabled && !navigator.onLine
            ? "portal.error.offline"
            : "portal.error.loadDashboard",
        );
      }
    } catch (err) {
      logger.error("[PatientDashboard offline] load error:", errorName(err));
      setErrorKey("portal.error.loadInfo");
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <PortalSkeleton />;
  if (errorKey) {
    return (
      <ErrorCard
        message={t(errorKey)}
        offline={errorKey === "portal.error.offline"}
        onRetry={load}
        retryLabel={t("portal.error.retry")}
      />
    );
  }
  if (!data) return null;

  const { patient, upcomingAppointments, recentVitals, activeMedications } =
    data;

  // Without the online portal the records come from this device, which does
  // not hold appointments: leave "next appointment" unknown, not "none".
  const next = pickNextAppointment(upcomingAppointments);
  const nextAppointment: NextAppointment | null | undefined = isSupabaseEnabled
    ? next
      ? { scheduledAt: new Date(next.scheduledAt), type: next.appointmentType }
      : null
    : undefined;

  return (
    <PortalHome
      name={patient.givenName}
      nextAppointment={nextAppointment}
      unreadMessages={data.unreadMessages}
    >
      {!isSupabaseEnabled ? (
        <div className="banner banner-info" role="status">
          <InformationCircleIcon
            className="mt-0.5 h-5 w-5 shrink-0"
            aria-hidden
          />
          <p>{t("portal.localData")}</p>
        </div>
      ) : (
        !online && (
          <div className="banner banner-warning" role="status">
            <SignalSlashIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <p>{t("portal.offline.stale")}</p>
          </div>
        )
      )}

      {recentVitals && (
        <VitalsPanel
          vitals={{
            takenAt: recentVitals.takenAt,
            systolic: recentVitals.systolic,
            diastolic: recentVitals.diastolic,
            weightKg: recentVitals.weightKg,
            tempC: recentVitals.tempC,
          }}
        />
      )}

      <MedicinesPanel
        medicines={activeMedications.map((med, i) => ({
          key: `${med.medicationName}-${i}`,
          name: med.medicationName,
          dosage: med.dosage,
          directions: med.directions,
          givenAt: med.dispensedAt,
        }))}
      />
    </PortalHome>
  );
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function ErrorCard({
  message,
  offline = false,
  onRetry,
  retryLabel,
}: {
  message: string;
  offline?: boolean;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const Icon = offline ? SignalSlashIcon : ExclamationCircleIcon;
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div
        className={`banner ${offline ? "banner-warning" : "banner-danger"}`}
        role="alert"
      >
        <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p>{message}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="btn-secondary mt-3"
            >
              <ArrowPathIcon className="h-5 w-5" aria-hidden />
              {retryLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Root export ──────────────────────────────────────────────────────────────

export function PatientDashboard() {
  const { user, loading } = useAuth();

  if (loading) return <PortalSkeleton />;

  // Use Supabase-backed dashboard when available and user is signed in
  if (isSupabaseEnabled && user) return <SupabaseDashboard />;

  // Fall back to legacy offline dashboard
  return <OfflineDashboard />;
}
