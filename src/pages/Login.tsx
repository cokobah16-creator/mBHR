import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { isOnlineSyncEnabled } from '@/sync/adapter'
import { db } from '@/db'
import { seed } from '@/db/seed'
import { derivePinHash } from '@/utils/pin'

export default function Login() {
  const [mode, setMode] = useState<'offline' | 'online'>('offline')
  const [pin, setPin] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [attempts, setAttempts] = useState(0)
  const [loading, setLoading] = useState(false)
  const [showDebug, setShowDebug] = useState(false)

  const onlineAvailable = isOnlineSyncEnabled()
  const navigate = useNavigate()
  const { login } = useAuthStore()

  // Debug panel state
  const [debugUsers, setDebugUsers] = useState<any[]>([])
  const [computed, setComputed] = useState<string>('')

  // Reset local data function
  const resetLocal = async () => {
    try {
      setLoading(true)
      await db.delete()
      localStorage.clear()
      sessionStorage.clear()
      
      // Clear Zustand persisted state
      const keys = Object.keys(localStorage)
      keys.forEach(key => {
        if (key.includes('mbhr') || key.includes('auth')) {
          localStorage.removeItem(key)
        }
      })
      
      alert('Local data cleared. The app will now reload and reseed.')
      window.location.reload()
    } catch (e) {
      console.error('Failed to reset local data:', e)
      alert('Failed to reset local data. Check console for details.')
    } finally {
      setLoading(false)
    }
  }

  // Load debug users
  useEffect(() => {
    if (showDebug) {
      (async () => {
        try {
          const users = await db.users.where('isActive').equals(1).toArray()
          setDebugUsers(users.map(u => ({
            name: u.fullName,
            role: u.role,
            salt: u.pinSalt?.slice(0, 10) + '…',
            hash: u.pinHash?.slice(0, 12) + '…'
          })))
        } catch (error) {
          console.error('Error loading debug users:', error)
          setDebugUsers([])
        }
      })()
    }
  }, [showDebug, attempts])

  // Compute hash for debugging
  useEffect(() => {
    if (pin && debugUsers.length > 0) {
      (async () => {
        try {
          const first = await db.users.where('isActive').equals(1).first()
          if (first?.pinSalt) {
            const h = await derivePinHash(pin, first.pinSalt)
            setComputed(h.slice(0, 12) + '…')
          } else {
            setComputed('')
          }
        } catch (error) {
          console.error('Error computing hash:', error)
          setComputed('Error')
        }
      })()
    } else {
      setComputed('')
    }
  }, [pin, debugUsers])

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
            disabled={loading}
            className="w-full bg-emerald-700 text-white py-2 rounded hover:bg-emerald-800 disabled:opacity-50"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>

          {/* Utility buttons */}
          <div className="flex items-center justify-between text-sm mt-4 pt-4 border-t">
            <button 
              type="button" 
              onClick={resetLocal} 
              className="text-red-600 hover:text-red-800 underline"
              disabled={loading}
            >
              Reset local data
            </button>
            <button 
              type="button" 
              onClick={() => setShowDebug(s => !s)} 
              className="text-blue-600 hover:text-blue-800 underline"
            >
              {showDebug ? 'Hide' : 'Show'} debug
            </button>
          </div>
        </form>

        {/* Debug panel */}
        {showDebug && (
          <div className="mt-4 rounded-lg border p-3 bg-gray-50 text-sm">
            <div className="font-semibold mb-2">Debug Panel (Offline Mode)</div>
            <div className="mb-2">Active users: {debugUsers.length}</div>
            
            {debugUsers.length > 0 ? (
              <div className="space-y-2">
                {debugUsers.map((user, index) => (
                  <div key={index} className="bg-white p-2 rounded border text-xs">
                    <div><strong>{user.name}</strong> ({user.role})</div>
                    <div>Salt: <code>{user.salt}</code></div>
                    <div>Hash: <code>{user.hash}</code></div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-gray-600 italic">No users found. Try "Reset local data".</div>
            )}
            
            {pin && computed && (
              <div className="mt-3 p-2 bg-blue-50 rounded">
                <div className="text-xs">
                  <strong>Computed hash for PIN "{pin}" (using first user's salt):</strong>
                </div>
                <code className="text-xs">{computed}</code>
              </div>
            )}
            
            <div className="mt-3 text-xs text-gray-600 border-t pt-2">
              <strong>Known seed PINs:</strong><br/>
              • 123456 (Admin User)<br/>
              • 234567 (Nurse Joy)<br/>
              • 111222 (Doctor Ada)<br/>
              • 333444 (Pharmacist Chidi)<br/>
              • 555666 (Volunteer Musa)
            </div>
          </div>
        )}
      </div>
    </div>
  )
}