import { useState, startTransition } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowRightIcon, PhoneIcon, CalendarIcon, CheckCircleIcon } from '@heroicons/react/24/outline'
import { requestOTP, registerPatientPortalAccount } from '@/services/patientPortalAuth'
import { OTPInput } from './OTPInput'

const registrationSchema = z.object({
  givenName: z.string().min(1, 'First name is required'),
  familyName: z.string().min(1, 'Last name is required'),
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
      givenName: '',
      familyName: '',
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
        formData.dob,
        formData.givenName,
        formData.familyName
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
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="givenName" className="block text-sm font-medium text-gray-700 mb-2">
                      First Name *
                    </label>
                    <input
                      {...form.register('givenName')}
                      type="text"
                      id="givenName"
                      placeholder="First name"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      disabled={loading}
                    />
                    {form.formState.errors.givenName && (
                      <p className="mt-2 text-sm text-red-600">{form.formState.errors.givenName.message}</p>
                    )}
                  </div>
                  <div>
                    <label htmlFor="familyName" className="block text-sm font-medium text-gray-700 mb-2">
                      Last Name *
                    </label>
                    <input
                      {...form.register('familyName')}
                      type="text"
                      id="familyName"
                      placeholder="Last name"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      disabled={loading}
                    />
                    {form.formState.errors.familyName && (
                      <p className="mt-2 text-sm text-red-600">{form.formState.errors.familyName.message}</p>
                    )}
                  </div>
                </div>

                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                    Email Address *
                  </label>
                  <input
                    {...form.register('email')}
                    type="email"
                    id="email"
                    placeholder="your.email@example.com"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    disabled={loading}
                  />
                  {form.formState.errors.email && (
                    <p className="mt-2 text-sm text-red-600">{form.formState.errors.email.message}</p>
                  )}
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
                <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-sm text-green-800 mb-2">Your verification code:</p>
                  <div className="bg-white px-4 py-3 rounded border border-green-200">
                    <div className="flex items-center justify-between">
                      <span className="text-2xl font-mono font-bold text-gray-900 tracking-widest">{demoOTP}</span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(demoOTP)
                        }}
                        className="text-xs px-3 py-1 bg-green-100 hover:bg-green-200 text-green-800 rounded font-medium transition-colors"
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

        <div className="mt-6 text-center space-y-3">
          <button
            type="button"
            onClick={() => navigate('/patient')}
            className="text-sm text-green-600 hover:text-green-700 font-medium"
          >
            Back to Home
          </button>
          <div className="text-sm text-gray-600">
            <p>Med Bridge Health Reach</p>
            <p className="mt-1">Secure patient portal powered by mBHR</p>
          </div>
        </div>
      </div>
    </div>
  )
}
