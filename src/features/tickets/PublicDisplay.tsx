import { useEffect, useState } from "react";
import { liveQuery } from "dexie";
import { db, QueueItem } from "@/db";

type Stage = "registration" | "vitals" | "consult" | "pharmacy";
const STAGES: Stage[] = ["registration", "vitals", "consult", "pharmacy"];

interface Lane {
  stage: Stage;
  current?: string;
  next: string[];
}

function labelForItem(q: QueueItem): string {
  return q.ticketNumber ?? `#${q.position.toString().padStart(3, "0")}`;
}

export default function PublicDisplay() {
  const [lanes, setLanes] = useState<Lane[]>([]);

  useEffect(() => {
    const sub = liveQuery(async () => {
      const result: Lane[] = [];
      for (const stage of STAGES) {
        const items = await db.queue
          .where("stage")
          .equals(stage)
          .and((q) => q.status !== "done")
          .toArray();

        const inProgress = items
          .filter((q) => q.status === "in_progress")
          .sort(
            (a, b) =>
              new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
          )[0];

        const waiting = items
          .filter((q) => q.status === "waiting")
          .sort((a, b) => a.position - b.position)
          .slice(0, 3);

        result.push({
          stage,
          current: inProgress ? labelForItem(inProgress) : undefined,
          next: waiting.map(labelForItem),
        });
      }
      return result;
    }).subscribe(setLanes);

    return () => sub.unsubscribe();
  }, []);

  return (
    <div className="min-h-screen bg-black text-white p-8 font-semibold">
      <h1 className="text-4xl mb-6">Now Serving</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {lanes.map((l) => (
          <div
            key={l.stage}
            className="rounded-2xl p-6 bg-zinc-900 border border-zinc-700"
          >
            <div className="text-zinc-400 text-xl capitalize">{l.stage}</div>
            <div className="text-5xl md:text-6xl my-2 tabular-nums">
              {l.current ?? "—"}
            </div>
            <div className="text-zinc-400 text-sm">Up next</div>
            <div className="flex gap-3 text-2xl mt-1 tabular-nums">
              {l.next.length ? (
                l.next.map((n) => <span key={n}>{n}</span>)
              ) : (
                <span>—</span>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-6 text-zinc-500 text-sm">
        Auto-updates offline via IndexedDB
      </div>
    </div>
  );
}
