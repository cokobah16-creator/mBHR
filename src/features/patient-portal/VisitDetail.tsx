import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ChatBubbleLeftRightIcon,
} from "@heroicons/react/24/outline";
import { loadVisitDetails } from "@/services/patientPortalData";
import type { PatientMedicalRecord, PortalDataError } from "@/types/patientPortal";
import { isSupabaseEnabled } from "@/lib/supabaseClient";
import * as logger from "@/lib/logger";
import { PortalListSkeleton, PortalNotice, PortalPage } from "./PortalPage";
import { formatPortalDate, formatPortalLongDate } from "./portalStatus";
import { clearPortalSession, readPortalUser } from "./portalSession";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useT } from "@/hooks/useT";

function BackLink() {
  const { t } = useT();
  return (
    <Link to="/patient/medical-history" className="btn-secondary">
      <ArrowLeftIcon className="h-5 w-5" aria-hidden />
      {t("portal.visit.back")}
    </Link>
  );
}

function NotConnectedNotice() {
  const { t } = useT();
  return (
    <PortalNotice tone="info" title={t("portal.visit.notConnectedTitle")}>
      {t("portal.visit.notConnected")}
    </PortalNotice>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="panel" aria-labelledby={id}>
      <div className="panel-header">
        <h2 id={id} className="panel-title">
          {title}
        </h2>
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

function NoteBlock({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <h3 className="text-label text-ink-secondary">{label}</h3>
      <p className="mt-1 whitespace-pre-wrap rounded-md bg-surface-sunken p-3 text-body text-ink">
        {text}
      </p>
    </div>
  );
}

export function VisitDetail() {
  const { t } = useT();
  const backCrumb = { label: t("portal.visits.title"), to: "/patient/medical-history" };
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const { visitId } = useParams<{ visitId: string }>();
  const [visit, setVisit] = useState<PatientMedicalRecord | null>(null);
  const [loading, setLoading] = useState(true);
  // A problem with the link itself (no visit id), as a translation key.
  const [error, setError] = useState("");
  // Why the visit did not load: "not_found" only when the server answered
  // that it has no such visit for this patient.
  const [loadError, setLoadError] = useState<PortalDataError | null>(null);

  const loadVisit = useCallback(
    async (id: string) => {
      setLoading(true);
      setError("");
      setLoadError(null);
      // Never show a different visit under this link while loading.
      setVisit((current) => (current && current.visitId === id ? current : null));
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
        const result = await loadVisitDetails(
          portalUser.id,
          portalUser.patientId,
          id,
        );
        if (result.visit && !result.error) {
          setVisit(result.visit);
        } else {
          setVisit(null);
          setLoadError(result.error ?? "failed");
        }
      } catch (err) {
        logger.error(
          "Error loading visit details:",
          err instanceof Error ? err.name : "unknown",
        );
        setVisit(null);
        setLoadError(navigator.onLine ? "failed" : "offline");
      } finally {
        setLoading(false);
      }
    },
    [navigate],
  );

  // Try once even when offline (this phone may have kept a copy from the last
  // time it was online), then reload when the connection comes back.
  const attemptedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!visitId) {
      setLoading(false);
      setError("portal.visit.badLink");
      return;
    }
    if (!isSupabaseEnabled) {
      setLoading(false);
      return;
    }
    if (!online && attemptedFor.current === visitId) return;
    attemptedFor.current = visitId;
    loadVisit(visitId);
  }, [visitId, online, loadVisit]);

  if (!isSupabaseEnabled) {
    return (
      <PortalPage title={t("portal.visit.detailsTitle")} breadcrumbs={[backCrumb, { label: t("portal.visit.crumb") }]}>
        <NotConnectedNotice />
        <BackLink />
      </PortalPage>
    );
  }

  // A refresh of the visit already on screen (e.g. after reconnecting) keeps
  // it visible; a different visit never shows here while loading.
  if (loading && !visit) {
    return <PortalListSkeleton label={t("portal.state.loading.visit")} rows={3} />;
  }

  if (!visit) {
    // Offline, the page reloads by itself when the connection comes back.
    const retry =
      visitId && online ? (
        <button
          type="button"
          onClick={() => loadVisit(visitId)}
          className="btn-secondary"
        >
          <ArrowPathIcon className="h-5 w-5" aria-hidden />
          {t("portal.error.retry")}
        </button>
      ) : undefined;
    let notice: ReactNode;
    if (error) {
      notice = <PortalNotice tone="danger">{t(error)}</PortalNotice>;
    } else if (loadError === "not_found") {
      notice = (
        <PortalNotice tone="warning" title={t("portal.visit.notFoundTitle")}>
          {t("portal.visit.notFound")}
        </PortalNotice>
      );
    } else if (loadError === "unavailable") {
      notice = <NotConnectedNotice />;
    } else if (loadError === "offline" || !online) {
      notice = (
        <PortalNotice tone="offline" title={t("portal.visits.offlineTitle")} action={retry}>
          {t("portal.visit.offlineEmpty")}
        </PortalNotice>
      );
    } else {
      notice = (
        <PortalNotice tone="danger" action={retry}>
          {t("portal.visit.loadFailed")}
        </PortalNotice>
      );
    }
    return (
      <PortalPage title={t("portal.visit.detailsTitle")} breadcrumbs={[backCrumb, { label: t("portal.visit.crumb") }]}>
        {notice}
        <BackLink />
      </PortalPage>
    );
  }

  const shortDate = formatPortalDate(visit.visitDate);
  const vitals = visit.vitals;
  const vitalItems: { label: string; value: string; unit: string }[] = [];
  if (vitals) {
    if (vitals.systolic && vitals.diastolic) {
      vitalItems.push({
        label: t("portal.visit.bloodPressure"),
        value: `${vitals.systolic}/${vitals.diastolic}`,
        unit: "mmHg",
      });
    }
    if (vitals.pulseBpm) {
      vitalItems.push({
        label: t("portal.visit.heartRate"),
        value: `${vitals.pulseBpm}`,
        unit: t("portal.visit.bpm"),
      });
    }
    if (vitals.tempC) {
      vitalItems.push({
        label: t("portal.visit.temperature"),
        value: `${vitals.tempC}`,
        unit: "°C",
      });
    }
    if (vitals.spo2) {
      vitalItems.push({
        label: t("portal.visit.oxygen"),
        value: `${vitals.spo2}`,
        unit: "%",
      });
    }
    if (vitals.heightCm) {
      vitalItems.push({
        label: t("portal.visit.height"),
        value: `${vitals.heightCm}`,
        unit: "cm",
      });
    }
    if (vitals.weightKg) {
      vitalItems.push({
        label: t("portal.visit.weight"),
        value: `${vitals.weightKg}`,
        unit: "kg",
      });
    }
    if (vitals.bmi) {
      vitalItems.push({
        label: t("portal.visit.bmi"),
        value: vitals.bmi.toFixed(1),
        unit: "kg/m²",
      });
    }
  }

  const consultation = visit.consultation;
  const diagnoses = consultation?.diagnoses ?? [];

  return (
    <PortalPage
      title={t("portal.visit.title", { date: shortDate })}
      breadcrumbs={[backCrumb, { label: shortDate }]}
      description={
        <>
          {t("portal.visit.recordedOn", { date: formatPortalLongDate(visit.visitDate) })}
          {consultation?.providerName && (
            <> {t("portal.visit.seenBy", { name: consultation.providerName })}.</>
          )}
        </>
      }
    >
      {!online && (
        <PortalNotice tone="offline" title={t("portal.visits.offlineTitle")}>
          {t("portal.visit.offlineStale")}
        </PortalNotice>
      )}

      {visit.chiefComplaint && (
        <p className="text-body text-ink-secondary">
          <span className="text-ink-muted">{t("portal.visit.reason")} </span>
          {visit.chiefComplaint}
        </p>
      )}

      {vitalItems.length > 0 && (
        <Section id="visit-vitals" title={t("portal.visit.measurements")}>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {vitalItems.map((item) => (
              <div
                key={item.label}
                className="rounded-lg border border-line bg-surface-sunken p-3"
              >
                <dt className="text-label text-ink-secondary">{item.label}</dt>
                <dd className="mt-1 text-h2 tabular-nums text-ink">
                  {item.value}
                  <span className="ml-1 text-caption font-normal text-ink-muted">
                    {item.unit}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-caption text-ink-muted">
            {t("portal.visit.measurementsNote")}
          </p>
        </Section>
      )}

      {consultation && (
        <Section id="visit-consultation" title={t("portal.visit.recorded")}>
          <div className="space-y-4">
            {diagnoses.length > 0 && (
              <div>
                <h3 className="text-label text-ink-secondary">{t("portal.visit.diagnosis")}</h3>
                <ul className="mt-1 flex flex-wrap gap-2">
                  {diagnoses.map((diagnosis, idx) => (
                    <li
                      key={`${diagnosis}-${idx}`}
                      className="rounded-md border border-line bg-surface-sunken px-3 py-1.5 text-body font-medium text-ink"
                    >
                      {diagnosis}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {consultation.subjective && (
              <NoteBlock
                label={t("portal.visit.yourConcern")}
                text={consultation.subjective}
              />
            )}
            {consultation.objective && (
              <NoteBlock
                label={t("portal.visit.objective")}
                text={consultation.objective}
              />
            )}
            {consultation.assessment && (
              <NoteBlock
                label={t("portal.visit.assessment")}
                text={consultation.assessment}
              />
            )}
            {consultation.plan && (
              <NoteBlock label={t("portal.visit.plan")} text={consultation.plan} />
            )}
          </div>
        </Section>
      )}

      {visit.prescriptions && visit.prescriptions.length > 0 && (
        <Section id="visit-medicines" title={t("portal.visit.medicinesGiven")}>
          <ul className="divide-y divide-line">
            {visit.prescriptions.map((rx, idx) => (
              <li
                key={`${rx.medicationName}-${idx}`}
                className="py-3 first:pt-0 last:pb-0"
              >
                <p className="text-body font-medium text-ink">
                  {rx.medicationName}
                </p>
                {rx.dosage && (
                  <p className="text-body text-ink-secondary">{rx.dosage}</p>
                )}
                {rx.directions && (
                  <p className="text-body text-ink-secondary">
                    {rx.directions}
                  </p>
                )}
                {rx.dispensedAt && (
                  <p className="mt-0.5 text-caption text-ink-muted">
                    {t("portal.visit.givenOn", { date: formatPortalDate(rx.dispensedAt) })}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {!vitals && !consultation && (visit.prescriptions?.length ?? 0) === 0 && (
        <PortalNotice tone="info">
          {t("portal.visit.nothingRecorded")}
        </PortalNotice>
      )}

      <div className="flex flex-wrap gap-2">
        <BackLink />
        <Link to="/patient/messages" className="btn-secondary">
          <ChatBubbleLeftRightIcon className="h-5 w-5" aria-hidden />
          {t("portal.visit.ask")}
        </Link>
      </div>
    </PortalPage>
  );
}
