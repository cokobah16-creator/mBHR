import { db } from '@/db'

export interface VolunteerProfile {
  userId: string
  displayName: string
  joinedDate: Date
  totalHours: number
  patientsHelped: number
  level: number
  experiencePoints: number
  badges: Badge[]
  skills: Skill[]
  specializations: string[]
  rank: string
  lifetimeImpact: ImpactMetrics
}

export interface Badge {
  id: string
  name: string
  description: string
  icon: string
  category: 'achievement' | 'milestone' | 'special' | 'skill' | 'community'
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
  earnedDate: Date
  criteria: string
}

export interface Skill {
  name: string
  level: number
  experiencePoints: number
  certifications: string[]
  practiceCount: number
  lastPracticed: Date
}

export interface Quest {
  id: string
  title: string
  description: string
  category: 'daily' | 'weekly' | 'special' | 'team'
  difficulty: 'easy' | 'medium' | 'hard' | 'expert'
  rewardXP: number
  rewardBadges?: string[]
  objectives: QuestObjective[]
  progress: number
  status: 'available' | 'in_progress' | 'completed' | 'expired'
  expiresAt?: Date
}

export interface QuestObjective {
  description: string
  target: number
  current: number
  completed: boolean
}

export interface ImpactMetrics {
  patientsServed: number
  livesImpacted: number
  vaccinesAdministered: number
  consultationsAssisted: number
  emergenciesHandled: number
  communitiesReached: number
  hoursContributed: number
  storiesCollected: string[]
}

export interface VolunteerLeaderboard {
  period: 'daily' | 'weekly' | 'monthly' | 'all-time'
  entries: LeaderboardEntry[]
  userRank?: number
}

export interface LeaderboardEntry {
  rank: number
  userId: string
  displayName: string
  score: number
  avatar?: string
  badges: string[]
  specialTitle?: string
}

export interface TeamChallenge {
  id: string
  name: string
  description: string
  startDate: Date
  endDate: Date
  targetGoal: number
  currentProgress: number
  participants: string[]
  rewards: string[]
  status: 'upcoming' | 'active' | 'completed'
}

export interface VolunteerStory {
  id: string
  volunteerId: string
  volunteerName: string
  title: string
  story: string
  date: Date
  impact: string
  category: 'patient-care' | 'community' | 'innovation' | 'teamwork' | 'inspiration'
  likes: number
  featured: boolean
}

export interface CertificationPath {
  id: string
  name: string
  description: string
  requirements: string[]
  modules: CertificationModule[]
  completionPercentage: number
  estimatedHours: number
  benefits: string[]
}

export interface CertificationModule {
  id: string
  name: string
  description: string
  completed: boolean
  requiredTasks: string[]
  quiz?: string
}

class VolunteerEngagementSystem {

  private readonly XP_PER_LEVEL = 1000
  private readonly RANKS = [
    { level: 1, name: 'Newcomer', color: 'gray' },
    { level: 5, name: 'Helper', color: 'blue' },
    { level: 10, name: 'Caregiver', color: 'green' },
    { level: 20, name: 'Healer', color: 'purple' },
    { level: 35, name: 'Champion', color: 'orange' },
    { level: 50, name: 'Guardian', color: 'red' },
    { level: 75, name: 'Legend', color: 'gold' },
    { level: 100, name: 'Hero of Health', color: 'platinum' }
  ]

