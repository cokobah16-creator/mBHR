import { useLiveQuery } from "dexie-react-hooks";
import { db, type Vital } from "@/db";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  assessVitals,
  classifyBMI,
  classifyBloodPressure,
  classifyPulse,
  classifySpO2,
  classifyTemperature,
  type Classification,
} from "@/utils/vitals";
import { formatNigerianDate } from "@/utils/dateFormat";

interface Row {
  label: string;
  value: string;
  cls: Classification | null;
}

function vitalRows(v: Vital): Row[] {
  // BMI is recomputed from height/weight: records saved before the BMI
  // argument-order fix hold an incorrect stored value.
  const { bmi } = assessVitals(v);
  const rows: Row[] = [];
  if (v.systolic && v.diastolic)
    rows.push({
      label: "Blood pressure",
      value: `${v.systolic}/${v.diastolic} mmHg`,
      cls: classifyBloodPressure(v.systolic, v.diastolic),
    });
  if (v.pulseBpm)
    rows.push({ label: "Pulse", value: `${v.pulseBpm} bpm`, cls: classifyPulse(v.pulseBpm) });
  if (v.tempC)
    rows.push({ label: "Temperature", value: `${v.tempC} °C`, cls: classifyTemperature(v.tempC) });
  if (v.spo2)
    rows.push({ label: "SpO₂", value: `${v.spo2}%`, cls: classifySpO2(v.spo2) });
  if (v.weightKg) rows.push({ label: "Weight", value: `${v.weightKg} kg`, cls: null });
  if (v.heightCm) rows.push({ label: "Height", value: `${v.heightCm} cm`, cls: null });
  if (bmi) rows.push({ label: "BMI", value: String(bmi), cls: classifyBMI(bmi) });
  return rows;
}

interface ClinicalSummaryPanelProps {
  patientId: string;
  visitId?: string;
}

/**
 * Read-only clinical context for the consultation: latest vitals with
 * their category, previous diagnoses and recent medicines. Sits beside the
 * notes so the clinician never has to leave the form to check history.
 */
export function ClinicalSummaryPanel({ patientId, visitId }: ClinicalSummaryPanelProps) {
  const data = useLiveQuery(async () => {
    const [vitals, consultations, dispenses] = await Promise.all([
      db.vitals.where("patientId").equals(patientId).toArray(),
      db.consultations.where("patientId").equals(patientId).toArray(),
      db.dispenses.where("patientId").equals(patientId).toArray(),
    ]);
    const newestFirst = (a: Date, b: Date) =>
      new Date(b).getTime() - new Date(a).getTime();
    vitals.sort((a, b) => newestFirst(a.takenAt, b.takenAt));
    return {
      latestVital: vitals.find((v) => v.visitId === visitId) ?? vitals[0],
      thisVisit: vitals.some((v) => v.visitId === visitId),
      previous: consultations
        .filter((c) => c.visitId !== visitId)
        .sort((a, b) => newestFirst(a.createdAt, b.createdAt))
        .slice(0, 3),
      medicines: dispenses.sort((a, b) => newestFirst(a.dispensedAt, b.dispensedAt)).slice(0, 5),
    };
  }, [patientId, visitId]);

  if (!data) {
    return (
      <aside className="panel p-4 space-y-3" aria-busy="true">
        <div className="skeleton h-4 w-24" />
        <div className="skeleton h-20 w-full" />
      </aside>
    );
  }

  const { latestVital, thisVisit, previous, medicines } = data;

  return (
    <aside className="panel divide-y divide-line" aria-label="Clinical summary">
      <section className="p-4">
        <h2 className="section-label">
          {thisVisit ? "Vitals this visit" : "Most recent vitals"}
        </h2>
        {latestVital ? (
          <>
            {!thisVisit && (
              <p className="mt-1 text-caption text-warning-fg">
                No vitals recorded for this visit. Showing{" "}
                {formatNigerianDate(latestVital.takenAt)}.
              </p>
            )}
            <dl className="mt-2 space-y-1.5">
              {vitalRows(latestVital).map((r) => (
                <div key={r.label} className="flex items-center justify-between gap-2 text-body">
                  <dt className="text-ink-secondary">{r.label}</dt>
                  <dd className="flex items-center gap-2 text-right">
                    <span className="font-medium text-ink">{r.value}</span>
                    {r.cls && r.cls.tone !== "success" && (
                      <StatusBadge tone={r.cls.tone}>{r.cls.label}</StatusBadge>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        ) : (
          <p className="mt-2 text-body text-ink-muted">No vitals recorded.</p>
        )}
      </section>

      <section className="p-4">
        <h2 className="section-label">Previous consultations</h2>
        {previous.length === 0 ? (
          <p className="mt-2 text-body text-ink-muted">None recorded.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {previous.map((c) => (
              <li key={c.id} className="text-body">
                <span className="block text-caption text-ink-muted">
                  {formatNigerianDate(c.createdAt)} · {c.providerName}
                </span>
                <span className="text-ink">
                  {c.provisionalDx.length > 0
                    ? c.provisionalDx.join(", ")
                    : c.soapAssessment || "No diagnosis recorded"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="p-4">
        <h2 className="section-label">Recent medicines</h2>
        {medicines.length === 0 ? (
          <p className="mt-2 text-body text-ink-muted">None dispensed.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {medicines.map((d) => (
              <li key={d.id} className="text-body">
                <span className="text-ink">{d.itemName}</span>
                <span className="text-ink-muted">
                  {" "}
                  · {d.dosage} × {d.qty} · {formatNigerianDate(d.dispensedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
