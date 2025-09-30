import { useState } from 'react'
import { login as offlineLogin } from '@/stores/auth'
import { isOnlineSyncEnabled } from '@/sync/adapter'
import { useAuthStore } from '@/stores/auth'
import { db, User, generateId } from '@/db'
import { derivePinHash, newSaltB64 } from '@/utils/pin'
import { Tab } from '@headlessui/react'
import { 
  LockClosedIcon, 
  WifiIcon, 
  SignalSlashIcon,
  UserPlusIcon 
} from '@heroicons/react/24/outline'
import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router-dom'
import { useEffect } from 'react'


export function Login() {
  const { t } = useTranslation()
  const { 
    isAuthenticated, 
    login, 
    loginOnline, 
    failedAttempts, 
    checkLockout,
    resetFailedAttempts 
  } = useAuthStore()
  
  const [pin, setPin] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showAdminSetup, setShowAdminSetup] = useState(false)
  const [adminSetupPin, setAdminSetupPin] = useState('')
  const [adminName, setAdminName] = useState('')
  
  const isOnline = navigator.onLine
  const isLockedOut = checkLockout()

  useEffect(() => {
    checkFirstRun()
  }, [])

  const checkFirstRun = async () => {
    try {
      const userCount = await db.users.count()
      const adminSetupDone = await db.settings.get('adminSetupDone')
      
      if (userCount === 0 && !adminSetupDone) {
        setShowAdminSetup(true)
      }
    } catch (error) {
      console.error('Error checking first run:', error)
    }
  }

  const handleAdminSetup = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (adminSetupPin.length < 6 || adminSetupPin.length > 12) {
      setError('Admin Setup PIN must be 6-12 digits')
      return
    }
    
    if (!adminName.trim()) {
      setError('Admin name is required')
      return
    }

    setLoading(true)
    setError('')

    try {
      // Create admin user
      const salt = newSaltB64()
      const pinHash = await derivePinHash(adminSetupPin, salt)
      
      const adminUser: User = {
        id: generateId(),
        fullName: adminName.trim(),
        role: 'admin',
        pinHash,
        pinSalt: salt,
        createdAt: new Date(),
        updatedAt: new Date(),
        isActive: true
      }
      
      await db.users.add(adminUser)
      await db.settings.put({ key: 'adminSetupDone', value: 'true' })
      
      setShowAdminSetup(false)
      setAdminSetupPin('')
      setAdminName('')
      
    } catch (error) {
      console.error('Admin setup error:', error)
      setError('Failed to create admin user')
    } finally {
      setLoading(false)
    }
  }

  const handleOfflineLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (isLockedOut) {
      setError(t('auth.lockedOut'))
      return
    }
    
    if (pin.length !== 6) {
      setError('PIN must be 6 digits')
      return
    }

    setLoading(true)
    setError('')

    try {
      const success = await login(pin)
      
      if (!success) {
        setError(t('auth.invalidPin'))
        setPin('')
      } else {
        resetFailedAttempts()
      }
    } catch (error) {
      console.error('Login error:', error)
      setError('Login failed')
    } finally {
      setLoading(false)
    }
  }

  const handleOnlineLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    
    setLoading(true)
    setError('')

    try {
      const success = await loginOnline(email, password)
      
      if (!success) {
        setError('Online login not available. Use offline PIN.')
      }
    } catch (error) {
      console.error('Online login error:', error)
      setError('Online login failed')
    } finally {
      setLoading(false)
    }
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />
  }

  if (showAdminSetup) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full space-y-8">
          <div className="text-center">
            <UserPlusIcon className="mx-auto h-12 w-12 text-primary" />
            <h2 className="mt-6 text-3xl font-bold text-gray-900">
              First-Time Setup
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              Create the first admin user to get started
            </p>
          </div>
          
          <form className="mt-8 space-y-6" onSubmit={handleAdminSetup}>
            <div>
              <label htmlFor="adminName" className="block text-sm font-medium text-gray-700">
                Admin Full Name
              </label>
              <input
                id="adminName"
                type="text"
                required
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
                className="input-field mt-1"
                placeholder="Enter admin full name"
              />
            </div>
            
            <div>
              <label htmlFor="adminSetupPin" className="block text-sm font-medium text-gray-700">
                Admin Setup PIN (6-12 digits)
              </label>
              <input
                id="adminSetupPin"
                type="password"
                required
                value={adminSetupPin}
                onChange={(e) => setAdminSetupPin(e.target.value.replace(/\D/g, '').slice(0, 12))}
                className="input-field mt-1"
                placeholder="Enter setup PIN"
              />
            </div>
            
            {error && (
              <div className="text-red-600 text-sm text-center">
                {error}
              </div>
            )}
            
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full"
            >
              {loading ? 'Creating Admin...' : 'Create Admin User'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <LockClosedIcon className="mx-auto h-12 w-12 text-primary" />
          <h2 className="mt-6 text-3xl font-bold text-gray-900">
            {t('app.title')}
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            {t('app.subtitle')}
          </p>
        </div>

        <Tab.Group>
          <Tab.List className="flex space-x-1 rounded-xl bg-gray-100 p-1">
            <Tab className={({ selected }) =>
              `w-full rounded-lg py-2.5 text-sm font-medium leading-5 transition-colors touch-target ${
                selected
                  ? 'bg-white text-primary shadow'
                  : 'text-gray-600 hover:bg-white/[0.12] hover:text-gray-800'
              }`
            }>
              <div className="flex items-center justify-center space-x-2">
                <SignalSlashIcon className="h-4 w-4" />
                <span>Offline PIN</span>
              </div>
            </Tab>
            <Tab className={({ selected }) =>
              `w-full rounded-lg py-2.5 text-sm font-medium leading-5 transition-colors touch-target ${
                selected
                  ? 'bg-white text-primary shadow'
                  : 'text-gray-600 hover:bg-white/[0.12] hover:text-gray-800'
              } ${!isOnlineSyncEnabled() ? 'opacity-50' : ''}`
            }>
              <div className="flex items-center justify-center space-x-2">
                <WifiIcon className="h-4 w-4" />
                <span>Online</span>
              </div>
            </Tab>
          </Tab.List>
          
          <Tab.Panels className="mt-6">
            {/* Offline PIN Login */}
            <Tab.Panel>
              <form className="space-y-6" onSubmit={handleOfflineLogin}>
                <div>
                  <label htmlFor="pin" className="block text-sm font-medium text-gray-700">
                    {t('auth.pin')}
                  </label>
                  <input
                    id="pin"
                    type="password"
                    required
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="input-field mt-1"
                    placeholder={t('auth.enterPin')}
                    disabled={isLockedOut}
                  />
                </div>

                {failedAttempts > 0 && (
                  <div className="text-yellow-600 text-sm text-center">
                    Failed attempts: {failedAttempts}/5
                  </div>
                )}

                {error && (
                  <div className="text-red-600 text-sm text-center">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || isLockedOut || pin.length !== 6}
                  className="btn-primary w-full"
                >
                  {loading ? t('common.loading') : t('auth.login')}
                </button>
              </form>
            </Tab.Panel>

            {/* Online Login */}
            <Tab.Panel>
              <form className="space-y-6" onSubmit={handleOnlineLogin}>
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input-field mt-1"
                    placeholder="Enter your email"
                    disabled={!isOnline}
                  />
                </div>

                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input-field mt-1"
                    placeholder="Enter your password"
                    disabled={!isOnline}
                  />
                </div>

                {!isOnline && (
                  <div className="text-yellow-600 text-sm text-center">
                    Online login requires internet connection
                  </div>
                )}

                {error && (
                  <div className="text-red-600 text-sm text-center">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || !isOnline}
                  className="btn-primary w-full"
                >
                  {loading ? t('common.loading') : t('auth.login')}
                </button>
              </form>
            </Tab.Panel>
          </Tab.Panels>
        </Tab.Group>
      </div>
    </div>
  )
}