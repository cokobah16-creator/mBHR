import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db";
import { readActiveQueue } from "@/features/tickets/queueReads";
import { FLOW_STAGE_LABELS, type FlowStage } from "@/services/patientFlow";
import { StatusBadge } from "@/components/ui/StatusBadge";

const STAGE_MARKER: Record<FlowStage, string> = {
  registration: "bg-stage-registration",
  vitals: "bg-stage-vitals",
  consult: "bg-stage-consult",
  pharmacy: "bg-stage-pharmacy",
};
const LONG_WAIT_MINUTES = 30;

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * Everyone currently in the outreach queue, longest-waiting first within
 * urgency. Colour only marks exceptions (urgent, long waits).
 */
export function LiveQueueTable({ limit = 10 }: { limit?: number }) {
  const now = useNow();
  const rows = useLiveQuery(async () => {
    const items = await readActiveQueue();
    const patients = await db.patients.bulkGet([...new Set(items.map((i) => i.patientId))]);
    const byId = new Map(patients.filter(Boolean).map((p) => [p!.id, p!]));
    return items.map((i) => ({ ...i, patient: byId.get(i.patientId) }));
  }, []);

  if (!rows) {
    return (
      <div className="panel-body space-y-2" aria-busy="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-5 w-full" />
        ))}
      </div>
    );
  }

  const waitOf = (r: (typeof rows)[number]) =>
    Math.max(0, Math.floor((now - new Date(r.queuedAt ?? r.updatedAt).getTime()) / 60000));

  const sorted = [...rows].sort((a, b) => {
    const ua = a.priority === "urgent" ? 0 : 1;
    const ub = b.priority === "urgent" ? 0 : 1;
    if (ua !== ub) return ua - ub;
    return waitOf(b) - waitOf(a);
  });

  if (sorted.length === 0) {
    return (
      <p className="panel-body text-body text-ink-muted">
        No one is in the queue right now.
      </p>
    );
  }

  const visible = sorted.slice(0, limit);

  return (
    <>
      <table className="data-table hidden md:table">
        <thead>
          <tr>
            <th scope="col">Ticket</th>
            <th scope="col">Patient</th>
            <th scope="col">Stage</th>
            <th scope="col">Waiting</th>
            <th scope="col">Priority</th>
            <th scope="col">With</th>
            <th scope="col" className="text-right">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => {
            const mins = waitOf(r);
            const stage = r.stage as FlowStage;
            return (
              <tr key={r.id}>
                <td className="font-mono tabular-nums">{r.ticketNumber ?? `#${r.position}`}</td>
                <td className="font-medium text-ink">
                  {r.patient ? `${r.patient.givenName} ${r.patient.familyName}` : "Unknown patient"}
                </td>
                <td>
                  <span className="flex items-center gap-2 text-ink-secondary">
                    <span className={`h-2 w-2 rounded-full ${STAGE_MARKER[stage] ?? "bg-line-strong"}`} aria-hidden />
                    {FLOW_STAGE_LABELS[stage] ?? r.stage}
                    {r.status === "in_progress" && <StatusBadge tone="info">In service</StatusBadge>}
                  </span>
                </td>
                <td className={`tabular-nums ${mins >= LONG_WAIT_MINUTES ? "font-semibold text-warning-fg" : "text-ink-secondary"}`}>
                  {mins} min
                </td>
                <td>
                  {r.priority === "urgent" ? (
                    <StatusBadge tone="danger">Urgent</StatusBadge>
                  ) : (
                    <span className="text-ink-muted">Normal</span>
                  )}
                </td>
                <td className="text-ink-secondary">{r.assignedName ?? "—"}</td>
                <td className="text-right">
                  <Link to={`/patients/${r.patientId}`} className="text-label text-primary hover:underline">
                    Open
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ul className="divide-y divide-line md:hidden">
        {visible.map((r) => {
          const mins = waitOf(r);
          const stage = r.stage as FlowStage;
          return (
            <li key={r.id}>
              <Link to={`/patients/${r.patientId}`} className="flex items-center gap-3 px-4 py-3">
                <span className="w-14 shrink-0 font-mono text-label tabular-nums">{r.ticketNumber ?? `#${r.position}`}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">
                    {r.patient ? `${r.patient.givenName} ${r.patient.familyName}` : "Unknown patient"}
                  </span>
                  <span className="block text-caption text-ink-muted">
                    {FLOW_STAGE_LABELS[stage] ?? r.stage} ·{" "}
                    <span className={mins >= LONG_WAIT_MINUTES ? "font-semibold text-warning-fg" : ""}>{mins} min</span>
                  </span>
                </span>
                {r.priority === "urgent" && <StatusBadge tone="danger">Urgent</StatusBadge>}
              </Link>
            </li>
          );
        })}
      </ul>
      {sorted.length > limit && (
        <div className="border-t border-line px-4 py-2.5">
          <Link to="/queue" className="text-label text-primary hover:underline">
            See all {sorted.length} in the queue
          </Link>
        </div>
      )}
    </>
  );
}
