import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { db } from '@/db'
import { GamificationService } from '@/services/gamification'
import { AcademicCapIcon, ClockIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline'

interface QuizQuestion {
  id: string
  topic: string
  difficulty: 'easy' | 'medium' | 'hard'
  stem: string
  choices: string[]
  answerIndex: number
  explanation: string
}

export default function KnowledgeBlitz() {
  const { currentUser } = useAuthStore()
  const navigate = useNavigate()
  const [currentSession, setCurrentSession] = useState<any>(null)
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null)
  const [answers, setAnswers] = useState<number[]>([])
  const [timeLeft, setTimeLeft] = useState(60) // 60 seconds
  const [gameStarted, setGameStarted] = useState(false)
  const [showResult, setShowResult] = useState(false)
  const [streak, setStreak] = useState(0)
  const [maxStreak, setMaxStreak] = useState(0)

  // Sample questions (in production, these would come from database)
  const questionBank: QuizQuestion[] = [
    {
      id: '1',
      topic: 'vital_signs',
      difficulty: 'easy',
      stem: 'What is the normal resting heart rate range for adults?',
      choices: ['40-60 bpm', '60-100 bpm', '100-120 bpm', '120-140 bpm'],
      answerIndex: 1,
      explanation: 'Normal adult resting heart rate is 60-100 beats per minute.'
    },
    {
      id: '2',
      topic: 'medication',
      difficulty: 'medium',
      stem: 'Which medication should be stored in a cool, dry place?',
      choices: ['Paracetamol tablets', 'Insulin vials', 'Cough syrup', 'All of the above'],
      answerIndex: 3,
      explanation: 'All medications should be stored properly to maintain efficacy.'
    },
    {
      id: '3',
      topic: 'infection_control',
      difficulty: 'easy',
      stem: 'How long should you wash your hands with soap?',
      choices: ['5 seconds', '10 seconds', '20 seconds', '30 seconds'],
      answerIndex: 2,
      explanation: 'Proper handwashing requires at least 20 seconds with soap and water.'
    },
    {
      id: '4',
      topic: 'triage',
      difficulty: 'medium',
      stem: 'A patient with chest pain and difficulty breathing should be triaged as:',
      choices: ['Low priority', 'Normal priority', 'Urgent priority', 'Can wait'],
      answerIndex: 2,
      explanation: 'Chest pain with breathing difficulty indicates potential cardiac emergency.'
    },
    {
      id: '5',
      topic: 'pharmacy',
      difficulty: 'hard',
      stem: 'FEFO stands for:',
      choices: ['First Expired, First Out', 'First Entry, First Out', 'Fast Expiry, Fast Out', 'Final Entry, Final Out'],
      answerIndex: 0,
      explanation: 'FEFO ensures medications closest to expiry are dispensed first.'
    },
    {
      id: '6',
      topic: 'vital_signs',
      difficulty: 'medium',
      stem: 'Normal body temperature range is:',
      choices: ['35.0-36.0°C', '36.1-37.2°C', '37.3-38.0°C', '38.1-39.0°C'],
      answerIndex: 1,
      explanation: 'Normal body temperature ranges from 36.1°C to 37.2°C.'
    },
    {
      id: '7',
      topic: 'workflow',
      difficulty: 'easy',
      stem: 'What is the correct patient flow sequence?',
      choices: ['Registration → Pharmacy → Vitals → Consult', 'Registration → Vitals → Consult → Pharmacy', 'Vitals → Registration → Consult → Pharmacy', 'Consult → Vitals → Registration → Pharmacy'],
      answerIndex: 1,
      explanation: 'Patients flow from Registration → Vitals → Consultation → Pharmacy.'
    },
    {
      id: '8',
      topic: 'safety',
      difficulty: 'medium',
      stem: 'If a patient reports an allergy to penicillin, you should:',
      choices: ['Give them penicillin anyway', 'Note it clearly in their record', 'Ignore the information', 'Ask them to prove it'],
      answerIndex: 1,
      explanation: 'Drug allergies must be clearly documented to prevent adverse reactions.'
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
      // Shuffle questions and take 5
      const shuffled = [...questionBank].sort(() => Math.random() - 0.5).slice(0, 5)
      
      const session = await GamificationService.startSession('quiz', currentUser.id, {
        totalQuestions: shuffled.length,
        startTime: new Date().toISOString()
      })

      setCurrentSession(session)
      setQuestions(shuffled)
      setCurrentQuestionIndex(0)
      setGameStarted(true)
      setTimeLeft(60)
      setAnswers([])
      setSelectedAnswer(null)
      setStreak(0)
      setMaxStreak(0)
      setShowResult(false)
    } catch (error) {
      console.error('Error starting knowledge blitz:', error)
    }
  }

  const submitAnswer = () => {
    if (selectedAnswer === null) return

    const isCorrect = selectedAnswer === questions[currentQuestionIndex].answerIndex
    const newAnswers = [...answers, selectedAnswer]
    setAnswers(newAnswers)

    // Update streak
    const newStreak = isCorrect ? streak + 1 : 0
    setStreak(newStreak)
    setMaxStreak(Math.max(maxStreak, newStreak))

    // Move to next question or end game
    if (currentQuestionIndex < questions.length - 1) {
      setTimeout(() => {
        setCurrentQuestionIndex(currentQuestionIndex + 1)
        setSelectedAnswer(null)
      }, 1000)
    } else {
      setTimeout(() => {
        endGame()
      }, 1000)
    }
  }

  const endGame = async () => {
    if (!currentSession || !currentUser) return

    try {
      setShowResult(true)
      
      const correctAnswers = answers.filter((answer, index) => 
        answer === questions[index]?.answerIndex
      ).length
      
      const accuracy = correctAnswers / questions.length
      const timeBonus = timeLeft >= 10 ? 1.1 : 1.0
      const streakBonus = maxStreak >= 5 ? 1.2 : 1.0

      const wallet = await db.gamificationWallets.get(currentUser.id)
      const tokensEarned = GamificationService.calculateTokens(10, {
        accuracy,
        streak: wallet?.streakDays || 0,
        speedBonus: timeBonus,
        qualityBonus: streakBonus
      })

      await GamificationService.completeSession(currentSession.id, {
        score: correctAnswers,
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

  if (!gameStarted) {
    return (
      <div className="space-y-6">
        <div className="flex items-center space-x-3">
          <AcademicCapIcon className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Knowledge Blitz</h1>
            <p className="text-gray-600">60-second rapid-fire quiz on protocols and procedures</p>
          </div>
        </div>

        <div className="card max-w-2xl mx-auto">
          <div className="text-center py-8">
            <AcademicCapIcon className="h-16 w-16 mx-auto text-purple-500 mb-4" />
            <h2 className="text-xl font-bold text-gray-900 mb-4">Ready for the Blitz?</h2>
            
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-6">
              <div className="text-sm text-purple-800">
                <div className="font-medium mb-2">⚡ Challenge Rules:</div>
                <ul className="text-xs space-y-1 text-purple-700 text-left">
                  <li>• 5 random questions in 60 seconds</li>
                  <li>• +2 tokens per correct answer</li>
                  <li>• +5 bonus for 5-question streak</li>
                  <li>• +10% speed bonus if 10+ seconds remain</li>
                  <li>• Topics: vitals, meds, protocols, safety</li>
                </ul>
              </div>
            </div>

            <button onClick={startGame} className="btn-primary">
              Start Knowledge Blitz
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (showResult) {
    const correctAnswers = answers.filter((answer, index) => 
      answer === questions[index]?.answerIndex
    ).length
    const accuracy = Math.round((correctAnswers / questions.length) * 100)

    return (
      <div className="space-y-6">
        <div className="flex items-center space-x-3">
          <AcademicCapIcon className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Knowledge Blitz Complete!</h1>
            <p className="text-gray-600">Great job! Here are your results:</p>
          </div>
        </div>

        <div className="card max-w-2xl mx-auto">
          <div className="text-center py-8">
            <div className="text-6xl mb-4">
              {accuracy >= 80 ? '🏆' : accuracy >= 60 ? '🥈' : '🥉'}
            </div>
            
            <div className="grid grid-cols-3 gap-6 mb-6">
              <div>
                <div className="text-3xl font-bold text-primary">{correctAnswers}/{questions.length}</div>
                <div className="text-sm text-gray-600">Correct</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-orange-600">{accuracy}%</div>
                <div className="text-sm text-gray-600">Accuracy</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-red-600">{maxStreak}</div>
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

  const currentQuestion = questions[currentQuestionIndex]
  if (!currentQuestion) return null

  return (
    <div className="space-y-6">
      {/* Header with Timer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <AcademicCapIcon className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Knowledge Blitz</h1>
            <p className="text-gray-600">Question {currentQuestionIndex + 1} of {questions.length}</p>
          </div>
        </div>
        
        <div className="flex items-center space-x-6">
          <div className="text-center">
            <div className="text-2xl font-bold text-primary">{answers.filter((answer, index) => answer === questions[index]?.answerIndex).length}</div>
            <div className="text-sm text-gray-600">Correct</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-orange-600">{streak}</div>
            <div className="text-sm text-gray-600">Streak</div>
          </div>
          <div className="text-center flex items-center space-x-1">
            <ClockIcon className="h-5 w-5 text-red-500" />
            <div className={`text-2xl font-bold ${timeLeft <= 10 ? 'text-red-600 animate-pulse' : 'text-red-600'}`}>
              {timeLeft}s
            </div>
          </div>
        </div>
      </div>

      {/* Question Card */}
      <div className="card max-w-3xl mx-auto">
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-purple-100 text-purple-800 capitalize">
              {currentQuestion.topic.replace('_', ' ')} • {currentQuestion.difficulty}
            </span>
            <div className="text-sm text-gray-500">
              {currentQuestionIndex + 1}/{questions.length}
            </div>
          </div>
          
          <h2 className="text-xl font-bold text-gray-900 mb-4">
            {currentQuestion.stem}
          </h2>
        </div>

        {/* Answer Choices */}
        <div className="space-y-3 mb-6">
          {currentQuestion.choices.map((choice, index) => (
            <button
              key={index}
              onClick={() => setSelectedAnswer(index)}
              className={`w-full text-left p-4 rounded-lg border transition-all ${
                selectedAnswer === index
                  ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center space-x-3">
                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                  selectedAnswer === index
                    ? 'border-primary bg-primary text-white'
                    : 'border-gray-300'
                }`}>
                  <span className="text-sm font-medium">
                    {String.fromCharCode(65 + index)}
                  </span>
                </div>
                <span className="text-gray-900">{choice}</span>
              </div>
            </button>
          ))}
        </div>

        {/* Submit Button */}
        <div className="text-center">
          <button
            onClick={submitAnswer}
            disabled={selectedAnswer === null}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Submit Answer
          </button>
        </div>
      </div>

      {/* Progress Indicator */}
      <div className="max-w-3xl mx-auto">
        <div className="flex justify-center space-x-2">
          {questions.map((_, index) => (
            <div
              key={index}
              className={`w-3 h-3 rounded-full ${
                index < currentQuestionIndex
                  ? 'bg-green-500'
                  : index === currentQuestionIndex
                  ? 'bg-primary'
                  : 'bg-gray-300'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}