import React, { useEffect, useState } from "react";
import { useT } from "@/hooks/useT";
import { db } from "@/db";
import { getFlagTone, getFlagLabel } from "@/utils/vitals";
import { formatNigerianDate, formatTime } from "@/utils/dateFormat";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  ClockIcon,
  HeartIcon,
  DocumentTextIcon,
  BeakerIcon,
  UserIcon,
  CalendarIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { resolveBmi } from "@/utils/vitals";

interface TimelineEvent {
  id: string;
  type: "visit" | "vitals" | "consultation" | "dispense";
  timestamp: Date;
  title: string;
  details: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: any;
  icon: React.ElementType;
  color: string;
}

type TimelineFilter = "all" | "vitals" | "consultations" | "medications";

interface MedicalTimelineProps {
  patientId: string;
  className?: string;
}

export function MedicalTimeline({
  patientId,
  className = "",
}: MedicalTimelineProps) {
  const { t } = useT();
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<TimelineFilter>("all");

  useEffect(() => {
    loadTimelineEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  const loadTimelineEvents = async () => {
    try {
      const [visits, vitals, consultations, dispenses] = await Promise.all([
        db.visits.where("patientId").equals(patientId).toArray(),
        db.vitals.where("patientId").equals(patientId).toArray(),
        db.consultations.where("patientId").equals(patientId).toArray(),
        db.dispenses.where("patientId").equals(patientId).toArray(),
      ]);

      const timelineEvents: TimelineEvent[] = [];

      // Add visit events
      visits.forEach((visit) => {
        timelineEvents.push({
          id: `visit-${visit.id}`,
          type: "visit",
          timestamp: visit.startedAt,
          title: t("timeline.visitStarted"),
          details: `${visit.siteName} • ${t(`queue.status.${visit.status}`)}`,
          icon: UserIcon,
          color: "bg-surface-sunken text-ink-secondary ring-line",
        });
      });

      // Add vitals events
      vitals.forEach((vital) => {
        const vitalDetails = [];
        if (vital.systolic && vital.diastolic) {
          vitalDetails.push(
            `${t("vitals.bloodPressure")}: ${vital.systolic}/${vital.diastolic}`,
          );
        }
        if (vital.pulseBpm) {
          vitalDetails.push(`${t("vitals.pulse")}: ${vital.pulseBpm} bpm`);
        }
        if (vital.tempC) {
          vitalDetails.push(`${t("vitals.temperature")}: ${vital.tempC}°C`);
        }
        const bmi = resolveBmi(vital);
        if (bmi) {
          vitalDetails.push(`${t("vitals.bmi")}: ${bmi}`);
        }

        timelineEvents.push({
          id: `vitals-${vital.id}`,
          type: "vitals",
          timestamp: vital.takenAt,
          title: t("timeline.vitalsRecorded"),
          details: vitalDetails.join(" • "),
          metadata: { flags: vital.flags },
          icon: HeartIcon,
          color: "bg-stage-vitals-soft text-stage-vitals ring-stage-vitals-line",
        });
      });

      // Add consultation events
      consultations.forEach((consultation) => {
        timelineEvents.push({
          id: `consultation-${consultation.id}`,
          type: "consultation",
          timestamp: consultation.createdAt,
          title: t("timeline.consultationCompleted"),
          details: `${consultation.providerName} • ${consultation.provisionalDx.join(", ")}`,
          metadata: {
            assessment: consultation.soapAssessment,
            plan: consultation.soapPlan,
          },
          icon: DocumentTextIcon,
          color: "bg-stage-consult-soft text-stage-consult ring-stage-consult-line",
        });
      });

      // Add dispense events
      dispenses.forEach((dispense) => {
        timelineEvents.push({
          id: `dispense-${dispense.id}`,
          type: "dispense",
          timestamp: dispense.dispensedAt,
          title: t("timeline.medicationDispensed"),
          details: `${dispense.itemName} ${dispense.dosage} × ${dispense.qty}`,
          metadata: {
            directions: dispense.directions,
            dispensedBy: dispense.dispensedBy,
          },
          icon: BeakerIcon,
          color: "bg-stage-pharmacy-soft text-stage-pharmacy ring-stage-pharmacy-line",
        });
      });

      // Sort by timestamp (newest first)
      timelineEvents.sort(
        (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
      );
      setEvents(timelineEvents);
    } catch (error) {
      console.error(
        "Error loading timeline events:",
        error instanceof Error ? error.name : error,
      );
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  const filteredEvents = events.filter((event) => {
    if (filter === "all") return true;
    if (filter === "vitals") return event.type === "vitals";
    if (filter === "consultations") return event.type === "consultation";
    if (filter === "medications") return event.type === "dispense";
    return true;
  });

  if (loading) {
    return (
      <div className={`space-y-4 ${className}`} aria-busy="true">
        <span role="status" className="sr-only">
          Loading medical history
        </span>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex space-x-4 p-4" aria-hidden>
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header with Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-h3 text-ink">
          {t("timeline.medicalHistory")}
        </h3>

        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Filter medical history"
        >
          {(
            [
              { key: "all", label: t("common.all") },
              { key: "vitals", label: t("nav.vitals") },
              { key: "consultations", label: t("timeline.consultations") },
              { key: "medications", label: t("timeline.medications") },
            ] as Array<{ key: TimelineFilter; label: string }>
          ).map((filterOption) => (
            <button
              key={filterOption.key}
              type="button"
              onClick={() => setFilter(filterOption.key)}
              aria-pressed={filter === filterOption.key}
              className={`min-h-touch-target rounded-md border px-3 py-1.5 text-label transition-colors ${
                filter === filterOption.key
                  ? "border-primary bg-primary-soft text-primary-fg"
                  : "border-line bg-surface text-ink-secondary hover:bg-surface-hover"
              }`}
            >
              {filterOption.label}
            </button>
          ))}
        </div>
      </div>

      {loadError && (
        <div className="banner banner-danger" role="alert">
          <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
          <span>
            The medical history could not be read from this device. Reload the
            page to try again.
          </span>
        </div>
      )}

      {/* Timeline */}
      <div className="relative">
        {filteredEvents.length === 0 ? (
          loadError ? null : (
            <EmptyState icon={ClockIcon} title={t("timeline.noEvents")} />
          )
        ) : (
          <div className="space-y-6">
            {/* Timeline line */}
            <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-line" aria-hidden></div>

            {filteredEvents.map((event, _index) => (
              <div
                key={event.id}
                className="relative flex items-start space-x-4"
              >
                {/* Timeline dot */}
                <div
                  className={`relative z-10 flex items-center justify-center w-12 h-12 rounded-full ring-2 ${event.color}`}
                >
                  <event.icon className="h-5 w-5" aria-hidden />
                </div>

                {/* Event content */}
                <div className="flex-1 min-w-0 pb-6">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <h4 className="text-h3 text-ink">
                      {event.title}
                    </h4>
                    <div className="flex items-center space-x-2 text-caption tabular-nums text-ink-muted">
                      <CalendarIcon className="h-4 w-4" aria-hidden />
                      <span>{formatNigerianDate(event.timestamp)}</span>
                      <ClockIcon className="h-4 w-4" aria-hidden />
                      <span>{formatTime(event.timestamp)}</span>
                    </div>
                  </div>

                  <p className="text-body text-ink-secondary mb-3">{event.details}</p>

                  {/* Event-specific metadata */}
                  {event.metadata?.flags && event.metadata.flags.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {event.metadata.flags.map((flag: string) => (
                        <StatusBadge key={flag} tone={getFlagTone(flag)}>
                          {getFlagLabel(flag)}
                        </StatusBadge>
                      ))}
                    </div>
                  )}

                  {event.metadata?.assessment && (
                    <details className="mt-2">
                      <summary className="flex min-h-touch-target cursor-pointer items-center text-label text-ink-secondary hover:text-ink">
                        {t("timeline.viewDetails")}
                      </summary>
                      <div className="mt-2 rounded-md border border-line bg-surface-sunken p-3 text-body text-ink">
                        <p>
                          <strong>{t("consultation.assessment")}:</strong>{" "}
                          {event.metadata.assessment}
                        </p>
                        {event.metadata.plan && (
                          <p className="mt-2">
                            <strong>{t("consultation.plan")}:</strong>{" "}
                            {event.metadata.plan}
                          </p>
                        )}
                      </div>
                    </details>
                  )}

                  {event.metadata?.directions && (
                    <div className="mt-2 rounded-md border border-line bg-surface-sunken p-3 text-body text-ink">
                      <p>
                        <strong>{t("pharmacy.directions")}:</strong>{" "}
                        {event.metadata.directions}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
