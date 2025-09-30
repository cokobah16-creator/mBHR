import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { isOnlineSyncEnabled } from '@/sync/adapter'

export default function Login() {
  const [mode, setMode] = useState<'offline' | 'online'>('offline')
  const [pin, setPin] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [attempts, setAttempts] = useState(0)
  const [loading, setLoading] = useState(false)

  const onlineAvailable = isOnlineSyncEnabled()
  const navigate = useNavigate()
  const { login } = useAuthStore()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    console.log('[login] form submitted, mode:', mode, 'pin:', pin)
    
    setErr(null)
    setLoading(true)

    try {
      if (mode === 'offline') {
        console.log('[login] attempting offline PIN login')
        const success = await login(pin)
        console.log('[login] result:', success)
        
        if (success) {
          console.log('[login] success - navigating to dashboard')
          navigate('/')
        } else {
          console.log('[login] failed - invalid PIN')
          setErr('Invalid PIN')
          setAttempts(a => a + 1)
        }
      } else {
        // Online mode
        if (!onlineAvailable) {
          setErr('Online login not available')
          return
        }
        setErr('Online login not implemented yet')
      }
    } catch (ex: any) {
      console.error('[login] error:', ex)
      setAttempts(a => a + 1)
      setErr(ex?.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const handleButtonClick = (e: React.MouseEvent) => {
    console.log('[login] button clicked directly')
    e.preventDefault()
    
    // Create a synthetic form event
    const form = e.currentTarget.closest('form')
    if (form) {
      const formEvent = new Event('submit', { bubbles: true, cancelable: true })
      form.dispatchEvent(formEvent)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-white">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="text-2xl font-semibold">Med Bridge Health Reach</div>
          <div className="text-sm text-gray-500">Powered by Dr. Isioma Okobah Foundation</div>
        </div>

        <div className="flex mb-4 gap-2">
          <button
            type="button"
            className={`flex-1 border rounded p-2 ${mode === 'offline' ? 'bg-emerald-50 border-emerald-600' : 'border-gray-300'}`}
            onClick={() => {
              console.log('[login] switching to offline mode')
              setMode('offline')
            }}
          >
            Offline PIN
          </button>
          <button
            type="button"
            className={`flex-1 border rounded p-2 ${mode === 'online' ? 'bg-emerald-50 border-emerald-600' : 'border-gray-300'}`}
            onClick={() => {
              console.log('[login] switching to online mode')
              setMode('online')
            }}
            disabled={!onlineAvailable}
            title={onlineAvailable ? '' : 'Online auth not configured'}
          >
            Online
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === 'offline' && (
            <>
              <label className="block text-sm font-medium">PIN</label>
              <input
                aria-label="PIN"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={pin}
                onChange={e => {
                  const newPin = e.target.value.replace(/\D/g, '').slice(0, 6)
                  console.log('[login] PIN changed:', newPin)
                  setPin(newPin)
                }}
                className="w-full border rounded px-3 py-2"
                placeholder="Enter your 6-digit PIN"
                required
              />
              {attempts > 0 && <div className="text-xs text-amber-600">Failed attempts: {attempts}/5</div>}
            </>
          )}

          {mode === 'online' && (
            <div className="text-sm text-gray-600">
              Online login will use Supabase auth when configured. (Set <code>VITE_SUPABASE_URL</code> and
              <code> VITE_SUPABASE_ANON_KEY</code>.)
            </div>
          )}

          {err && <div className="text-sm text-red-600">{err}</div>}

          <button 
            type="submit" 
            onClick={handleButtonClick}
            disabled={loading}
            className="w-full bg-emerald-700 text-white py-2 rounded hover:bg-emerald-800 disabled:opacity-50"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  )
}