  async getVolunteerProfile(userId: string): Promise<VolunteerProfile> {
    const user = await db.users.get(userId)
    if (!user) throw new Error('User not found')

    const visits = await db.visits
      .where('_dirty')
      .between(0, 2)
      .toArray()

    const patientsHelped = new Set(visits.map(v => v.patientId)).size
    const totalHours = visits.length * 0.5

    const xp = Math.floor(patientsHelped * 100 + totalHours * 50)
    const level = Math.floor(xp / this.XP_PER_LEVEL) + 1

    const badges = await this.calculateBadges(userId, patientsHelped, totalHours, visits.length)
    const skills = await this.calculateSkills(userId)
    const rank = this.getRankForLevel(level)

    const lifetimeImpact: ImpactMetrics = {
      patientsServed: patientsHelped,
      livesImpacted: Math.floor(patientsHelped * 1.5),
      vaccinesAdministered: 0,
      consultationsAssisted: visits.length,
      emergenciesHandled: 0,
      communitiesReached: 1,
      hoursContributed: totalHours,
      storiesCollected: []
    }

    return {
      userId,
      displayName: user.fullName,
      joinedDate: user.createdAt,
      totalHours,
      patientsHelped,
      level,
      experiencePoints: xp,
      badges,
      skills,
      specializations: this.determineSpecializations(skills),
      rank,
      lifetimeImpact
    }
  }

  private getRankForLevel(level: number): string {
    for (let i = this.RANKS.length - 1; i >= 0; i--) {
      if (level >= this.RANKS[i].level) {
        return this.RANKS[i].name
      }
    }
    return this.RANKS[0].name
  }

  private async calculateBadges(userId: string, patientsHelped: number, hours: number, visits: number): Promise<Badge[]> {
    const badges: Badge[] = []

    if (patientsHelped >= 1) {
      badges.push({
        id: 'first-patient',
        name: 'First Steps',
        description: 'Helped your first patient',
        icon: '🎯',
        category: 'milestone',
        rarity: 'common',
        earnedDate: new Date(),
        criteria: 'Help 1 patient'
      })
    }

    if (patientsHelped >= 10) {
      badges.push({
        id: 'ten-patients',
        name: 'Helping Hands',
        description: 'Helped 10 patients',
        icon: '👐',
        category: 'milestone',
        rarity: 'uncommon',
        earnedDate: new Date(),
        criteria: 'Help 10 patients'
      })
    }

    if (patientsHelped >= 50) {
      badges.push({
        id: 'fifty-patients',
        name: 'Community Champion',
        description: 'Helped 50 patients',
        icon: '🏆',
        category: 'milestone',
        rarity: 'rare',
        earnedDate: new Date(),
        criteria: 'Help 50 patients'
      })
    }

    if (patientsHelped >= 100) {
      badges.push({
        id: 'hundred-patients',
        name: 'Healthcare Hero',
        description: 'Helped 100 patients',
        icon: '⭐',
        category: 'milestone',
        rarity: 'epic',
        earnedDate: new Date(),
        criteria: 'Help 100 patients'
      })
    }

    if (hours >= 10) {
      badges.push({
        id: 'ten-hours',
        name: 'Dedicated Volunteer',
        description: 'Contributed 10 hours',
        icon: '⏰',
        category: 'achievement',
        rarity: 'uncommon',
        earnedDate: new Date(),
        criteria: 'Volunteer 10 hours'
      })
    }

    if (hours >= 50) {
      badges.push({
        id: 'fifty-hours',
        name: 'Time Champion',
        description: 'Contributed 50 hours',
        icon: '🌟',
        category: 'achievement',
        rarity: 'rare',
        earnedDate: new Date(),
        criteria: 'Volunteer 50 hours'
      })
    }

    if (visits >= 5) {
      const recentVisits = await db.visits
        .reverse()
        .limit(5)
        .toArray()

      const datesUnique = new Set(recentVisits.map(v => v.startedAt.toDateString()))
      if (datesUnique.size === 5) {
        badges.push({
          id: 'five-day-streak',
          name: 'Consistency King',
          description: 'Volunteered 5 days in a row',
          icon: '🔥',
          category: 'achievement',
          rarity: 'rare',
          earnedDate: new Date(),
          criteria: '5-day streak'
        })
      }
    }

    return badges
  }

