import { Link } from 'react-router-dom'
import {
  DevicePhoneMobileIcon,
  ClipboardDocumentListIcon,
  CalendarIcon,
  EnvelopeIcon,
  ShieldCheckIcon,
  ClockIcon,
  ArrowLeftIcon
} from '@heroicons/react/24/outline'

export function PatientPortalLanding() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50">
      <header className="bg-white/80 backdrop-blur-sm border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-gray-600 hover:text-blue-600 transition-colors font-medium"
          >
            <ArrowLeftIcon className="w-5 h-5" />
            <span>Back to Home</span>
          </Link>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
            mBHR Patient Portal
          </h1>
          <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
            Access your medical records, request appointments, and communicate with your care team anytime, anywhere.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/patient/login"
              className="inline-flex items-center justify-center px-8 py-4 bg-blue-600 text-white text-lg font-semibold rounded-xl hover:bg-blue-700 transition-colors shadow-lg hover:shadow-xl"
            >
              <DevicePhoneMobileIcon className="w-6 h-6 mr-2" />
              Login to Portal
            </Link>
            <Link
              to="/patient/register"
              className="inline-flex items-center justify-center px-8 py-4 bg-white text-blue-600 text-lg font-semibold rounded-xl hover:bg-gray-50 transition-colors border-2 border-blue-600 shadow-lg hover:shadow-xl"
            >
              Create Account
            </Link>
          </div>
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-12">
          <div className="bg-white rounded-2xl shadow-lg p-8 hover:shadow-xl transition-shadow">
            <div className="w-16 h-16 bg-blue-100 rounded-xl flex items-center justify-center mb-4">
              <ClipboardDocumentListIcon className="w-8 h-8 text-blue-600" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Medical Records</h3>
            <p className="text-gray-600">
              View your complete medical history, visit notes, prescriptions, and lab results in one secure place.
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-lg p-8 hover:shadow-xl transition-shadow">
            <div className="w-16 h-16 bg-green-100 rounded-xl flex items-center justify-center mb-4">
              <CalendarIcon className="w-8 h-8 text-green-600" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Appointments</h3>
            <p className="text-gray-600">
              Request appointments online with your preferred dates and times. Track upcoming visits easily.
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-lg p-8 hover:shadow-xl transition-shadow">
            <div className="w-16 h-16 bg-purple-100 rounded-xl flex items-center justify-center mb-4">
              <EnvelopeIcon className="w-8 h-8 text-purple-600" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Secure Messaging</h3>
            <p className="text-gray-600">
              Communicate directly with your care team for non-urgent questions and follow-ups.
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-lg p-8 hover:shadow-xl transition-shadow">
            <div className="w-16 h-16 bg-yellow-100 rounded-xl flex items-center justify-center mb-4">
              <ShieldCheckIcon className="w-8 h-8 text-yellow-600" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Secure Access</h3>
            <p className="text-gray-600">
              Your health information is protected with SMS verification and industry-standard security.
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-lg p-8 hover:shadow-xl transition-shadow">
            <div className="w-16 h-16 bg-red-100 rounded-xl flex items-center justify-center mb-4">
              <ClockIcon className="w-8 h-8 text-red-600" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">24/7 Access</h3>
            <p className="text-gray-600">
              Access your health information anytime, from any device with an internet connection.
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-lg p-8 hover:shadow-xl transition-shadow">
            <div className="w-16 h-16 bg-indigo-100 rounded-xl flex items-center justify-center mb-4">
              <DevicePhoneMobileIcon className="w-8 h-8 text-indigo-600" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Mobile Friendly</h3>
            <p className="text-gray-600">
              Optimized for smartphones and tablets. Access your health info on the go.
            </p>
          </div>
        </div>

        {/* How It Works */}
        <div className="bg-white rounded-2xl shadow-xl p-8 mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-8 text-center">How It Works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-600 text-white rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-4">
                1
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Register</h3>
              <p className="text-gray-600">
                Create your account using your phone number and date of birth. We'll verify your identity.
              </p>
            </div>

            <div className="text-center">
              <div className="w-16 h-16 bg-blue-600 text-white rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-4">
                2
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Verify</h3>
              <p className="text-gray-600">
                Receive a 6-digit code via SMS. Enter it to verify your phone number and access your account.
              </p>
            </div>

            <div className="text-center">
              <div className="w-16 h-16 bg-blue-600 text-white rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-4">
                3
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Access</h3>
              <p className="text-gray-600">
                View your medical records, request appointments, and message your care team.
              </p>
            </div>
          </div>
        </div>

        {/* FAQ Section */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl shadow-xl p-8 mb-12 text-white">
          <h2 className="text-3xl font-bold mb-6 text-center">Frequently Asked Questions</h2>
          <div className="space-y-6 max-w-3xl mx-auto">
            <div>
              <h3 className="text-xl font-bold mb-2">Who can register for the patient portal?</h3>
              <p className="text-blue-100">
                Any patient who has visited our facility and has a phone number on record can register. Your phone number and date of birth must match our records.
              </p>
            </div>

            <div>
              <h3 className="text-xl font-bold mb-2">Is my health information secure?</h3>
              <p className="text-blue-100">
                Yes! We use SMS verification for login, encrypt all data, and follow strict security practices to protect your health information.
              </p>
            </div>

            <div>
              <h3 className="text-xl font-bold mb-2">What if I don't receive my verification code?</h3>
              <p className="text-blue-100">
                Wait a few minutes as SMS can be delayed. Make sure you entered the correct phone number. You can request a new code after 10 minutes. Contact our office if problems persist.
              </p>
            </div>

            <div>
              <h3 className="text-xl font-bold mb-2">Can I use the portal for emergencies?</h3>
              <p className="text-blue-100">
                No. The patient portal is for non-urgent matters only. For medical emergencies, call emergency services or visit the nearest hospital immediately.
              </p>
            </div>

            <div>
              <h3 className="text-xl font-bold mb-2">Do I need internet access?</h3>
              <p className="text-blue-100">
                Yes, you need an internet connection (WiFi or mobile data) to access the portal. The portal works on smartphones, tablets, and computers.
              </p>
            </div>
          </div>
        </div>

        {/* Call to Action */}
        <div className="text-center bg-white rounded-2xl shadow-xl p-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">Ready to Get Started?</h2>
          <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
            Join hundreds of patients who are already using the mBHR Patient Portal to manage their health.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/patient/register"
              className="inline-flex items-center justify-center px-8 py-4 bg-green-600 text-white text-lg font-semibold rounded-xl hover:bg-green-700 transition-colors shadow-lg hover:shadow-xl"
            >
              Create Free Account
            </Link>
            <a
              href="#contact"
              className="inline-flex items-center justify-center px-8 py-4 bg-white text-gray-700 text-lg font-semibold rounded-xl hover:bg-gray-50 transition-colors border-2 border-gray-300 shadow-lg hover:shadow-xl"
            >
              Contact Support
            </a>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-12 text-center text-gray-600">
          <p className="mb-2">Med Bridge Health Reach</p>
          <p className="text-sm">Dr. Isioma Okobah Foundation</p>
          <p className="text-sm mt-4">
            For technical support, contact: support@mbhr.health
          </p>
        </div>
      </div>
    </div>
  )
}
