import React from 'react'
import { Suspense, lazy, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Layout } from '@/components/Layout'
import RequireRoles from '@/components/RequireRoles'
import Login from '@/pages/Login'
import { useAuthStore } from '@/stores/auth'
import { seedDemo } from '@/db/seedMbhr'
import { PWAInstallPrompt } from '@/components/PWAInstallPrompt'

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
const PharmacyStock = lazy(() => import('@/features/pharmacy/PharmacyStock'))
const RxForm = lazy(() => import('@/features/pharmacy/RxForm'))
const Dispense = lazy(() => import('@/features/pharmacy/Dispense'))
const EnhancedPharmacy = lazy(() => import('@/features/pharmacy/EnhancedPharmacy'))
const FEFODispenser = lazy(() => import('@/features/pharmacy/FEFODispenser'))
const SMSReminders = lazy(() => import('@/pages/SMSReminders'))

// Labs and appointments (Sprint 5 features)
const LabOrderForm = lazy(() => import('@/features/labs/LabOrderForm').then(m => ({ default: m.LabOrderForm })))
const LabResultsDashboard = lazy(() => import('@/features/labs/LabResultsDashboard').then(m => ({ default: m.LabResultsDashboard })))
const AppointmentCalendar = lazy(() => import('@/features/appointments/AppointmentCalendar').then(m => ({ default: m.AppointmentCalendar })))

// Patient Portal components
const PatientLogin = lazy(() => import('@/features/patient-portal/PatientLogin').then(m => ({ default: m.PatientLogin })))
const PatientRegister = lazy(() => import('@/features/patient-portal/PatientRegister').then(m => ({ default: m.PatientRegister })))
const PatientDashboard = lazy(() => import('@/features/patient-portal/PatientDashboard').then(m => ({ default: m.PatientDashboard })))
const MedicalHistory = lazy(() => import('@/features/patient-portal/MedicalHistory').then(m => ({ default: m.MedicalHistory })))
const VisitDetail = lazy(() => import('@/features/patient-portal/VisitDetail').then(m => ({ default: m.VisitDetail })))
const AppointmentRequest = lazy(() => import('@/features/patient-portal/AppointmentRequest').then(m => ({ default: m.AppointmentRequest })))

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
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

function PatientProtectedRoute({ children }: { children: React.ReactNode }) {
  const sessionToken = localStorage.getItem('patient_session_token')

  if (!sessionToken) {
    return <Navigate to="/patient/login" replace />
  }

  return <>{children}</>
}

function App() {
  useEffect(() => {
    seedDemo().catch(console.error)
  }, [])

  return (
    <ErrorBoundary>
      <PWAInstallPrompt />
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* Patient Portal Routes */}
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
                  <Route path="/appointments/request" element={<AppointmentRequest />} />
                  <Route path="/" element={<Navigate to="/patient/dashboard" replace />} />
                </Routes>
              </Suspense>
            </PatientProtectedRoute>
          }
        />

        {/* Staff Routes */}
        <Route
          path="/*"
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
                    <Route path="/" element={<Dashboard />} />
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
                    <Route path="/rx/stock" element={
                      <RequireRoles roles={['pharmacist', 'admin']}>
                        <PharmacyStock />
                      </RequireRoles>
                    } />
                    <Route path="/rx/new" element={
                      <RequireRoles roles={['doctor', 'nurse', 'admin']}>
                        <RxForm />
                      </RequireRoles>
                    } />
                    <Route path="/rx/dispense" element={
                      <RequireRoles roles={['pharmacist', 'admin']}>
                        <Dispense />
                      </RequireRoles>
                    } />
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
                    <Route path="/pharmacy/enhanced/:visitId" element={
                      <RequireRoles roles={['pharmacist', 'admin']}>
                        <EnhancedPharmacy patientId="" visitId="" onSuccess={() => {}} />
                      </RequireRoles>
                    } />
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