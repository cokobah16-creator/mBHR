import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
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
}

export default function VitalsPrecision() {
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

  // Sample vital cases (in production, these would come from database)
  const vitalCases: VitalCase[] = [
    {
      id: '1',
      patientAge: 35,
      patientSex: 'M',
      scenario: 'Adult male presenting with chest pain',
      vitals: { hr: 110, temp: 37.2, sbp: 150, dbp: 95, rr: 22, spo2: 97 }
    },
    {
      id: '2',
      patientAge: 8,
      patientSex: 'F',
      scenario: 'Child with fever and cough',
      vitals: { hr: 130, temp: 39.1, sbp: 95, dbp: 60, rr: 28, spo2: 95 }
    },
    {
      id: '3',
      patientAge: 65,
      patientSex: 'F',
      scenario: 'Elderly woman routine check',
      vitals: { hr: 72, temp: 36.8, sbp: 135, dbp: 85, rr: 16, spo2: 98 }
    },
    {
      id: '4',
      patientAge: 25,
      patientSex: 'M',
      scenario: 'Young athlete post-exercise',
      vitals: { hr: 95, temp: 37.0, sbp: 120, dbp: 75, rr: 18, spo2: 99 }
    },
    {
      id: '5',
      patientAge: 45,
      patientSex: 'F',
      scenario: 'Woman with headache',
      vitals: { hr: 88, temp: 36.5, sbp: 165, dbp: 100, rr: 20, spo2: 98 }
    }
  ]

  useEffect(() => {
    if (gameStarted && timeLeft > 0) {
      const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000)
      return () => clearTimeout(timer)
    } else if (timeLeft === 0) {
      endGame()
    }
  }, [gameStarted, timeLeft])

  const startGame = async () => {
    if (!currentUser) return

    try {
      const session = await GamificationService.startSession('vitals', currentUser.id, {
        totalCases: vitalCases.length,
        startTime: new Date().toISOString()
      })

      setCurrentSession(session)
      setCurrentCase(vitalCases[0])
      setCaseIndex(0)
      setGameStarted(true)
      setTimeLeft(300)
      setSessionStats({ correct: 0, total: 0, streak: 0, maxStreak: 0 })
      setUserAnswers({})
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
      }, 1000)
    }
  }

  const checkAnswer = (vitalCase: VitalCase, metric: string, answer: 'normal' | 'abnormal'): boolean => {
    const value = vitalCase.vitals[metric as keyof typeof vitalCase.vitals]
    if (!value) return false

    // Simplified normal ranges (in production, use vitalsRanges table)
    const ranges = {
      hr: { min: 60, max: 100 },
      temp: { min: 36.1, max: 37.2 },
      sbp: { min: 90, max: 140 },
      dbp: { min: 60, max: 90 },
      rr: { min: 12, max: 20 },
      spo2: { min: 95, max: 100 }
    }

    const range = ranges[metric as keyof typeof ranges]
    if (!range) return false

    const isNormal = value >= range.min && value <= range.max
    return (answer === 'normal') === isNormal
  }

  const endGame = async () => {
    if (!currentSession || !currentUser) return

    try {
      const accuracy = sessionStats.total > 0 ? sessionStats.correct / sessionStats.total : 0
      const timeBonus = timeLeft > 0 ? 1.1 : 1.0
      const streakBonus = sessionStats.maxStreak >= 5 ? 1.2 : 1.0

      const wallet = await db.gamificationWallets.get(currentUser.id)
      const tokensEarned = GamificationService.calculateTokens(8, {
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

      // Show results
      alert(`🎉 Vitals Precision Complete!\n\nAccuracy: ${Math.round(accuracy * 100)}%\nMax Streak: ${sessionStats.maxStreak}\nTokens Earned: ${tokensEarned}\n\nWaiting for supervisor approval...`)
      
      navigate('/games')
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
            <p className="text-gray-600">Test your ability to identify abnormal vital signs</p>
          </div>
        </div>

        <div className="card max-w-2xl mx-auto">
          <div className="text-center py-8">
            <HeartIcon className="h-16 w-16 mx-auto text-green-500 mb-4" />
            <h2 className="text-xl font-bold text-gray-900 mb-4">Ready to Start?</h2>
            
            <div className="space-y-4 text-left max-w-md mx-auto mb-6">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                  <span className="text-blue-600 font-semibold text-sm">1</span>
                </div>
                <p className="text-gray-700">Review {vitalCases.length} patient scenarios</p>
              </div>
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                  <span className="text-blue-600 font-semibold text-sm">2</span>
                </div>
                <p className="text-gray-700">Identify normal vs abnormal vital signs</p>
              </div>
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                  <span className="text-blue-600 font-semibold text-sm">3</span>
                </div>
                <p className="text-gray-700">Earn tokens based on accuracy and speed</p>
              </div>
            </div>

            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
              <div className="text-sm text-green-800">
                <div className="font-medium mb-1">💡 Scoring:</div>
                <ul className="text-xs space-y-1 text-green-700">
                  <li>• Base: 8 tokens</li>
                  <li>• Accuracy bonus: up to +30%</li>
                  <li>• Speed bonus: +10% if time remaining</li>
                  <li>• Streak bonus: +20% for 5+ correct in a row</li>
                </ul>
              </div>
            </div>

            <button onClick={startGame} className="btn-primary">
              Start Vitals Precision
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
            <div className="text-xl font-bold text-red-600">{formatTime(timeLeft)}</div>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div 
          className="bg-primary h-2 rounded-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Case Card */}
      <div className="card max-w-4xl mx-auto">
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(currentCase.vitals).map(([metric, value]) => {
            const answered = userAnswers[`${currentCase.id}_${metric}`]
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
                    ? 'border-green-200 bg-green-50' 
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="text-center mb-4">
                  <h3 className="font-medium text-gray-900">
                    {metricLabels[metric as keyof typeof metricLabels]}
                  </h3>
                  <div className="text-3xl font-bold text-primary mt-2">
                    {value}
                    <span className="text-lg text-gray-600 ml-1">
                      {metricUnits[metric as keyof typeof metricUnits]}
                    </span>
                  </div>
                </div>

                {answered ? (
                  <div className="flex items-center justify-center space-x-2">
                    {answered === 'normal' ? (
                      <CheckCircleIcon className="h-5 w-5 text-green-600" />
                    ) : (
                      <XCircleIcon className="h-5 w-5 text-red-600" />
                    )}
                    <span className="text-sm font-medium capitalize text-gray-700">
                      {answered}
                    </span>
                  </div>
                ) : (
                  <div className="flex space-x-2">
                    <button
                      onClick={() => submitAnswer(metric, 'normal')}
                      className="flex-1 bg-green-100 text-green-800 py-2 px-3 rounded-lg hover:bg-green-200 transition-colors text-sm font-medium"
                    >
                      Normal
                    </button>
                    <button
                      onClick={() => submitAnswer(metric, 'abnormal')}
                      className="flex-1 bg-red-100 text-red-800 py-2 px-3 rounded-lg hover:bg-red-200 transition-colors text-sm font-medium"
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