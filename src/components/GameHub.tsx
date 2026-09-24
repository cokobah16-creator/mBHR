import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "@/stores/auth";
import { db, type GamificationWallet } from "@/db";
import {
  AcademicCapIcon,
  ArrowRightIcon,
  ClockIcon,
  CubeIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  GiftIcon,
  HeartIcon,
  LockClosedIcon,
  MegaphoneIcon,
  StarIcon,
  TrophyIcon,
} from "@heroicons/react/24/outline";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import { TrainingModeFrame } from "@/components/training/TrainingModeFrame";
import { TrainingStat } from "@/components/training/TrainingWidgets";
import {
  TOKEN_PAGE_ROLES,
  TRAINING_ACTIVITIES,
  activityAccessNote,
  canOpenActivity,
  type TrainingActivityId,
} from "@/components/training/trainingActivities";
import type { Role } from "@/auth/roles";
import { badgeLabel } from "@/components/training/trainingRules";

interface GameHubProps {
  className?: string;
}

const ACTIVITY_ICONS: Record<TrainingActivityId, typeof HeartIcon> = {
  "knowledge-blitz": AcademicCapIcon,
  "triage-sprint": ExclamationTriangleIcon,
  "vitals-precision": HeartIcon,
  "queue-maestro": MegaphoneIcon,
  restock: CubeIcon,
};

// `roles` mirrors each route's guard in App.tsx; undefined = any signed-in role.
const MORE_LINKS: {
  href: string;
  name: string;
  description: string;
  icon: typeof StarIcon;
  roles?: Role[];
}[] = [
  {
    href: "/quests",
    name: "Quest board",
    description: "Daily quests, limits and cool-downs.",
    icon: StarIcon,
  },
  {
    href: "/inv/prizes",
    name: "Prize shop",
    description: "Spend Restock game tokens.",
    icon: GiftIcon,
    roles: TOKEN_PAGE_ROLES,
  },
  {
    href: "/inv/leaderboard",
    name: "Restock leaderboard",
    description: "Prize-shop tokens per staff member.",
    icon: TrophyIcon,
    roles: TOKEN_PAGE_ROLES,
  },
];

type LoadState = "loading" | "ready" | "failed";

const LIVE_ACTIVITY_NAMES = TRAINING_ACTIVITIES.filter((a) => a.liveData).map(
  (a) => a.name,
);

