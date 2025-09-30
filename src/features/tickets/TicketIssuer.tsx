import { FormEvent, useState } from 'react'
import { useQueue } from '@/stores/queue'
import { TicketIcon, UserGroupIcon } from '@heroicons/react/24/outline'

const categories = ['adult','child','antenatal'] as const
const priorities = ['normal','urgent','low'] as const

export default function TicketIssuer() {
  const issue = useQueue(s => s.issueTicket)
  const [siteId, setSite] = useState('site-001')
  const [category, setCat] = useState<typeof categories[number]>('adult')
  const [priority, setPri] = useState<typeof priorities[number]>('normal')
  const [lastNum, setLast] = useState<string>('—')
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const t = await issue({ siteId, category, priority })
      setLast(t.number)
    } catch (error) {
      console.error('Error issuing ticket:', error)
      alert('Failed to issue ticket')
    } finally {
      setLoading(false)
    }
  }

  const getCategoryIcon = (cat: string) => {
    switch (cat) {
      case 'child': return '👶'
      case 'antenatal': return '🤱'
      default: return '👤'
    }
  }

  const getPriorityColor = (pri: string) => {
    switch (pri) {
      case 'urgent': return 'text-red-600'
      case 'low': return 'text-gray-500'
      default: return 'text-blue-600'
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center space-x-3 mb-6">
        <TicketIcon className="h-8 w-8 text-primary" />
        <h1 className="text-2xl font-bold text-gray-900">Issue New Ticket</h1>
      </div>

      <div className="card">
        <form className="space-y-6" onSubmit={onSubmit}>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Site ID</label>
            <input 
              className="input-field" 
              value={siteId} 
              onChange={e => setSite(e.target.value)}
              placeholder="e.g., site-001, clinic-main"
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
              <select 
                className="input-field" 
                value={category} 
                onChange={e => setCat(e.target.value as any)}
              >
                {categories.map(c => (
                  <option key={c} value={c}>
                    {getCategoryIcon(c)} {c.charAt(0).toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Priority</label>
              <select 
                className="input-field" 
                value={priority} 
                onChange={e => setPri(e.target.value as any)}
              >
                {priorities.map(p => (
                  <option key={p} value={p} className={getPriorityColor(p)}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button 
            className="btn-primary w-full flex items-center justify-center space-x-2" 
            disabled={loading}
          >
            <UserGroupIcon className="h-5 w-5" />
            <span>{loading ? 'Creating...' : 'Issue Ticket'}</span>
          </button>
        </form>

        {lastNum !== '—' && (
          <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="text-center">
              <div className="text-sm text-green-600 mb-1">Last ticket issued:</div>
              <div className="text-2xl font-bold text-green-800">{lastNum}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}