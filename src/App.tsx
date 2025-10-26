import React, { startTransition } from 'react'
import { Suspense, lazy, useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Layout } from '@/components/Layout'
import RequireRoles from '@/components/RequireRoles'
import Login from '@/pages/Login'
import { useAuthStore } from '@/stores/auth'
import { seedDemo } from '@/db/seedMbhr'
import { PWAInstallPrompt } from '@/components/PWAInstallPrompt'
import { Home } from '@/pages/Home'
import { startPortalSyncWorker } from '@/services/portalSyncWorker'

// Core pages - loaded eagerly for initial navigation
const Dashboard = lazy(() => import('@/pages/Dashboard').then(m => ({ default: m.Dashboard })))
const Register = lazy(() => import('@/pages/Register').then(m => ({ default: m.Register })))
const Patients = lazy(() => import('@/pages/Patients').then(m => ({ default: m.Patients })))
const SimpleRegister = lazy(() => import('@/pages/SimpleRegister').then(m => ({ default: m.SimpleRegister })))

// Patient detail and workflow pages
const PatientDetail = lazy(() => import('@/pages/PatientDetail').then(m => ({ default: m.PatientDetail })))
const Queue = lazy(() => import('@/pages/Queue').then(m => ({ default: m.Queue })))
const Vitals = lazy(() => import('@/pages/Vitals').then(m => ({ default: m.Vitals })))
const Consult = lazy(() => import('@/pages/Consult').then(m => ({ default: m.Consult })))

// Pharmacy pages
const Pharmacy = lazy(() => import('@/pages/Pharmacy').then(m => ({ default: m.Pharmacy })))
const PharmacyMenu = lazy(() => import('@/pages/PharmacyMenu'))
const PharmacyReports = lazy(() => import('@/pages/PharmacyReports'))
// Temporarily disabled - corrupted files
// const PharmacyStock = lazy(() => import('@/features/pharmacy/PharmacyStock'))
// const RxForm = lazy(() => import('@/features/pharmacy/RxForm'))
// const Dispense = lazy(() => import('@/features/pharmacy/Dispense'))
// const EnhancedPharmacy = lazy(() => import('@/features/pharmacy/EnhancedPharmacy'))
// const FEFODispenser = lazy(() => import('@/features/pharmacy/FEFODispenser'))
const SMSReminders = lazy(() => import('@/pages/SMSReminders'))

// Labs and appointments (Sprint 5 features)
const LabOrderForm = lazy(() => import('@/features/labs/LabOrderForm').then(m => ({ default: m.LabOrderForm })))
const LabResultsDashboard = lazy(() => import('@/features/labs/LabResultsDashboard').then(m => ({ default: m.LabResultsDashboard })))
const AppointmentCalendar = lazy(() => import('@/features/appointments/AppointmentCalendar').then(m => ({ default: m.AppointmentCalendar })))

// Portal admin pages
const PortalDashboard = lazy(() => import('@/pages/admin/PortalDashboard').then(m => ({ default: m.PortalDashboard })))
const PortalMigration = lazy(() => import('@/pages/admin/PortalMigration').then(m => ({ default: m.PortalMigration })))
const BulkPortalMigration = lazy(() => import('@/pages/admin/BulkPortalMigration').then(m => ({ default: m.BulkPortalMigration })))
const EmailDiagnostics = lazy(() => import('@/pages/admin/EmailDiagnostics'))

// Patient Portal components
const PatientPortalLanding = lazy(() => import('@/features/patient-portal/PatientPortalLanding').then(m => ({ default: m.PatientPortalLanding })))
const PatientLogin = lazy(() => import('@/features/patient-portal/PatientLogin').then(m => ({ default: m.PatientLogin })))
const PatientRegister = lazy(() => import('@/features/patient-portal/PatientRegister').then(m => ({ default: m.PatientRegister })))
const PatientDashboard = lazy(() => import('@/features/patient-portal/PatientDashboard').then(m => ({ default: m.PatientDashboard })))
const MedicalHistory = lazy(() => import('@/features/patient-portal/MedicalHistory').then(m => ({ default: m.MedicalHistory })))
const VisitDetail = lazy(() => import('@/features/patient-portal/VisitDetail').then(m => ({ default: m.VisitDetail })))
const AppointmentRequest = lazy(() => import('@/features/patient-portal/AppointmentRequest').then(m => ({ default: m.AppointmentRequest })))
const BillingPayments = lazy(() => import('@/features/patient-portal/BillingPayments').then(m => ({ default: m.BillingPayments })))
const PreVisitForms = lazy(() => import('@/features/patient-portal/PreVisitForms').then(m => ({ default: m.PreVisitForms })))
const PrescriptionRefills = lazy(() => import('@/features/patient-portal/PrescriptionRefills').then(m => ({ default: m.PrescriptionRefills })))
const Telehealth = lazy(() => import('@/features/patient-portal/Telehealth').then(m => ({ default: m.Telehealth })))

