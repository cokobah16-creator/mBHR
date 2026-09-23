import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/auth";
import { db } from "@/db";
import {
  gamificationDb,
  type GameTask,
  type GameAttempt,
  type Wallet,
} from "@/db/gamification";
import {
  ArrowRightIcon,
  BoltIcon,
  ClockIcon,
  ExclamationCircleIcon,
  LockClosedIcon,
  TrophyIcon,
} from "@heroicons/react/24/outline";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusBadge, type Tone } from "@/components/ui/StatusBadge";
import { Tabs } from "@/components/ui/Tabs";
import { panelId, tabId } from "@/components/ui/tabIds";
import { TrainingModeFrame } from "@/components/training/TrainingModeFrame";
import { TrainingStat } from "@/components/training/TrainingWidgets";
import {
  QUEST_SESSION_TYPES,
  activityAccessNote,
  canOpenActivity,
  completedToday,
  questActivity,
  questProgressTracked,
  questStatus,
  toDate,
  type QuestStatus,
} from "@/components/training/trainingActivities";

interface QuestBoardProps {
  onStartQuest?: (task: GameTask) => void;
}

type QuestTab = "daily" | "weekly" | "event";
const TAB_IDS: QuestTab[] = ["daily", "weekly", "event"];
const TABS_PREFIX = "quest-board";

function isQuestTab(id: string): id is QuestTab {
  return (TAB_IDS as string[]).includes(id);
}

const STATUS_DISPLAY: Record<QuestStatus, { text: string; tone: Tone }> = {
  in_progress: { text: "In progress", tone: "info" },
  daily_limit: { text: "Done for today", tone: "success" },
  cooldown: { text: "Cooling down", tone: "warning" },
  available: { text: "Available", tone: "neutral" },
};

const CATEGORY_LABELS: Record<GameTask["category"], string> = {
  "clinic-flow": "Clinic flow",
  inventory: "Inventory",
  knowledge: "Knowledge",
  community: "Community",
};

type LoadState = "loading" | "ready" | "failed";

