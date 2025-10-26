import { useState, useEffect, startTransition } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowRightIcon, PhoneIcon, LockClosedIcon } from '@heroicons/react/24/outline'
import { requestOTP, verifyOTP } from '@/services/patientPortalAuth'
import { OTPInput } from './OTPInput'
import { useT } from '@/hooks/useT'

const phoneSchema = z.object({
  phone: z.string().min(10, 'Phone number must be at least 10 digits').regex(/^\+?[\d\s-]+$/, 'Invalid phone number')
})

const otpSchema = z.object({
  otp: z.string().length(6, 'OTP must be 6 digits')
})

type PhoneForm = z.infer<typeof phoneSchema>
type OTPForm = z.infer<typeof otpSchema>

export function PatientLogin() {
  const navigate = useNavigate()
  const t = useT()
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [canResend, setCanResend] = useState(false)

  const phoneForm = useForm<PhoneForm>({
    resolver: zodResolver(phoneSchema),
    defaultValues: { phone: '' }
  })

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000)
      return () => clearTimeout(timer)
    } else if (countdown === 0 && step === 'otp') {
      setCanResend(true)
    }
  }, [countdown, step])

  const handleRequestOTP = async (data: PhoneForm) => {
    setLoading(true)
    setError('')

    try {
      const result = await requestOTP({
        phone: data.phone,
        purpose: 'login'
      })

      if (result.success) {
        setPhone(data.phone)
        setStep('otp')
        setCountdown(600)
        setCanResend(false)
      } else {
        setError(result.error || 'Failed to send OTP')
      }
    } catch (err) {
      setError('An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyOTP = async () => {
    if (otp.length !== 6) {
      setError('Please enter complete 6-digit code')
      return
    }

    setLoading(true)
    setError('')

    try {
      const result = await verifyOTP({
        phone,
        otp
      })

      if (result.success && result.sessionToken) {
        localStorage.setItem('patient_session_token', result.sessionToken)
        localStorage.setItem('patient_portal_user', JSON.stringify(result.portalUser))
        startTransition(() => {
          navigate('/patient/dashboard')
        })
      } else {
        setError(result.error || 'Invalid verification code')
        setOtp('')
      }
    } catch (err) {
      setError('An error occurred. Please try again.')
      setOtp('')
    } finally {
      setLoading(false)
    }
  }

  const handleResendOTP = async () => {
    if (!canResend) return

    setLoading(true)
    setError('')

    try {
      const result = await requestOTP({
        phone,
        purpose: 'login'
      })

      if (result.success) {
        setCountdown(600)
        setCanResend(false)
        setOtp('')
        setError('')
      } else {
        setError(result.error || 'Failed to send OTP')
      }
    } catch (err) {
      setError('An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const formatCountdown = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
              {step === 'phone' ? (
                <PhoneIcon className="w-8 h-8 text-blue-600" />
              ) : (
                <LockClosedIcon className="w-8 h-8 text-blue-600" />
              )}
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              {step === 'phone' ? 'Patient Portal Login' : 'Verify Your Identity'}
            </h1>
            <p className="text-gray-600">
              {step === 'phone'
                ? 'Enter your phone number to receive a verification code'
                : 'Enter the 6-digit code sent to your phone'}
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {step === 'phone' ? (
            <form onSubmit={phoneForm.handleSubmit(handleRequestOTP)} className="space-y-6">
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-2">
                  Phone Number
                </label>
                <input
                  {...phoneForm.register('phone')}
                  type="tel"
                  id="phone"
                  placeholder="+234 XXX XXX XXXX"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled={loading}
                />
                {phoneForm.formState.errors.phone && (
                  <p className="mt-2 text-sm text-red-600">{phoneForm.formState.errors.phone.message}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Sending Code...
                  </>
                ) : (
                  <>
                    Continue
                    <ArrowRightIcon className="w-5 h-5" />
                  </>
                )}
              </button>

              <div className="text-center">
                <p className="text-sm text-gray-600">
                  Don't have an account?{' '}
                  <button
                    type="button"
                    onClick={() => navigate('/patient/register')}
                    className="text-blue-600 hover:text-blue-700 font-medium"
                  >
                    Register here
                  </button>
                </p>
              </div>
            </form>
          ) : (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-4 text-center">
                  Verification Code
                </label>
                <OTPInput
                  value={otp}
                  onChange={setOtp}
                  disabled={loading}
                  error={!!error}
                />
                {countdown > 0 && (
                  <p className="mt-3 text-sm text-center text-gray-600">
                    Code expires in <span className="font-semibold text-blue-600">{formatCountdown(countdown)}</span>
                  </p>
                )}
              </div>

              <button
                onClick={handleVerifyOTP}
                disabled={loading || otp.length !== 6}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Verifying...
                  </>
                ) : (
                  <>
                    Verify & Login
                    <ArrowRightIcon className="w-5 h-5" />
                  </>
                )}
              </button>

              <div className="text-center space-y-2">
                <button
                  type="button"
                  onClick={handleResendOTP}
                  disabled={!canResend || loading}
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium disabled:text-gray-400 disabled:cursor-not-allowed"
                >
                  {canResend ? 'Resend Code' : `Resend available in ${formatCountdown(countdown)}`}
                </button>
                <p className="text-sm text-gray-600">
                  <button
                    type="button"
                    onClick={() => {
                      setStep('phone')
                      setOtp('')
                      setError('')
                      setCountdown(0)
                    }}
                    className="text-blue-600 hover:text-blue-700 font-medium"
                  >
                    Use different number
                  </button>
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 text-center text-sm text-gray-600">
          <p>Med Bridge Health Reach</p>
          <p className="mt-1">Secure patient portal powered by mBHR</p>
        </div>
      </div>
    </div>
  )
}