export function GameHub({ className = "" }: GameHubProps) {
  const currentUser = useAuthStore((s) => s.currentUser);
  const userId = currentUser?.id;
  const role = currentUser?.role;
  const [wallet, setWallet] = useState<GamificationWallet | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [state, setState] = useState<LoadState>("loading");

  const loadGameData = useCallback(async () => {
    if (!userId) {
      setState("ready");
      return;
    }
    setState("loading");
    try {
      const [walletData, sessionsData] = await Promise.all([
        db.gamificationWallets.get(userId),
        db.gameSessions
          .where("volunteerId")
          .equals(userId)
          .and((session) => !session.committed && !!session.finishedAt)
          .toArray(),
      ]);
      setWallet(walletData ?? null);
      setPendingCount(sessionsData.length);
      setState("ready");
    } catch (error) {
      console.error(
        "Error loading game data:",
        error instanceof Error ? error.name : error,
      );
      setState("failed");
    }
  }, [userId]);

  useEffect(() => {
    void loadGameData();
  }, [loadGameData]);

  const badges = wallet?.badges ?? [];

  return (
    <div className={className}>
      <TrainingModeFrame
        title="Training"
        description="Practice games and quests. Scores and tokens are kept on this device."
        breadcrumbs={null}
        note={`${LIVE_ACTIVITY_NAMES.join(" and ")} use live clinic data and are marked "Live data" below.`}
      >
        <div className="space-y-6">
          <section aria-labelledby="hub-wallet">
            <h2 id="hub-wallet" className="sr-only">
              Your game wallet
            </h2>
            {state === "loading" && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-hidden>
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="rounded-lg border border-line bg-surface px-4 py-3">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="mt-2 h-7 w-16" />
                  </div>
                ))}
              </div>
            )}
            {state === "failed" && (
              <div className="banner banner-danger" role="alert">
                <ExclamationCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
                <div>
                  <p>Your game wallet could not be read from this device.</p>
                  <button
                    type="button"
                    onClick={() => void loadGameData()}
                    className="btn-secondary mt-2"
                  >
                    Try again
                  </button>
                </div>
              </div>
            )}
            {state === "ready" && (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <TrainingStat
                    label="Game tokens"
                    value={wallet?.tokens ?? 0}
                    hint="Approved sessions only"
                  />
                  <TrainingStat label="Level" value={wallet?.level ?? 1} />
                  <TrainingStat
                    label="Day streak"
                    value={wallet?.streakDays ?? 0}
                    hint="Adds up to +50% to game tokens"
                  />
                </div>
                {!wallet && (
                  <p className="mt-2 text-caption text-ink-muted">
                    No approved tokens yet. Finish a game; after an admin
                    approves the session, its tokens appear here.
                  </p>
                )}
              </>
            )}
          </section>

          {state === "ready" && pendingCount > 0 && (
            <div className="banner banner-info" role="status">
              <ClockIcon className="h-5 w-5 shrink-0" aria-hidden />
              <p>
                {pendingCount} finished{" "}
                {pendingCount === 1 ? "session is" : "sessions are"} waiting
                for an admin to approve them. Their tokens are added after
                approval.
              </p>
            </div>
          )}

          <section aria-labelledby="hub-activities">
            <h2 id="hub-activities" className="mb-3 text-h2 text-ink">
              Games and quests
            </h2>
            <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {TRAINING_ACTIVITIES.map((activity) => {
                const Icon = ACTIVITY_ICONS[activity.id];
                const allowed = canOpenActivity(activity, role);
                const body = (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent/25 text-ink">
                        <Icon className="h-6 w-6" aria-hidden />
                      </span>
                      {activity.liveData ? (
                        <StatusBadge tone="warning">Live data</StatusBadge>
                      ) : (
                        <StatusBadge tone="neutral">Practice</StatusBadge>
                      )}
                    </div>
                    <h3 className="mt-3 text-h3 text-ink">{activity.name}</h3>
                    <p className="text-body text-ink-secondary">
                      {activity.description}
                    </p>
                    {activity.liveData && (
                      <p className="mt-1 text-body text-warning-fg">
                        {activity.liveData}
                      </p>
                    )}
                    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-caption text-ink-muted">
                      <li className="flex items-center gap-1">
                        <ClockIcon className="h-4 w-4" aria-hidden />
                        <span className="sr-only">Time: </span>
                        {activity.timing}
                      </li>
                      <li className="flex items-center gap-1">
                        <StarIcon className="h-4 w-4" aria-hidden />
                        <span className="sr-only">Reward: </span>
                        {activity.reward}
                      </li>
                    </ul>
                    <p className="mt-auto flex items-center gap-1.5 pt-3 text-label">
                      {allowed ? (
                        <span className="flex items-center gap-1 text-primary-fg">
                          Open
                          <ArrowRightIcon className="h-4 w-4" aria-hidden />
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-ink-muted">
                          <LockClosedIcon className="h-4 w-4" aria-hidden />
                          Not available: {activityAccessNote(activity, role)}
                        </span>
                      )}
                    </p>
                  </>
                );
                return (
                  <li key={activity.id} className="flex">
                    {allowed ? (
                      <Link
                        to={activity.href}
                        className="flex w-full flex-col rounded-lg border border-line bg-surface p-5 transition-colors hover:border-accent hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        {body}
                      </Link>
                    ) : (
                      <div className="flex w-full flex-col rounded-lg border border-line bg-surface-sunken p-5">
                        {body}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-labelledby="hub-more">
            <h2 id="hub-more" className="mb-3 text-h2 text-ink">
              Quests, prizes and rankings
            </h2>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {MORE_LINKS.filter((l) => !l.roles || (!!role && l.roles.includes(role))).map((l) => (
                <li key={l.href}>
                  <Link
                    to={l.href}
                    className="flex min-h-touch-target items-start gap-3 rounded-lg border border-line bg-surface p-4 transition-colors hover:border-accent hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <l.icon className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden />
                    <span>
                      <span className="block text-label text-ink">{l.name}</span>
                      <span className="block text-caption text-ink-muted">
                        {l.description}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          {badges.length > 0 && (
            <section className="panel" aria-labelledby="hub-badges">
              <div className="panel-header">
                <h2 id="hub-badges" className="panel-title">
                  Recent badges
                </h2>
              </div>
              <ul className="panel-body flex flex-wrap gap-2">
                {badges.slice(-6).map((badge) => (
                  <li key={badge}>
                    <StatusBadge tone="info">{badgeLabel(badge)}</StatusBadge>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </TrainingModeFrame>
    </div>
  );
}
