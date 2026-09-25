import { useLiveQuery } from "dexie-react-hooks";
import { db, type Patient } from "@/db";
import { formatNigerianDateTime } from "@/utils/dateFormat";
import { formatPatientId } from "@/utils/patient";

/**
 * Read-only details of how a merged-away record was merged: its old MBHR
 * ID, the kept record's ID, when, by whom and why (clinical change log
 * row 21). Shows only what this device holds.
 */
export function MergeProvenance({ patient }: { patient: Patient }) {
  const merge = useLiveQuery(async () => {
    const rows = await db.patientMerges.where("loserId").equals(patient.id).toArray();
    const latest = rows
      .filter((m) => m.kind !== "unmerge" && m.status !== "rejected" && m.winnerId === patient.mergeInto)
      .sort((a, b) => mergeTime(b) - mergeTime(a))[0];
    if (!latest) return null;
    const by = latest.mergedBy ? await db.users.get(latest.mergedBy) : undefined;
    return { ...latest, byName: by?.fullName };
  }, [patient.id, patient.mergeInto]);

  const when = patient.mergedAt ?? (merge ? new Date(mergeTime(merge)).toISOString() : null);
  const rows: Array<[string, string]> = [
    ["This record's MBHR ID", formatPatientId(patient.id)],
    ["Kept record's MBHR ID", patient.mergeInto ? formatPatientId(patient.mergeInto) : "Not recorded"],
    ["Merged on", when ? formatNigerianDateTime(when) : "Not recorded on this device"],
    ["Merged by", merge?.byName ?? (merge ? "A staff member not on this device" : "Not recorded on this device")],
    ["Reason", merge?.reason?.trim() || "Not recorded"],
  ];
  if (merge?.status === "pending") rows.push(["Status", "Waiting for the server to confirm"]);

  return (
    <dl className="mx-auto mt-4 grid max-w-md grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-left text-body">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-ink-muted">{label}</dt>
          <dd className="text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function mergeTime(m: { createdAt?: string; requestedAt?: string; createdDay: number }): number {
  return Date.parse(m.createdAt ?? m.requestedAt ?? "") || m.createdDay * 86_400_000;
}