export function QuestBoard({ onStartQuest }: QuestBoardProps) {
  const currentUser = useAuthStore((s) => s.currentUser);
  const role = currentUser?.role;
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<GameTask[]>([]);
  const [attempts, setAttempts] = useState<
    Pick<GameAttempt, "taskCode" | "status" | "finishedAt">[]
  >([]);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [activeTab, setActiveTab] = useState<QuestTab>("daily");
  const [state, setState] = useState<LoadState>("loading");

  const loadQuestData = useCallback(async () => {
    if (!currentUser) return;

    try {
      setState("loading");

      // Load available tasks
      const allTasks = await gamificationDb.game_tasks.toArray();
      const userRole = currentUser.role;
      const nowIso = new Date().toISOString();

      // Filter tasks by role and active status
      const availableTasks = allTasks.filter((task) => {
        if (task.requiredRole && !task.requiredRole.includes(userRole)) {
          return false;
        }
        if (task.activeFrom && nowIso < task.activeFrom) return false;
        if (task.activeTo && nowIso > task.activeTo) return false;
        return true;
      });

      // Load user's quest attempts for today
      const today = nowIso.split("T")[0];
      const todayAttempts = await gamificationDb.game_attempts
        .where("actorId")
        .equals(currentUser.id)
        .and((attempt) => attempt.startedAt.startsWith(today))
        .toArray();

      // Knowledge Blitz and Vitals Precision save finished rounds as game
      // sessions, not quest attempts. Count today's finished ones so their
      // progress is real.
      const sessionTypes = new Set(Object.values(QUEST_SESSION_TYPES));
      const codeForType = new Map(
        Object.entries(QUEST_SESSION_TYPES).map(([code, type]) => [type, code]),
      );
      const sessions = await db.gameSessions
        .where("volunteerId")
        .equals(currentUser.id)
        .and((s) => sessionTypes.has(s.type) && !!s.finishedAt)
        .toArray();
      const sessionAttempts = sessions
        .map((s) => ({ s, finished: toDate(s.finishedAt) }))
        .filter(({ finished }) => !!finished && finished.toISOString().startsWith(today))
        .map(({ s, finished }) => ({
          taskCode: codeForType.get(s.type) ?? s.type,
          status: "completed" as const,
          finishedAt: finished!.toISOString(),
        }));

      // Load wallet
      const userWallet = await gamificationDb.wallets.get(currentUser.id);

      setTasks(availableTasks);
      setAttempts([...todayAttempts, ...sessionAttempts]);
      setWallet(userWallet || null);
      setState("ready");
    } catch (error) {
      console.error(
        "Error loading quest data:",
        error instanceof Error ? error.name : error,
      );
      setState("failed");
    }
  }, [currentUser]);

  useEffect(() => {
    void loadQuestData();
  }, [loadQuestData]);

  const handleStartQuest = (task: GameTask) => {
    if (onStartQuest) {
      onStartQuest(task);
      return;
    }
    // Only open pages this role may use (the route guards them too).
    const activity = questActivity(task.code);
    if (activity && canOpenActivity(activity, role)) navigate(activity.href);
  };

  const now = new Date();

  const questCards = (
    <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {tasks.map((task) => {
        const status = questStatus(task, attempts, now);
        const display = STATUS_DISPLAY[status];
        const tracked = questProgressTracked(task.code);
        const done = completedToday(task, attempts);
        const activity = questActivity(task.code);
        const hasRoute = !!onStartQuest || !!activity;
        const accessNote =
          !onStartQuest && activity && !canOpenActivity(activity, role)
            ? activityAccessNote(activity, role)
            : "";
        const canStart =
          hasRoute &&
          !accessNote &&
          (status === "available" || status === "in_progress");
        const progressId = `quest-progress-${task.id}`;

        return (
          <li key={task.id} className="card flex flex-col">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-h3 text-ink">{task.title}</h3>
                <p className="text-caption text-ink-muted">
                  {CATEGORY_LABELS[task.category] ?? task.category}
                </p>
              </div>
              <StatusBadge tone={display.tone} icon>
                {display.text}
              </StatusBadge>
            </div>

            <p className="mt-3 text-body text-ink-secondary">{task.description}</p>
            {activity?.liveData && (
              <p className="mt-2 flex flex-wrap items-center gap-2 text-body text-warning-fg">
                <StatusBadge tone="warning">Live data</StatusBadge>
                {activity.liveData}
              </p>
            )}

            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-caption text-ink-muted">
              <li className="flex items-center gap-1">
                <ClockIcon className="h-4 w-4" aria-hidden />
                About {task.estimatedMinutes} min
              </li>
              <li className="flex items-center gap-1">
                <BoltIcon className="h-4 w-4" aria-hidden />
                {task.baseTokens} base tokens
              </li>
              {task.cooldownMinutes ? (
                <li>{task.cooldownMinutes} min cool-down</li>
              ) : null}
            </ul>

            {task.maxPerDay ? (
              tracked ? (
                <div className="mt-3">
                  <div className="mb-1 flex justify-between text-caption text-ink-muted">
                    <span id={progressId}>Today</span>
                    <span>
                      {done}/{task.maxPerDay}
                    </span>
                  </div>
                  <div
                    className="h-2 w-full rounded bg-surface-sunken"
                    role="progressbar"
                    aria-labelledby={progressId}
                    aria-valuemin={0}
                    aria-valuemax={task.maxPerDay}
                    aria-valuenow={Math.min(done, task.maxPerDay)}
                  >
                    <div
                      className="h-2 rounded bg-primary"
                      style={{
                        width: `${Math.min(100, (done / task.maxPerDay) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-caption text-ink-muted">
                  Up to {task.maxPerDay} a day. Progress for this quest is not
                  recorded on this board yet.
                </p>
              )
            ) : null}

            <div className="mt-auto pt-4">
              {accessNote ? (
                <p className="flex items-center gap-1.5 rounded-md border border-line bg-surface-sunken px-3 py-2 text-caption text-ink-muted">
                  <LockClosedIcon className="h-4 w-4 shrink-0" aria-hidden />
                  Not available to you: {accessNote}
                </p>
              ) : hasRoute ? (
                <button
                  type="button"
                  onClick={() => handleStartQuest(task)}
                  disabled={!canStart}
                  className={
                    status === "in_progress" ? "btn-primary w-full" : "btn-secondary w-full"
                  }
                >
                  {status === "in_progress" ? "Continue quest" : "Start quest"}
                  <ArrowRightIcon className="h-4 w-4" aria-hidden />
                </button>
              ) : (
                <p className="rounded-md border border-line bg-surface-sunken px-3 py-2 text-caption text-ink-muted">
                  Not available in this version of the app.
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );

  return (
    <TrainingModeFrame
      title="Quest board"
      description="Quests for today, with daily limits and cool-downs. Quest tokens are kept on this device."
      actions={
        <Link to="/games" className="btn-secondary">
          All training games
        </Link>
      }
    >
      <div className="space-y-5">
        {state === "failed" && (
          <div className="banner banner-danger" role="alert">
            <ExclamationCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
            <div>
              <p>Quests could not be read from this device.</p>
              <button
                type="button"
                onClick={() => void loadQuestData()}
                className="btn-secondary mt-2"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {state === "ready" && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <TrainingStat
              label="Quest tokens"
              value={wallet?.tokens ?? 0}
              hint="From completed Queue Maestro quests"
            />
            <TrainingStat label="Quest level" value={wallet?.level ?? 1} />
            <TrainingStat label="Day streak" value={wallet?.streakDays ?? 0} />
          </div>
        )}

        <Tabs
          tabs={[
            { id: "daily", label: "Daily quests" },
            { id: "weekly", label: "Weekly challenges" },
            { id: "event", label: "Special events" },
          ]}
          active={activeTab}
          onChange={(id) => {
            if (isQuestTab(id)) setActiveTab(id);
          }}
          idPrefix={TABS_PREFIX}
          label="Quest types"
        />

        <div
          role="tabpanel"
          id={panelId(TABS_PREFIX, activeTab)}
          aria-labelledby={tabId(TABS_PREFIX, activeTab)}
        >
          {state === "loading" && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3" aria-hidden>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="card space-y-3">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ))}
            </div>
          )}
          <p className="sr-only" aria-live="polite">
            {state === "loading" ? "Loading quests" : ""}
          </p>

          {state === "ready" && activeTab === "daily" && tasks.length > 0 && questCards}

          {state === "ready" && activeTab === "daily" && tasks.length === 0 && (
            <div className="panel">
              <EmptyState
                icon={TrophyIcon}
                title="No quests available"
                description="No quests are set up for your role on this device right now."
                action={
                  <Link to="/games" className="btn-secondary">
                    See training games
                  </Link>
                }
              />
            </div>
          )}

          {state === "ready" && activeTab !== "daily" && (
            <div className="panel">
              <EmptyState
                icon={TrophyIcon}
                title={
                  activeTab === "weekly"
                    ? "No weekly challenges are set up"
                    : "No special events are set up"
                }
                description="Only daily quests exist in this version of the app."
              />
            </div>
          )}
        </div>
      </div>
    </TrainingModeFrame>
  );
}
