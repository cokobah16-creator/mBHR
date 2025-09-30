// src/pages/Login.tsx
import { useState } from 'react'
import { useAuthStore } from '@/stores/auth'
import { isOnlineSyncEnabled } from '@/sync/adapter'
// import { useNavigate } from 'react-router-dom'

export default function Login() {
  const [mode, setMode] = useState<'offline' | 'online'>('offline')
  const [pin, setPin] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [attempts, setAttempts] = useState(0)

  const onlineAvailable = isOnlineSyncEnabled()
  // const navigate = useNavigate()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)

    try {
      if (mode === 'offline') {
        console.log('[login] attempting offline PIN', pin)
        await useAuthStore.getState().login(pin) // throws on bad PIN
        console.log('[login] success (offline)')
        // navigate('/'); // uncomment if using React Router
        return
      }

      // mode === 'online'
      if (!onlineAvailable) {
        setErr('Online login not available on this device')
        return
      }

      // TODO: implement Supabase auth here
      console.log('[login] online selected but not implemented yet')
      setErr('Online login not configured yet')
    } catch (ex: any) {
      console.error('[login] error', ex)
      setAttempts(a => a + 1)
      setErr(ex?.message === 'INVALID_PIN' ? 'Invalid PIN' : ex?.message || 'Login failed')
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
            className={`flex-1 border rounded p-2 ${mode === 'offline' ? 'bg-emerald-50 border-emerald-600' : 'border-gray-300'}`}
            onClick={() => setMode('offline')}
          >
            Offline PIN
          </button>
          <button
            className={`flex-1 border rounded p-2 ${mode === 'online' ? 'bg-emerald-50 border-emerald-600' : 'border-gray-300'}`}
            onClick={() => setMode('online')}
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
                onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
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

          <button type="submit" className="w-full bg-emerald-700 text-white py-2 rounded hover:bg-emerald-800">
            Login
          </button>
        </form>
      </div>
    </div>
  )
}