  private async calculateSkills(userId: string): Promise<Skill[]> {
    const skills: Skill[] = []

    const vitals = await db.vitals.where('recordedBy').equals(userId).count()
    if (vitals > 0) {
      skills.push({
        name: 'Vital Signs',
        level: Math.min(10, Math.floor(vitals / 10) + 1),
        experiencePoints: vitals * 10,
        certifications: vitals > 50 ? ['Advanced Vitals'] : [],
        practiceCount: vitals,
        lastPracticed: new Date()
      })
    }

    const visits = await db.visits.count()
    if (visits > 0) {
      skills.push({
        name: 'Patient Registration',
        level: Math.min(10, Math.floor(visits / 20) + 1),
        experiencePoints: visits * 5,
        certifications: [],
        practiceCount: visits,
        lastPracticed: new Date()
      })
    }

    return skills
  }

  private determineSpecializations(skills: Skill[]): string[] {
    const specializations: string[] = []

    skills.forEach(skill => {
      if (skill.level >= 5) {
        if (skill.name === 'Vital Signs') {
          specializations.push('Clinical Care')
        }
        if (skill.name === 'Patient Registration') {
          specializations.push('Patient Services')
        }
      }
    })

    return specializations
  }

  async getDailyQuests(userId: string): Promise<Quest[]> {
    const profile = await this.getVolunteerProfile(userId)

    const quests: Quest[] = [
      {
        id: 'daily-register-3',
        title: 'Morning Registration Rush',
        description: 'Help register 3 new patients today',
        category: 'daily',
        difficulty: 'easy',
        rewardXP: 150,
        objectives: [
          { description: 'Register patients', target: 3, current: 0, completed: false }
        ],
        progress: 0,
        status: 'available',
        expiresAt: this.getEndOfDay()
      },
      {
        id: 'daily-vitals-5',
        title: 'Vital Signs Champion',
        description: 'Record vital signs for 5 patients',
        category: 'daily',
        difficulty: 'medium',
        rewardXP: 250,
        objectives: [
          { description: 'Record vital signs', target: 5, current: 0, completed: false }
        ],
        progress: 0,
        status: 'available',
        expiresAt: this.getEndOfDay()
      },
      {
        id: 'daily-queue-helper',
        title: 'Queue Master',
        description: 'Help process patients through the queue efficiently',
        category: 'daily',
        difficulty: 'medium',
        rewardXP: 200,
        objectives: [
          { description: 'Move 10 patients through queue', target: 10, current: 0, completed: false }
        ],
        progress: 0,
        status: 'available',
        expiresAt: this.getEndOfDay()
      }
    ]

    if (profile.level >= 10) {
      quests.push({
        id: 'daily-mentor',
        title: 'Mentor a Newcomer',
        description: 'Help train a new volunteer',
        category: 'daily',
        difficulty: 'hard',
        rewardXP: 500,
        rewardBadges: ['mentor-badge'],
        objectives: [
          { description: 'Train new volunteer', target: 1, current: 0, completed: false }
        ],
        progress: 0,
        status: 'available',
        expiresAt: this.getEndOfDay()
      })
    }

    return quests
  }

  async getWeeklyQuests(): Promise<Quest[]> {
    return [
      {
        id: 'weekly-25-patients',
        title: 'Community Impact',
        description: 'Help 25 patients this week',
        category: 'weekly',
        difficulty: 'medium',
        rewardXP: 1000,
        rewardBadges: ['weekly-champion'],
        objectives: [
          { description: 'Help patients', target: 25, current: 0, completed: false }
        ],
        progress: 0,
        status: 'available',
        expiresAt: this.getEndOfWeek()
      },
      {
        id: 'weekly-perfect-attendance',
        title: 'Perfect Attendance',
        description: 'Volunteer every day this week',
        category: 'weekly',
        difficulty: 'hard',
        rewardXP: 1500,
        rewardBadges: ['dedication-star'],
        objectives: [
          { description: 'Volunteer days', target: 7, current: 0, completed: false }
        ],
        progress: 0,
        status: 'available',
        expiresAt: this.getEndOfWeek()
      },
      {
        id: 'weekly-skill-master',
        title: 'Skill Master',
        description: 'Practice 3 different skills',
        category: 'weekly',
        difficulty: 'medium',
        rewardXP: 800,
        objectives: [
          { description: 'Different skills used', target: 3, current: 0, completed: false }
        ],
        progress: 0,
        status: 'available',
        expiresAt: this.getEndOfWeek()
      }
    ]
  }

