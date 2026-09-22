import { useEffect, useState } from "react";
import { liveQuery } from "dexie";
import { db, QueueItem } from "@/db";

type Stage = "registration" | "vitals" | "consult" | "pharmacy";
const STAGES: Stage[] = ["registration", "vitals", "consult", "pharmacy"];
const STAGE_LABEL: Record<Stage, string> = {
  registration: "Registration",
  vitals: "Vitals",
  consult: "Consultation",
  pharmacy: "Pharmacy",
};

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
    <div className="min-h-screen bg-zinc-950 p-6 text-white sm:p-10">
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        Now serving
      </h1>
      <ul className="mt-8 divide-y divide-zinc-800 border-y border-zinc-800">
        {lanes.map((l) => (
          <li
            key={l.stage}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-6 py-6"
            aria-live="polite"
          >
            <div className="min-w-0">
              <div className="text-2xl text-zinc-400 sm:text-3xl">
                {STAGE_LABEL[l.stage]}
              </div>
              <div className="mt-2 text-lg text-zinc-500 sm:text-xl">
                Next:{" "}
                <span className="tabular-nums text-zinc-300">
                  {l.next.length ? l.next.join("   ") : "—"}
                </span>
              </div>
            </div>
            <div className="text-right text-6xl font-bold tabular-nums sm:text-8xl">
              {l.current ?? <span className="text-zinc-700">—</span>}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-8 text-2xl text-zinc-400">
        Please listen for your ticket number.
      </p>
    </div>
  );
}
