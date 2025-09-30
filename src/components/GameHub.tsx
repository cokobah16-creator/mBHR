import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { db } from '@/db'
import { GamificationService } from '@/services/gamification'
import { 
  TrophyIcon, 
  FireIcon,
  StarIcon,
  ClockIcon,
  HeartIcon,
  CubeIcon,
  AcademicCapIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline'

interface GameHubProps {
  className?: string
}

export function GameHub({ className = '' }: GameHubProps) {
  const { currentUser } = useAuthStore()
  const [wallet, setWallet] = useState<any>(null)
  const [pendingSessions, setPendingSessions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (currentUser) {
      loadGameData()
    }
  }, [currentUser])

  const loadGameData = async () => {
    if (!currentUser) return

    try {
      const [walletData, sessionsData] = await Promise.all([
        db.gamificationWallets.get(currentUser.id),
        db.gameSessions
          .where('volunteerId')
          .equals(currentUser.id)
          .and(session => !session.committed && session.finishedAt)
          .toArray()
      ])

      setWallet(walletData)
      setPendingSessions(sessionsData)
    } catch (error) {
      console.error('Error loading game data:', error)
    } finally {
      setLoading(false)
    }
  }

  const games = [
    {
      id: 'vitals',
      name: 'Vitals Precision',
      description: 'Validate vital signs with accuracy bonuses',
      icon: HeartIcon,
      color: 'bg-green-500 hover:bg-green-600',
      baseTokens: 8,
      estimatedMinutes: 3,
      href: '/games/vitals-precision'
    },
    {
      id: 'shelf',
      name: 'Shelf Sleuth',
      description: 'Verify inventory counts and find discrepancies',
      icon: CubeIcon,
      color: 'bg-blue-500 hover:bg-blue-600',
      baseTokens: 12,
      estimatedMinutes: 5,
      href: '/games/shelf-sleuth'
    },
    {
      id: 'quiz',
      name: 'Knowledge Blitz',
      description: '60-second protocol and procedure quizzes',
      icon: AcademicCapIcon,
      color: 'bg-purple-500 hover:bg-purple-600',
      baseTokens: 10,
      estimatedMinutes: 1,
      href: '/games/knowledge-blitz'
    },
    {
      id: 'triage',
      name: 'Triage Sprint',
      description: 'Quick priority assessment challenges',
      icon: ExclamationTriangleIcon,
      color: 'bg-orange-500 hover:bg-orange-600',
      baseTokens: 15,
      estimatedMinutes: 2,
      href: '/games/triage-sprint'
    }
  ]

  if (loading) {
    return (
      <div className={`space-y-6 ${className}`}>
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-48 mb-4"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-32 bg-gray-200 rounded-lg"></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header with Wallet Info */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <TrophyIcon className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Game Hub</h1>
            <p className="text-gray-600">Earn tokens and badges through clinic work</p>
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

      {/* Pending Approvals Alert */}
      {pendingSessions.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-center space-x-2">
            <ClockIcon className="h-5 w-5 text-yellow-600" />
            <div>
              <h3 className="text-sm font-medium text-yellow-800">
                Pending Approval ({pendingSessions.length} sessions)
              </h3>
              <p className="text-sm text-yellow-700">
                Your completed game sessions are waiting for supervisor approval to mint tokens.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Game Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {games.map((game) => (
          <Link
            key={game.id}
            to={game.href}
            className={`${game.color} text-white rounded-lg p-6 transition-all hover:scale-105 transform group`}
          >
            <div className="text-center">
              <game.icon className="h-12 w-12 mx-auto mb-4 group-hover:scale-110 transition-transform" />
              <h3 className="text-lg font-bold mb-2">{game.name}</h3>
              <p className="text-sm opacity-90 mb-4">{game.description}</p>
              
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center space-x-1">
                  <ClockIcon className="h-4 w-4" />
                  <span>{game.estimatedMinutes} min</span>
                </div>
                <div className="flex items-center space-x-1">
                  <StarIcon className="h-4 w-4" />
                  <span>{game.baseTokens} tokens</span>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Recent Badges */}
      {wallet?.badges.length > 0 && (
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Badges</h3>
          <div className="flex flex-wrap gap-2">
            {wallet.badges.slice(-6).map((badge: string, index: number) => (
              <span
                key={index}
                className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-purple-100 text-purple-800"
              >
                🏆 {badge.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Getting Started */}
      {!wallet && (
        <div className="card bg-blue-50 border-blue-200">
          <div className="text-center py-8">
            <TrophyIcon className="h-12 w-12 mx-auto text-blue-600 mb-4" />
            <h3 className="text-lg font-medium text-blue-800 mb-2">Welcome to the Game Hub!</h3>
            <p className="text-blue-700 mb-4">
              Complete your first game to start earning tokens and badges.
            </p>
            <p className="text-sm text-blue-600">
              All games are based on real clinic work - you're helping patients while having fun!
            </p>
          </div>
        </div>
      )}
    </div>
  )
}