  private getEndOfDay(): Date {
    const end = new Date()
    end.setHours(23, 59, 59, 999)
    return end
  }

  private getEndOfWeek(): Date {
    const end = new Date()
    const day = end.getDay()
    const diff = 7 - day
    end.setDate(end.getDate() + diff)
    end.setHours(23, 59, 59, 999)
    return end
  }

  async getLeaderboard(period: 'daily' | 'weekly' | 'monthly' | 'all-time'): Promise<VolunteerLeaderboard> {
    const users = await db.users.toArray()

    const entries: LeaderboardEntry[] = []

    for (const user of users) {
      if (user.role === 'volunteer' || user.role === 'nurse' || user.role === 'doctor') {
        const profile = await this.getVolunteerProfile(user.id)

        entries.push({
          rank: 0,
          userId: user.id,
          displayName: user.fullName,
          score: profile.experiencePoints,
          badges: profile.badges.slice(0, 3).map(b => b.icon),
          specialTitle: profile.rank
        })
      }
    }

    entries.sort((a, b) => b.score - a.score)
    entries.forEach((entry, index) => {
      entry.rank = index + 1
    })

    return {
      period,
      entries: entries.slice(0, 50)
    }
  }

  async getTeamChallenges(): Promise<TeamChallenge[]> {
    const now = new Date()

    return [
      {
        id: 'monthly-1000-patients',
        name: '1000 Patients Challenge',
        description: 'Our team goal: Help 1000 patients this month!',
        startDate: new Date(now.getFullYear(), now.getMonth(), 1),
        endDate: new Date(now.getFullYear(), now.getMonth() + 1, 0),
        targetGoal: 1000,
        currentProgress: 450,
        participants: [],
        rewards: ['Team Champion Badge', 'Recognition Certificate', 'Featured in Newsletter'],
        status: 'active'
      },
      {
        id: 'quarterly-training',
        name: 'Skill Up Challenge',
        description: 'Complete 5 training modules as a team',
        startDate: now,
        endDate: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
        targetGoal: 5,
        currentProgress: 2,
        participants: [],
        rewards: ['Advanced Certification', 'Skill Master Badge'],
        status: 'active'
      }
    ]
  }

  async getCertificationPaths(): Promise<CertificationPath[]> {
    return [
      {
        id: 'basic-care',
        name: 'Basic Healthcare Provider',
        description: 'Learn fundamental skills for patient care',
        requirements: [
          'Complete all 6 modules',
          'Practice each skill 10 times',
          'Pass final assessment'
        ],
        modules: [
          {
            id: 'module-1',
            name: 'Patient Communication',
            description: 'Learn to communicate effectively with patients',
            completed: false,
            requiredTasks: [
              'Watch training video',
              'Practice with 5 patients',
              'Complete quiz'
            ]
          },
          {
            id: 'module-2',
            name: 'Vital Signs Mastery',
            description: 'Master taking accurate vital signs',
            completed: false,
            requiredTasks: [
              'Learn proper technique',
              'Record vitals for 20 patients',
              'Pass accuracy test'
            ]
          },
          {
            id: 'module-3',
            name: 'Medical Records',
            description: 'Understand how to manage patient records',
            completed: false,
            requiredTasks: [
              'Study HIPAA/privacy guidelines',
              'Process 30 records',
              'Complete documentation quiz'
            ]
          }
        ],
        completionPercentage: 0,
        estimatedHours: 20,
        benefits: [
          'Official certification',
          'Increased responsibilities',
          'Mentorship opportunities',
          'Priority scheduling'
        ]
      },
      {
        id: 'advanced-triage',
        name: 'Advanced Triage Specialist',
        description: 'Become an expert in patient prioritization',
        requirements: [
          'Complete Basic Healthcare Provider',
          'Minimum 50 hours experience',
          'Complete all 4 advanced modules'
        ],
        modules: [
          {
            id: 'adv-1',
            name: 'Emergency Recognition',
            description: 'Identify life-threatening conditions',
            completed: false,
            requiredTasks: [
              'Complete emergency training',
              'Shadow experienced staff 10 times',
              'Pass scenario assessment'
            ]
          },
          {
            id: 'adv-2',
            name: 'Priority Decision Making',
            description: 'Learn to prioritize patients effectively',
            completed: false,
            requiredTasks: [
              'Study triage protocols',
              'Triage 100 patients',
              'Achieve 95% accuracy rate'
            ]
          }
        ],
        completionPercentage: 0,
        estimatedHours: 40,
        benefits: [
          'Advanced certification',
          'Leadership role eligibility',
          'Training stipend eligibility',
          'Reference letters for employment'
        ]
      }
    ]
  }

