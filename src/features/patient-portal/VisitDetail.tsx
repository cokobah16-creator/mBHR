import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ChatBubbleLeftRightIcon,
} from "@heroicons/react/24/outline";
import { getVisitDetails } from "@/services/patientPortalData";
import type { PatientMedicalRecord } from "@/types/patientPortal";
import { isSupabaseEnabled } from "@/lib/supabaseClient";
import * as logger from "@/lib/logger";
import { PortalListSkeleton, PortalNotice, PortalPage } from "./PortalPage";
import { formatPortalDate, formatPortalLongDate } from "./portalStatus";
import { clearPortalSession, readPortalUser } from "./portalSession";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

const BACK_CRUMB = { label: "Your visits", to: "/patient/medical-history" };

function BackLink() {
  return (
    <Link to="/patient/medical-history" className="btn-secondary">
      <ArrowLeftIcon className="h-5 w-5" aria-hidden />
      Back to your visits
    </Link>
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
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const { visitId } = useParams<{ visitId: string }>();
  const [visit, setVisit] = useState<PatientMedicalRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadVisitDetails = useCallback(
    async (id: string) => {
      setLoading(true);
      setError("");
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
        const visitData = await getVisitDetails(
          portalUser.id,
          portalUser.patientId,
          id,
        );
        if (visitData) {
          setVisit(visitData);
        } else {
          setVisit(null);
          setError(
            "We could not find this visit. It may not be uploaded yet, or it could not be loaded.",
          );
        }
      } catch (err) {
        logger.error(
          "Error loading visit details:",
          err instanceof Error ? err.name : "unknown",
        );
        setVisit(null);
        setError("We could not load this visit. Please try again.");
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
      setError("This link does not point to a visit.");
      return;
    }
    if (!isSupabaseEnabled) {
      setLoading(false);
      return;
    }
    if (!online && attemptedFor.current === visitId) return;
    attemptedFor.current = visitId;
    loadVisitDetails(visitId);
  }, [visitId, online, loadVisitDetails]);

  if (!isSupabaseEnabled) {
    return (
      <PortalPage title="Visit details" breadcrumbs={[BACK_CRUMB, { label: "Visit" }]}>
        <PortalNotice tone="info" title="Visit details are not available here">
          This portal is not connected to the clinic&apos;s online records, so
          visit details cannot be shown.
        </PortalNotice>
        <BackLink />
      </PortalPage>
    );
  }

  // A refresh of the visit already on screen (e.g. after reconnecting) keeps
  // it visible; a different visit never shows here while loading.
  if (loading && !visit) {
    return <PortalListSkeleton label="Loading visit details" rows={3} />;
  }

  if (!visit) {
    return (
      <PortalPage title="Visit details" breadcrumbs={[BACK_CRUMB, { label: "Visit" }]}>
        {!online ? (
          <PortalNotice tone="offline" title="You are offline">
            Connect to the internet to see this visit.
          </PortalNotice>
        ) : (
          <PortalNotice
            tone="danger"
            action={
              visitId ? (
                <button
                  type="button"
                  onClick={() => loadVisitDetails(visitId)}
                  className="btn-secondary"
                >
                  <ArrowPathIcon className="h-5 w-5" aria-hidden />
                  Try again
                </button>
              ) : undefined
            }
          >
            {error || "We could not load this visit."}
          </PortalNotice>
        )}
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
        label: "Blood pressure",
        value: `${vitals.systolic}/${vitals.diastolic}`,
        unit: "mmHg",
      });
    }
    if (vitals.pulseBpm) {
      vitalItems.push({
        label: "Heart rate",
        value: `${vitals.pulseBpm}`,
        unit: "beats per minute",
      });
    }
    if (vitals.tempC) {
      vitalItems.push({
        label: "Temperature",
        value: `${vitals.tempC}`,
        unit: "°C",
      });
    }
    if (vitals.spo2) {
      vitalItems.push({
        label: "Oxygen level (SpO2)",
        value: `${vitals.spo2}`,
        unit: "%",
      });
    }
    if (vitals.heightCm) {
      vitalItems.push({
        label: "Height",
        value: `${vitals.heightCm}`,
        unit: "cm",
      });
    }
    if (vitals.weightKg) {
      vitalItems.push({
        label: "Weight",
        value: `${vitals.weightKg}`,
        unit: "kg",
      });
    }
    if (vitals.bmi) {
      vitalItems.push({
        label: "BMI",
        value: vitals.bmi.toFixed(1),
        unit: "kg/m²",
      });
    }
  }

  const consultation = visit.consultation;
  const diagnoses = consultation?.diagnoses ?? [];

  return (
    <PortalPage
      title={`Visit on ${shortDate}`}
      breadcrumbs={[BACK_CRUMB, { label: shortDate }]}
      description={
        <>
          Recorded by the outreach team at your visit on{" "}
          {formatPortalLongDate(visit.visitDate)}.
          {consultation?.providerName && (
            <> Seen by {consultation.providerName}.</>
          )}
        </>
      }
    >
      {!online && (
        <PortalNotice tone="offline" title="You are offline">
          You are seeing this visit as it was loaded when this phone was last
          online. It may be out of date.
        </PortalNotice>
      )}

      {visit.chiefComplaint && (
        <p className="text-body text-ink-secondary">
          <span className="text-ink-muted">Reason for visit: </span>
          {visit.chiefComplaint}
        </p>
      )}

      {vitalItems.length > 0 && (
        <Section id="visit-vitals" title="Measurements">
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
            Talk to your clinician if you have questions about these numbers.
          </p>
        </Section>
      )}

      {consultation && (
        <Section id="visit-consultation" title="What the clinician recorded">
          <div className="space-y-4">
            {diagnoses.length > 0 && (
              <div>
                <h3 className="text-label text-ink-secondary">Diagnosis</h3>
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
                label="What you told the clinician"
                text={consultation.subjective}
              />
            )}
            {consultation.objective && (
              <NoteBlock
                label="What the clinician found"
                text={consultation.objective}
              />
            )}
            {consultation.assessment && (
              <NoteBlock
                label="Clinician's assessment"
                text={consultation.assessment}
              />
            )}
            {consultation.plan && (
              <NoteBlock label="Treatment plan" text={consultation.plan} />
            )}
          </div>
        </Section>
      )}

      {visit.prescriptions && visit.prescriptions.length > 0 && (
        <Section id="visit-medicines" title="Medicines given">
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
                    Given on {formatPortalDate(rx.dispensedAt)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {!vitals && !consultation && (visit.prescriptions?.length ?? 0) === 0 && (
        <PortalNotice tone="info">
          No measurements, notes or medicines were recorded for this visit.
        </PortalNotice>
      )}

      <div className="flex flex-wrap gap-2">
        <BackLink />
        <Link to="/patient/messages" className="btn-secondary">
          <ChatBubbleLeftRightIcon className="h-5 w-5" aria-hidden />
          Ask the clinic about this visit
        </Link>
      </div>
    </PortalPage>
  );
}