// Inventory and gamification
const Inventory = lazy(() => import('@/pages/Inventory').then(m => ({ default: m.Inventory })))
const RestockGame = lazy(() => import('@/features/inventory/RestockGame'))
const PrizeShop = lazy(() => import('@/features/inventory/PrizeShop'))

// Queue/ticket management
const QueueBoard = lazy(() => import('@/features/tickets/QueueBoard'))
const TicketIssuer = lazy(() => import('@/features/tickets/TicketIssuer'))
const PublicDisplay = lazy(() => import('@/features/tickets/PublicDisplay'))

// Gamification features
const GameHub = lazy(() => import('@/components/GameHub').then(m => ({ default: m.GameHub })))
const QuestBoard = lazy(() => import('@/components/QuestBoard').then(m => ({ default: m.QuestBoard })))
const Leaderboard = lazy(() => import('@/features/gamification/Leaderboard'))
const QueueMaestro = lazy(() => import('@/features/gamification/QueueMaestro'))
const KnowledgeBlitz = lazy(() => import('@/features/gamification/KnowledgeBlitz'))
const VitalsPrecisionGame = lazy(() => import('@/features/vitals/VitalsPrecisionGame'))
const ApprovalInbox = lazy(() => import('@/features/gamification/ApprovalInbox'))

// Triage features
const TriageSprint = lazy(() => import('@/features/triage/TriageSprint'))
const QuickTriage = lazy(() => import('@/features/triage/QuickTriage'))

// Analytics (admin only)
const AnalyticsDashboard = lazy(() => import('@/features/analytics/AnalyticsDashboard'))

// Admin
const Users = lazy(() => import('@/pages/Users').then(m => ({ default: m.Users })))

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore()

  if (!isAuthenticated) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

function PatientProtectedRoute({ children }: { children: React.ReactNode }) {
  const [isValidating, setIsValidating] = React.useState(true)
  const [isValid, setIsValid] = React.useState(false)

  React.useEffect(() => {
    const validateSession = async () => {
      const sessionToken = localStorage.getItem('patient_session_token')
      const portalUser = localStorage.getItem('patient_portal_user')

      console.log('[PatientProtectedRoute] Validating session...', {
        hasToken: !!sessionToken,
        hasUser: !!portalUser,
        token: sessionToken?.substring(0, 8) + '...'
      })

      if (!sessionToken || !portalUser) {
        console.log('[PatientProtectedRoute] No session or user found')
        setIsValid(false)
        setIsValidating(false)
        return
      }

      try {
        const { supabase } = await import('@/lib/supabase')
        console.log('[PatientProtectedRoute] Querying session from database...')

        const { data, error } = await supabase
          .from('patient_portal_sessions')
          .select('id, expires_at, is_active')
          .eq('session_token', sessionToken)
          .eq('is_active', true)
          .maybeSingle()

        console.log('[PatientProtectedRoute] Query result:', { data, error })

        if (error) {
          console.error('[PatientProtectedRoute] Database error:', error)
          localStorage.removeItem('patient_session_token')
          localStorage.removeItem('patient_portal_user')
          setIsValid(false)
          setIsValidating(false)
          return
        }

        if (!data) {
          console.log('[PatientProtectedRoute] No session found in database')
          localStorage.removeItem('patient_session_token')
          localStorage.removeItem('patient_portal_user')
          setIsValid(false)
          setIsValidating(false)
          return
        }

        const expiresAt = new Date(data.expires_at)
        const now = new Date()
        console.log('[PatientProtectedRoute] Session expires:', expiresAt, 'Now:', now, 'Valid:', expiresAt > now)

        if (expiresAt < now) {
          console.log('[PatientProtectedRoute] Session expired')
          localStorage.removeItem('patient_session_token')
          localStorage.removeItem('patient_portal_user')
          setIsValid(false)
          setIsValidating(false)
          return
        }

        console.log('[PatientProtectedRoute] Session is valid!')
        setIsValid(true)
        setIsValidating(false)
      } catch (err) {
        console.error('[PatientProtectedRoute] Exception during validation:', err)
        setIsValid(false)
        setIsValidating(false)
      }
    }

    validateSession()
  }, [])

  if (isValidating) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Validating session...</p>
        </div>
      </div>
    )
  }

  if (!isValid) {
    return <Navigate to="/patient/login" replace />
  }

  return <>{children}</>
}

