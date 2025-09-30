import { FormEvent, useState } from 'react'
import { useQueue } from '@/stores/queue'
import { TicketIcon, UserGroupIcon } from '@heroicons/react/24/outline'

const categories = ['adult','child','antenatal'] as const
const priorities = ['normal','urgent','low'] as const

export default function TicketIssuer() {
  const { issueTicket } = useQueue()
  const [form, setForm] = useState({
    category: 'adult' as typeof categories[number],
    priority: 'normal' as typeof priorities[number],
    patientId: '',
    stage: 'registration' as const
  })
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    
    try {
      const ticket = await issueTicket({
        siteId: 'demo-site',
        category: form.category,
        priority: form.priority,
        patientId: form.patientId || undefined,
        stage: form.stage
      })
      
      alert(`✅ Ticket issued: ${ticket.number}`)
      
      // Reset form
      setForm({
        category: 'adult',
        priority: 'normal',
        patientId: '',
        stage: 'registration'
      })
    } catch (error) {
      console.error('Error issuing ticket:', error)
      alert('❌ Failed to issue ticket')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-4 space-y-6">
      <div className="flex items-center space-x-3">
        <TicketIcon className="h-8 w-8 text-primary" />
        <h2 className="text-2xl font-bold text-gray-900">Issue Ticket</h2>
      </div>

      <div className="card max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Category
            </label>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as any })}
              className="input-field"
            >
              <option value="adult">Adult</option>
              <option value="child">Child</option>
              <option value="antenatal">Antenatal</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Priority
            </label>
            <select
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value as any })}
              className="input-field"
            >
              <option value="normal">Normal</option>
              <option value="urgent">Urgent</option>
              <option value="low">Low</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Patient ID (Optional)
            </label>
            <input
              type="text"
              value={form.patientId}
              onChange={(e) => setForm({ ...form, patientId: e.target.value })}
              className="input-field"
              placeholder="Leave blank for walk-in"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Starting Stage
            </label>
            <select
              value={form.stage}
              onChange={(e) => setForm({ ...form, stage: e.target.value as any })}
              className="input-field"
            >
              <option value="registration">Registration</option>
              <option value="vitals">Vitals</option>
              <option value="consult">Consultation</option>
              <option value="pharmacy">Pharmacy</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full"
          >
            {loading ? 'Issuing...' : 'Issue Ticket'}
          </button>
        </form>
      </div>

      <div className="card bg-blue-50 border-blue-200">
        <div className="flex items-center space-x-2 mb-2">
          <UserGroupIcon className="h-5 w-5 text-blue-600" />
          <h3 className="font-medium text-blue-800">How it works</h3>
        </div>
        <div className="text-sm text-blue-700 space-y-1">
          <p>• Tickets are automatically numbered (A-001, B-001, C-001)</p>
          <p>• Categories: A=Adult, B=Child, C=Antenatal</p>
          <p>• Urgent tickets are prioritized in the queue</p>
          <p>• Patients can be linked to existing records</p>
        </div>
      </div>
    </div>
  )
}