import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useT } from '@/hooks/useT'
import { useAuthStore } from '@/stores/auth'
import { db, generateId } from '@/db'
import { GamificationService } from '@/services/gamification'
import { 
  ExclamationTriangleIcon,
  ClockIcon,
  HeartIcon,
  UserIcon,
  FireIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline'

interface TriageCase {
  id: string
  scenario: string
  patientAge: number
  patientSex: 'M' | 'F'
  symptoms: string[]
  vitals: {
    conscious: boolean
    breathing: boolean
    pulse: 'weak' | 'normal' | 'strong'
    skinColor: 'normal' | 'pale' | 'cyanotic'
  }
  correctPriority: 'urgent' | 'normal' | 'low'
  explanation: string
}

export default function TriageSprint() {
  const { t } = useT()
  const { currentUser } = useAuthStore()
  const navigate = useNavigate()
  const [currentSession, setCurrentSession] = useState<any>(null)
  const [currentCase, setCurrentCase] = useState<TriageCase | null>(null)
  const [caseIndex, setCaseIndex] = useState(0)
  const [selectedPriority, setSelectedPriority] = useState<'urgent' | 'normal' | 'low' | null>(null)
  const [sessionStats, setSessionStats] = useState({
    correct: 0,
    total: 0,
    streak: 0,
    maxStreak: 0
  })
  const [timeLeft, setTimeLeft] = useState(120) // 2 minutes per case
  const [gameStarted, setGameStarted] = useState(false)
  const [showResult, setShowResult] = useState(false)

  // Sample triage cases
  const triageCases: TriageCase[] = [
    {
      id: '1',
      scenario: 'Adult male collapsed at home',
      patientAge: 45,
      patientSex: 'M',
      symptoms: ['chest pain', 'difficulty breathing', 'sweating'],
      vitals: {
        conscious: true,
        breathing: true,
        pulse: 'weak',
        skinColor: 'pale'
      },
      correctPriority: 'urgent',
      explanation: 'Chest pain with breathing difficulty and weak pulse suggests cardiac emergency'
    },
    {
      id: '2',
      scenario: 'Child with fever and cough',
      patientAge: 6,
      patientSex: 'F',
      symptoms: ['fever', 'cough', 'runny nose'],
      vitals: {
        conscious: true,
        breathing: true,
        pulse: 'normal',
        skinColor: 'normal'
      },
      correctPriority: 'normal',
      explanation: 'Common cold symptoms in stable child - routine care appropriate'
    },
    {
      id: '3',
      scenario: 'Elderly woman with minor cut',
      patientAge: 70,
      patientSex: 'F',
      symptoms: ['small laceration', 'no bleeding'],
      vitals: {
        conscious: true,
        breathing: true,
        pulse: 'normal',
        skinColor: 'normal'
      },
      correctPriority: 'low',
      explanation: 'Minor wound in stable patient can wait for routine care'
    },
    {
      id: '4',
      scenario: 'Unconscious patient brought by family',
      patientAge: 30,
      patientSex: 'M',
      symptoms: ['unconscious', 'unknown cause'],
      vitals: {
        conscious: false,
        breathing: true,
        pulse: 'weak',
        skinColor: 'pale'
      },
      correctPriority: 'urgent',
      explanation: 'Unconsciousness requires immediate assessment and intervention'
    },
    {
      id: '5',
      scenario: 'Pregnant woman with contractions',
      patientAge: 28,
      patientSex: 'F',
      symptoms: ['regular contractions', 'back pain'],
      vitals: {
        conscious: true,
        breathing: true,
        pulse: 'strong',
        skinColor: 'normal'
      },
      correctPriority: 'urgent',
      explanation: 'Active labor requires immediate obstetric care'
    }
  ]

  useEffect(() => {
    if (gameStarted && timeLeft > 0 && !showResult) {
      const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000)
      return () => clearTimeout(timer)
    } else if (timeLeft === 0 && !showResult) {
      submitAnswer()
    }
  }, [gameStarted, timeLeft, showResult])

  const startGame = async () => {
    if (!currentUser) return

    try {
      // Shuffle cases and take 3
      const shuffled = [...triageCases].sort(() => Math.random() - 0.5).slice(0, 3)
      
      const session = await GamificationService.startSession('triage', currentUser.id, {
        totalCases: shuffled.length,
        startTime: new Date().toISOString()
      })

      setCurrentSession(session)
      setCurrentCase(shuffled[0])
      setCaseIndex(0)
      setGameStarted(true)
      setTimeLeft(120)
      setSessionStats({ correct: 0, total: 0, streak: 0, maxStreak: 0 })
      setSelectedPriority(null)
      setShowResult(false)
    } catch (error) {
      console.error('Error starting triage sprint:', error)
    }
  }

  const submitAnswer = async () => {
    if (!currentCase || !currentSession) return

    const isCorrect = selectedPriority === currentCase.correctPriority
    const newStats = {
      ...sessionStats,
      total: sessionStats.total + 1,
      correct: sessionStats.correct + (isCorrect ? 1 : 0),
      streak: isCorrect ? sessionStats.streak + 1 : 0,
      maxStreak: Math.max(sessionStats.maxStreak, isCorrect ? sessionStats.streak + 1 : sessionStats.streak)
    }
    setSessionStats(newStats)

    // Show feedback
    setTimeout(() => {
      if (caseIndex < triageCases.length - 1) {
        setCaseIndex(caseIndex + 1)
        setCurrentCase(triageCases[caseIndex + 1])
        setSelectedPriority(null)
        setTimeLeft(120)
      } else {
        endGame()
      }
    }, 2000)
  }

  const endGame = async () => {
    if (!currentSession || !currentUser) return

    try {
      setShowResult(true)
      
      const accuracy = sessionStats.total > 0 ? sessionStats.correct / sessionStats.total : 0
      const timeBonus = timeLeft > 30 ? 1.1 : 1.0
      const streakBonus = sessionStats.maxStreak >= 3 ? 1.2 : 1.0

      const wallet = await db.gamificationWallets.get(currentUser.id)
      const tokensEarned = GamificationService.calculateTokens(15, {
        accuracy,
        streak: wallet?.streakDays || 0,
        speedBonus: timeBonus,
        qualityBonus: streakBonus
      })

      await GamificationService.completeSession(currentSession.id, {
        score: Math.round(accuracy * 100),
        tokensEarned,
        badges: [],
        multipliers: { accuracy, speed: timeBonus, quality: streakBonus }
      })

      // Auto-navigate after showing results
      setTimeout(() => {
        navigate('/games')
      }, 5000)

    } catch (error) {
      console.error('Error ending game:', error)
    }
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const getPriorityColor = (priority: 'urgent' | 'normal' | 'low') => {
    switch (priority) {
      case 'urgent':
        return 'bg-red-500 hover:bg-red-600 text-white'
      case 'normal':
        return 'bg-yellow-500 hover:bg-yellow-600 text-white'
      case 'low':
        return 'bg-green-500 hover:bg-green-600 text-white'
    }
  }

  const getPriorityIcon = (priority: 'urgent' | 'normal' | 'low') => {
    switch (priority) {
      case 'urgent':
        return '🚨'
      case 'normal':
        return '⚠️'
      case 'low':
        return '✅'
    }
  }

  if (!gameStarted) {
    return (
      <div className="space-y-6">
        <div className="flex items-center space-x-3">
          <ExclamationTriangleIcon className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Triage Sprint</h1>
            <p className="text-gray-600">Quick priority assessment challenges</p>
          </div>
        </div>

        <div className="card max-w-2xl mx-auto">
          <div className="text-center py-8">
            <ExclamationTriangleIcon className="h-16 w-16 mx-auto text-orange-500 mb-4" />
            <h2 className="text-xl font-bold text-gray-900 mb-4">Ready for Triage Training?</h2>
            
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-6">
              <div className="text-sm text-orange-800">
                <div className="font-medium mb-2">🚨 Challenge Rules:</div>
                <ul className="text-xs space-y-1 text-orange-700 text-left">
                  <li>• 3 random patient scenarios</li>
                  <li>• 2 minutes per case to assess priority</li>
                  <li>• +15 tokens per correct triage decision</li>
                  <li>• +20% bonus for 3-case streak</li>
                  <li>• +10% speed bonus if time remaining</li>
                  <li>• Focus: ABC assessment and priority</li>
                </ul>
              </div>
            </div>

            <button onClick={startGame} className="btn-primary">
              Start Triage Sprint
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (showResult) {
    const accuracy = Math.round((sessionStats.correct / sessionStats.total) * 100)

    return (
      <div className="space-y-6">
        <div className="flex items-center space-x-3">
          <ExclamationTriangleIcon className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Triage Sprint Complete!</h1>
            <p className="text-gray-600">Excellent work on patient prioritization!</p>
          </div>
        </div>

        <div className="card max-w-2xl mx-auto">
          <div className="text-center py-8">
            <div className="text-6xl mb-4">
              {accuracy >= 80 ? '🏆' : accuracy >= 60 ? '🥈' : '🥉'}
            </div>
            
            <div className="grid grid-cols-3 gap-6 mb-6">
              <div>
                <div className="text-3xl font-bold text-primary">{sessionStats.correct}/{sessionStats.total}</div>
                <div className="text-sm text-gray-600">Correct</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-orange-600">{accuracy}%</div>
                <div className="text-sm text-gray-600">Accuracy</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-red-600">{sessionStats.maxStreak}</div>
                <div className="text-sm text-gray-600">Max Streak</div>
              </div>
            </div>

            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
              <p className="text-green-800 font-medium">
                🎉 Session completed! Waiting for supervisor approval to mint tokens.
              </p>
            </div>

            <button onClick={() => navigate('/games')} className="btn-primary">
              Back to Game Hub
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!currentCase) return null

  const isAnswered = selectedPriority !== null
  const isCorrect = selectedPriority === currentCase.correctPriority

  return (
    <div className="space-y-6">
      {/* Header with Timer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <ExclamationTriangleIcon className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Triage Sprint</h1>
            <p className="text-gray-600">Case {caseIndex + 1} of {triageCases.length}</p>
          </div>
        </div>
        
        <div className="flex items-center space-x-6">
          <div className="text-center">
            <div className="text-2xl font-bold text-primary">{sessionStats.correct}/{sessionStats.total}</div>
            <div className="text-sm text-gray-600">Correct</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-orange-600">{sessionStats.streak}</div>
            <div className="text-sm text-gray-600">Streak</div>
          </div>
          <div className="text-center flex items-center space-x-1">
            <ClockIcon className="h-5 w-5 text-red-500" />
            <div className={`text-2xl font-bold ${timeLeft <= 30 ? 'text-red-600 animate-pulse' : 'text-red-600'}`}>
              {formatTime(timeLeft)}
            </div>
          </div>
        </div>
      </div>

      {/* Case Presentation */}
      <div className="card max-w-4xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Patient Info */}
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-4">Patient Presentation</h2>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center space-x-3 mb-3">
                  <UserIcon className="h-6 w-6 text-blue-600" />
                  <div>
                    <p className="font-medium text-blue-800">
                      {currentCase.patientAge} year old {currentCase.patientSex === 'M' ? 'male' : 'female'}
                    </p>
                  </div>
                </div>
                <p className="text-blue-700 text-lg">{currentCase.scenario}</p>
              </div>
            </div>

            {/* Symptoms */}
            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-3">Symptoms</h3>
              <div className="flex flex-wrap gap-2">
                {currentCase.symptoms.map((symptom, index) => (
                  <span
                    key={index}
                    className="px-3 py-2 bg-gray-100 text-gray-800 rounded-full text-sm font-medium"
                  >
                    {symptom}
                  </span>
                ))}
              </div>
            </div>

            {/* Quick Assessment */}
            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-3">Quick Assessment</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <span className="text-sm font-medium">Conscious:</span>
                  <span className={`text-sm font-bold ${currentCase.vitals.conscious ? 'text-green-600' : 'text-red-600'}`}>
                    {currentCase.vitals.conscious ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <span className="text-sm font-medium">Breathing:</span>
                  <span className={`text-sm font-bold ${currentCase.vitals.breathing ? 'text-green-600' : 'text-red-600'}`}>
                    {currentCase.vitals.breathing ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <span className="text-sm font-medium">Pulse:</span>
                  <span className="text-sm font-bold capitalize">{currentCase.vitals.pulse}</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <span className="text-sm font-medium">Skin Color:</span>
                  <span className="text-sm font-bold capitalize">{currentCase.vitals.skinColor}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Priority Selection */}
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-4">Assign Priority</h2>
              <p className="text-gray-600 mb-6">
                Based on the patient presentation, what priority should this case receive?
              </p>
            </div>

            <div className="space-y-4">
              {(['urgent', 'normal', 'low'] as const).map((priority) => (
                <button
                  key={priority}
                  onClick={() => setSelectedPriority(priority)}
                  disabled={isAnswered}
                  className={`w-full p-6 rounded-xl border-2 transition-all touch-target-large ${
                    selectedPriority === priority
                      ? `${getPriorityColor(priority)} ring-2 ring-primary/20`
                      : 'bg-white border-gray-200 hover:border-gray-300'
                  } ${isAnswered ? 'cursor-not-allowed' : ''}`}
                >
                  <div className="flex items-center space-x-4">
                    <div className="text-4xl">{getPriorityIcon(priority)}</div>
                    <div className="text-left">
                      <div className="text-xl font-bold capitalize">{priority}</div>
                      <div className="text-sm opacity-90">
                        {priority === 'urgent' && 'Immediate attention required'}
                        {priority === 'normal' && 'Standard care pathway'}
                        {priority === 'low' && 'Can wait for routine care'}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* Submit Button */}
            <div className="text-center pt-4">
              <button
                onClick={submitAnswer}
                disabled={!selectedPriority || isAnswered}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Submit Priority Decision
              </button>
            </div>

            {/* Feedback */}
            {isAnswered && (
              <div className={`p-4 rounded-lg border ${
                isCorrect 
                  ? 'bg-green-50 border-green-200' 
                  : 'bg-red-50 border-red-200'
              }`}>
                <div className="flex items-center space-x-2 mb-2">
                  {isCorrect ? (
                    <CheckCircleIcon className="h-5 w-5 text-green-600" />
                  ) : (
                    <ExclamationTriangleIcon className="h-5 w-5 text-red-600" />
                  )}
                  <span className={`font-medium ${isCorrect ? 'text-green-800' : 'text-red-800'}`}>
                    {isCorrect ? 'Correct!' : 'Incorrect'}
                  </span>
                </div>
                <p className={`text-sm ${isCorrect ? 'text-green-700' : 'text-red-700'}`}>
                  <strong>Correct Priority:</strong> {currentCase.correctPriority}
                </p>
                <p className={`text-sm mt-2 ${isCorrect ? 'text-green-700' : 'text-red-700'}`}>
                  {currentCase.explanation}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}