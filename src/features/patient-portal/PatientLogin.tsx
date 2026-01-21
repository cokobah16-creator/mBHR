import { useState, useEffect, startTransition } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowRightIcon, PhoneIcon, LockClosedIcon } from '@heroicons/react/24/outline'
import { requestOTP, verifyOTP } from '@/services/patientPortalAuth'
import { OTPInput } from './OTPInput'
import { useT } from '@/hooks/useT'

const contactSchema = z.object({
  contact: z.string().min(3, 'Please enter your phone number or email address')
})

const otpSchema = z.object({
  otp: z.string().length(6, 'OTP must be 6 digits')
})

type ContactForm = z.infer<typeof contactSchema>
type OTPForm = z.infer<typeof otpSchema>

export function PatientLogin() {
  const navigate = useNavigate()
  const t = useT()
  const [step, setStep] = useState<'contact' | 'otp'>('contact')
  const [contact, setContact] = useState('')
  const [isEmail, setIsEmail] = useState(false)
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [canResend, setCanResend] = useState(false)
  const [demoOTP, setDemoOTP] = useState<string | null>(null)
  const [isDemoMode, setIsDemoMode] = useState(false)

  const contactForm = useForm<ContactForm>({
    resolver: zodResolver(contactSchema),
    defaultValues: { contact: '' }
  })

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000)
      return () => clearTimeout(timer)
    } else if (countdown === 0 && step === 'otp') {
      setCanResend(true)
    }
  }, [countdown, step])

  const handleRequestOTP = async (data: ContactForm) => {
    setLoading(true)
    setError('')

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    const isEmailAddress = emailRegex.test(data.contact)
    setIsEmail(isEmailAddress)

    try {
      const result = await requestOTP({
        phone: isEmailAddress ? undefined : data.contact,
        email: isEmailAddress ? data.contact : undefined,
        purpose: 'login'
      })

      if (result.success) {
        setContact(data.contact)
        setStep('otp')
        setCountdown(600)
        setCanResend(false)

        if (result.demoMode && result.demoOTP) {
          setIsDemoMode(true)
          setDemoOTP(result.demoOTP)
        } else {
          setIsDemoMode(false)
          setDemoOTP(null)
        }
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
        phone: isEmail ? undefined : contact,
        email: isEmail ? contact : undefined,
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
        phone: isEmail ? undefined : contact,
        email: isEmail ? contact : undefined,
        purpose: 'login'
      })

      if (result.success) {
        setCountdown(600)
        setCanResend(false)
        setOtp('')
        setError('')

        if (result.demoMode && result.demoOTP) {
          setIsDemoMode(true)
          setDemoOTP(result.demoOTP)
        } else {
          setIsDemoMode(false)
          setDemoOTP(null)
        }
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
              {step === 'contact' ? (
                <PhoneIcon className="w-8 h-8 text-blue-600" />
              ) : (
                <LockClosedIcon className="w-8 h-8 text-blue-600" />
              )}
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              {step === 'contact' ? 'Patient Portal Login' : 'Verify Your Identity'}
            </h1>
            <p className="text-gray-600">
              {step === 'contact'
                ? 'Enter your email address or phone number to receive a verification code'
                : `Enter the 6-digit code sent to your ${isEmail ? 'email' : 'phone'}`}
            </p>
          </div>

          {isDemoMode && demoOTP && (
            <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800 mb-2">Your verification code:</p>
              <div className="bg-white px-4 py-3 rounded border border-blue-200">
                <div className="flex items-center justify-between">
                  <span className="text-2xl font-mono font-bold text-gray-900 tracking-widest">{demoOTP}</span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(demoOTP)
                    }}
                    className="text-xs px-3 py-1 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded font-medium transition-colors"
                  >
                    Copy
                  </button>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {step === 'contact' ? (
            <form onSubmit={contactForm.handleSubmit(handleRequestOTP)} className="space-y-6">
              <div>
                <label htmlFor="contact" className="block text-sm font-medium text-gray-700 mb-2">
                  Email Address or Phone Number
                </label>
                <input
                  {...contactForm.register('contact')}
                  type="text"
                  id="contact"
                  placeholder="email@example.com (recommended)"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled={loading}
                />
                {contactForm.formState.errors.contact && (
                  <p className="mt-2 text-sm text-red-600">{contactForm.formState.errors.contact.message}</p>
                )}
                <p className="mt-1 text-xs text-gray-500">
                  <span className="font-medium text-blue-600">Email recommended</span> - Enter the email or phone you used to register
                </p>
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
                      setStep('contact')
                      setOtp('')
                      setError('')
                      setCountdown(0)
                      setDemoOTP(null)
                      setIsDemoMode(false)
                    }}
                    className="text-blue-600 hover:text-blue-700 font-medium"
                  >
                    Use different contact method
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
