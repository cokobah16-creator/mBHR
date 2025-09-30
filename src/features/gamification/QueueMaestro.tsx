import React, { useState, useEffect } from 'react'
import { useAuthStore } from '@/stores/auth'
import { useQueue } from '@/stores/queue'
import { gamificationDb, GameAttempt, generateGameId, calculateTokens, updateWallet, checkBadgeEligibility } from '@/db/gamification'
import { useLiveQuery } from 'dexie-react-hooks'
import { db as mbhrDb } from '@/db/mbhr'
import { 
  PlayIcon, 
  CheckIcon, 
  ClockIcon,
  BoltIcon,
  TrophyIcon,
  FireIcon
} from '@heroicons/react/24/outline'

const STAGES = ['registration', 'vitals', 'consult', 'pharmacy'] as const
type Stage = typeof STAGES[number]

interface QueueMaestroProps {
  onComplete?: (tokens: number, badges: string[]) => void
  onCancel?: () => void
}

export default function QueueMaestro({ onComplete, onCancel }: QueueMaestroProps) {
  const { currentUser } = useAuthStore()
  const { callNext, completeCurrent } = useQueue()
  const [selectedStage, setSelectedStage] = useState<Stage>('registration')
  const [currentAttempt, setCurrentAttempt] = useState<GameAttempt | null>(null)
  const [sessionStats, setSessionStats] = useState({
    patientsProcessed: 0,
    averageTime: 0,
    tokensEarned: 0,
    speedBonuses: 0
  })

  // Live query for tickets in selected stage
  const stageTickets = useLiveQuery(
    () => mbhrDb.tickets
      .where('currentStage')
      .equals(selectedStage)
      .toArray(),
    [selectedStage],
    []
  )

  const waiting = stageTickets?.filter(t => t.state === 'waiting') || []
  const inProgress = stageTickets?.find(t => t.state === 'in_progress')

  useEffect(() => {
    // Load any existing in-progress attempt
    loadCurrentAttempt()
  }, [currentUser])

  const loadCurrentAttempt = async () => {
    if (!currentUser) return

    try {
      const attempt = await gamificationDb.game_attempts
        .where('actorId')
        .equals(currentUser.id)
        .and(a => a.taskCode === 'queue_maestro' && a.status === 'in_progress')
        .first()

      setCurrentAttempt(attempt || null)
    } catch (error) {
      console.error('Error loading current attempt:', error)
    }
  }

  const startQuest = async () => {
    if (!currentUser || currentAttempt) return

    try {
      const attempt: GameAttempt = {
        id: generateGameId(),
        taskCode: 'queue_maestro',
        actorId: currentUser.id,
        payloadJson: JSON.stringify({
          stage: selectedStage,
          startedAt: new Date().toISOString(),
          patientsProcessed: 0,
          totalServiceTime: 0
        }),
        startedAt: new Date().toISOString(),
        status: 'in_progress',
        _dirty: 1
      }

      await gamificationDb.game_attempts.add(attempt)
      setCurrentAttempt(attempt)
    } catch (error) {
      console.error('Error starting quest:', error)
    }
  }

  const processNextPatient = async () => {
    if (!currentAttempt || !currentUser) return

    const startTime = new Date()
    
    try {
      // Call next patient
      const nextPatient = await callNext(selectedStage)
      if (!nextPatient) {
        alert('No patients waiting in this stage')
        return
      }

      // Simulate processing time (in real app, this would be actual work)
      // For demo, we'll use a random time between 2-8 minutes
      const processingTime = Math.random() * 6 + 2 // 2-8 minutes
      
      // In real implementation, this would wait for actual completion
      // For demo, we'll simulate it
      setTimeout(async () => {
        await completePatientProcessing(nextPatient.id, processingTime)
      }, 2000) // 2 second demo delay

    } catch (error) {
      console.error('Error processing patient:', error)
    }
  }

  const completePatientProcessing = async (patientId: string, serviceTimeMinutes: number) => {
    if (!currentAttempt || !currentUser) return

    try {
      // Complete current patient in queue system
      await completeCurrent(selectedStage, serviceTimeMinutes * 60) // Convert to seconds

      // Update attempt payload
      const payload = JSON.parse(currentAttempt.payloadJson)
      payload.patientsProcessed += 1
      payload.totalServiceTime += serviceTimeMinutes

      // Calculate performance metrics
      const averageTime = payload.totalServiceTime / payload.patientsProcessed
      const targetTime = 4 // 4 minutes target
      const speedBonus = averageTime <= targetTime ? 1.2 : 1.0

      // Update session stats
      setSessionStats(prev => ({
        patientsProcessed: payload.patientsProcessed,
        averageTime: averageTime,
        tokensEarned: prev.tokensEarned,
        speedBonuses: prev.speedBonuses + (speedBonus > 1 ? 1 : 0)
      }))

      // Update attempt
      await gamificationDb.game_attempts.update(currentAttempt.id, {
        payloadJson: JSON.stringify(payload),
        _dirty: 1
      })

      // Refresh current attempt
      const updatedAttempt = await gamificationDb.game_attempts.get(currentAttempt.id)
      setCurrentAttempt(updatedAttempt || null)

    } catch (error) {
      console.error('Error completing patient processing:', error)
    }
  }

  const completeQuest = async () => {
    if (!currentAttempt || !currentUser) return

    try {
      const payload = JSON.parse(currentAttempt.payloadJson)
      const finishedAt = new Date().toISOString()
      
      // Calculate final score and tokens
      const baseTokens = 15 // Base tokens for queue maestro
      const patientsProcessed = payload.patientsProcessed
      const averageTime = payload.totalServiceTime / Math.max(1, patientsProcessed)
      const targetTime = 4 // 4 minutes target
      
      // Performance multipliers
      const speedBonus = averageTime <= targetTime ? 1.2 : averageTime <= 6 ? 1.0 : 0.8
      const volumeBonus = patientsProcessed >= 5 ? 1.1 : 1.0
      
      // Get user's current streak for streak bonus
      const wallet = await gamificationDb.wallets.get(currentUser.id)
      const streakDays = wallet?.streakDays || 0

      const finalTokens = calculateTokens(baseTokens * patientsProcessed, {
        streak: streakDays,
        accuracy: 1.0, // Assume 100% accuracy for now
        speedBonus,
        qualityBonus: volumeBonus
      })

      // Update attempt as completed
      await gamificationDb.game_attempts.update(currentAttempt.id, {
        finishedAt,
        status: 'completed',
        score: Math.round(averageTime * 100) / 100, // Average service time as score
        tokens: finalTokens,
        multipliersJson: JSON.stringify({
          speedBonus,
          volumeBonus,
          streakBonus: 1 + Math.min(streakDays, 5) * 0.1
        }),
        _dirty: 1
      })

      // Update wallet
      await updateWallet(currentUser.id, finalTokens, true)

      // Check for new badges
      const newBadges = await checkBadgeEligibility(currentUser.id, 'queue_maestro')

      // Update session stats
      setSessionStats(prev => ({
        ...prev,
        tokensEarned: finalTokens
      }))

      // Clear current attempt
      setCurrentAttempt(null)

      // Notify completion
      if (onComplete) {
        onComplete(finalTokens, newBadges)
      }

      // Show completion message
      alert(`🎉 Quest Complete!\n\nPatients Processed: ${patientsProcessed}\nAverage Time: ${averageTime.toFixed(1)} min\nTokens Earned: ${finalTokens}\n${newBadges.length > 0 ? `New Badges: ${newBadges.join(', ')}` : ''}`)

    } catch (error) {
      console.error('Error completing quest:', error)
    }
  }

  const cancelQuest = async () => {
    if (!currentAttempt) return

    try {
      await gamificationDb.game_attempts.delete(currentAttempt.id)
      setCurrentAttempt(null)
      setSessionStats({
        patientsProcessed: 0,
        averageTime: 0,
        tokensEarned: 0,
        speedBonuses: 0
      })

      if (onCancel) {
        onCancel()
      }
    } catch (error) {
      console.error('Error canceling quest:', error)
    }
  }

  const payload = currentAttempt ? JSON.parse(currentAttempt.payloadJson) : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="text-3xl">🏥</div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Queue Maestro</h1>
            <p className="text-gray-600">Process patients efficiently through care stages</p>
          </div>
        </div>
        
        {currentAttempt && (
          <div className="flex items-center space-x-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-primary">{payload?.patientsProcessed || 0}</div>
              <div className="text-sm text-gray-600">Processed</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600">
                {payload?.patientsProcessed > 0 ? (payload.totalServiceTime / payload.patientsProcessed).toFixed(1) : '0.0'}m
              </div>
              <div className="text-sm text-gray-600">Avg Time</div>
            </div>
          </div>
        )}
      </div>

      {/* Stage Selection */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Select Stage</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {STAGES.map(stage => {
            const stageCount = stageTickets?.filter(t => t.currentStage === stage && t.state !== 'done').length || 0
            return (
              <button
                key={stage}
                onClick={() => setSelectedStage(stage)}
                disabled={!!currentAttempt}
                className={`p-4 rounded-lg border font-medium capitalize transition-colors ${
                  selectedStage === stage
                    ? 'bg-primary text-white border-primary'
                    : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                } ${currentAttempt ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className="text-lg font-bold">{stageCount}</div>
                <div className="text-sm">{stage}</div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Quest Status */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Quest Status</h3>
          <div className="flex items-center space-x-2">
            <BoltIcon className="h-5 w-5 text-yellow-500" />
            <span className="font-medium text-primary">15 tokens per patient</span>
          </div>
        </div>

        {!currentAttempt ? (
          <div className="text-center py-8">
            <TrophyIcon className="h-12 w-12 mx-auto text-gray-400 mb-4" />
            <p className="text-gray-600 mb-6">Ready to start processing patients in {selectedStage}?</p>
            <button
              onClick={startQuest}
              disabled={waiting.length === 0}
              className="btn-primary inline-flex items-center space-x-2"
            >
              <PlayIcon className="h-5 w-5" />
              <span>Start Quest</span>
            </button>
            {waiting.length === 0 && (
              <p className="text-sm text-gray-500 mt-2">No patients waiting in this stage</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Current Progress */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-blue-800">Quest in Progress</span>
                <span className="text-sm text-blue-600">Stage: {selectedStage}</span>
              </div>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-blue-600">Patients:</span>
                  <span className="ml-2 font-medium">{payload?.patientsProcessed || 0}</span>
                </div>
                <div>
                  <span className="text-blue-600">Avg Time:</span>
                  <span className="ml-2 font-medium">
                    {payload?.patientsProcessed > 0 ? (payload.totalServiceTime / payload.patientsProcessed).toFixed(1) : '0.0'}m
                  </span>
                </div>
                <div>
                  <span className="text-blue-600">Target:</span>
                  <span className="ml-2 font-medium">≤4.0m</span>
                </div>
              </div>
            </div>

            {/* Current Patient Status */}
            <div className="flex items-center justify-between">
              <div>
                {inProgress ? (
                  <div className="flex items-center space-x-2 text-yellow-600">
                    <ClockIcon className="h-5 w-5" />
                    <span>Patient {inProgress.number} in progress</span>
                  </div>
                ) : (
                  <div className="flex items-center space-x-2 text-gray-600">
                    <span>Ready for next patient</span>
                  </div>
                )}
              </div>
              <div className="text-sm text-gray-500">
                {waiting.length} waiting
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex space-x-4">
              <button
                onClick={processNextPatient}
                disabled={waiting.length === 0 || !!inProgress}
                className="btn-primary flex-1 inline-flex items-center justify-center space-x-2"
              >
                <PlayIcon className="h-5 w-5" />
                <span>Process Next Patient</span>
              </button>
              
              {payload?.patientsProcessed > 0 && (
                <button
                  onClick={completeQuest}
                  className="btn-secondary inline-flex items-center space-x-2"
                >
                  <CheckIcon className="h-5 w-5" />
                  <span>Complete Quest</span>
                </button>
              )}
              
              <button
                onClick={cancelQuest}
                className="btn-secondary text-red-600 hover:bg-red-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Performance Tips */}
      <div className="card bg-green-50 border-green-200">
        <div className="flex items-center space-x-2 mb-3">
          <FireIcon className="h-5 w-5 text-green-600" />
          <h4 className="font-medium text-green-800">Performance Tips</h4>
        </div>
        <div className="text-sm text-green-700 space-y-1">
          <p>• Keep service time ≤4 minutes per patient for speed bonus</p>
          <p>• Process 5+ patients for volume bonus</p>
          <p>• Maintain daily streaks for streak multiplier</p>
          <p>• Clean handoffs (no patient returns) boost your score</p>
        </div>
      </div>
    </div>
  )
}