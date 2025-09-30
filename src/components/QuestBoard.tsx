import React, { useEffect, useState } from 'react'
import { useAuthStore } from '@/stores/auth'
import { gamificationDb, GameTask, GameAttempt, Wallet } from '@/db/gamification'
import { 
  TrophyIcon, 
  ClockIcon, 
  FireIcon,
  PlayIcon,
  CheckCircleIcon,
  StarIcon,
  BoltIcon
} from '@heroicons/react/24/outline'

interface QuestBoardProps {
  onStartQuest?: (task: GameTask) => void
}

export function QuestBoard({ onStartQuest }: QuestBoardProps) {
  const { currentUser } = useAuthStore()
  const [tasks, setTasks] = useState<GameTask[]>([])
  const [attempts, setAttempts] = useState<GameAttempt[]>([])
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [activeTab, setActiveTab] = useState<'daily' | 'weekly' | 'event'>('daily')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (currentUser) {
      loadQuestData()
    }
  }, [currentUser, activeTab])

  const loadQuestData = async () => {
    if (!currentUser) return

    try {
      setLoading(true)
      
      // Load available tasks
      const allTasks = await gamificationDb.game_tasks.toArray()
      const userRole = currentUser.role
      
      // Filter tasks by role and active status
      const availableTasks = allTasks.filter(task => {
        // Check role requirements
        if (task.requiredRole && !task.requiredRole.includes(userRole)) {
          return false
        }
        
        // Check if task is active
        const now = new Date().toISOString()
        if (task.activeFrom && now < task.activeFrom) return false
        if (task.activeTo && now > task.activeTo) return false
        
        return true
      })

      // Load user's attempts for today
      const today = new Date().toISOString().split('T')[0]
      const todayAttempts = await gamificationDb.game_attempts
        .where('actorId')
        .equals(currentUser.id)
        .and(attempt => attempt.startedAt.startsWith(today))
        .toArray()

      // Load wallet
      const userWallet = await gamificationDb.wallets.get(currentUser.id)

      setTasks(availableTasks)
      setAttempts(todayAttempts)
      setWallet(userWallet || null)
    } catch (error) {
      console.error('Error loading quest data:', error)
    } finally {
      setLoading(false)
    }
  }

  const getTaskStatus = (task: GameTask) => {
    const taskAttempts = attempts.filter(a => a.taskCode === task.code)
    const inProgress = taskAttempts.find(a => a.status === 'in_progress')
    const completedToday = taskAttempts.filter(a => a.status === 'completed' || a.status === 'verified').length
    
    if (inProgress) return 'in_progress'
    if (task.maxPerDay && completedToday >= task.maxPerDay) return 'daily_limit'
    
    // Check cooldown
    if (task.cooldownMinutes && task.cooldownMinutes > 0) {
      const lastAttempt = taskAttempts
        .filter(a => a.finishedAt)
        .sort((a, b) => b.finishedAt!.localeCompare(a.finishedAt!))[0]
      
      if (lastAttempt) {
        const cooldownEnd = new Date(lastAttempt.finishedAt!)
        cooldownEnd.setMinutes(cooldownEnd.getMinutes() + task.cooldownMinutes)
        if (new Date() < cooldownEnd) return 'cooldown'
      }
    }
    
    return 'available'
  }

  const getStatusDisplay = (task: GameTask, status: string) => {
    const taskAttempts = attempts.filter(a => a.taskCode === task.code)
    const completedToday = taskAttempts.filter(a => a.status === 'completed' || a.status === 'verified').length

    switch (status) {
      case 'in_progress':
        return { text: 'In Progress', color: 'text-blue-600 bg-blue-50', icon: PlayIcon }
      case 'daily_limit':
        return { text: `Completed (${completedToday}/${task.maxPerDay})`, color: 'text-green-600 bg-green-50', icon: CheckCircleIcon }
      case 'cooldown':
        return { text: 'Cooling Down', color: 'text-orange-600 bg-orange-50', icon: ClockIcon }
      case 'available':
        return { text: 'Available', color: 'text-emerald-600 bg-emerald-50', icon: StarIcon }
      default:
        return { text: 'Available', color: 'text-gray-600 bg-gray-50', icon: StarIcon }
    }
  }

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'clinic-flow': return '🏥'
      case 'inventory': return '📦'
      case 'knowledge': return '🧠'
      case 'community': return '🤝'
      default: return '⭐'
    }
  }

  const handleStartQuest = (task: GameTask) => {
    if (onStartQuest) {
      onStartQuest(task)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading quests...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header with Wallet Info */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <TrophyIcon className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Quest Board</h1>
            <p className="text-gray-600">Complete tasks to earn tokens and badges</p>
          </div>
        </div>
        
        {wallet && (
          <div className="flex items-center space-x-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-primary">{wallet.tokens}</div>
              <div className="text-sm text-gray-600">Tokens</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600">Level {wallet.level}</div>
              <div className="text-sm text-gray-600">Current Level</div>
            </div>
            <div className="text-center flex items-center space-x-1">
              <FireIcon className="h-5 w-5 text-red-500" />
              <div className="text-xl font-bold text-red-600">{wallet.streakDays}</div>
              <div className="text-sm text-gray-600">Day Streak</div>
            </div>
          </div>
        )}
      </div>

      {/* Tab Navigation */}
      <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg">
        {[
          { key: 'daily', label: 'Daily Quests' },
          { key: 'weekly', label: 'Weekly Challenges' },
          { key: 'event', label: 'Special Events' }
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-white text-primary shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Quest Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {tasks.map(task => {
          const status = getTaskStatus(task)
          const statusDisplay = getStatusDisplay(task, status)
          const StatusIcon = statusDisplay.icon
          const isAvailable = status === 'available'
          
          return (
            <div
              key={task.id}
              className={`card transition-all hover:shadow-lg ${
                isAvailable ? 'border-emerald-200 hover:border-emerald-300' : 'border-gray-200'
              }`}
            >
              {/* Task Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <div className="text-2xl">{getCategoryIcon(task.category)}</div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{task.title}</h3>
                    <p className="text-sm text-gray-600 capitalize">{task.category.replace('-', ' ')}</p>
                  </div>
                </div>
                <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${statusDisplay.color}`}>
                  <StatusIcon className="h-3 w-3 mr-1" />
                  {statusDisplay.text}
                </span>
              </div>

              {/* Task Description */}
              <p className="text-sm text-gray-700 mb-4">{task.description}</p>

              {/* Task Details */}
              <div className="flex items-center justify-between text-sm text-gray-600 mb-4">
                <div className="flex items-center space-x-1">
                  <ClockIcon className="h-4 w-4" />
                  <span>Est. {task.estimatedMinutes} min</span>
                </div>
                <div className="flex items-center space-x-1">
                  <BoltIcon className="h-4 w-4 text-yellow-500" />
                  <span className="font-medium text-primary">{task.baseTokens} tokens</span>
                </div>
              </div>

              {/* Progress Info */}
              {task.maxPerDay && (
                <div className="mb-4">
                  <div className="flex justify-between text-xs text-gray-600 mb-1">
                    <span>Daily Progress</span>
                    <span>{attempts.filter(a => a.taskCode === task.code && (a.status === 'completed' || a.status === 'verified')).length}/{task.maxPerDay}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-primary h-2 rounded-full transition-all"
                      style={{ 
                        width: `${Math.min(100, (attempts.filter(a => a.taskCode === task.code && (a.status === 'completed' || a.status === 'verified')).length / task.maxPerDay) * 100)}%` 
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Action Button */}
              <button
                onClick={() => handleStartQuest(task)}
                disabled={!isAvailable}
                className={`w-full py-2 px-4 rounded-lg font-medium transition-colors ${
                  isAvailable
                    ? 'bg-primary text-white hover:bg-primary/90'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}
              >
                {status === 'in_progress' ? 'Continue Quest' : 'Start Quest'}
              </button>
            </div>
          )
        })}
      </div>

      {/* Empty State */}
      {tasks.length === 0 && (
        <div className="text-center py-12">
          <TrophyIcon className="h-12 w-12 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Quests Available</h3>
          <p className="text-gray-600">Check back later for new challenges!</p>
        </div>
      )}
    </div>
  )
}