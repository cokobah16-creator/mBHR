import { FormEvent, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { db, Patient } from '@/db'
import { queueManagement, QueueStage } from '@/services/queueManagement'
import { PatientSearch } from '@/components/PatientSearch'
import { TicketIcon, UserIcon, CheckCircleIcon } from '@heroicons/react/24/outline'

const stages: QueueStage[] = ['registration', 'vitals', 'consult', 'pharmacy']

export default function TicketIssuer() {
  const navigate = useNavigate()
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [stage, setStage] = useState<QueueStage>('vitals')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  async function handleAddToQueue() {
    if (!selectedPatient) return

    setLoading(true)
    setSuccess(false)

    try {
      // Check if patient is already in queue
      const existing = await db.queue
        .where('patientId')
        .equals(selectedPatient.id)
        .and(item => item.status !== 'done')
        .first()

      if (existing) {
        alert(`⚠️ Patient is already in queue at ${existing.stage} stage`)
        setLoading(false)
        return
      }

      // Add to queue
      await queueManagement.addToQueue(selectedPatient.id, stage, 'normal')

      setSuccess(true)
      setTimeout(() => {
        setSuccess(false)
        setSelectedPatient(null)
      }, 2000)

    } catch (error) {
      console.error('Error adding to queue:', error)
      alert('❌ Failed to add patient to queue')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-4 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <TicketIcon className="h-8 w-8 text-primary" />
          <h2 className="text-2xl font-bold text-gray-900">Add Patient to Queue</h2>
        </div>
        <button
          onClick={() => navigate('/queue')}
          className="btn-secondary text-sm"
        >
          View Queue
        </button>
      </div>

      {success ? (
        <div className="card max-w-2xl text-center py-12">
          <CheckCircleIcon className="h-16 w-16 text-green-500 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-900 mb-2">
            Patient Added to Queue
          </h3>
          <p className="text-gray-600">
            {selectedPatient?.givenName} {selectedPatient?.familyName} has been added to the {stage} queue
          </p>
        </div>
      ) : (
        <div className="card max-w-2xl">
          <div className="space-y-6">
            {/* Patient Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Patient
              </label>
              {selectedPatient ? (
                <div className="flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 rounded-full bg-green-200 flex items-center justify-center">
                      <UserIcon className="h-6 w-6 text-green-700" />
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900">
                        {selectedPatient.givenName} {selectedPatient.familyName}
                      </div>
                      <div className="text-sm text-gray-600">
                        {selectedPatient.sex} • {selectedPatient.dob}
                      </div>
                      <div className="text-sm text-gray-600">{selectedPatient.phone}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedPatient(null)}
                    className="btn-secondary text-sm"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <PatientSearch
                  onPatientSelect={setSelectedPatient}
                  placeholder="Search by name or phone..."
                />
              )}
            </div>

            {/* Stage Selection */}
            {selectedPatient && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Add to Stage
                  </label>
                  <select
                    value={stage}
                    onChange={(e) => setStage(e.target.value as QueueStage)}
                    className="input-field"
                  >
                    <option value="registration">Registration</option>
                    <option value="vitals">Vitals</option>
                    <option value="consult">Consultation</option>
                    <option value="pharmacy">Pharmacy</option>
                  </select>
                  <p className="text-sm text-gray-500 mt-1">
                    Select which stage to add the patient to
                  </p>
                </div>

                {/* Stage Info */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h4 className="font-medium text-blue-900 mb-2">What happens next?</h4>
                  <p className="text-sm text-blue-800">
                    {stage === 'registration' && 'Patient will be added to registration queue and wait to be registered.'}
                    {stage === 'vitals' && 'Patient will be added to vitals queue and wait for vital signs to be recorded.'}
                    {stage === 'consult' && 'Patient will be added to consultation queue and appear in the Doctor Station.'}
                    {stage === 'pharmacy' && 'Patient will be added to pharmacy queue and wait for medication dispensing.'}
                  </p>
                </div>

                {/* Submit Button */}
                <button
                  onClick={handleAddToQueue}
                  disabled={loading}
                  className="btn-primary w-full"
                >
                  {loading ? 'Adding to Queue...' : `Add to ${stage.charAt(0).toUpperCase() + stage.slice(1)} Queue`}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Quick Stats */}
      <div className="card max-w-2xl">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Current Queue Status</h3>
        <QueueStats />
      </div>
    </div>
  )
}

function QueueStats() {
  const [stats, setStats] = useState<Record<QueueStage, number>>({
    registration: 0,
    vitals: 0,
    consult: 0,
    pharmacy: 0
  })

  useEffect(() => {
    loadStats()
    const interval = setInterval(loadStats, 5000)
    return () => clearInterval(interval)
  }, [])

  async function loadStats() {
    const counts: Record<QueueStage, number> = {
      registration: 0,
      vitals: 0,
      consult: 0,
      pharmacy: 0
    }

    for (const stage of stages) {
      const items = await db.queue
        .where('stage')
        .equals(stage)
        .and(item => item.status !== 'done')
        .toArray()
      counts[stage] = items.length
    }

    setStats(counts)
  }

  const stageColors = {
    registration: 'bg-blue-100 text-blue-800',
    vitals: 'bg-green-100 text-green-800',
    consult: 'bg-purple-100 text-purple-800',
    pharmacy: 'bg-orange-100 text-orange-800'
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {stages.map(stage => (
        <div key={stage} className="text-center">
          <div className={`text-2xl font-bold ${stageColors[stage]} rounded-lg py-4`}>
            {stats[stage]}
          </div>
          <div className="text-sm text-gray-600 mt-2 capitalize">{stage}</div>
        </div>
      ))}
    </div>
  )
}
