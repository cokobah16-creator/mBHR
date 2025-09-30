import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useT } from '@/hooks/useT'
import { useAuthStore } from '@/stores/auth'
import { db, generateId } from '@/db'
import { GamificationService } from '@/services/gamification'
import { HeartIcon, CheckCircleIcon, XCircleIcon, ClockIcon } from '@heroicons/react/24/outline'

interface VitalCase {
  id: string
  patientAge: number
  patientSex: 'M' | 'F'
  scenario: string
  vitals: {
    hr?: number
    temp?: number
    sbp?: number
    dbp?: number
    rr?: number
    spo2?: number
  }
  normalRanges: {
    hr: [number, number]
    temp: [number, number]
    sbp: [number, number]
    dbp: [number, number]
    rr: [number, number]
    spo2: [number, number]
  }
}

export default function VitalsPrecisionGame() {
  const { t } = useT()
  const { currentUser } = useAuthStore()
  const navigate = useNavigate()
  const [currentSession, setCurrentSession] = useState<any>(null)
  const [currentCase, setCurrentCase] = useState<VitalCase | null>(null)
  const [caseIndex, setCaseIndex] = useState(0)
  const [userAnswers, setUserAnswers] = useState<Record<string, 'normal' | 'abnormal'>>({})
  const [sessionStats, setSessionStats] = useState({
    correct: 0,
    total: 0,
    streak: 0,
    maxStreak: 0
  })
  const [timeLeft, setTimeLeft] = useState(300) // 5 minutes
  const [gameStarted, setGameStarted] = useState(false)
  const [showResult, setShowResult] = useState(false)

  // Enhanced vital cases with age/sex-specific ranges
  const vitalCases: VitalCase[] = [
    {
      id: '1',
      patientAge: 35,
      patientSex: 'M',
      scenario: 'Adult male presenting with chest pain',
      vitals: { hr: 110, temp: 37.2, sbp: 150, dbp: 95, rr: 22, spo2: 97 },
      normalRanges: {
        hr: [60, 100],
        temp: [36.1, 37.2],
        sbp: [90, 140],
        dbp: [60, 90],
        rr: [12, 20],
        spo2: [95, 100]
      }
    },
    {
      id: '2',
      patientAge: 8,
      patientSex: 'F',
      scenario: 'Child with fever and cough',
      vitals: { hr: 130, temp: 39.1, sbp: 95, dbp: 60, rr: 28, spo2: 95 },
      normalRanges: {
        hr: [80, 120],
        temp: [36.1, 37.2],
        sbp: [85, 110],
        dbp: [50, 70],
        rr: [20, 30],
        spo2: [95, 100]
      }
    },
    {
      id: '3',
      patientAge: 65,
      patientSex: 'F',
      scenario: 'Elderly woman routine check',
      vitals: { hr: 72, temp: 36.8, sbp: 135, dbp: 85, rr: 16, spo2: 98 },
      normalRanges: {
        hr: [60, 100],
        temp: [36.1, 37.2],
        sbp: [90, 140],
        dbp: [60, 90],
        rr: [12, 20],
        spo2: [95, 100]
      }
    },
    {
      id: '4',
      patientAge: 25,
      patientSex: 'M',
      scenario: 'Young athlete post-exercise',
      vitals: { hr: 95, temp: 37.0, sbp: 120, dbp: 75, rr: 18, spo2: 99 },
      normalRanges: {
        hr: [60, 100],
        temp: [36.1, 37.2],
        sbp: [90, 140],
        dbp: [60, 90],
        rr: [12, 20],
        spo2: [95, 100]
      }
    },
    {
      id: '5',
      patientAge: 45,
      patientSex: 'F',
      scenario: 'Woman with headache',
      vitals: { hr: 88, temp: 36.5, sbp: 165, dbp: 100, rr: 20, spo2: 98 },
      normalRanges: {
        hr: [60, 100],
        temp: [36.1, 37.2],
        sbp: [90, 140],
        dbp: [60, 90],
        rr: [12, 20],
        spo2: [95, 100]
      }
    }
  ]

  useEffect(() => {
    if (gameStarted && timeLeft > 0 && !showResult) {
      const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000)
      return () => clearTimeout(timer)
    } else if (timeLeft === 0 && !showResult) {
      endGame()
    }
  }, [gameStarted, timeLeft, showResult])

  const startGame = async () => {
    if (!currentUser) return

    try {
      // Shuffle cases and take 5
      const shuffled = [...vitalCases].sort(() => Math.random() - 0.5)
      
      const session = await GamificationService.startSession('vitals', currentUser.id, {
        totalCases: shuffled.length,
        startTime: new Date().toISOString()
      })

      setCurrentSession(session)
      setCurrentCase(shuffled[0])
      setCaseIndex(0)
      setGameStarted(true)
      setTimeLeft(300)
      setSessionStats({ correct: 0, total: 0, streak: 0, maxStreak: 0 })
      setUserAnswers({})
      setShowResult(false)
    } catch (error) {
      console.error('Error starting vitals precision game:', error)
    }
  }

  const submitAnswer = async (metric: string, answer: 'normal' | 'abnormal') => {
    if (!currentCase || !currentSession) return

    const isCorrect = checkAnswer(currentCase, metric, answer)
    const newAnswers = { ...userAnswers, [`${currentCase.id}_${metric}`]: answer }
    setUserAnswers(newAnswers)

    // Update stats
    const newStats = {
      ...sessionStats,
      total: sessionStats.total + 1,
      correct: sessionStats.correct + (isCorrect ? 1 : 0),
      streak: isCorrect ? sessionStats.streak + 1 : 0,
      maxStreak: Math.max(sessionStats.maxStreak, isCorrect ? sessionStats.streak + 1 : sessionStats.streak)
    }
    setSessionStats(newStats)

    // Check if case is complete
    const caseMetrics = Object.keys(currentCase.vitals)
    const caseAnswers = caseMetrics.filter(metric => 
      newAnswers[`${currentCase.id}_${metric}`]
    )

    if (caseAnswers.length === caseMetrics.length) {
      // Move to next case
      setTimeout(() => {
        if (caseIndex < vitalCases.length - 1) {
          setCaseIndex(caseIndex + 1)
          setCurrentCase(vitalCases[caseIndex + 1])
        } else {
          endGame()
        }
      }, 1500)
    }
  }

  const checkAnswer = (vitalCase: VitalCase, metric: string, answer: 'normal' | 'abnormal'): boolean => {
    const value = vitalCase.vitals[metric as keyof typeof vitalCase.vitals]
    if (!value) return false

    const range = vitalCase.normalRanges[metric as keyof typeof vitalCase.normalRanges]
    if (!range) return false

    const isNormal = value >= range[0] && value <= range[1]
    return (answer === 'normal') === isNormal
  }

  const endGame = async () => {
    if (!currentSession || !currentUser) return

    try {
      setShowResult(true)
      
      const accuracy = sessionStats.total > 0 ? sessionStats.correct / sessionStats.total : 0
      const timeBonus = timeLeft > 60 ? 1.1 : 1.0
      const streakBonus = sessionStats.maxStreak >= 8 ? 1.2 : 1.0

      const wallet = await db.gamificationWallets.get(currentUser.id)
      const tokensEarned = GamificationService.calculateTokens(12, {
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

  if (!gameStarted) {
    return (
      <div className="space-y-6">
        <div className="flex items-center space-x-3">
          <HeartIcon className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Vitals Precision</h1>
            <p className="text-gray-600">Enhanced vital signs validation training</p>
          </div>
        </div>

        <div className="card max-w-2xl mx-auto">
          <div className="text-center py-8">
            <HeartIcon className="h-16 w-16 mx-auto text-green-500 mb-4" />
            <h2 className="text-xl font-bold text-gray-900 mb-4">Ready for Enhanced Training?</h2>
            
            <div className="space-y-4 text-left max-w-md mx-auto mb-6">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                  <span className="text-blue-600 font-semibold text-sm">1</span>
                </div>
                <p className="text-gray-700">Review {vitalCases.length} patient scenarios with age/sex context</p>
              </div>
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                  <span className="text-blue-600 font-semibold text-sm">2</span>
                </div>
                <p className="text-gray-700">Identify normal vs abnormal vital signs using clinical ranges</p>
              </div>
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                  <span className="text-blue-600 font-semibold text-sm">3</span>
                </div>
                <p className="text-gray-700">Earn tokens based on accuracy, speed, and streak performance</p>
              </div>
            </div>

            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
              <div className="text-sm text-green-800">
                <div className="font-medium mb-1">💡 Enhanced Scoring:</div>
                <ul className="text-xs space-y-1 text-green-700">
                  <li>• Base: 12 tokens</li>
                  <li>• Accuracy bonus: up to +30%</li>
                  <li>• Speed bonus: +10% if 1+ minute remaining</li>
                  <li>• Streak bonus: +20% for 8+ correct in a row</li>
                  <li>• Age/sex-specific normal ranges</li>
                </ul>
              </div>
            </div>

            <button onClick={startGame} className="btn-primary">
              Start Enhanced Vitals Precision
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
          <HeartIcon className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Vitals Precision Complete!</h1>
            <p className="text-gray-600">Excellent work on clinical assessment!</p>
          </div>
        </div>

        <div className="card max-w-2xl mx-auto">
          <div className="text-center py-8">
            <div className="text-6xl mb-4">
              {accuracy >= 90 ? '🏆' : accuracy >= 75 ? '🥈' : '🥉'}
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
                🎉 Enhanced session completed! Waiting for supervisor approval to mint tokens.
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

  const caseMetrics = Object.keys(currentCase.vitals)
  const answeredMetrics = caseMetrics.filter(metric => 
    userAnswers[`${currentCase.id}_${metric}`]
  )
  const progress = (answeredMetrics.length / caseMetrics.length) * 100

  return (
    <div className="space-y-6">
      {/* Header with Timer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <HeartIcon className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Vitals Precision</h1>
            <p className="text-gray-600">Case {caseIndex + 1} of {vitalCases.length}</p>
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
            <div className={`text-2xl font-bold ${timeLeft <= 60 ? 'text-red-600 animate-pulse' : 'text-red-600'}`}>
              {formatTime(timeLeft)}
            </div>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-gray-200 rounded-full h-3">
        <div 
          className="bg-primary h-3 rounded-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Case Card */}
      <div className="card max-w-5xl mx-auto">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-900 mb-2">Patient Scenario</h2>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-blue-800">
              <strong>Age:</strong> {currentCase.patientAge} years old • 
              <strong>Sex:</strong> {currentCase.patientSex === 'M' ? 'Male' : 'Female'}
            </p>
            <p className="text-blue-700 mt-2">{currentCase.scenario}</p>
          </div>
        </div>

        {/* Vitals Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Object.entries(currentCase.vitals).map(([metric, value]) => {
            const answered = userAnswers[`${currentCase.id}_${metric}`]
            const range = currentCase.normalRanges[metric as keyof typeof currentCase.normalRanges]
            const isNormal = value >= range[0] && value <= range[1]
            const isCorrect = answered && ((answered === 'normal') === isNormal)
            
            const metricLabels = {
              hr: 'Heart Rate',
              temp: 'Temperature',
              sbp: 'Systolic BP',
              dbp: 'Diastolic BP',
              rr: 'Respiratory Rate',
              spo2: 'SpO2'
            }
            const metricUnits = {
              hr: 'bpm',
              temp: '°C',
              sbp: 'mmHg',
              dbp: 'mmHg',
              rr: '/min',
              spo2: '%'
            }

            return (
              <div
                key={metric}
                className={`border rounded-lg p-4 transition-all ${
                  answered 
                    ? isCorrect
                      ? 'border-green-200 bg-green-50' 
                      : 'border-red-200 bg-red-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="text-center mb-4">
                  <h3 className="font-medium text-gray-900">
                    {metricLabels[metric as keyof typeof metricLabels]}
                  </h3>
                  <div className="text-4xl font-bold text-primary mt-2">
                    {value}
                    <span className="text-lg text-gray-600 ml-1">
                      {metricUnits[metric as keyof typeof metricUnits]}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Normal: {range[0]}-{range[1]} {metricUnits[metric as keyof typeof metricUnits]}
                  </div>
                </div>

                {answered ? (
                  <div className="flex items-center justify-center space-x-2">
                    {isCorrect ? (
                      <CheckCircleIcon className="h-5 w-5 text-green-600" />
                    ) : (
                      <XCircleIcon className="h-5 w-5 text-red-600" />
                    )}
                    <span className={`text-sm font-medium capitalize ${isCorrect ? 'text-green-700' : 'text-red-700'}`}>
                      {answered} {isCorrect ? '✓' : '✗'}
                    </span>
                  </div>
                ) : (
                  <div className="flex space-x-2">
                    <button
                      onClick={() => submitAnswer(metric, 'normal')}
                      className="flex-1 bg-green-100 text-green-800 py-3 px-4 rounded-lg hover:bg-green-200 transition-colors font-medium touch-target-large"
                    >
                      Normal
                    </button>
                    <button
                      onClick={() => submitAnswer(metric, 'abnormal')}
                      className="flex-1 bg-red-100 text-red-800 py-3 px-4 rounded-lg hover:bg-red-200 transition-colors font-medium touch-target-large"
                    >
                      Abnormal
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Case Progress */}
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600">
            {answeredMetrics.length} of {caseMetrics.length} vitals assessed
          </p>
          {answeredMetrics.length === caseMetrics.length && caseIndex < vitalCases.length - 1 && (
            <p className="text-sm text-green-600 mt-2">
              ✅ Case complete! Moving to next case...
            </p>
          )}
        </div>
      </div>

      {/* Cancel Button */}
      <div className="text-center">
        <button
          onClick={() => navigate('/games')}
          className="btn-secondary"
        >
          Cancel Game
        </button>
      </div>
    </div>
  )
}