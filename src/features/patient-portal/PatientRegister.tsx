import { useState, startTransition } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowRightIcon, PhoneIcon, CalendarIcon, CheckCircleIcon } from '@heroicons/react/24/outline'
import { requestOTP, registerPatientPortalAccount } from '@/services/patientPortalAuth'
import { OTPInput } from './OTPInput'

const registrationSchema = z.object({
  phone: z.string().min(10, 'Phone number must be at least 10 digits').regex(/^\+?[\d\s-]+$/, 'Invalid phone number').optional().or(z.literal('')),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  consentGiven: z.boolean().refine(val => val === true, 'You must accept the terms to continue')
}).refine(data => data.phone || data.email, {
  message: 'Please provide either a phone number or email address',
  path: ['phone']
})

type RegistrationForm = z.infer<typeof registrationSchema>

export function PatientRegister() {
  const navigate = useNavigate()
  const [step, setStep] = useState<'info' | 'otp' | 'success'>('info')
  const [formData, setFormData] = useState<RegistrationForm | null>(null)
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [demoOTP, setDemoOTP] = useState<string | null>(null)
  const [isDemoMode, setIsDemoMode] = useState(false)

  const form = useForm<RegistrationForm>({
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      phone: '',
      email: '',
      dob: '',
      consentGiven: false
    }
  })

  const handleSubmitInfo = async (data: RegistrationForm) => {
    setLoading(true)
    setError('')

    if (!data.phone && !data.email) {
      setError('Please provide either a phone number or email address')
      setLoading(false)
      return
    }

    try {
      const result = await requestOTP({
        phone: data.phone || undefined,
        email: data.email || undefined,
        purpose: 'registration'
      })

      if (result.success) {
        setFormData(data)
        setStep('otp')

        if (result.demoMode && result.demoOTP) {
          setIsDemoMode(true)
          setDemoOTP(result.demoOTP)
        } else {
          setIsDemoMode(false)
          setDemoOTP(null)
        }
      } else {
        setError(result.error || 'Failed to send verification code')
      }
    } catch (err) {
      setError('An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyOTP = async () => {
    if (!formData || otp.length !== 6) {
      setError('Please enter complete 6-digit code')
      return
    }

    setLoading(true)
    setError('')

    try {
      const result = await registerPatientPortalAccount(
        formData.phone || undefined,
        formData.email || undefined,
        otp,
        formData.dob
      )

      if (result.success && result.sessionToken) {
        localStorage.setItem('patient_session_token', result.sessionToken)
        localStorage.setItem('patient_portal_user', JSON.stringify(result.portalUser))
        setStep('success')
        setTimeout(() => startTransition(() => navigate('/patient/dashboard')), 2000)
      } else {
        setError(result.error || 'Registration failed')
        setOtp('')
      }
    } catch (err) {
      setError('An error occurred. Please try again.')
      setOtp('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-green-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          {step === 'info' && (
            <>
              <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
                  <PhoneIcon className="w-8 h-8 text-green-600" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">Create Your Account</h1>
                <p className="text-gray-600">Join the mBHR Patient Portal for easy access to your health records</p>
              </div>

              {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              )}

              <form onSubmit={form.handleSubmit(handleSubmitInfo)} className="space-y-6">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                    Email Address
                  </label>
                  <input
                    {...form.register('email')}
                    type="email"
                    id="email"
                    placeholder="your.email@example.com (recommended)"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    disabled={loading}
                  />
                  {form.formState.errors.email && (
                    <p className="mt-2 text-sm text-red-600">{form.formState.errors.email.message}</p>
                  )}
                  <p className="mt-1 text-xs text-gray-500">
                    <span className="font-medium text-green-600">Recommended</span> - Must match your patient record
                  </p>
                </div>

                <div>
                  <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-2">
                    Phone Number (Optional)
                  </label>
                  <input
                    {...form.register('phone')}
                    type="tel"
                    id="phone"
                    placeholder="+234 XXX XXX XXXX"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    disabled={loading}
                  />
                  {form.formState.errors.phone && (
                    <p className="mt-2 text-sm text-red-600">{form.formState.errors.phone.message}</p>
                  )}
                  <p className="mt-1 text-xs text-gray-500">If provided, must match your patient record</p>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-xs text-blue-800">
                    <span className="font-medium">Email recommended:</span> You must provide at least one contact method
                  </p>
                </div>

                <div>
                  <label htmlFor="dob" className="block text-sm font-medium text-gray-700 mb-2">
                    Date of Birth *
                  </label>
                  <input
                    {...form.register('dob')}
                    type="date"
                    id="dob"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    disabled={loading}
                  />
                  {form.formState.errors.dob && (
                    <p className="mt-2 text-sm text-red-600">{form.formState.errors.dob.message}</p>
                  )}
                  <p className="mt-1 text-xs text-gray-500">This must match your patient record date of birth</p>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-blue-900 mb-2">Identity Verification</h3>
                  <p className="text-xs text-blue-800">
                    To protect your privacy, we'll verify your identity by matching your contact information and date of birth
                    with our patient records.
                  </p>
                </div>

                <div className="flex items-start gap-3">
                  <input
                    {...form.register('consentGiven')}
                    type="checkbox"
                    id="consent"
                    className="mt-1 w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
                    disabled={loading}
                  />
                  <label htmlFor="consent" className="text-sm text-gray-700">
                    I agree to the{' '}
                    <a href="#" className="text-green-600 hover:text-green-700 font-medium">
                      Terms of Service
                    </a>{' '}
                    and{' '}
                    <a href="#" className="text-green-600 hover:text-green-700 font-medium">
                      Privacy Policy
                    </a>
                    . I consent to access my medical records through this portal.
                  </label>
                </div>
                {form.formState.errors.consentGiven && (
                  <p className="text-sm text-red-600">{form.formState.errors.consentGiven.message}</p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 bg-green-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      Continue to Verification
                      <ArrowRightIcon className="w-5 h-5" />
                    </>
                  )}
                </button>

                <div className="text-center">
                  <p className="text-sm text-gray-600">
                    Already have an account?{' '}
                    <button
                      type="button"
                      onClick={() => navigate('/patient/login')}
                      className="text-green-600 hover:text-green-700 font-medium"
                    >
                      Login here
                    </button>
                  </p>
                </div>
              </form>
            </>
          )}

          {step === 'otp' && (
            <>
              <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
                  <CalendarIcon className="w-8 h-8 text-green-600" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">Verify Your Identity</h1>
                <p className="text-gray-600">Enter the 6-digit code sent to {formData?.phone || formData?.email}</p>
              </div>

              {isDemoMode && demoOTP && (
                <div className="mb-6 p-4 bg-yellow-50 border-2 border-yellow-400 rounded-lg">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0">
                      <svg className="w-5 h-5 text-yellow-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h3 className="text-sm font-semibold text-yellow-800 mb-1">Development Mode Active</h3>
                      <p className="text-sm text-yellow-700 mb-2">
                        Email/SMS delivery is not configured. Use this code for testing:
                      </p>
                      <div className="bg-white px-4 py-3 rounded border border-yellow-300">
                        <div className="flex items-center justify-between">
                          <span className="text-2xl font-mono font-bold text-gray-900 tracking-widest">{demoOTP}</span>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(demoOTP)
                              setError('Code copied to clipboard!')
                              setTimeout(() => setError(''), 2000)
                            }}
                            className="text-xs px-3 py-1 bg-yellow-100 hover:bg-yellow-200 text-yellow-800 rounded font-medium transition-colors"
                          >
                            Copy
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-yellow-600 mt-2">
                        For production use, configure Resend API key in Supabase Edge Functions.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              )}

              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-4 text-center">
                    Verification Code
                  </label>
                  <OTPInput value={otp} onChange={setOtp} disabled={loading} error={!!error} />
                </div>

                <button
                  onClick={handleVerifyOTP}
                  disabled={loading || otp.length !== 6}
                  className="w-full flex items-center justify-center gap-2 bg-green-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Creating Account...
                    </>
                  ) : (
                    <>
                      Complete Registration
                      <ArrowRightIcon className="w-5 h-5" />
                    </>
                  )}
                </button>

                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setStep('info')
                      setOtp('')
                      setError('')
                      setDemoOTP(null)
                      setIsDemoMode(false)
                    }}
                    className="text-sm text-green-600 hover:text-green-700 font-medium"
                  >
                    Go back to edit information
                  </button>
                </div>
              </div>
            </>
          )}

          {step === 'success' && (
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-full mb-6">
                <CheckCircleIcon className="w-12 h-12 text-green-600" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">Account Created!</h1>
              <p className="text-gray-600 mb-6">
                Welcome to the mBHR Patient Portal. You'll be redirected to your dashboard shortly.
              </p>
              <div className="flex justify-center">
                <div className="w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full animate-spin" />
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
