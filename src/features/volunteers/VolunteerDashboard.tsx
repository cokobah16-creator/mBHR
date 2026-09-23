import { useState, useEffect, useCallback } from "react";
import { volunteerEngagement } from "@/services/volunteerEngagement";
import type {
  VolunteerProfile,
  Quest,
  LeaderboardEntry,
  TeamChallenge,
} from "@/services/volunteerEngagement";
import {
  TrophyIcon,
  StarIcon,
  UserGroupIcon,
  AcademicCapIcon,
  ChartBarIcon,
  LockClosedIcon,
  InformationCircleIcon,
  UserIcon,
} from "@heroicons/react/24/outline";
import { useAuthStore } from "@/stores/auth";
import { StatusBadge, type Tone } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { StatTile } from "@/features/reports/StatTile";

const DIFFICULTY_TONE: Record<Quest["difficulty"], Tone> = {
  easy: "neutral",
  medium: "info",
  hard: "warning",
  expert: "warning",
};

const XP_PER_LEVEL = 1000;

export function VolunteerDashboard() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const [profile, setProfile] = useState<VolunteerProfile | null>(null);
  const [dailyQuests, setDailyQuests] = useState<Quest[]>([]);
  const [weeklyQuests, setWeeklyQuests] = useState<Quest[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [teamChallenges, setTeamChallenges] = useState<TeamChallenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const loadDashboard = useCallback(async () => {
    if (!currentUser) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setLoadFailed(false);
      const [prof, daily, weekly, board, challenges] = await Promise.all([
        volunteerEngagement.getVolunteerProfile(currentUser.id),
        volunteerEngagement.getDailyQuests(currentUser.id),
        volunteerEngagement.getWeeklyQuests(),
        volunteerEngagement.getLeaderboard("weekly"),
        volunteerEngagement.getTeamChallenges(),
      ]);

      setProfile(prof);
      setDailyQuests(daily);
      setWeeklyQuests(weekly);
      setLeaderboard(board.entries.slice(0, 10));
      setTeamChallenges(challenges);
    } catch (error) {
      console.error(
        "Failed to load volunteer dashboard:",
        error instanceof Error ? error.name : error,
      );
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  if (loading) {
    return <DashboardSkeleton />;
  }

  if (!currentUser) {
    return (
      <div className="panel">
        <EmptyState
          icon={UserIcon}
          title="Sign in to see your volunteer progress"
        />
      </div>
    );
  }

  if (loadFailed || !profile) {
    return (
      <div className="banner banner-danger" role="alert">
        <span className="flex-1">Your volunteer progress could not be loaded on this device.</span>
        <button type="button" onClick={loadDashboard} className="btn-secondary">
          Try again
        </button>
      </div>
    );
  }

  // Level n covers (n − 1) × 1000 up to n × 1000 points (see volunteerEngagement).
  const levelFloorXP = (profile.level - 1) * XP_PER_LEVEL;
  const progressToNextLevel = Math.max(
    0,
    Math.min(100, Math.round(((profile.experiencePoints - levelFloorXP) / XP_PER_LEVEL) * 100)),
  );

  return (
    <div className="space-y-4">
      <section className="panel p-5" aria-labelledby="volunteer-name">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="volunteer-name" className="text-h2 text-ink">
                {profile.displayName}
              </h2>
              <StatusBadge tone="neutral">{profile.rank}</StatusBadge>
            </div>
            <p className="mt-1 text-body text-ink-secondary">
              Level {profile.level} · {profile.experiencePoints.toLocaleString("en-NG")} points
            </p>
            <div className="mt-3 max-w-md">
              <div className="mb-1 flex items-center justify-between text-caption text-ink-muted">
                <span id="level-progress-label">Progress to level {profile.level + 1}</span>
                <span className="tabular-nums">{progressToNextLevel}%</span>
              </div>
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
                role="progressbar"
                aria-labelledby="level-progress-label"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressToNextLevel}
              >
                <div className="h-2 rounded-full bg-primary" style={{ width: `${progressToNextLevel}%` }} />
              </div>
            </div>
          </div>
        </div>
        <p className="mt-4 flex items-start gap-1.5 text-caption text-ink-muted">
          <InformationCircleIcon className="mt-px h-4 w-4 shrink-0" aria-hidden />
          Points, levels and badges are worked out from all visits recorded on
          this device, not only the ones you helped with. Hours are an estimate
          of 30 minutes per visit.
        </p>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Patients with visits"
          value={profile.patientsHelped.toLocaleString("en-NG")}
          hint="All staff, this device"
        />
        <StatTile
          label="Visits recorded"
          value={profile.lifetimeImpact.consultationsAssisted.toLocaleString("en-NG")}
          hint="All staff, this device"
        />
        <StatTile
          label="Estimated hours"
          value={profile.totalHours.toFixed(1)}
          hint="30 minutes per visit"
        />
        <StatTile
          label="Badges earned"
          value={profile.badges.length.toLocaleString("en-NG")}
          hint={`${profile.skills.length} ${profile.skills.length === 1 ? "skill" : "skills"} practised`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <QuestList
            title="Daily quests"
            icon={StarIcon}
            quests={dailyQuests}
          />
          <QuestList
            title="Weekly challenges"
            icon={TrophyIcon}
            quests={weeklyQuests}
          />

          <section className="panel" aria-labelledby="team-challenges-title">
            <div className="panel-header">
              <h3 id="team-challenges-title" className="panel-title flex items-center gap-2">
                <UserGroupIcon className="h-5 w-5 text-ink-muted" aria-hidden />
                Team challenges
              </h3>
            </div>
            {teamChallenges.length === 0 ? (
              <EmptyState icon={UserGroupIcon} title="No team challenges yet" />
            ) : (
              <ul className="divide-y divide-line">
                {teamChallenges.map((challenge) => (
                  <li key={challenge.id} className="space-y-2 px-4 py-3">
                    <div>
                      <p className="font-medium text-ink">{challenge.name}</p>
                      <p className="text-body text-ink-secondary">{challenge.description}</p>
                    </div>
                    <StatusBadge tone="neutral" icon>
                      Team progress is not tracked yet
                    </StatusBadge>
                    {challenge.rewards.length > 0 && (
                      <p className="text-caption text-ink-muted">
                        Rewards: {challenge.rewards.join(", ")}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-4">
          <section className="panel" aria-labelledby="badges-title">
            <div className="panel-header">
              <h3 id="badges-title" className="panel-title flex items-center gap-2">
                <TrophyIcon className="h-5 w-5 text-ink-muted" aria-hidden />
                Badges
              </h3>
            </div>
            <ul className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3">
              {profile.badges.map((badge) => (
                <li
                  key={badge.id}
                  className="rounded-md border border-line bg-surface-sunken p-3 text-center"
                >
                  <TrophyIcon className="mx-auto h-6 w-6 text-ink-muted" aria-hidden />
                  <span className="block truncate text-caption font-medium text-ink">{badge.name}</span>
                  <span className="block text-caption capitalize text-ink-muted">{badge.rarity}</span>
                  <span className="sr-only">. {badge.description}</span>
                </li>
              ))}
              <li className="rounded-md border border-dashed border-line-strong p-3 text-center">
                <LockClosedIcon className="mx-auto h-6 w-6 text-ink-disabled" aria-hidden />
                <span className="block text-caption text-ink-muted">More to earn</span>
              </li>
            </ul>
          </section>

          <section className="panel" aria-labelledby="leaderboard-title">
            <div className="panel-header">
              <h3 id="leaderboard-title" className="panel-title flex items-center gap-2">
                <ChartBarIcon className="h-5 w-5 text-ink-muted" aria-hidden />
                Leaderboard
              </h3>
            </div>
            <p className="border-b border-line px-4 py-2 text-caption text-ink-muted">
              Scores use the same device-wide visit count for everyone, so this
              list does not yet show individual effort.
            </p>
            {leaderboard.length === 0 ? (
              <EmptyState icon={ChartBarIcon} title="No volunteers on this device yet" />
            ) : (
              <ol className="divide-y divide-line">
                {leaderboard.map((entry) => {
                  const isMe = entry.userId === currentUser.id;
                  return (
                    <li
                      key={entry.userId}
                      className={`flex items-center gap-3 px-4 py-2 ${isMe ? "bg-primary-soft" : ""}`}
                    >
                      <span className="w-6 text-right tabular-nums text-ink-muted">{entry.rank}.</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-ink">
                          {entry.displayName}
                          {isMe && <span className="text-caption text-primary-fg"> (you)</span>}
                        </span>
                        <span className="text-caption tabular-nums text-ink-muted">
                          {entry.score.toLocaleString("en-NG")} points
                        </span>
                      </span>
                      {entry.badges.length > 0 && (
                        <span className="shrink-0 text-caption tabular-nums text-ink-muted">
                          {entry.badges.length} {entry.badges.length === 1 ? "badge" : "badges"}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <section className="panel" aria-labelledby="skills-title">
            <div className="panel-header">
              <h3 id="skills-title" className="panel-title flex items-center gap-2">
                <AcademicCapIcon className="h-5 w-5 text-ink-muted" aria-hidden />
                Skills
              </h3>
            </div>
            {profile.skills.length === 0 ? (
              <EmptyState
                icon={AcademicCapIcon}
                title="No skills recorded yet"
                description="Recording vitals and visits builds skills here."
              />
            ) : (
              <ul className="space-y-3 p-4">
                {profile.skills.map((skill) => (
                  <li key={skill.name}>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-medium text-ink">{skill.name}</span>
                      <span className="text-label tabular-nums text-ink-secondary">
                        Level {skill.level} of 10
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
                      <div
                        className="h-1.5 rounded-full bg-primary"
                        style={{ width: `${(skill.level / 10) * 100}%` }}
                      />
                    </div>
                    <p className="mt-1 text-caption text-ink-muted">
                      {skill.practiceCount} times
                      {skill.name === "Patient Registration" ? " (all visits on this device)" : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function QuestList({
  title,
  icon: Icon,
  quests,
}: {
  title: string;
  icon: typeof StarIcon;
  quests: Quest[];
}) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h3 className="panel-title flex items-center gap-2">
          <Icon className="h-5 w-5 text-ink-muted" aria-hidden />
          {title}
        </h3>
        <span className="text-caption text-ink-muted">Progress is not tracked yet</span>
      </div>
      {quests.length === 0 ? (
        <EmptyState icon={Icon} title={`No ${title.toLowerCase()} right now`} />
      ) : (
        <ul className="divide-y divide-line">
          {quests.map((quest) => (
            <li key={quest.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-ink">{quest.title}</p>
                  <StatusBadge tone={DIFFICULTY_TONE[quest.difficulty]} icon={false}>
                    <span className="capitalize">{quest.difficulty}</span>
                  </StatusBadge>
                </div>
                <p className="text-body text-ink-secondary">{quest.description}</p>
                <ul className="mt-1 text-caption text-ink-muted">
                  {quest.objectives.map((obj, idx) => (
                    <li key={idx}>
                      Goal: {obj.description} ({obj.target})
                    </li>
                  ))}
                </ul>
              </div>
              <p className="shrink-0 text-label tabular-nums text-ink">
                +{quest.rewardXP} points
                {quest.rewardBadges && quest.rewardBadges.length > 0 && (
                  <span className="block text-caption text-ink-muted">and a badge</span>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
