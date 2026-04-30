import React, { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, QueueItem } from "@/db";
import { queueManagement } from "@/services/queueManagement";
import { useAuthStore } from "@/stores/auth";
import { recordStageEvent } from "@/services/stageEvents";
import { patientStatusFromQueue } from "@/services/patientStatus";
import {
  QueueListIcon,
  PlayIcon,
  CheckIcon,
  ClockIcon,
} from "@heroicons/react/24/outline";

const STAGES: Array<"registration" | "vitals" | "consult" | "pharmacy"> = [
  "registration",
  "vitals",
  "consult",
  "pharmacy",
];

const AVG_SERVICE_SEC = 240;

const asArray = <T,>(v: T[] | undefined | null): T[] =>
  Array.isArray(v) ? v : [];

export default function QueueBoard() {
  const { currentUser } = useAuthStore();
  const [selectedStage, setSelectedStage] =
    useState<(typeof STAGES)[number]>("vitals");

  const allQueue = asArray(
    useLiveQuery(() => db.queue.toArray(), [], [] as QueueItem[]),
  );
  const stageQueue = asArray(
    useLiveQuery(
      () => db.queue.where("stage").equals(selectedStage).toArray(),
      [selectedStage],
      [] as QueueItem[],
    ),
  );

  const waiting = stageQueue
    .filter((q) => q.status === "waiting")
    .sort((a, b) => a.position - b.position);
  const inProgress = stageQueue.find((q) => q.status === "in_progress");

  const [patientNames, setPatientNames] = useState<
    Record<string, { givenName: string; familyName: string }>
  >({});

  useEffect(() => {
    const ids = Array.from(new Set(stageQueue.map((q) => q.patientId)));
    if (ids.length === 0) {
      setPatientNames({});
      return;
    }
    let cancelled = false;
    db.patients
      .where("id")
      .anyOf(ids)
      .toArray()
      .then((patients) => {
        if (cancelled) return;
        const map: Record<string, { givenName: string; familyName: string }> =
          {};
        for (const p of patients) {
          map[p.id] = { givenName: p.givenName, familyName: p.familyName };
        }
        setPatientNames(map);
      })
      .catch((err) => console.error("Failed to load patient names:", err));
    return () => {
      cancelled = true;
    };
  }, [stageQueue]);

  const etaTail = waiting.length * Math.round(AVG_SERVICE_SEC / 60);

  const handleCallNext = async () => {
    const next = waiting[0];
    if (!next) return;
    await queueManagement.startService(next.id);
    await recordStageEvent({
      stage: selectedStage,
      kind: "start",
      patientId: next.patientId,
      actorId: currentUser?.id,
    });
  };

  const handleCompleteCurrent = async () => {
    if (!inProgress) return;
    await queueManagement.completeService(inProgress.id);
    await recordStageEvent({
      stage: selectedStage,
      kind: "finish",
      patientId: inProgress.patientId,
      actorId: currentUser?.id,
    });
  };

  const getStageColor = (stage: string) => {
    switch (stage) {
      case "registration":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "vitals":
        return "bg-green-100 text-green-800 border-green-200";
      case "consult":
        return "bg-purple-100 text-purple-800 border-purple-200";
      case "pharmacy":
        return "bg-orange-100 text-orange-800 border-orange-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const getPriorityColor = (priority: string | undefined) => {
    return priority === "urgent" ? "text-red-600" : "text-gray-600";
  };

  const labelForItem = (q: QueueItem) =>
    q.ticketNumber ?? `#${q.position.toString().padStart(3, "0")}`;
  const patientNameFor = (q: QueueItem) => {
    const p = patientNames[q.patientId];
    return p ? `${p.givenName} ${p.familyName}` : "Patient";
  };

  return (
    <div className="p-4 space-y-6">
      <div className="flex items-center space-x-3">
        <QueueListIcon className="h-8 w-8 text-primary" />
        <h2 className="text-2xl font-bold text-gray-900">Queue Management</h2>
      </div>

      {/* Stage Selector */}
      <div className="flex space-x-2 overflow-x-auto">
        {STAGES.map((stage) => {
          const stageCount = allQueue.filter(
            (q) => q.stage === stage && q.status !== "done",
          ).length;
          return (
            <button
              key={stage}
              onClick={() => setSelectedStage(stage)}
              className={`px-4 py-2 rounded-lg border font-medium capitalize whitespace-nowrap ${
                selectedStage === stage
                  ? getStageColor(stage)
                  : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {stage} ({stageCount})
            </button>
          );
        })}
      </div>

      {/* Queue Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card bg-blue-50 border-blue-200">
          <div className="text-sm text-blue-600">Waiting</div>
          <div className="text-2xl font-bold text-blue-800">
            {waiting.length}
          </div>
        </div>
        <div className="card bg-yellow-50 border-yellow-200">
          <div className="text-sm text-yellow-600">In Progress</div>
          <div className="text-2xl font-bold text-yellow-800">
            {inProgress ? "1" : "0"}
          </div>
        </div>
        <div className="card bg-green-50 border-green-200">
          <div className="text-sm text-green-600">Avg Service Time</div>
          <div className="text-2xl font-bold text-green-800">
            {Math.round(AVG_SERVICE_SEC / 60)}m
          </div>
        </div>
        <div className="card bg-purple-50 border-purple-200">
          <div className="text-sm text-purple-600">ETA for Last</div>
          <div className="text-2xl font-bold text-purple-800">{etaTail}m</div>
        </div>
      </div>

      {/* Queue Controls */}
      <div className="flex space-x-4">
        <button
          className="btn-primary flex items-center space-x-2"
          onClick={handleCallNext}
          disabled={waiting.length === 0 || !!inProgress}
        >
          <PlayIcon className="h-5 w-5" />
          <span>Call Next</span>
        </button>
        <button
          className="btn-secondary flex items-center space-x-2"
          onClick={handleCompleteCurrent}
          disabled={!inProgress}
        >
          <CheckIcon className="h-5 w-5" />
          <span>Complete Current</span>
        </button>
      </div>

      {/* Current Patient */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Now Serving
        </h3>
        {inProgress ? (
          <div className="flex items-center space-x-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="w-12 h-12 bg-yellow-600 rounded-full flex items-center justify-center text-white font-bold text-lg">
              {inProgress.position}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xl font-bold text-gray-900">
                  {labelForItem(inProgress)}
                </span>
                {(() => {
                  const s = patientStatusFromQueue(inProgress);
                  return (
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${s.classes}`}
                    >
                      {s.label}
                    </span>
                  );
                })()}
              </div>
              <div className="text-sm text-gray-600">
                {patientNameFor(inProgress)} •
                <span className={getPriorityColor(inProgress.priority)}>
                  {" "}
                  {inProgress.priority ?? "normal"} priority
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <ClockIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No patient currently being served</p>
          </div>
        )}
      </div>

      {/* Waiting Queue */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Waiting Queue ({waiting.length})
        </h3>

        {waiting.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No patients waiting in {selectedStage}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {waiting.slice(0, 10).map((item, index) => (
              <div
                key={item.id}
                className={`flex items-center justify-between p-3 border rounded-lg ${
                  index === 0
                    ? "border-green-200 bg-green-50"
                    : "border-gray-200"
                }`}
              >
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center text-white font-bold text-sm">
                    {index + 1}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900">
                        {labelForItem(item)}
                      </span>
                      {(() => {
                        const s = patientStatusFromQueue(item);
                        return (
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${s.classes}`}
                          >
                            {s.label}
                          </span>
                        );
                      })()}
                    </div>
                    <div className="text-sm text-gray-600">
                      {patientNameFor(item)} •
                      <span className={getPriorityColor(item.priority)}>
                        {" "}
                        {item.priority ?? "normal"} priority
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-sm text-gray-500">
                  {index === 0 ? "Next" : `~${(index * AVG_SERVICE_SEC) / 60}m`}
                </div>
              </div>
            ))}

            {waiting.length > 10 && (
              <div className="text-center text-sm text-gray-500 py-2">
                ... and {waiting.length - 10} more patients
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