  async submitVolunteerStory(story: Omit<VolunteerStory, 'id' | 'likes' | 'featured'>): Promise<VolunteerStory> {
    return {
      id: `story-${Date.now()}`,
      ...story,
      likes: 0,
      featured: false
    }
  }

  async getVolunteerStories(limit: number = 10): Promise<VolunteerStory[]> {
    return [
      {
        id: 'story-1',
        volunteerId: 'v-001',
        volunteerName: 'Sarah Johnson',
        title: 'The Day I Helped Save a Life',
        story: 'It was a busy Saturday morning when a mother rushed in with her 3-year-old having a seizure. Because of my training here, I immediately recognized the signs of severe malaria and got her straight to the doctor. The doctor said those few minutes made all the difference. That little girl is healthy today because we were prepared.',
        date: new Date('2025-10-15'),
        impact: 'Quick recognition and action saved a child\'s life',
        category: 'patient-care',
        likes: 156,
        featured: true
      },
      {
        id: 'story-2',
        volunteerId: 'v-002',
        volunteerName: 'David Okonkwo',
        title: 'Why I Keep Coming Back',
        story: 'I started volunteering to get medical experience, but it became so much more. The smiles, the thank yous, the feeling that you made someone\'s day better - you can\'t buy that. Last week, a grandmother held my hand and said "God bless you, my son." I\'ve never felt more valued.',
        date: new Date('2025-10-20'),
        impact: 'Over 200 patients served in 6 months',
        category: 'inspiration',
        likes: 89,
        featured: true
      },
      {
        id: 'story-3',
        volunteerId: 'v-003',
        volunteerName: 'Amina Hassan',
        title: 'From Volunteer to Healthcare Worker',
        story: 'I came here with no experience, just a desire to help. The training, mentorship, and hands-on experience gave me real skills. Today, I got accepted to nursing school - and the reference letter from the clinic made all the difference. This place changed my life.',
        date: new Date('2025-10-18'),
        impact: 'Career pathway opened through volunteering',
        category: 'community',
        likes: 134,
        featured: true
      }
    ]
  }

  async calculateVolunteerROI(userId: string): Promise<{
    skillsGained: string[]
    certifications: string[]
    experienceHours: number
    networkConnections: number
    careerValue: string
    personalGrowth: string[]
  }> {
    const profile = await this.getVolunteerProfile(userId)

    return {
      skillsGained: profile.skills.map(s => s.name),
      certifications: profile.skills.flatMap(s => s.certifications),
      experienceHours: profile.totalHours,
      networkConnections: Math.floor(profile.patientsHelped / 10),
      careerValue: profile.totalHours > 100 ? 'Equivalent to $5,000+ in training value' :
                   profile.totalHours > 50 ? 'Equivalent to $2,500+ in training value' :
                   'Equivalent to $1,000+ in training value',
      personalGrowth: [
        'Clinical skills development',
        'Patient communication mastery',
        'Team collaboration experience',
        'Healthcare system understanding',
        'Community impact contribution',
        'Leadership opportunities'
      ]
    }
  }
}

export const volunteerEngagement = new VolunteerEngagementSystem()