function App() {
  useEffect(() => {
    seedDemo().catch(console.error)

    // Start background portal sync worker
    startPortalSyncWorker()
  }, [])

  return (
    <ErrorBoundary>
      <PWAInstallPrompt />
      <Routes>
        {/* Public Routes - Must be defined before catch-all */}
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />

        {/* Patient Portal Routes */}
        <Route path="/patient" element={<PatientPortalLanding />} />
        <Route path="/patient/login" element={<PatientLogin />} />
        <Route path="/patient/register" element={<PatientRegister />} />
        <Route
          path="/patient/*"
          element={
            <PatientProtectedRoute>
              <Suspense fallback={
                <div className="min-h-screen flex items-center justify-center">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                    <p className="mt-4 text-gray-600">Loading...</p>
                  </div>
                </div>
              }>
                <Routes>
                  <Route path="/dashboard" element={<PatientDashboard />} />
                  <Route path="/medical-history" element={<MedicalHistory />} />
                  <Route path="/visit/:visitId" element={<VisitDetail />} />
                  <Route path="/appointments" element={<AppointmentRequest />} />
                  <Route path="/appointments/request" element={<AppointmentRequest />} />
                  <Route path="/billing" element={<BillingPayments />} />
                  <Route path="/forms" element={<PreVisitForms />} />
                  <Route path="/prescriptions" element={<PrescriptionRefills />} />
                  <Route path="/telehealth" element={<Telehealth />} />
                  <Route path="/" element={<Navigate to="/patient/dashboard" replace />} />
                </Routes>
              </Suspense>
            </PatientProtectedRoute>
          }
        />

        {/* Staff Routes - catch-all for authenticated routes */}
        <Route
          path="*"
          element={
            <ProtectedRoute>
              <Suspense fallback={
                <div className="min-h-screen flex items-center justify-center">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
                    <p className="mt-4 text-gray-600">Loading...</p>
                  </div>
                </div>
              }>
                <Layout>
                  <Routes>
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/register" element={<Register />} />
                    <Route path="/patients" element={<Patients />} />
                    <Route path="/patients/:id" element={<PatientDetail />} />
                    <Route path="/queue" element={<Queue />} />
                    <Route path="/inventory" element={<Inventory />} />
                    <Route path="/users" element={<Users />} />
                    <Route path="/vitals" element={<Vitals />} />
                    <Route path="/vitals/:visitId" element={<Vitals />} />
                    <Route path="/consult" element={<Consult />} />
                    <Route path="/consult/:visitId" element={<Consult />} />
                    <Route path="/pharmacy" element={<Pharmacy />} />
                    <Route path="/pharmacy/:visitId" element={<Pharmacy />} />
                    
                    {/* New MBHR Features */}
                    <Route path="/inv/game" element={
                      <RequireRoles roles={['volunteer', 'nurse', 'admin']}>
                        <RestockGame />
                      </RequireRoles>
                    } />
                    <Route path="/inv/prizes" element={
                      <RequireRoles roles={['volunteer', 'nurse', 'admin']}>
                        <PrizeShop />
                      </RequireRoles>
                    } />
                    {/* Temporarily disabled - corrupted file
                    <Route path="/rx/stock" element={
                      <RequireRoles roles={['pharmacist', 'admin']}>
                        <PharmacyStock />
                      </RequireRoles>
                    } />
                    */}
                    {/* Temporarily disabled - corrupted file
                    <Route path="/rx/new" element={
                      <RequireRoles roles={['doctor', 'nurse', 'admin']}>
                        <RxForm />
                      </RequireRoles>
                    } />
                    */}
                    {/* Temporarily disabled - corrupted file
                    <Route path="/rx/dispense" element={
                      <RequireRoles roles={['pharmacist', 'admin']}>
                        <Dispense />
                      </RequireRoles>
                    } />
                    */}
                    <Route path="/tickets/queue" element={
                      <RequireRoles roles={['nurse', 'doctor', 'admin']}>
                        <QueueBoard />
                      </RequireRoles>
                    } />
                    <Route path="/tickets/issue" element={
                      <RequireRoles roles={['volunteer', 'nurse', 'doctor', 'admin']}>
                        <TicketIssuer />
                      </RequireRoles>
                    } />
                    <Route path="/inv/leaderboard" element={
                      <RequireRoles roles={['volunteer', 'nurse', 'admin']}>
                        <Leaderboard />
                      </RequireRoles>
                    } />
                    <Route path="/display" element={<PublicDisplay />} />
                    <Route path="/quests" element={<QuestBoard />} />
                    <Route path="/games/queue-maestro" element={
                      <RequireRoles roles={['volunteer', 'nurse', 'admin']}>
                        <QueueMaestro />
                      </RequireRoles>
                    } />
                    <Route path="/games" element={<GameHub />} />
                    <Route path="/games/vitals-precision" element={
                      <RequireRoles roles={['volunteer', 'nurse', 'admin']}>
                        <VitalsPrecisionGame />
                      </RequireRoles>
                    } />
                    <Route path="/games/knowledge-blitz" element={
                      <RequireRoles roles={['volunteer', 'nurse', 'admin']}>
                        <KnowledgeBlitz />
                      </RequireRoles>
                    } />
                    <Route path="/games/triage-sprint" element={
                      <RequireRoles roles={['nurse', 'doctor', 'admin']}>
                        <TriageSprint />
                      </RequireRoles>
                    } />
                    <Route path="/games/vitals-precision-enhanced" element={
                      <RequireRoles roles={['volunteer', 'nurse', 'admin']}>
                        <VitalsPrecisionGame />
                      </RequireRoles>
                    } />
                    <Route path="/analytics" element={
                      <RequireRoles roles={['admin']}>
                        <AnalyticsDashboard />
                      </RequireRoles>
                    } />
                    <Route path="/admin/approvals" element={
                      <RequireRoles roles={['admin']}>
                        <ApprovalInbox />
                      </RequireRoles>
                    } />
                    <Route path="/admin/portal-dashboard" element={
                      <RequireRoles roles={['admin']}>
                        <PortalDashboard />
                      </RequireRoles>
                    } />
                    <Route path="/admin/portal-migration" element={
                      <RequireRoles roles={['admin']}>
                        <PortalMigration />
                      </RequireRoles>
                    } />
                    <Route path="/admin/bulk-portal-migration" element={
                      <RequireRoles roles={['admin']}>
                        <BulkPortalMigration />
                      </RequireRoles>
                    } />
                    <Route path="/admin/email-diagnostics" element={
                      <RequireRoles roles={['admin']}>
                        <EmailDiagnostics />
                      </RequireRoles>
                    } />
                    <Route path="/simple/register" element={<SimpleRegister />} />
                    <Route path="/pharmacy" element={<PharmacyMenu />} />
                    <Route path="/pharmacy/reports" element={
                      <RequireRoles roles={['pharmacist', 'admin']}>
                        <PharmacyReports />
                      </RequireRoles>
                    } />
                    <Route path="/pharmacy/sms-reminders" element={
                      <RequireRoles roles={['pharmacist', 'admin']}>
                        <SMSReminders />
                      </RequireRoles>
                    } />
                    {/* Temporarily disabled - corrupted file
                    <Route path="/pharmacy/enhanced/:visitId" element={
                      <RequireRoles roles={['pharmacist', 'admin']}>
                        <EnhancedPharmacy patientId="" visitId="" onSuccess={() => {}} />
                      </RequireRoles>
                    } />
                    */}
                    <Route path="/labs" element={
                      <RequireRoles roles={['doctor', 'nurse', 'admin']}>
                        <LabResultsDashboard userId="" />
                      </RequireRoles>
                    } />
                    <Route path="/appointments" element={
                      <RequireRoles roles={['doctor', 'nurse', 'volunteer', 'admin']}>
                        <AppointmentCalendar createdBy="" />
                      </RequireRoles>
                    } />
                    <Route path="/triage/quick" element={
                      <RequireRoles roles={['nurse', 'doctor', 'admin']}>
                        <QuickTriage onComplete={() => {}} />
                      </RequireRoles>
                    } />
                  </Routes>
                </Layout>
              </Suspense>
            </ProtectedRoute>
          }
        />
      </Routes>
    </ErrorBoundary>
  )
}

export default App