import { useState, useEffect } from 'react'
import { volunteerEngagement } from '@/services/volunteerEngagement'
import type { VolunteerProfile, Quest, LeaderboardEntry, TeamChallenge } from '@/services/volunteerEngagement'
import {
  TrophyIcon,
  SparklesIcon,
  FireIcon,
  StarIcon,
  UserGroupIcon,
  AcademicCapIcon,
  HeartIcon,
  ChartBarIcon
} from '@heroicons/react/24/outline'
import { useAuthStore } from '@/stores/auth'

export function VolunteerDashboard() {
  const { currentUser } = useAuthStore()
  const [profile, setProfile] = useState<VolunteerProfile | null>(null)
  const [dailyQuests, setDailyQuests] = useState<Quest[]>([])
  const [weeklyQuests, setWeeklyQuests] = useState<Quest[]>([])
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [teamChallenges, setTeamChallenges] = useState<TeamChallenge[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (currentUser) {
      loadDashboard()
    }
  }, [currentUser])

  const loadDashboard = async () => {
    if (!currentUser) return

    try {
      setLoading(true)
      const [prof, daily, weekly, board, challenges] = await Promise.all([
        volunteerEngagement.getVolunteerProfile(currentUser.id),
        volunteerEngagement.getDailyQuests(currentUser.id),
        volunteerEngagement.getWeeklyQuests(),
        volunteerEngagement.getLeaderboard('weekly'),
        volunteerEngagement.getTeamChallenges()
      ])

      setProfile(prof)
      setDailyQuests(daily)
      setWeeklyQuests(weekly)
      setLeaderboard(board.entries.slice(0, 10))
      setTeamChallenges(challenges)
    } catch (error) {
      console.error('Failed to load volunteer dashboard:', error)
    } finally {
      setLoading(false)
    }
  }

  const getRarityColor = (rarity: string) => {
    switch (rarity) {
      case 'legendary': return 'text-yellow-500 bg-yellow-50 border-yellow-500'
      case 'epic': return 'text-purple-500 bg-purple-50 border-purple-500'
      case 'rare': return 'text-blue-500 bg-blue-50 border-blue-500'
      case 'uncommon': return 'text-green-500 bg-green-50 border-green-500'
      default: return 'text-gray-500 bg-gray-50 border-gray-300'
    }
  }

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case 'expert': return 'bg-red-500'
      case 'hard': return 'bg-orange-500'
      case 'medium': return 'bg-yellow-500'
      default: return 'bg-green-500'
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (!profile) return null

  const nextLevelXP = (profile.level + 1) * 1000
  const currentLevelXP = profile.level * 1000
  const progressToNextLevel = ((profile.experiencePoints - currentLevelXP) / (nextLevelXP - currentLevelXP)) * 100

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg shadow-lg p-8 text-white">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold">{profile.displayName}</h1>
              <span className="px-3 py-1 bg-white/20 backdrop-blur rounded-full text-sm font-medium">
                {profile.rank}
              </span>
            </div>
            <p className="text-blue-100 mb-4">
              Level {profile.level} • {profile.experiencePoints.toLocaleString()} XP
            </p>

            <div className="w-full max-w-md">
              <div className="flex items-center justify-between text-sm mb-1">
                <span>Progress to Level {profile.level + 1}</span>
                <span>{Math.round(progressToNextLevel)}%</span>
              </div>
              <div className="w-full bg-white/20 rounded-full h-3">
                <div
                  className="bg-white rounded-full h-3 transition-all duration-500"
                  style={{ width: `${progressToNextLevel}%` }}
                ></div>
              </div>
            </div>
          </div>

          <div className="text-right">
            <div className="text-4xl font-bold mb-1">{profile.patientsHelped}</div>
            <div className="text-blue-100">Patients Helped</div>
            <div className="text-2xl font-bold mt-3">{profile.totalHours.toFixed(1)}h</div>
            <div className="text-blue-100">Hours Contributed</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center gap-3 mb-2">
            <TrophyIcon className="h-8 w-8 text-yellow-500" />
            <div>
              <div className="text-2xl font-bold text-gray-900">{profile.badges.length}</div>
              <div className="text-sm text-gray-600">Badges Earned</div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center gap-3 mb-2">
            <SparklesIcon className="h-8 w-8 text-blue-500" />
            <div>
              <div className="text-2xl font-bold text-gray-900">{profile.skills.length}</div>
              <div className="text-sm text-gray-600">Skills Mastered</div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center gap-3 mb-2">
            <HeartIcon className="h-8 w-8 text-red-500" />
            <div>
              <div className="text-2xl font-bold text-gray-900">
                {profile.lifetimeImpact.livesImpacted}
              </div>
              <div className="text-sm text-gray-600">Lives Impacted</div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center gap-3 mb-2">
            <FireIcon className="h-8 w-8 text-orange-500" />
            <div>
              <div className="text-2xl font-bold text-gray-900">5</div>
              <div className="text-sm text-gray-600">Day Streak</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
              <StarIcon className="h-6 w-6 text-yellow-500" />
              Daily Quests
            </h2>

            <div className="space-y-3">
              {dailyQuests.map((quest) => (
                <div key={quest.id} className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-gray-900">{quest.title}</h3>
                        <span className={`px-2 py-0.5 rounded text-xs text-white ${getDifficultyColor(quest.difficulty)}`}>
                          {quest.difficulty}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600">{quest.description}</p>
                    </div>
                    <div className="text-right ml-4">
                      <div className="text-lg font-bold text-blue-600">+{quest.rewardXP} XP</div>
                      {quest.rewardBadges && (
                        <div className="text-xs text-gray-500">+ Badge</div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    {quest.objectives.map((obj, idx) => (
                      <div key={idx}>
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="text-gray-700">{obj.description}</span>
                          <span className="font-medium">{obj.current}/{obj.target}</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-blue-600 rounded-full h-2 transition-all"
                            style={{ width: `${(obj.current / obj.target) * 100}%` }}
                          ></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
              <TrophyIcon className="h-6 w-6 text-purple-500" />
              Weekly Challenges
            </h2>

            <div className="space-y-3">
              {weeklyQuests.map((quest) => (
                <div key={quest.id} className="border border-purple-200 bg-purple-50 rounded-lg p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900 mb-1">{quest.title}</h3>
                      <p className="text-sm text-gray-600">{quest.description}</p>
                    </div>
                    <div className="text-lg font-bold text-purple-600">+{quest.rewardXP} XP</div>
                  </div>

                  {quest.objectives.map((obj, idx) => (
                    <div key={idx}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-gray-700">{obj.description}</span>
                        <span className="font-medium">{obj.current}/{obj.target}</span>
                      </div>
                      <div className="w-full bg-purple-200 rounded-full h-2">
                        <div
                          className="bg-purple-600 rounded-full h-2 transition-all"
                          style={{ width: `${(obj.current / obj.target) * 100}%` }}
                        ></div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
              <UserGroupIcon className="h-6 w-6 text-green-500" />
              Team Challenges
            </h2>

            <div className="space-y-4">
              {teamChallenges.map((challenge) => (
                <div key={challenge.id} className="border border-green-200 bg-green-50 rounded-lg p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-gray-900">{challenge.name}</h3>
                      <p className="text-sm text-gray-600 mt-1">{challenge.description}</p>
                    </div>
                    <span className="px-2 py-1 bg-green-600 text-white rounded text-xs font-medium">
                      {challenge.status}
                    </span>
                  </div>

                  <div className="mb-3">
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-gray-700">Team Progress</span>
                      <span className="font-medium">{challenge.currentProgress}/{challenge.targetGoal}</span>
                    </div>
                    <div className="w-full bg-green-200 rounded-full h-3">
                      <div
                        className="bg-green-600 rounded-full h-3 transition-all"
                        style={{ width: `${(challenge.currentProgress / challenge.targetGoal) * 100}%` }}
                      ></div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <UserGroupIcon className="h-4 w-4" />
                    <span>{challenge.participants.length} participants</span>
                  </div>

                  <div className="mt-3 pt-3 border-t border-green-200">
                    <p className="text-xs font-medium text-gray-700 mb-1">Rewards:</p>
                    <div className="flex flex-wrap gap-1">
                      {challenge.rewards.map((reward, idx) => (
                        <span key={idx} className="px-2 py-1 bg-white rounded text-xs text-gray-700">
                          {reward}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
              <TrophyIcon className="h-6 w-6 text-yellow-500" />
              Badges
            </h2>

            <div className="grid grid-cols-3 gap-3">
              {profile.badges.map((badge) => (
                <div
                  key={badge.id}
                  className={`border-2 rounded-lg p-3 text-center ${getRarityColor(badge.rarity)}`}
                  title={badge.description}
                >
                  <div className="text-3xl mb-1">{badge.icon}</div>
                  <div className="text-xs font-medium truncate">{badge.name}</div>
                </div>
              ))}

              <div className="border-2 border-dashed border-gray-300 rounded-lg p-3 text-center opacity-50">
                <div className="text-3xl mb-1">🔒</div>
                <div className="text-xs text-gray-500">Locked</div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
              <ChartBarIcon className="h-6 w-6 text-blue-500" />
              Leaderboard
            </h2>

            <div className="space-y-2">
              {leaderboard.map((entry) => (
                <div
                  key={entry.userId}
                  className={`flex items-center gap-3 p-3 rounded-lg ${
                    entry.userId === currentUser?.id ? 'bg-blue-50 border-2 border-blue-500' : 'bg-gray-50'
                  }`}
                >
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                    entry.rank === 1 ? 'bg-yellow-500 text-white' :
                    entry.rank === 2 ? 'bg-gray-400 text-white' :
                    entry.rank === 3 ? 'bg-orange-600 text-white' :
                    'bg-gray-200 text-gray-700'
                  }`}>
                    {entry.rank}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 truncate">{entry.displayName}</div>
                    <div className="text-xs text-gray-500">{entry.score.toLocaleString()} XP</div>
                  </div>

                  <div className="flex gap-1">
                    {entry.badges.map((badge, idx) => (
                      <span key={idx} className="text-lg">{badge}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
              <AcademicCapIcon className="h-6 w-6 text-purple-500" />
              Skills
            </h2>

            <div className="space-y-3">
              {profile.skills.map((skill) => (
                <div key={skill.name}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-gray-900">{skill.name}</span>
                    <span className="text-sm font-bold text-purple-600">Level {skill.level}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-purple-600 rounded-full h-2"
                      style={{ width: `${(skill.level / 10) * 100}%` }}
                    ></div>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {skill.practiceCount} times practiced
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-gradient-to-r from-green-600 to-teal-600 rounded-lg shadow-lg p-6 text-white">
        <h3 className="text-lg font-semibold mb-2">Your Impact This Month</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-3xl font-bold">{profile.lifetimeImpact.patientsServed}</div>
            <div className="text-green-100">Patients Served</div>
          </div>
          <div>
            <div className="text-3xl font-bold">{profile.lifetimeImpact.consultationsAssisted}</div>
            <div className="text-green-100">Consultations</div>
          </div>
          <div>
            <div className="text-3xl font-bold">{profile.lifetimeImpact.hoursContributed}h</div>
            <div className="text-green-100">Hours Given</div>
          </div>
          <div>
            <div className="text-3xl font-bold">{profile.lifetimeImpact.communitiesReached}</div>
            <div className="text-green-100">Communities</div>
          </div>
        </div>
      </div>
    </div>
  )
}
